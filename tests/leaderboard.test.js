import { describe, it, expect, beforeEach } from "vitest";
import { LeaderboardManager } from "../src/crdt/leaderboard.js";

describe("CRDT Leaderboard", () => {
  let lm;

  beforeEach(() => {
    lm = new LeaderboardManager();
  });

  describe("constructor", () => {
    it("creates documents for all 7 domains", () => {
      const domains = ["research", "search", "finance", "coding", "skills", "causes", "agi"];
      for (const d of domains) {
        expect(lm.docs.has(d)).toBe(true);
      }
    });

    it("docs map has exactly 7 entries", () => {
      expect(lm.docs.size).toBe(7);
    });

    it("each doc has getMap function (Yjs Doc)", () => {
      for (const doc of lm.docs.values()) {
        expect(typeof doc.getMap).toBe("function");
      }
    });
  });

  describe("submit", () => {
    it("submits a result and reports new best", () => {
      const isNew = lm.submit("research", "peer1", { valLoss: 2.5 });
      expect(isNew).toBe(true);
    });

    it("rejects worse result for asc domain (research)", () => {
      lm.submit("research", "peer1", { valLoss: 2.5 });
      const isNew = lm.submit("research", "peer1", { valLoss: 3.0 });
      expect(isNew).toBe(false);
    });

    it("accepts better result for asc domain (research)", () => {
      lm.submit("research", "peer1", { valLoss: 2.5 });
      const isNew = lm.submit("research", "peer1", { valLoss: 2.0 });
      expect(isNew).toBe(true);
    });

    it("rejects worse result for desc domain (search)", () => {
      lm.submit("search", "peer1", { ndcg10: 0.8 });
      const isNew = lm.submit("search", "peer1", { ndcg10: 0.6 });
      expect(isNew).toBe(false);
    });

    it("accepts better result for desc domain (search)", () => {
      lm.submit("search", "peer1", { ndcg10: 0.6 });
      const isNew = lm.submit("search", "peer1", { ndcg10: 0.8 });
      expect(isNew).toBe(true);
    });

    it("throws for unknown domain", () => {
      expect(() => lm.submit("nonexistent", "peer1", {})).toThrow("Unknown domain");
    });

    it("tracks multiple peers independently", () => {
      lm.submit("finance", "peer1", { sharpeRatio: 1.5 });
      lm.submit("finance", "peer2", { sharpeRatio: 2.0 });
      const top = lm.getTop("finance", 10);
      expect(top.length).toBe(2);
    });

    it("handles missing metric field gracefully", () => {
      const isNew = lm.submit("search", "p1", {});
      expect(isNew).toBe(true);
      const isNew2 = lm.submit("search", "p1", { ndcg10: 0.5 });
      expect(isNew2).toBe(true);
    });

    it("adds timestamp to stored entry", () => {
      lm.submit("research", "p1", { valLoss: 2.0 });
      const top = lm.getTop("research", 1);
      expect(top[0]).toHaveProperty("timestamp");
      expect(typeof top[0].timestamp).toBe("number");
    });

    it("stores peerId in the entry", () => {
      lm.submit("skills", "my-peer", { score: 0.5 });
      const top = lm.getTop("skills", 1);
      expect(top[0].peerId).toBe("my-peer");
    });

    it("accepts and rejects correctly for coding domain (desc)", () => {
      lm.submit("coding", "p1", { compositeScore: 0.4 });
      expect(lm.submit("coding", "p1", { compositeScore: 0.2 })).toBe(false);
      expect(lm.submit("coding", "p1", { compositeScore: 0.7 })).toBe(true);
    });

    it("accepts and rejects correctly for agi domain (desc)", () => {
      lm.submit("agi", "p1", { compositeScore: 0.3 });
      expect(lm.submit("agi", "p1", { compositeScore: 0.1 })).toBe(false);
      expect(lm.submit("agi", "p1", { compositeScore: 0.5 })).toBe(true);
    });

    it("accepts and rejects correctly for causes domain (desc)", () => {
      lm.submit("causes", "p1", { bestResult: 0.3 });
      expect(lm.submit("causes", "p1", { bestResult: 0.1 })).toBe(false);
      expect(lm.submit("causes", "p1", { bestResult: 0.6 })).toBe(true);
    });
  });

  describe("getTop", () => {
    it("returns entries sorted by metric (asc)", () => {
      lm.submit("research", "peer1", { valLoss: 3.0 });
      lm.submit("research", "peer2", { valLoss: 2.0 });
      lm.submit("research", "peer3", { valLoss: 2.5 });
      const top = lm.getTop("research", 10);
      expect(top[0].valLoss).toBe(2.0);
      expect(top[1].valLoss).toBe(2.5);
      expect(top[2].valLoss).toBe(3.0);
    });

    it("returns entries sorted by metric (desc)", () => {
      lm.submit("search", "peer1", { ndcg10: 0.6 });
      lm.submit("search", "peer2", { ndcg10: 0.9 });
      lm.submit("search", "peer3", { ndcg10: 0.75 });
      const top = lm.getTop("search", 10);
      expect(top[0].ndcg10).toBe(0.9);
    });

    it("limits to N entries", () => {
      for (let i = 0; i < 20; i++) {
        lm.submit("skills", `peer${i}`, { score: Math.random() });
      }
      const top5 = lm.getTop("skills", 5);
      expect(top5.length).toBe(5);
    });

    it("defaults N to 10", () => {
      for (let i = 0; i < 15; i++) {
        lm.submit("skills", `p${i}`, { score: Math.random() });
      }
      expect(lm.getTop("skills").length).toBe(10);
    });

    it("each entry includes peerId field", () => {
      lm.submit("coding", "peer-a", { compositeScore: 0.7 });
      lm.submit("coding", "peer-b", { compositeScore: 0.8 });
      for (const entry of lm.getTop("coding", 10)) {
        expect(entry).toHaveProperty("peerId");
      }
    });

    it("returns empty for unknown domain", () => {
      expect(lm.getTop("nonexistent")).toEqual([]);
    });
  });

  describe("getGlobalBest", () => {
    it("returns the best entry", () => {
      lm.submit("finance", "peer1", { sharpeRatio: 1.0 });
      lm.submit("finance", "peer2", { sharpeRatio: 2.5 });
      const best = lm.getGlobalBest("finance");
      expect(best.sharpeRatio).toBe(2.5);
    });

    it("returns null when empty", () => {
      expect(lm.getGlobalBest("finance")).toBeNull();
    });

    it("returns single entry when only one exists", () => {
      lm.submit("agi", "only-peer", { compositeScore: 0.55 });
      expect(lm.getGlobalBest("agi").compositeScore).toBe(0.55);
    });

    it("returns best across multiple peers for causes", () => {
      lm.submit("causes", "p1", { bestResult: 0.3 });
      lm.submit("causes", "p2", { bestResult: 0.7 });
      lm.submit("causes", "p3", { bestResult: 0.5 });
      expect(lm.getGlobalBest("causes").bestResult).toBe(0.7);
    });
  });

  describe("CRDT sync", () => {
    it("syncs state between two managers", () => {
      const lm2 = new LeaderboardManager();

      lm.submit("research", "peer1", { valLoss: 2.0 });
      lm2.submit("research", "peer2", { valLoss: 2.5 });

      // Sync lm → lm2
      const fullState = lm.getFullState("research");
      lm2.applyUpdate("research", Array.from(fullState));

      const top = lm2.getTop("research", 10);
      expect(top.length).toBe(2);
      expect(top[0].valLoss).toBe(2.0);
    });

    it("provides state vector for incremental sync", () => {
      lm.submit("coding", "peer1", { compositeScore: 0.7 });
      const sv = lm.getStateVector("coding");
      expect(sv).toBeInstanceOf(Uint8Array);
      expect(sv.length).toBeGreaterThan(0);
    });

    it("getStateUpdate returns diff", () => {
      const lm2 = new LeaderboardManager();
      lm.submit("coding", "peer1", { compositeScore: 0.7 });

      const remoteVector = lm2.getStateVector("coding");
      const update = lm.getStateUpdate("coding", remoteVector);
      lm2.applyUpdate("coding", Array.from(update));

      const top = lm2.getTop("coding", 10);
      expect(top.length).toBe(1);
      expect(top[0].compositeScore).toBe(0.7);
    });

    it("bidirectional sync merges entries from both sides", () => {
      const lm2 = new LeaderboardManager();
      lm.submit("skills", "p1", { score: 0.8 });
      lm2.submit("skills", "p2", { score: 0.6 });

      const state1 = lm.getFullState("skills");
      const state2 = lm2.getFullState("skills");
      lm2.applyUpdate("skills", Array.from(state1));
      lm.applyUpdate("skills", Array.from(state2));

      expect(lm.getTop("skills", 10).length).toBe(2);
      expect(lm2.getTop("skills", 10).length).toBe(2);
    });

    it("applying same update twice is idempotent", () => {
      const lm2 = new LeaderboardManager();
      lm.submit("research", "p1", { valLoss: 1.5 });
      const state = lm.getFullState("research");
      lm2.applyUpdate("research", Array.from(state));
      lm2.applyUpdate("research", Array.from(state));
      expect(lm2.getTop("research", 10).length).toBe(1);
    });
  });

  describe("snapshot", () => {
    it("generates snapshot with all domains", () => {
      lm.submit("research", "peer1", { valLoss: 2.0 });
      lm.submit("search", "peer2", { ndcg10: 0.8 });

      const snap = lm.snapshot("my-peer");
      expect(snap.version).toBe(2);
      expect(snap.generatedBy).toBe("my-peer");
      expect(snap.leaderboards).toHaveProperty("research");
      expect(snap.leaderboards).toHaveProperty("search");
      expect(snap.leaderboards).toHaveProperty("finance");
      expect(snap.leaderboards).toHaveProperty("coding");
      expect(snap.leaderboards).toHaveProperty("skills");
      expect(snap.leaderboards).toHaveProperty("causes");
      expect(snap.leaderboards).toHaveProperty("agi");
      expect(snap.leaderboards.research.top10.length).toBe(1);
      expect(snap.leaderboards.research.globalBest.valLoss).toBe(2.0);
    });

    it("includes version, timestamp, generatedBy, summary, disclaimer", () => {
      const snap = lm.snapshot("peer-x");
      expect(snap.version).toBe(2);
      expect(snap.generatedBy).toBe("peer-x");
      expect(snap.timestamp).toBeDefined();
      expect(snap.summary).toBeDefined();
      expect(snap.disclaimer).toBeDefined();
    });

    it("each domain has top10 and globalBest", () => {
      const snap = lm.snapshot("p");
      for (const domainData of Object.values(snap.leaderboards)) {
        expect(domainData).toHaveProperty("top10");
        expect(domainData).toHaveProperty("globalBest");
      }
    });

    it("summary string reflects agent count", () => {
      lm.submit("research", "p1", { valLoss: 2.0 });
      lm.submit("search", "p2", { ndcg10: 0.7 });
      const snap = lm.snapshot("p");
      expect(snap.summary).toContain("2 agents");
      expect(snap.summary).toContain("7 domains");
    });
  });
});
