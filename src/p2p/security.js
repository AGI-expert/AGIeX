/**
 * P2P Security Layer — Challenge-response, peer attestation, anomaly detection.
 *
 * Layers:
 *   1. Message authentication — all GossipSub messages are signed
 *   2. Challenge-response — peers challenge each other's liveness
 *   3. Peer attestation — validators verify pulse proofs before on-chain submission
 *   4. Anomaly detection — flag statistical outliers (timing, proof patterns)
 *   5. Peer scoring — libp2p peer scores track behavior, bad peers get disconnected
 *   6. Rate limiting — per-peer message rate caps
 *   7. Sybil resistance — proof-of-work for node registration
 */

import crypto from "crypto";
import { sign, verify } from "../identity.js";
import { TOPICS, publish } from "./node.js";

// ── Rate limiting ────────────────────────────────────────────────────────
const MAX_MESSAGES_PER_PEER_PER_MINUTE = 60;
const MAX_PROOF_SUBMISSIONS_PER_PEER_PER_HOUR = 50;

// ── Challenge-response ───────────────────────────────────────────────────
const CHALLENGE_TIMEOUT_MS = 10_000; // 10 seconds to respond
const CHALLENGE_INTERVAL_MS = 300_000; // Challenge random peer every 5 min

// ── Anomaly detection ────────────────────────────────────────────────────
const MIN_PROOF_COMPUTE_MS = 50; // Proofs taking <50ms are suspicious
const MAX_PROOF_COMPUTE_MS = 30_000; // Proofs taking >30s are suspicious
const TIMING_VARIANCE_THRESHOLD = 0.05; // <5% variance across rounds = bot

/**
 * P2P Security Manager — wraps all networking security.
 */
