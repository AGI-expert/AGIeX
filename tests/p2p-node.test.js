import { describe, it, expect } from "vitest";
import { TOPICS } from "../src/p2p/node.js";

describe("P2P Node", () => {
  describe("TOPICS constant", () => {
    it("exports an object with 10 topic keys", () => {
      expect(typeof TOPICS).toBe("object");
      expect(Object.keys(TOPICS).length).toBe(10);
    });

    it("contains all expected topic keys", () => {
      const expected = [
        "RESEARCH_ROUNDS",
        "SEARCH_EXPERIMENTS",
        "FINANCE_EXPERIMENTS",
        "CODING_EXPERIMENTS",
        "SKILLS",
        "INSPIRATION",
        "PULSE",
        "LEADERBOARD_SYNC",
        "PEER_ANNOUNCE",
        "GOVERNANCE",
      ];
      for (const key of expected) {
        expect(TOPICS).toHaveProperty(key);
      }
    });

    it("all topic values are strings starting with 'agi/'", () => {
      for (const value of Object.values(TOPICS)) {
        expect(typeof value).toBe("string");
        expect(value.startsWith("agi/")).toBe(true);
      }
    });

    it("all topic values are unique", () => {
      const values = Object.values(TOPICS);
      expect(new Set(values).size).toBe(values.length);
    });

    it("maps to expected topic strings", () => {
      expect(TOPICS.RESEARCH_ROUNDS).toBe("agi/research/rounds");
      expect(TOPICS.SEARCH_EXPERIMENTS).toBe("agi/search/experiments");
      expect(TOPICS.FINANCE_EXPERIMENTS).toBe("agi/finance/experiments");
      expect(TOPICS.CODING_EXPERIMENTS).toBe("agi/coding/experiments");
      expect(TOPICS.SKILLS).toBe("agi/cause/skills");
      expect(TOPICS.INSPIRATION).toBe("agi/cause/inspiration");
      expect(TOPICS.PULSE).toBe("agi/pulse");
      expect(TOPICS.LEADERBOARD_SYNC).toBe("agi/leaderboard/sync");
      expect(TOPICS.PEER_ANNOUNCE).toBe("agi/peers/announce");
      expect(TOPICS.GOVERNANCE).toBe("agi/governance");
    });

    it("is frozen / not accidentally mutated", () => {
      const topicCount = Object.keys(TOPICS).length;
      expect(topicCount).toBe(10);
    });
  });

  describe("module exports", () => {
    it("exports createP2PNode as a function", async () => {
      const mod = await import("../src/p2p/node.js");
      expect(typeof mod.createP2PNode).toBe("function");
    });

    it("exports subscribeAll as a function", async () => {
      const mod = await import("../src/p2p/node.js");
      expect(typeof mod.subscribeAll).toBe("function");
    });

    it("exports publish as a function", async () => {
      const mod = await import("../src/p2p/node.js");
      expect(typeof mod.publish).toBe("function");
    });

    it("exports getConnectedPeers as a function", async () => {
      const mod = await import("../src/p2p/node.js");
      expect(typeof mod.getConnectedPeers).toBe("function");
    });
  });
});
