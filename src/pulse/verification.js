/**
 * Pulse Verification — 7-step commit-reveal protocol.
 *
 * Every ~90 seconds a "pulse round" runs:
 *   1. VRF leader election — deterministic from round seed
 *   2. Seed broadcast — leader sends seed to committee
 *   3. Matrix computation — each node does matmul with WASM seed
 *   4. Merkle commitment — hash of result matrix rows
 *   5. Random index challenge — leader picks rows to verify
 *   6. Proof reveal — nodes send Merkle proofs for challenged rows
 *   7. Verification + reward — valid proofs earn SPL tokens
 *
 * This proves the node is actually running compute and not just idling.
 */

import crypto from "crypto";

const PULSE_INTERVAL_MS = 90_000; // ~90 seconds
const MATRIX_SIZE = 256; // N×N matrix for matmul challenge
const CHALLENGE_ROWS = 4; // How many rows the leader challenges

/**
 * VRF-based leader election.
 * Deterministic given (roundSeed, peerList) — every node computes the same leader.
 *
 * @param {Buffer} roundSeed - Seed for this round
 * @param {string[]} peerIds - All known peer IDs
 * @returns {string} The elected leader's peer ID
 */
export function electLeader(roundSeed, peerIds) {
  if (peerIds.length === 0) return null;

  // Sort deterministically
  const sorted = [...peerIds].sort();

  // Hash seed to get index
  const hash = crypto.createHash("sha256").update(roundSeed).digest();
  const index = hash.readUInt32BE(0) % sorted.length;
  return sorted[index];
}

/**
 * Generate a deterministic seed for a pulse round.
 */
export function roundSeed(roundNumber, networkSeed = "agi-network-v1") {
  return crypto
    .createHash("sha256")
    .update(`${networkSeed}:${roundNumber}`)
    .digest();
}

/**
 * Generate a deterministic matrix from a seed.
 * Uses the seed as PRNG state to create an N×N float32 matrix.
 */
export function generateMatrix(seed, size = MATRIX_SIZE) {
  const matrix = new Float32Array(size * size);
  let state = crypto.createHash("sha256").update(seed).digest();

  for (let i = 0; i < size * size; i++) {
    if (i % 8 === 0) {
      state = crypto.createHash("sha256").update(state).digest();
    }
    // Extract a float from 4 bytes of the hash
    matrix[i] = state.readUInt32BE((i % 8) * 4 % 28) / 0xffffffff;
  }

  return matrix;
}

/**
 * Perform matrix multiplication C = A × B.
 * Both A and B are N×N stored as flat Float32Arrays.
 */
export function matmul(a, b, n = MATRIX_SIZE) {
  const c = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < n; k++) {
      const aik = a[i * n + k];
      for (let j = 0; j < n; j++) {
        c[i * n + j] += aik * b[k * n + j];
      }
    }
  }
  return c;
}

/**
 * Build a Merkle tree from matrix rows.
 * Returns { root, leaves, tree } where tree[i] are the hashes at each level.
 */
export function buildMerkleTree(matrix, n = MATRIX_SIZE) {
  // Hash each row
  const leaves = [];
  for (let i = 0; i < n; i++) {
    const row = Buffer.from(matrix.buffer, i * n * 4, n * 4);
    leaves.push(crypto.createHash("sha256").update(row).digest());
  }

  // Build tree bottom-up
  const tree = [leaves];
  let current = leaves;

  while (current.length > 1) {
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i];
      const right = current[i + 1] || left; // duplicate if odd
      next.push(
        crypto.createHash("sha256").update(Buffer.concat([left, right])).digest()
      );
    }
    tree.push(next);
    current = next;
  }

  return { root: current[0], leaves, tree };
}

/**
 * Generate a Merkle proof for a specific row index.
 */
export function merkleProof(tree, index) {
  const proof = [];
  let idx = index;

  for (let level = 0; level < tree.length - 1; level++) {
    const layer = tree[level];
    const isRight = idx % 2 === 1;
    const siblingIdx = isRight ? idx - 1 : idx + 1;
    const sibling = siblingIdx < layer.length ? layer[siblingIdx] : layer[idx];
    proof.push({ hash: sibling, isRight: !isRight });
    idx = Math.floor(idx / 2);
  }

  return proof;
}

