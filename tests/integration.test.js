import { describe, it, expect, afterEach } from "vitest";
import { AgentBrain } from "../src/brain/agent.js";
import { LeaderboardManager } from "../src/crdt/leaderboard.js";
import { PulseRunner } from "../src/pulse/verification.js";
import { loadOrCreateIdentity } from "../src/identity.js";
import { rmSync, existsSync } from "fs";
import { resolve } from "path";

const TEST_DIR = resolve("./tests/.tmp-integration");
const SILENT = { log: () => {}, warn: () => {}, error: () => {} };

describe("Integration — Node Launch Simulation", () => {
  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  it("boots identity, leaderboards, pulse, and brain together", async () => {
    // Step 1: Identity
    const identity = loadOrCreateIdentity(TEST_DIR);
    expect(identity.peerId).toMatch(/^12D3KooW/);

    // Step 2: Leaderboards
    const leaderboards = new LeaderboardManager();
    expect(leaderboards.docs.size).toBe(7);

    // Step 3: Pulse runner
    let rewardCount = 0;
    const pulse = new PulseRunner({
      peerId: identity.peerId,
      onReward: () => { rewardCount++; },
      logger: SILENT,
    });

    const pulseResult = pulse.runRound([]);
    expect(pulseResult.valid).toBe(true);
    expect(rewardCount).toBe(1);

    // Step 4: Brain
    const brain = new AgentBrain({
      peerId: identity.peerId,
      p2pNode: null,
      leaderboards,
      capabilities: { getEnabled: () => ["research"] },
      pulseRunner: pulse,
      p2pSecurity: null,
      governance: null,
      logger: SILENT,
    });

    brain.init();
    expect(brain.pipelines.size).toBe(9);

    // Step 5: Run a research experiment via brain tick
    await brain.tick();
    expect(brain.stats.totalExperiments).toBe(1);
    expect(brain.stats.currentProject).toBeDefined();

    // Step 6: Status check
    const status = brain.status();
    expect(status.peerId).toBe(identity.peerId);
    expect(status.stats.totalExperiments).toBe(1);
  });

  it("runs multiple brain ticks across different domains", async () => {
    const identity = loadOrCreateIdentity(TEST_DIR);
    const leaderboards = new LeaderboardManager();

    const brain = new AgentBrain({
      peerId: identity.peerId,
      p2pNode: null,
      leaderboards,
      capabilities: { getEnabled: () => ["research"] },
      pulseRunner: null,
      p2pSecurity: null,
      governance: null,
      logger: SILENT,
    });

    brain.init();

    // Run 9 ticks to cover all domains
    for (let i = 0; i < 9; i++) {
      await brain.tick();
    }

    expect(brain.stats.totalExperiments).toBe(9);
  });

  it("leaderboard receives results from brain experiments", async () => {
    const identity = loadOrCreateIdentity(TEST_DIR);
    const leaderboards = new LeaderboardManager();

    const brain = new AgentBrain({
      peerId: identity.peerId,
      p2pNode: null,
      leaderboards,
      capabilities: { getEnabled: () => ["research"] },
      pulseRunner: null,
      p2pSecurity: null,
      governance: null,
      logger: SILENT,
    });

    brain.init();

    // Run enough ticks to hit research domain (first project)
    await brain.tick();

    // Check that at least one domain has entries
    let hasEntries = false;
    for (const domain of ["research", "search", "finance", "coding", "skills", "causes", "agi"]) {
      if (leaderboards.getTop(domain, 10).length > 0) {
        hasEntries = true;
        break;
      }
    }
    expect(hasEntries).toBe(true);
  });

  it("pulse runner produces valid proofs across multiple rounds", () => {
    const pulse = new PulseRunner({
      peerId: "test-peer",
      onReward: () => {},
      logger: SILENT,
    });

    for (let i = 0; i < 5; i++) {
      const result = pulse.runRound(["peer-a", "peer-b"]);
      expect(result.valid).toBe(true);
      expect(result.round).toBe(i + 1);
    }
  });

  it("full gossip flow: brain receives peer result and updates leaderboard", () => {
    const identity = loadOrCreateIdentity(TEST_DIR);
    const leaderboards = new LeaderboardManager();

    const brain = new AgentBrain({
      peerId: identity.peerId,
      p2pNode: null,
      leaderboards,
      capabilities: { getEnabled: () => ["research"] },
      pulseRunner: null,
      p2pSecurity: null,
      governance: null,
      logger: SILENT,
    });

    brain.init();

    // Simulate receiving gossip from a remote peer
    brain.handleGossip("agi/research/rounds", {
      project: "gpt2-tinystories",
      result: { valLoss: 1.8 },
      metricValue: 1.8,
      config: {},
      peerId: "remote-peer-123",
    }, "remote-peer-123");

    // Check leaderboard was updated
    const top = leaderboards.getTop("research", 10);
    expect(top.length).toBe(1);
    expect(top[0].valLoss).toBe(1.8);

    // Check inspiration was added
    const pipeline = brain.pipelines.get("gpt2-tinystories");
    expect(pipeline.inspirations.length).toBe(1);
  });

  it("two brains can share results via leaderboard sync", async () => {
    const id1 = loadOrCreateIdentity(resolve(TEST_DIR, "node1"));
    const id2 = loadOrCreateIdentity(resolve(TEST_DIR, "node2"));
    const lb1 = new LeaderboardManager();
    const lb2 = new LeaderboardManager();

    const brain1 = new AgentBrain({
      peerId: id1.peerId,
      p2pNode: null,
      leaderboards: lb1,
      capabilities: { getEnabled: () => ["research"] },
      pulseRunner: null,
      p2pSecurity: null,
      governance: null,
      logger: SILENT,
    });

    brain1.init();
    await brain1.tick();

    // Sync lb1 → lb2 via CRDT
    for (const domain of ["research", "search", "finance", "coding", "skills", "causes", "agi"]) {
      const state = lb1.getFullState(domain);
      lb2.applyUpdate(domain, Array.from(state));
    }

    // lb2 should have lb1's results
    const snap1 = lb1.snapshot(id1.peerId);
    const snap2 = lb2.snapshot(id2.peerId);

    // At least one domain should match
    let synced = false;
    for (const domain of ["research", "search", "finance", "coding", "skills", "causes", "agi"]) {
      if (snap1.leaderboards[domain].top10.length > 0 &&
          snap2.leaderboards[domain].top10.length > 0) {
        synced = true;
        break;
      }
    }
    expect(synced).toBe(true);
  });
});
