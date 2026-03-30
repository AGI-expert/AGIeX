import { describe, it, expect, vi, afterEach } from "vitest";
import {
  electLeader,
  roundSeed,
  generateMatrix,
  matmul,
  buildMerkleTree,
  merkleProof,
  verifyMerkleProof,
  selectChallengeRows,
  PulseRunner,
} from "../src/pulse/verification.js";

const SILENT = { log: () => {}, error: () => {} };

describe("Pulse Verification", () => {
  describe("roundSeed", () => {
    it("produces deterministic 32-byte seed", () => {
      const seed1 = roundSeed(1);
      const seed2 = roundSeed(1);
      expect(seed1.equals(seed2)).toBe(true);
      expect(seed1.length).toBe(32);
    });

    it("different rounds produce different seeds", () => {
      const seed1 = roundSeed(1);
      const seed2 = roundSeed(2);
      expect(seed1.equals(seed2)).toBe(false);
    });

    it("accepts custom network seed", () => {
      const s1 = roundSeed(1, "net-a");
      const s2 = roundSeed(1, "net-b");
      expect(s1.equals(s2)).toBe(false);
    });

    it("handles large round numbers", () => {
      const s = roundSeed(Number.MAX_SAFE_INTEGER);
      expect(s.length).toBe(32);
    });
  });

  describe("electLeader", () => {
    it("returns null for empty peer list", () => {
      const seed = roundSeed(1);
      expect(electLeader(seed, [])).toBeNull();
    });

    it("returns deterministic leader", () => {
      const seed = roundSeed(42);
      const peers = ["peerA", "peerB", "peerC"];
      const leader1 = electLeader(seed, peers);
      const leader2 = electLeader(seed, peers);
      expect(leader1).toBe(leader2);
      expect(peers).toContain(leader1);
    });

    it("is independent of peer order", () => {
      const seed = roundSeed(42);
      const leader1 = electLeader(seed, ["peerA", "peerB", "peerC"]);
      const leader2 = electLeader(seed, ["peerC", "peerA", "peerB"]);
      expect(leader1).toBe(leader2);
    });

    it("returns the only peer if list has one", () => {
      const seed = roundSeed(1);
      expect(electLeader(seed, ["onlyPeer"])).toBe("onlyPeer");
    });

    it("distributes leadership across peers over many rounds", () => {
      const peers = ["a", "b", "c", "d", "e"];
      const leaders = new Set();
      for (let round = 0; round < 100; round++) {
        leaders.add(electLeader(roundSeed(round), peers));
      }
      expect(leaders.size).toBeGreaterThan(1);
    });
  });

  describe("generateMatrix", () => {
    it("produces N×N Float32Array", () => {
      const seed = roundSeed(1);
      const m = generateMatrix(seed, 8);
      expect(m).toBeInstanceOf(Float32Array);
      expect(m.length).toBe(64);
    });

    it("is deterministic", () => {
      const seed = roundSeed(1);
      const m1 = generateMatrix(seed, 8);
      const m2 = generateMatrix(seed, 8);
      expect(Array.from(m1)).toEqual(Array.from(m2));
    });

    it("values are in [0, 1]", () => {
      const seed = roundSeed(1);
      const m = generateMatrix(seed, 16);
      for (const v of m) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    });

    it("produces different matrices for different seeds", () => {
      const m1 = generateMatrix(roundSeed(1), 4);
      const m2 = generateMatrix(roundSeed(2), 4);
      expect(Array.from(m1)).not.toEqual(Array.from(m2));
    });

    it("handles size 1", () => {
      const m = generateMatrix(roundSeed(1), 1);
      expect(m.length).toBe(1);
    });

    it("handles non-power-of-2 size", () => {
      const m = generateMatrix(roundSeed(1), 7);
      expect(m.length).toBe(49);
    });
  });

  describe("matmul", () => {
    it("multiplies identity-like matrices correctly", () => {
      // 2×2 identity times a matrix should return the matrix
      const identity = new Float32Array([1, 0, 0, 1]);
      const m = new Float32Array([2, 3, 4, 5]);
      const result = matmul(identity, m, 2);
      expect(result[0]).toBeCloseTo(2);
      expect(result[1]).toBeCloseTo(3);
      expect(result[2]).toBeCloseTo(4);
      expect(result[3]).toBeCloseTo(5);
    });

    it("produces correct dimensions", () => {
      const seed = roundSeed(1);
      const a = generateMatrix(seed, 16);
      const b = generateMatrix(roundSeed(2), 16);
      const c = matmul(a, b, 16);
      expect(c.length).toBe(256);
    });

    it("multiplies zero matrix to produce zero", () => {
      const zero = new Float32Array(4);
      const any = new Float32Array([1, 2, 3, 4]);
      const result = matmul(zero, any, 2);
      for (const v of result) expect(v).toBe(0);
    });

    it("computes a known 2x2 product", () => {
      const a = new Float32Array([1, 2, 3, 4]);
      const b = new Float32Array([5, 6, 7, 8]);
      const c = matmul(a, b, 2);
      expect(c[0]).toBeCloseTo(19);
      expect(c[1]).toBeCloseTo(22);
      expect(c[2]).toBeCloseTo(43);
      expect(c[3]).toBeCloseTo(50);
    });

    it("identity * A = A for 3x3", () => {
      const n = 3;
      const identity = new Float32Array(n * n);
      for (let i = 0; i < n; i++) identity[i * n + i] = 1;
      const a = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      const c = matmul(identity, a, n);
      for (let i = 0; i < n * n; i++) {
        expect(c[i]).toBeCloseTo(a[i]);
      }
    });
  });

  describe("Merkle tree", () => {
    it("builds tree and produces root", () => {
      const seed = roundSeed(1);
      const m = generateMatrix(seed, 8);
      const { root, leaves, tree } = buildMerkleTree(m, 8);
      expect(root).toBeInstanceOf(Buffer);
      expect(root.length).toBe(32);
      expect(leaves.length).toBe(8);
      expect(tree.length).toBeGreaterThan(1);
    });

    it("merkle proof verifies for each row", () => {
      const seed = roundSeed(1);
      const m = generateMatrix(seed, 8);
      const { root, leaves, tree } = buildMerkleTree(m, 8);

      for (let i = 0; i < 8; i++) {
        const proof = merkleProof(tree, i);
        const valid = verifyMerkleProof(leaves[i], proof, root);
        expect(valid).toBe(true);
      }
    });

    it("rejects wrong leaf", () => {
      const seed = roundSeed(1);
      const m = generateMatrix(seed, 8);
      const { root, leaves, tree } = buildMerkleTree(m, 8);

      const wrongLeaf = Buffer.alloc(32, 0xff);
      const proof = merkleProof(tree, 0);
      expect(verifyMerkleProof(wrongLeaf, proof, root)).toBe(false);
    });

    it("deterministic root for same input", () => {
      const m = generateMatrix(roundSeed(42), 8);
      const r1 = buildMerkleTree(m, 8).root;
      const r2 = buildMerkleTree(m, 8).root;
      expect(r1.equals(r2)).toBe(true);
    });

    it("different root for different input", () => {
      const m1 = generateMatrix(roundSeed(1), 8);
      const m2 = generateMatrix(roundSeed(2), 8);
      expect(buildMerkleTree(m1, 8).root.equals(buildMerkleTree(m2, 8).root)).toBe(false);
    });

    it("handles odd number of rows", () => {
      const m = generateMatrix(roundSeed(1), 5);
      const { tree } = buildMerkleTree(m, 5);
      expect(tree[0].length).toBe(5);
      expect(tree[tree.length - 1].length).toBe(1);
    });

    it("proof step has hash and isRight fields", () => {
      const m = generateMatrix(roundSeed(1), 8);
      const { tree } = buildMerkleTree(m, 8);
      const proof = merkleProof(tree, 3);
      for (const step of proof) {
        expect(step).toHaveProperty("hash");
        expect(step).toHaveProperty("isRight");
        expect(Buffer.isBuffer(step.hash)).toBe(true);
        expect(typeof step.isRight).toBe("boolean");
      }
    });

    it("verifies all rows in a 16-row tree", () => {
      const m = generateMatrix(roundSeed(7), 16);
      const { root, leaves, tree } = buildMerkleTree(m, 16);
      for (let i = 0; i < 16; i++) {
        const proof = merkleProof(tree, i);
        expect(verifyMerkleProof(leaves[i], proof, root)).toBe(true);
      }
    });

    it("rejects proof with tampered sibling hash", () => {
      const m = generateMatrix(roundSeed(1), 8);
      const { root, leaves, tree } = buildMerkleTree(m, 8);
      const proof = merkleProof(tree, 0);
      proof[0].hash = Buffer.alloc(32, 0xaa);
      expect(verifyMerkleProof(leaves[0], proof, root)).toBe(false);
    });

    it("rejects proof verified against wrong root", () => {
      const m = generateMatrix(roundSeed(1), 8);
      const { leaves, tree } = buildMerkleTree(m, 8);
      const proof = merkleProof(tree, 0);
      expect(verifyMerkleProof(leaves[0], proof, Buffer.alloc(32, 0xbb))).toBe(false);
    });
  });

  describe("selectChallengeRows", () => {
    it("returns the correct number of unique indices", () => {
      const seed = roundSeed(1);
      const rows = selectChallengeRows(seed, 256, 4);
      expect(rows.length).toBe(4);
      expect(new Set(rows).size).toBe(4);
    });

    it("indices are within bounds", () => {
      const seed = roundSeed(1);
      const rows = selectChallengeRows(seed, 32, 4);
      for (const r of rows) {
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThan(32);
      }
    });

    it("is deterministic", () => {
      const seed = roundSeed(1);
      const r1 = selectChallengeRows(seed, 256, 4);
      const r2 = selectChallengeRows(seed, 256, 4);
      expect(r1).toEqual(r2);
    });

    it("returns different indices for different seeds", () => {
      const r1 = selectChallengeRows(roundSeed(1), 256, 4);
      const r2 = selectChallengeRows(roundSeed(2), 256, 4);
      expect(r1).not.toEqual(r2);
    });

    it("all indices are integers", () => {
      const rows = selectChallengeRows(roundSeed(1), 128, 4);
      for (const r of rows) expect(Number.isInteger(r)).toBe(true);
    });

    it("works with count=1", () => {
      expect(selectChallengeRows(roundSeed(1), 256, 1).length).toBe(1);
    });

    it("works when count equals n", () => {
      const rows = selectChallengeRows(roundSeed(1), 8, 8);
      expect(rows.length).toBe(8);
      expect(new Set(rows).size).toBe(8);
    });
  });

  describe("PulseRunner", () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it("runs a round and returns valid result", () => {
      let rewarded = false;
      const runner = new PulseRunner({
        peerId: "test-peer",
        onReward: () => { rewarded = true; },
        logger: { log: () => {}, error: () => {} },
      });

      const result = runner.runRound([]);
      expect(result.round).toBe(1);
      expect(result.leader).toBe("test-peer");
      expect(result.valid).toBe(true);
      expect(result.challengeRows).toHaveLength(4);
      expect(typeof result.commitment).toBe("string");
      expect(rewarded).toBe(true);
    });

    it("increments round number", () => {
      const runner = new PulseRunner({
        peerId: "test-peer",
        logger: { log: () => {}, error: () => {} },
      });

      const r1 = runner.runRound([]);
      const r2 = runner.runRound([]);
      expect(r1.round).toBe(1);
      expect(r2.round).toBe(2);
    });

    it("elects leader from peer list", () => {
      const runner = new PulseRunner({
        peerId: "peer-me",
        logger: { log: () => {}, error: () => {} },
      });

      const result = runner.runRound(["peer-a", "peer-b"]);
      expect(["peer-me", "peer-a", "peer-b"]).toContain(result.leader);
    });

    it("starts and stops the timer", () => {
      const runner = new PulseRunner({
        peerId: "test-peer",
        logger: { log: () => {}, error: () => {} },
      });
      runner.start(() => []);
      expect(runner.timer).not.toBeNull();
      runner.stop();
      expect(runner.timer).toBeNull();
    });

    it("accepts startRound parameter", () => {
      const runner = new PulseRunner({ peerId: "p", logger: SILENT, startRound: 100 });
      const result = runner.runRound([]);
      expect(result.round).toBe(101);
    });

    it("does not throw when onReward is not set", () => {
      const runner = new PulseRunner({ peerId: "p", logger: SILENT });
      expect(() => runner.runRound([])).not.toThrow();
    });

    it("passes round number to onReward", () => {
      let receivedRound;
      const runner = new PulseRunner({
        peerId: "p",
        onReward: (r) => { receivedRound = r; },
        logger: SILENT,
      });
      runner.runRound([]);
      expect(receivedRound).toBe(1);
    });

    it("commitment is a 64-char hex string", () => {
      const runner = new PulseRunner({ peerId: "p", logger: SILENT });
      expect(runner.runRound([]).commitment).toMatch(/^[0-9a-f]{64}$/);
    });

    it("returns different commitments per round", () => {
      const runner = new PulseRunner({ peerId: "p", logger: SILENT });
      const r1 = runner.runRound([]);
      const r2 = runner.runRound([]);
      expect(r1.commitment).not.toBe(r2.commitment);
    });

    it("stop is idempotent", () => {
      const runner = new PulseRunner({ peerId: "p", logger: SILENT });
      runner.stop();
      runner.stop();
      expect(runner.timer).toBeNull();
    });

    it("self-verifies correctly over multiple rounds", () => {
      const runner = new PulseRunner({ peerId: "self-verify", logger: SILENT });
      for (let i = 0; i < 5; i++) {
        expect(runner.runRound(["a", "b"]).valid).toBe(true);
      }
    });
  });
});