/**
 * Verify a Merkle proof.
 */
export function verifyMerkleProof(leafHash, proof, root) {
  let current = leafHash;

  for (const step of proof) {
    const [left, right] = step.isRight
      ? [current, step.hash]
      : [step.hash, current];
    current = crypto
      .createHash("sha256")
      .update(Buffer.concat([left, right]))
      .digest();
  }

  return current.equals(root);
}

/**
 * Select random challenge rows from the result matrix.
 */
export function selectChallengeRows(seed, n = MATRIX_SIZE, count = CHALLENGE_ROWS) {
  const hash = crypto.createHash("sha256").update(Buffer.concat([seed, Buffer.from("challenge")])).digest();
  const indices = new Set();

  let state = hash;
  while (indices.size < count) {
    state = crypto.createHash("sha256").update(state).digest();
    indices.add(state.readUInt32BE(0) % n);
  }

  return [...indices];
}

/**
 * Pulse round runner — orchestrates the full 7-step protocol.
 */
export class PulseRunner {
  constructor({ peerId, onReward, logger = console, startRound = 0 }) {
    this.peerId = peerId;
    this.roundNumber = startRound;
    this.onReward = onReward;
    this.logger = logger;
    this.timer = null;
  }

  /**
   * Run one pulse round locally (for solo/small-network operation).
   * In a full network, steps 2-6 happen over GossipSub.
   */
  runRound(knownPeers = []) {
    this.roundNumber++;
    const seed = roundSeed(this.roundNumber);

    // Step 1: Leader election
    const allPeers = [this.peerId, ...knownPeers];
    const leader = electLeader(seed, allPeers);
    const isLeader = leader === this.peerId;

    this.logger.log(
      `[pulse] Round ${this.roundNumber} — leader: ${leader}${isLeader ? " (me)" : ""}`
    );

    // Step 3: Matrix computation
    const a = generateMatrix(seed, MATRIX_SIZE);
    const b = generateMatrix(
      crypto.createHash("sha256").update(Buffer.concat([seed, Buffer.from("B")])).digest(),
      MATRIX_SIZE
    );
    const c = matmul(a, b, MATRIX_SIZE);

    // Step 4: Merkle commitment
    const { root, tree } = buildMerkleTree(c, MATRIX_SIZE);

    // Step 5: Challenge rows (leader generates, all verify)
    const challengeRows = selectChallengeRows(seed, MATRIX_SIZE, CHALLENGE_ROWS);

    // Step 6: Proof reveal
    const proofs = challengeRows.map((rowIdx) => ({
      rowIdx,
      rowData: Buffer.from(c.buffer, rowIdx * MATRIX_SIZE * 4, MATRIX_SIZE * 4),
      proof: merkleProof(tree, rowIdx),
    }));

    // Step 7: Self-verify and reward
    let valid = true;
    for (const p of proofs) {
      const leafHash = crypto.createHash("sha256").update(p.rowData).digest();
      if (!verifyMerkleProof(leafHash, p.proof, root)) {
        valid = false;
        break;
      }
    }

    if (valid && this.onReward) {
      this.onReward(this.roundNumber);
    }

    return {
      round: this.roundNumber,
      leader,
      commitment: root.toString("hex"),
      challengeRows,
      valid,
    };
  }

  /**
   * Start the periodic pulse loop.
   */
  start(knownPeersFn = () => []) {
    this.logger.log(`[pulse] Starting pulse runner (interval: ${PULSE_INTERVAL_MS / 1000}s)`);
    this.timer = setInterval(() => {
      try {
        this.runRound(knownPeersFn());
      } catch (err) {
        this.logger.error(`[pulse] Round error: ${err.message}`);
      }
    }, PULSE_INTERVAL_MS);

    // Run first round immediately
    this.runRound(knownPeersFn());
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
