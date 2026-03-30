import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { P2PSecurity } from "../src/p2p/security.js";
import { loadOrCreateIdentity } from "../src/identity.js";
import { rmSync, existsSync } from "fs";
import { resolve } from "path";
import crypto from "crypto";

const TEST_DIR = resolve("./tests/.tmp-security");
const SILENT = { log: () => {}, warn: () => {}, error: () => {} };

describe("P2P Security", () => {
  let identity;
  let security;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    identity = loadOrCreateIdentity(TEST_DIR);
    security = new P2PSecurity({
      peerId: identity.peerId,
      privateKey: identity.privateKey,
      publicKey: identity.publicKey,
      p2pNode: null,
      logger: SILENT,
    });
  });

  afterEach(() => {
    security.stop();
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  describe("signMessage / verifyMessage", () => {
    it("signs and verifies a message", () => {
      const msg = security.signMessage({ type: "test", data: "hello" });
      expect(msg._auth).toBeDefined();
      expect(msg._auth.peerId).toBe(identity.peerId);
      expect(msg._auth.signature).toBeDefined();

      const result = security.verifyMessage(msg, identity.publicKey);
      expect(result.valid).toBe(true);
      expect(result.peerId).toBe(identity.peerId);
    });

    it("rejects message without auth", () => {
      const result = security.verifyMessage({ type: "test" }, identity.publicKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("missing_auth");
    });

    it("rejects stale timestamps", () => {
      const msg = security.signMessage({ type: "test" });
      msg._auth.timestamp = Date.now() - 600_000; // 10 min ago
      const result = security.verifyMessage(msg, identity.publicKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("stale_timestamp");
    });

    it("rejects blocklisted peers", () => {
      security.blocklist.add("bad-peer");
      const msg = { type: "test", _auth: { peerId: "bad-peer", timestamp: Date.now(), nonce: "x", signature: "x" } };
      const result = security.verifyMessage(msg);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("blocklisted");
    });

    it("produces unique nonces each call", () => {
      const m1 = security.signMessage({ x: 1 });
      const m2 = security.signMessage({ x: 1 });
      expect(m1._auth.nonce).not.toBe(m2._auth.nonce);
    });

    it("preserves original payload fields", () => {
      const msg = security.signMessage({ type: "test", value: 42 });
      expect(msg.type).toBe("test");
      expect(msg.value).toBe(42);
    });

    it("rejects future timestamp beyond tolerance", () => {
      const msg = security.signMessage({ type: "t" });
      msg._auth.timestamp = Date.now() + 60_000;
      const result = security.verifyMessage(msg, identity.publicKey);
      expect(result.valid).toBe(false);
    });

    it("passes when senderPublicKey is null", () => {
      const msg = security.signMessage({ type: "t" });
      expect(security.verifyMessage(msg, null).valid).toBe(true);
    });

    it("detects tampered payload", () => {
      const msg = security.signMessage({ type: "original" });
      msg.type = "tampered";
      const result = security.verifyMessage(msg, identity.publicKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("bad_signature");
    });
  });

  describe("checkRateLimit", () => {
    it("allows messages within rate limit", () => {
      for (let i = 0; i < 60; i++) {
        expect(security.checkRateLimit("peer1", "message")).toBe(true);
      }
    });

    it("blocks messages exceeding rate limit", () => {
      for (let i = 0; i < 61; i++) {
        security.checkRateLimit("peer2", "message");
      }
      expect(security.checkRateLimit("peer2", "message")).toBe(false);
    });

    it("has separate limits for proof type", () => {
      // Fill up message limit
      for (let i = 0; i < 61; i++) {
        security.checkRateLimit("peer3", "message");
      }
      // Proof limit should still be open
      expect(security.checkRateLimit("peer3", "proof")).toBe(true);
    });

    it("proof limit is 50 per hour", () => {
      for (let i = 0; i < 50; i++) security.checkRateLimit("proof-peer", "proof");
      expect(security.checkRateLimit("proof-peer", "proof")).toBe(false);
    });

    it("lowers peer score on rate limit violation", () => {
      for (let i = 0; i < 62; i++) security.checkRateLimit("score-peer", "message");
      expect(security.getPeerScore("score-peer").score).toBeLessThan(0);
    });
  });

  describe("trackProofTiming", () => {
    it("flags proofs that are too fast", () => {
      const result = security.trackProofTiming("fast-peer", 10);
      expect(result.anomaly).toBe(true);
      expect(result.reason).toBe("too_fast");
    });

    it("flags proofs that are too slow", () => {
      const result = security.trackProofTiming("slow-peer", 60_000);
      expect(result.anomaly).toBe(true);
      expect(result.reason).toBe("too_slow");
    });

    it("accepts normal timing", () => {
      const result = security.trackProofTiming("normal-peer", 500);
      expect(result.anomaly).toBe(false);
    });

    it("detects bot-like consistency after 20 samples", () => {
      for (let i = 0; i < 20; i++) {
        security.trackProofTiming("bot-peer", 100.0); // identical timings
      }
      const result = security.trackProofTiming("bot-peer", 100.0);
      expect(result.anomaly).toBe(true);
      expect(result.reason).toBe("bot_pattern");
    });

    it("keeps at most 100 timing samples", () => {
      for (let i = 0; i < 120; i++) {
        security.trackProofTiming("ts-peer", 100 + Math.random() * 5000);
      }
      expect(security.peerTimings.get("ts-peer").length).toBe(100);
    });

    it("does not flag bot pattern with high variance", () => {
      for (let i = 0; i < 25; i++) {
        security.trackProofTiming("var-peer", 200 + Math.random() * 2000);
      }
      expect(security.trackProofTiming("var-peer", 1000).anomaly).toBe(false);
    });
  });

  describe("adjustPeerScore", () => {
    it("starts peers at score 0", () => {
      const score = security.getPeerScore("new-peer");
      expect(score.score).toBe(0);
    });

    it("adjusts score positively", () => {
      security.adjustPeerScore("good-peer", 10, "test");
      expect(security.getPeerScore("good-peer").score).toBe(10);
    });

    it("adjusts score negatively and tracks violations", () => {
      security.adjustPeerScore("bad-peer", -30, "test_violation");
      const info = security.getPeerScore("bad-peer");
      expect(info.score).toBe(-30);
      expect(info.violations.length).toBe(1);
      expect(info.violations[0].reason).toBe("test_violation");
    });

    it("auto-blocklists at -100", () => {
      security.adjustPeerScore("terrible-peer", -100, "very_bad");
      expect(security.blocklist.has("terrible-peer")).toBe(true);
    });

    it("accumulates positive and negative adjustments", () => {
      security.adjustPeerScore("mixed", 10, "good");
      security.adjustPeerScore("mixed", -5, "minor");
      expect(security.getPeerScore("mixed").score).toBe(5);
    });

    it("caps violations at 50 entries", () => {
      for (let i = 0; i < 60; i++) {
        security.adjustPeerScore("many-v", -1, `v${i}`);
      }
      expect(security.getPeerScore("many-v").violations.length).toBe(50);
    });

    it("does not blocklist at -99", () => {
      security.adjustPeerScore("close-peer", -99, "close");
      expect(security.blocklist.has("close-peer")).toBe(false);
    });
  });

  describe("checkSybilPattern", () => {
    it("does not flag unique roots", () => {
      const r1 = security.checkSybilPattern(1, "peer1", "root-a");
      const r2 = security.checkSybilPattern(1, "peer2", "root-b");
      expect(r1.sybil).toBe(false);
      expect(r2.sybil).toBe(false);
    });

    it("flags 3+ peers with identical roots", () => {
      security.checkSybilPattern(1, "peer1", "same-root");
      security.checkSybilPattern(1, "peer2", "same-root");
      const result = security.checkSybilPattern(1, "peer3", "same-root");
      expect(result.sybil).toBe(true);
      expect(result.peers).toContain("peer1");
      expect(result.peers).toContain("peer2");
      expect(result.peers).toContain("peer3");
    });

    it("tracks rounds separately", () => {
      security.checkSybilPattern(1, "a", "root");
      security.checkSybilPattern(1, "b", "root");
      expect(security.checkSybilPattern(2, "c", "root").sybil).toBe(false);
    });

    it("different roots in same round are independent", () => {
      security.checkSybilPattern(1, "a", "root-x");
      security.checkSybilPattern(1, "b", "root-y");
      security.checkSybilPattern(1, "c", "root-z");
      expect(security.checkSybilPattern(1, "d", "root-x").sybil).toBe(false);
    });

    it("blocklists sybil peers", () => {
      security.checkSybilPattern(1, "s1", "r");
      security.checkSybilPattern(1, "s2", "r");
      security.checkSybilPattern(1, "s3", "r");
      expect(security.blocklist.has("s1")).toBe(true);
      expect(security.blocklist.has("s2")).toBe(true);
      expect(security.blocklist.has("s3")).toBe(true);
    });
  });

  describe("handleMessage", () => {
    it("allows normal messages", async () => {
      const result = await security.handleMessage("test-topic", { type: "data" }, "peer1");
      expect(result.allowed).toBe(true);
    });

    it("blocks blocklisted peers", async () => {
      security.blocklist.add("blocked-peer");
      const result = await security.handleMessage("test-topic", { type: "data" }, "blocked-peer");
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("blocklisted");
    });

    it("blocks rate-limited peers", async () => {
      for (let i = 0; i < 62; i++) {
        await security.handleMessage("test-topic", { type: "data" }, "spammer");
      }
      const result = await security.handleMessage("test-topic", { type: "data" }, "spammer");
      expect(result.allowed).toBe(false);
    });

    it("routes violation_report and adjusts target score", async () => {
      await security.handleMessage("announce", {
        type: "violation_report",
        target: "bad-actor",
        violationType: "spam",
      }, "reporter");
      expect(security.getPeerScore("bad-actor").score).toBe(-5);
    });

    it("does not penalize self from violation_report", async () => {
      await security.handleMessage("announce", {
        type: "violation_report",
        target: identity.peerId,
        violationType: "spam",
      }, "reporter");
      expect(security.getPeerScore(identity.peerId).score).toBe(0);
    });
  });

  describe("challenge-response", () => {
    it("handleChallenge ignores challenges for other peers", async () => {
      // Should not throw
      await security.handleChallenge({
        target: "someone-else",
        nonce: "abc",
        challengeId: "c1",
      });
    });

    it("handleChallengeResponse verifies correct response", async () => {
      const nonce = crypto.randomBytes(32);
      const challengeId = "test-challenge";
      const targetPeerId = "target-peer";

      security.pendingChallenges.set(challengeId, {
        peerId: targetPeerId,
        nonce,
        sentAt: Date.now(),
      });

      const expected = crypto
        .createHash("sha256")
        .update(Buffer.concat([nonce, Buffer.from(targetPeerId)]))
        .digest("hex");

      security.handleChallengeResponse({
        challengeId,
        response: expected,
        _auth: { peerId: targetPeerId },
      });

      expect(security.getPeerScore(targetPeerId).score).toBe(5);
    });

    it("ignores response for unknown challengeId", () => {
      expect(() => security.handleChallengeResponse({
        challengeId: "unknown",
        response: "x",
      })).not.toThrow();
    });

    it("penalizes incorrect challenge response", () => {
      const nonce = crypto.randomBytes(32);
      security.pendingChallenges.set("bad-c", {
        peerId: "target",
        nonce,
        sentAt: Date.now(),
      });
      security.handleChallengeResponse({
        challengeId: "bad-c",
        response: "wrong-hash",
        _auth: { peerId: "target" },
      });
      expect(security.getPeerScore("target").score).toBe(-50);
    });
  });

  describe("status", () => {
    it("returns security summary", () => {
      security.adjustPeerScore("peer1", -50, "test");
      security.blocklist.add("bad-peer");
      const s = security.status();
      expect(s.blockedPeers).toBe(1);
      expect(s.trackedPeers).toBe(1);
      expect(s.peerScores.peer1).toBe(-50);
    });

    it("includes all expected fields", () => {
      const s = security.status();
      expect(s).toHaveProperty("blockedPeers");
      expect(s).toHaveProperty("trackedPeers");
      expect(s).toHaveProperty("pendingChallenges");
      expect(s).toHaveProperty("peerScores");
      expect(typeof s.blockedPeers).toBe("number");
    });
  });

  describe("start / stop lifecycle", () => {
    it("stop clears challenge timer", () => {
      security.start(() => []);
      expect(security.challengeTimer).not.toBeNull();
      security.stop();
      expect(security.challengeTimer).toBeNull();
    });

    it("stop is safe to call without start", () => {
      security.stop();
      expect(security.challengeTimer).toBeNull();
    });
  });
});
