import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentBrain } from "../src/brain/agent.js";
import { LeaderboardManager } from "../src/crdt/leaderboard.js";

const SILENT = { log: () => {}, warn: () => {}, error: () => {} };

function makeBrain(overrides = {}) {
  return new AgentBrain({
    peerId: "test-brain-peer",
    p2pNode: null,
    leaderboards: new LeaderboardManager(),
    capabilities: { getEnabled: () => ["research"] },
    pulseRunner: null,
    p2pSecurity: null,
    governance: null,
    logger: SILENT,
    ...overrides,
  });
}

describe("Agent Brain", () => {
  describe("constructor", () => {
    it("initializes stats to zero", () => {
      const brain = makeBrain();
      expect(brain.stats.totalExperiments).toBe(0);
      expect(brain.stats.totalGossipSent).toBe(0);
      expect(brain.stats.totalGossipReceived).toBe(0);
      expect(brain.stats.currentProject).toBeNull();
    });

    it("sets running to false initially", () => {
      expect(makeBrain().running).toBe(false);
    });

    it("stores startedAt as a timestamp", () => {
      const before = Date.now();
      const brain = makeBrain();
      expect(brain.startedAt).toBeGreaterThanOrEqual(before);
      expect(brain.startedAt).toBeLessThanOrEqual(Date.now());
    });
  });

  describe("init", () => {
    it("creates 9 research pipelines", () => {
      const brain = makeBrain();
      brain.init();
      expect(brain.pipelines.size).toBe(9);
      expect(brain.pipelines.has("gpt2-tinystories")).toBe(true);
      expect(brain.pipelines.has("astrophysics")).toBe(true);
      expect(brain.pipelines.has("search-engine")).toBe(true);
      expect(brain.pipelines.has("financial-analysis")).toBe(true);
      expect(brain.pipelines.has("skills-and-tools")).toBe(true);
      expect(brain.pipelines.has("academic-papers")).toBe(true);
      expect(brain.pipelines.has("p2p-network")).toBe(true);
      expect(brain.pipelines.has("agentic-coding")).toBe(true);
      expect(brain.pipelines.has("general-intelligence")).toBe(true);
    });

    it("each pipeline has its project name set", () => {
      const brain = makeBrain();
      brain.init();
      for (const [name, pipeline] of brain.pipelines) {
        expect(pipeline.project).toBe(name);
      }
    });

    it("passes peerId to each pipeline", () => {
      const brain = makeBrain();
      brain.init();
      for (const pipeline of brain.pipelines.values()) {
        expect(pipeline.peerId).toBe("test-brain-peer");
      }
    });
  });

  describe("pickAction", () => {
    it("picks research action when capability enabled", () => {
      const brain = makeBrain();
      brain.init();
      const action = brain.pickAction();
      expect(action.type).toBe("research");
      expect(action.project).toBeDefined();
    });

    it("round-robins through projects", () => {
      const brain = makeBrain();
      brain.init();
      const projects = new Set();
      for (let i = 0; i < 9; i++) {
        brain.stats.totalExperiments = i;
        const action = brain.pickAction();
        projects.add(action.project);
      }
      expect(projects.size).toBe(9);
    });

    it("picks idle when no research capability", () => {
      const brain = makeBrain({
        capabilities: { getEnabled: () => [] },
      });
      brain.init();
      brain.stats.totalExperiments = 1; // not divisible by 5
      const action = brain.pickAction();
      expect(action.type).toBe("idle");
    });

    it("picks sync_leaderboards on 5th tick without research", () => {
      const brain = makeBrain({
        capabilities: { getEnabled: () => [] },
      });
      brain.init();
      brain.stats.totalExperiments = 0; // divisible by 5
      const action = brain.pickAction();
      expect(action.type).toBe("sync_leaderboards");
    });
  });

  describe("tick", () => {
    it("executes a research experiment", async () => {
      const brain = makeBrain();
      brain.init();
      await brain.tick();
      expect(brain.stats.totalExperiments).toBe(1);
      expect(brain.stats.currentProject).toBeDefined();
    });

    it("sets currentProject on research tick", async () => {
      const brain = makeBrain();
      brain.init();
      await brain.tick();
      expect(typeof brain.stats.currentProject).toBe("string");
    });

    it("submits result to leaderboard after tick", async () => {
      const brain = makeBrain();
      brain.init();
      await brain.tick();
      let hasEntry = false;
      for (const d of ["research", "search", "finance", "coding", "skills", "causes", "agi"]) {
        if (brain.leaderboards.getTop(d, 10).length > 0) { hasEntry = true; break; }
      }
      expect(hasEntry).toBe(true);
    });

    it("handles sync_leaderboards tick without error", async () => {
      const brain = makeBrain({ capabilities: { getEnabled: () => [] } });
      brain.init();
      brain.stats.totalExperiments = 0;
      await expect(brain.tick()).resolves.not.toThrow();
    });

    it("handles idle tick without error", async () => {
      const brain = makeBrain({ capabilities: { getEnabled: () => [] } });
      brain.init();
      brain.stats.totalExperiments = 1;
      await expect(brain.tick()).resolves.not.toThrow();
    });
  });

  describe("handleGossip", () => {
    it("adds inspiration from peer experiment result", () => {
      const brain = makeBrain();
      brain.init();

      brain.handleGossip("agi/research/rounds", {
        project: "gpt2-tinystories",
        result: { valLoss: 2.0 },
        metricValue: 2.0,
        config: { optimizer: { learningRate: 0.001 } },
        peerId: "remote-peer",
      }, "remote-peer");

      const pipeline = brain.pipelines.get("gpt2-tinystories");
      expect(pipeline.inspirations.length).toBe(1);
    });

    it("submits result to leaderboard", () => {
      const brain = makeBrain();
      brain.init();

      brain.handleGossip("agi/search/experiments", {
        project: "search-engine",
        result: { ndcg10: 0.75 },
        metricValue: 0.75,
        config: {},
        peerId: "remote-peer",
      }, "remote-peer");

      const top = brain.leaderboards.getTop("search", 10);
      expect(top.length).toBe(1);
    });

    it("increments totalGossipReceived", () => {
      const brain = makeBrain();
      brain.init();
      brain.handleGossip("agi/research/rounds", {}, "remote");
      expect(brain.stats.totalGossipReceived).toBe(1);
    });

    it("handles leaderboard sync topic", () => {
      const brain = makeBrain();
      brain.init();
      const lm2 = new LeaderboardManager();
      lm2.submit("finance", "other", { sharpeRatio: 3.0 });
      const update = lm2.getFullState("finance");

      brain.handleGossip("agi/leaderboard/sync", {
        domain: "finance",
        update: Array.from(update),
      }, "remote");

      expect(brain.leaderboards.getTop("finance", 10).length).toBe(1);
    });

    it("ignores gossip for unknown project", () => {
      const brain = makeBrain();
      brain.init();
      expect(() => brain.handleGossip("agi/research/rounds", {
        project: "nonexistent",
        result: {},
        metricValue: 0,
        config: {},
        peerId: "r",
      }, "r")).not.toThrow();
    });
  });

  describe("broadcastResult", () => {
    it("does nothing when p2pNode is null", async () => {
      const brain = makeBrain({ p2pNode: null });
      brain.init();
      await brain.broadcastResult("gpt2-tinystories", {
        result: { valLoss: 2.0 },
        config: {},
        hypothesis: "test",
        isNewBest: false,
      });
      expect(brain.stats.totalGossipSent).toBe(0);
    });
  });

  describe("syncLeaderboards", () => {
    it("does nothing when p2pNode is null", async () => {
      const brain = makeBrain({ p2pNode: null });
      brain.init();
      await expect(brain.syncLeaderboards()).resolves.not.toThrow();
    });
  });

  describe("status", () => {
    it("returns status summary", () => {
      const brain = makeBrain();
      brain.init();
      const s = brain.status();
      expect(s).toHaveProperty("peerId", "test-brain-peer");
      expect(s).toHaveProperty("uptime_seconds");
      expect(s).toHaveProperty("stats");
      expect(s).toHaveProperty("bestResults");
      expect(s).toHaveProperty("leaderboardSnapshot");
    });

    it("includes capabilities list", () => {
      const brain = makeBrain();
      brain.init();
      expect(brain.status().capabilities).toEqual(["research"]);
    });

    it("includes leaderboardSnapshot", () => {
      const brain = makeBrain();
      brain.init();
      expect(brain.status().leaderboardSnapshot).toBeDefined();
      expect(brain.status().leaderboardSnapshot.version).toBe(2);
    });

    it("includes bestResults for pipelines with results", async () => {
      const brain = makeBrain();
      brain.init();
      await brain.tick();
      expect(Object.keys(brain.status().bestResults).length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("start / stop", () => {
    it("starts and stops the brain loop", () => {
      const brain = makeBrain();
      brain.start();
      expect(brain.running).toBe(true);
      expect(brain.timer).not.toBeNull();
      brain.stop();
      expect(brain.running).toBe(false);
      expect(brain.timer).toBeNull();
    });
  });
});