export class P2PSecurity {
  constructor({ peerId, privateKey, publicKey, p2pNode, logger = console }) {
    this.peerId = peerId;
    this.privateKey = privateKey;
    this.publicKey = publicKey;
    this.p2pNode = p2pNode;
    this.logger = logger;

    // Per-peer tracking
    this.peerMessageCounts = new Map(); // peerId → { count, windowStart }
    this.peerProofCounts = new Map();   // peerId → { count, windowStart }
    this.peerScores = new Map();        // peerId → { score, lastUpdate, violations }
    this.peerTimings = new Map();       // peerId → [proof durations]

    // Challenge tracking
    this.pendingChallenges = new Map(); // challengeId → { peerId, nonce, sentAt }
    this.challengeTimer = null;

    // Known bad peers
    this.blocklist = new Set();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MESSAGE AUTHENTICATION
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Sign a message before publishing to GossipSub.
   * Every message includes: peerId, timestamp, nonce, signature.
   */
  signMessage(data) {
    const payload = JSON.stringify(data);
    const nonce = crypto.randomBytes(16).toString("hex");
    const timestamp = Date.now();
    const sigData = `${payload}:${nonce}:${timestamp}`;
    const signature = sign(sigData, this.privateKey).toString("hex");

    return {
      ...data,
      _auth: {
        peerId: this.peerId,
        nonce,
        timestamp,
        signature,
      },
    };
  }

  /**
   * Verify an incoming message's signature.
   * Returns { valid, peerId } or { valid: false, reason }.
   */
  verifyMessage(msg, senderPublicKey) {
    if (!msg._auth) {
      return { valid: false, reason: "missing_auth" };
    }

    const { peerId, nonce, timestamp, signature } = msg._auth;

    // Check timestamp freshness (reject messages older than 5 min)
    const age = Date.now() - timestamp;
    if (age > 300_000 || age < -30_000) {
      return { valid: false, reason: "stale_timestamp" };
    }

    // Check blocklist
    if (this.blocklist.has(peerId)) {
      return { valid: false, reason: "blocklisted" };
    }

    // Verify signature
    const data = { ...msg };
    delete data._auth;
    const payload = JSON.stringify(data);
    const sigData = `${payload}:${nonce}:${timestamp}`;

    if (senderPublicKey) {
      const sigBuf = Buffer.from(signature, "hex");
      const isValid = verify(sigData, sigBuf, senderPublicKey);
      if (!isValid) {
        this.reportViolation(peerId, "invalid_signature");
        return { valid: false, reason: "bad_signature" };
      }
    }

    return { valid: true, peerId };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // RATE LIMITING
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Check if a peer is within rate limits.
   * Returns true if allowed, false if rate limited.
   */
  checkRateLimit(peerId, type = "message") {
    const map = type === "proof" ? this.peerProofCounts : this.peerMessageCounts;
    const limit = type === "proof"
      ? MAX_PROOF_SUBMISSIONS_PER_PEER_PER_HOUR
      : MAX_MESSAGES_PER_PEER_PER_MINUTE;
    const window = type === "proof" ? 3_600_000 : 60_000;

    const now = Date.now();
    let entry = map.get(peerId);

    if (!entry || now - entry.windowStart > window) {
      entry = { count: 0, windowStart: now };
      map.set(peerId, entry);
    }

    entry.count++;

    if (entry.count > limit) {
      this.logger.warn(`[security] Rate limit exceeded: ${peerId} (${type})`);
      this.adjustPeerScore(peerId, -10, "rate_limit_exceeded");
      return false;
    }

    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CHALLENGE-RESPONSE (liveness verification)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Send a challenge to a random peer.
   * The peer must respond with the correct hash within CHALLENGE_TIMEOUT_MS.
   */
  async sendChallenge(targetPeerId) {
    const nonce = crypto.randomBytes(32);
    const challengeId = crypto.randomBytes(16).toString("hex");

    const msg = this.signMessage({
      type: "challenge",
      challengeId,
      nonce: nonce.toString("hex"),
      target: targetPeerId,
    });

    this.pendingChallenges.set(challengeId, {
      peerId: targetPeerId,
      nonce,
      sentAt: Date.now(),
    });

    if (this.p2pNode) {
      await publish(this.p2pNode, TOPICS.PULSE, msg);
    }

    // Set timeout
    setTimeout(() => {
      const pending = this.pendingChallenges.get(challengeId);
      if (pending) {
        // Peer didn't respond in time
        this.pendingChallenges.delete(challengeId);
        this.adjustPeerScore(targetPeerId, -20, "challenge_timeout");
        this.logger.warn(`[security] Challenge timeout: ${targetPeerId}`);
      }
    }, CHALLENGE_TIMEOUT_MS);
  }

  /**
   * Handle an incoming challenge — compute and send the response.
   */
  async handleChallenge(msg) {
    if (msg.target !== this.peerId) return;

    const nonce = Buffer.from(msg.nonce, "hex");
    // Response = SHA-256(nonce || peerId)
    const response = crypto
      .createHash("sha256")
      .update(Buffer.concat([nonce, Buffer.from(this.peerId)]))
      .digest("hex");

    const reply = this.signMessage({
      type: "challenge_response",
      challengeId: msg.challengeId,
      response,
    });

    if (this.p2pNode) {
      await publish(this.p2pNode, TOPICS.PULSE, reply);
    }
  }

  /**
   * Verify an incoming challenge response.
   */
  handleChallengeResponse(msg) {
    const pending = this.pendingChallenges.get(msg.challengeId);
    if (!pending) return;

    const expected = crypto
      .createHash("sha256")
      .update(Buffer.concat([pending.nonce, Buffer.from(pending.peerId)]))
      .digest("hex");

    this.pendingChallenges.delete(msg.challengeId);

    if (msg.response === expected) {
      this.adjustPeerScore(pending.peerId, 5, "challenge_passed");
    } else {
      this.adjustPeerScore(pending.peerId, -50, "challenge_failed");
      this.logger.warn(`[security] Challenge FAILED: ${pending.peerId}`);
    }
  }

  /**
   * Start periodic challenge-response loop.
   */
  startChallengeLoop(getConnectedPeersFn) {
    this.challengeTimer = setInterval(async () => {
      const peers = getConnectedPeersFn();
      if (peers.length === 0) return;

      // Challenge a random peer
      const target = peers[Math.floor(Math.random() * peers.length)];
      await this.sendChallenge(target.peerId || target);
    }, CHALLENGE_INTERVAL_MS);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ANOMALY DETECTION
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Track proof submission timing for a peer.
   * Flags anomalies:
   *   - Too fast (< 50ms) = likely replaying cached proofs
   *   - Too slow (> 30s) = possible resource exhaustion attack
   *   - Too consistent (< 5% variance) = bot behavior
   */
  trackProofTiming(peerId, durationMs) {
    let timings = this.peerTimings.get(peerId);
    if (!timings) {
      timings = [];
      this.peerTimings.set(peerId, timings);
    }

    timings.push(durationMs);
    if (timings.length > 100) timings.shift(); // Keep last 100

    // ── Check: too fast ──
    if (durationMs < MIN_PROOF_COMPUTE_MS) {
      this.adjustPeerScore(peerId, -30, "proof_too_fast");
      this.logger.warn(
        `[security] Suspicious: ${peerId} proof in ${durationMs}ms (min: ${MIN_PROOF_COMPUTE_MS}ms)`
      );
      return { anomaly: true, reason: "too_fast" };
    }

    // ── Check: too slow ──
    if (durationMs > MAX_PROOF_COMPUTE_MS) {
      this.adjustPeerScore(peerId, -5, "proof_too_slow");
      return { anomaly: true, reason: "too_slow" };
    }

    // ── Check: bot-like consistency (after 20+ samples) ──
    if (timings.length >= 20) {
      const mean = timings.reduce((a, b) => a + b, 0) / timings.length;
      const variance =
        timings.reduce((s, t) => s + (t - mean) ** 2, 0) / timings.length;
      const cv = Math.sqrt(variance) / mean; // Coefficient of variation

      if (cv < TIMING_VARIANCE_THRESHOLD) {
        this.adjustPeerScore(peerId, -40, "bot_like_timing");
        this.logger.warn(
          `[security] Bot-like timing: ${peerId} CV=${cv.toFixed(4)} (threshold: ${TIMING_VARIANCE_THRESHOLD})`
        );
        return { anomaly: true, reason: "bot_pattern" };
      }
    }

    return { anomaly: false };
  }

  /**
   * Detect sybil patterns: multiple peers with identical proof roots.
   */
  checkSybilPattern(roundNumber, peerId, merkleRoot) {
    const key = `${roundNumber}:${merkleRoot}`;
    if (!this._rootTracker) this._rootTracker = new Map();

    let peers = this._rootTracker.get(key);
    if (!peers) {
      peers = new Set();
      this._rootTracker.set(key, peers);
    }
    peers.add(peerId);

    // If 3+ peers submit identical roots for the same round, flag sybil
    // (legitimate nodes should have slightly different computation due to
    // floating-point ordering, unless they're the same machine)
    if (peers.size >= 3) {
      this.logger.warn(
        `[security] SYBIL ALERT: ${peers.size} nodes with identical root in round ${roundNumber}`
      );
      for (const p of peers) {
        this.adjustPeerScore(p, -100, "sybil_pattern");
      }
      return { sybil: true, peers: [...peers] };
    }

    // Clean old entries (keep last 100 rounds)
    if (this._rootTracker.size > 1000) {
      const entries = [...this._rootTracker.entries()];
      for (let i = 0; i < entries.length - 100; i++) {
        this._rootTracker.delete(entries[i][0]);
      }
    }

    return { sybil: false };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PEER SCORING
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Adjust a peer's score. Negative = bad behavior, positive = good.
   * Peers below -100 get blocklisted.
   */
  adjustPeerScore(peerId, delta, reason) {
    let entry = this.peerScores.get(peerId);
    if (!entry) {
      entry = { score: 0, lastUpdate: Date.now(), violations: [] };
      this.peerScores.set(peerId, entry);
    }

    entry.score += delta;
    entry.lastUpdate = Date.now();

    if (delta < 0) {
      entry.violations.push({ reason, delta, timestamp: Date.now() });
      // Keep last 50 violations
      if (entry.violations.length > 50) entry.violations.shift();
    }

    // Auto-blocklist at -100
    if (entry.score <= -100 && !this.blocklist.has(peerId)) {
      this.blocklist.add(peerId);
      this.logger.warn(
        `[security] BLOCKLISTED: ${peerId} (score: ${entry.score})`
      );
    }
  }

  /**
   * Get a peer's current score and violation history.
   */
  getPeerScore(peerId) {
    return this.peerScores.get(peerId) || { score: 0, violations: [] };
  }

  /**
   * Report a violation to the network via GossipSub.
   */
  async reportViolation(peerId, type) {
    this.adjustPeerScore(peerId, -25, type);

    if (this.p2pNode) {
      const msg = this.signMessage({
        type: "violation_report",
        target: peerId,
        violationType: type,
        reportedBy: this.peerId,
        timestamp: Date.now(),
      });
      await publish(this.p2pNode, TOPICS.PEER_ANNOUNCE, msg);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PEER ATTESTATION (cross-validation at P2P layer)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Request attestation from peers before submitting proof on-chain.
   *
   * Flow:
   *   1. Node computes matmul and builds Merkle tree
   *   2. Node broadcasts attestation request with its Merkle root
   *   3. Validator peers independently compute and compare
   *   4. Validators respond with agree/disagree
   *   5. If 3+ validators agree, node submits on-chain with confidence
   */
  async requestAttestation(roundNumber, merkleRoot) {
    const request = this.signMessage({
      type: "attestation_request",
      roundNumber,
      merkleRoot: merkleRoot.toString("hex"),
      requestedAt: Date.now(),
    });

    if (this.p2pNode) {
      await publish(this.p2pNode, TOPICS.PULSE, request);
    }

    // Collect responses (handled by handleGossip in the brain)
    return new Promise((resolve) => {
      const attestations = [];
      const timeout = setTimeout(() => {
        resolve(attestations);
      }, 15_000); // 15s window

      this._attestationCallbacks = this._attestationCallbacks || new Map();
      this._attestationCallbacks.set(roundNumber, (attestation) => {
        attestations.push(attestation);
        if (attestations.length >= 3) {
          clearTimeout(timeout);
          this._attestationCallbacks.delete(roundNumber);
          resolve(attestations);
        }
      });
    });
  }

  /**
   * Handle an attestation request — validate and respond.
   */
  async handleAttestationRequest(msg, computeMerkleRoot) {
    if (msg._auth?.peerId === this.peerId) return; // Don't self-attest

    const myRoot = await computeMerkleRoot(msg.roundNumber);
    const agrees = myRoot.toString("hex") === msg.merkleRoot;

    const response = this.signMessage({
      type: "attestation_response",
      roundNumber: msg.roundNumber,
      targetPeerId: msg._auth?.peerId,
      agrees,
      validatorRoot: myRoot.toString("hex"),
    });

    if (this.p2pNode) {
      await publish(this.p2pNode, TOPICS.PULSE, response);
    }
  }

  /**
   * Handle an attestation response.
   */
  handleAttestationResponse(msg) {
    const callback = this._attestationCallbacks?.get(msg.roundNumber);
    if (callback) {
      callback({
        validator: msg._auth?.peerId,
        agrees: msg.agrees,
        validatorRoot: msg.validatorRoot,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // INCOMING MESSAGE HANDLER
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Process all security-relevant incoming messages.
   * Call this from the main GossipSub handler.
   */
  async handleMessage(topic, data, fromPeerId) {
    // Rate limit check
    if (!this.checkRateLimit(fromPeerId, "message")) {
      return { allowed: false, reason: "rate_limited" };
    }

    // Blocklist check
    if (this.blocklist.has(fromPeerId)) {
      return { allowed: false, reason: "blocklisted" };
    }

    // Route security messages
    switch (data.type) {
      case "challenge":
        await this.handleChallenge(data);
        break;
      case "challenge_response":
        this.handleChallengeResponse(data);
        break;
      case "attestation_request":
        // Handled by brain (needs computeMerkleRoot)
        break;
      case "attestation_response":
        this.handleAttestationResponse(data);
        break;
      case "violation_report":
        // Another peer reported a violation — track it
        if (data.target && data.target !== this.peerId) {
          this.adjustPeerScore(data.target, -5, `peer_report:${data.violationType}`);
        }
        break;
    }

    return { allowed: true };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════

  start(getConnectedPeersFn) {
    this.startChallengeLoop(getConnectedPeersFn);
    this.logger.log("[security] P2P security layer started");
    this.logger.log("[security] - Message authentication: active");
    this.logger.log("[security] - Rate limiting: active");
    this.logger.log("[security] - Challenge-response: every 5 min");
    this.logger.log("[security] - Anomaly detection: active");
    this.logger.log("[security] - Peer scoring: active");
  }

  stop() {
    if (this.challengeTimer) {
      clearInterval(this.challengeTimer);
      this.challengeTimer = null;
    }
  }

  /**
   * Get security status summary.
   */
  status() {
    return {
      blockedPeers: this.blocklist.size,
      trackedPeers: this.peerScores.size,
      pendingChallenges: this.pendingChallenges.size,
      peerScores: Object.fromEntries(
        [...this.peerScores.entries()].map(([k, v]) => [k, v.score])
      ),
    };
  }
}
