/**
 * Agent Brain — Autonomous decision loop.
 *
 * The brain decides what the node should do at any given moment:
 *   - Run research experiments across active projects
 *   - Serve inference requests
 *   - Respond to pulse rounds
 *   - Gossip results to peers
 *   - Read peer discoveries and incorporate as inspiration
 *   - Sync CRDT leaderboards
 *   - Idle tasks: read news, serve compute
 *
 * The brain runs in a continuous loop, picking the highest-priority
 * action based on current state and network conditions.
 */

import { ResearchPipeline } from "../research/pipeline.js";
import { TOPICS, publish } from "../p2p/node.js";

// How often the brain loop ticks (seconds)
const TICK_INTERVAL_MS = 10_000;

// Projects to research — matches projects/ directory
const RESEARCH_PROJECTS = [
  "gpt2-tinystories",
  "astrophysics",
  "search-engine",
  "financial-analysis",
  "skills-and-tools",
  "academic-papers",
  "p2p-network",
  "agentic-coding",
  "general-intelligence",
];

/**
 * The autonomous agent brain.
 */
export class AgentBrain {
  constructor({ peerId, p2pNode, leaderboards, capabilities, pulseRunner, p2pSecurity, governance, storage, logger = console }) {
    this.peerId = peerId;
    this.p2pNode = p2pNode;
    this.leaderboards = leaderboards;
    this.capabilities = capabilities;
    this.pulseRunner = pulseRunner;
    this.p2pSecurity = p2pSecurity || null;
    this.governance = governance || null;
    this.storage = storage || null;
    this.logger = logger;
    this.running = false;
    this.timer = null;
    this.startedAt = Date.now();

    // Research pipelines — one per active project
    /** @type {Map<string, ResearchPipeline>} */
    this.pipelines = new Map();

    // Stats
    this.stats = {
      totalExperiments: 0,
      totalGossipSent: 0,
      totalGossipReceived: 0,
      currentProject: null,
    };
  }

  /**
   * Initialize research pipelines for all projects.
   */
  init() {
    for (const project of RESEARCH_PROJECTS) {
      this.pipelines.set(
        project,
        new ResearchPipeline({ project, peerId: this.peerId, logger: this.logger })
      );
    }
    this.logger.log(`[brain] Initialized ${this.pipelines.size} research pipelines`);
  }

  /**
   * Handle incoming gossip messages from peers.
   */
  handleGossip(topic, data, fromPeerId) {
    this.stats.totalGossipReceived++;

    // Route by topic
    if (topic === TOPICS.RESEARCH_ROUNDS || topic === TOPICS.SEARCH_EXPERIMENTS ||
        topic === TOPICS.FINANCE_EXPERIMENTS || topic === TOPICS.CODING_EXPERIMENTS ||
        topic === TOPICS.SKILLS || topic === TOPICS.INSPIRATION) {
      // Peer shared an experiment result — use as inspiration
      if (data.project && data.result) {
        const pipeline = this.pipelines.get(data.project);
        if (pipeline) {
          pipeline.addInspiration({
            peerId: fromPeerId,
            metricValue: data.metricValue,
            config: data.config,
          });
          this.logger.log(
            `[brain] Got inspiration from ${fromPeerId?.slice(0, 12)} for ${data.project}`
          );
        }
      }

      // Update CRDT leaderboard
      if (data.project && data.result && data.peerId) {
        const domain = projectToDomain(data.project);
        if (domain) {
          this.leaderboards.submit(domain, data.peerId, data.result);
        }
      }
    }

    if (topic === TOPICS.LEADERBOARD_SYNC && data.domain && data.update) {
      // Apply CRDT state update from peer
      this.leaderboards.applyUpdate(data.domain, data.update);
    }
  }

  /**
   * Broadcast an experiment result to the network.
   */
  async broadcastResult(project, result) {
    if (!this.p2pNode) return;

    const topic = projectToTopic(project);
    const msg = {
      type: "experiment_result",
      project,
      peerId: this.peerId,
      result: result.result,
      config: result.config,
      hypothesis: result.hypothesis,
      isNewBest: result.isNewBest,
      metricValue: result.result?.valLoss ?? result.result?.score ?? 0,
      timestamp: Date.now(),
    };

    try {
      await publish(this.p2pNode, topic, msg);
      this.stats.totalGossipSent++;
    } catch {
      // No peers yet — that's fine
    }
  }

  /**
   * Sync CRDT leaderboard state with peers.
   */
  async syncLeaderboards() {
    if (!this.p2pNode) return;

    for (const domain of ["research", "search", "finance", "coding", "skills", "causes", "agi"]) {
      try {
        const update = this.leaderboards.getFullState(domain);
        await publish(this.p2pNode, TOPICS.LEADERBOARD_SYNC, {
          domain,
          update: Array.from(update),
        });
      } catch {
        // No peers — skip
      }
    }
  }

  /**
   * Pick the next action based on priorities.
   */
  pickAction() {
    const canResearch = this.capabilities.getEnabled().includes("research");
    const uptimeMin = (Date.now() - this.startedAt) / 60_000;

    // Priority 1: If we have research capability, run experiments
    if (canResearch) {
      // Round-robin through projects
      const projects = [...this.pipelines.keys()];
      const idx = this.stats.totalExperiments % projects.length;
      return { type: "research", project: projects[idx] };
    }

    // Priority 2: Sync leaderboards every few ticks
    if (this.stats.totalExperiments % 5 === 0) {
      return { type: "sync_leaderboards" };
    }

    // Priority 3: Idle
    return { type: "idle" };
  }

  /**
   * Execute one brain tick.
   */
  async tick() {
    const action = this.pickAction();

    switch (action.type) {
      case "research": {
        this.stats.currentProject = action.project;
        const pipeline = this.pipelines.get(action.project);
        if (!pipeline) break;

        try {
          const result = await pipeline.runCycle();
          if (result?.result) {
            this.stats.totalExperiments++;

            // Submit to local CRDT
            const domain = projectToDomain(action.project);
            if (domain) {
              this.leaderboards.submit(domain, this.peerId, result.result);
            }

            // Persist to DHT storage if available
            if (this.storage) {
              try {
                const key = `${action.project}:${this.peerId}:${pipeline.runNumber}`;
                await this.storage.put(key, Buffer.from(JSON.stringify(result.result)));
              } catch {
                // Storage write failed — non-fatal
              }
            }

            // Broadcast to peers
            await this.broadcastResult(action.project, result.result);

            this.logger.log(
              `[brain] ${action.project} run #${pipeline.runNumber} done` +
              (result.result.isNewBest ? " ★ NEW BEST" : "")
            );
          }
        } catch (err) {
          this.logger.error(`[brain] Research error: ${err.message}`);
        }
        break;
      }
      case "sync_leaderboards":
        await this.syncLeaderboards();
        break;
      case "idle":
        // Nothing to do — just keep the node alive
        break;
    }
  }

  /**
   * Start the autonomous brain loop.
   */
  start() {
    this.init();
    this.running = true;

    this.logger.log("[brain] Agent brain started — autonomous mode");
    this.logger.log(`[brain] Active projects: ${RESEARCH_PROJECTS.join(", ")}`);

    // Run ticks
    this.timer = setInterval(async () => {
      if (!this.running) return;
      try {
        await this.tick();
      } catch (err) {
        this.logger.error(`[brain] Tick error: ${err.message}`);
      }
    }, TICK_INTERVAL_MS);

    // Run first tick immediately
    this.tick();
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.log("[brain] Agent brain stopped");
  }

  /**
   * Get brain status summary.
   */
  status() {
    const uptime = Math.floor((Date.now() - this.startedAt) / 1000);
    const bestResults = {};

    for (const [project, pipeline] of this.pipelines) {
      if (pipeline.bestResult) {
        bestResults[project] = {
          runNumber: pipeline.runNumber,
          bestMetric: pipeline.bestResult.result,
        };
      }
    }

    return {
      peerId: this.peerId,
      uptime_seconds: uptime,
      capabilities: this.capabilities.getEnabled(),
      stats: this.stats,
      bestResults,
      leaderboardSnapshot: this.leaderboards.snapshot(this.peerId),
    };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function projectToDomain(project) {
  switch (project) {
    case "gpt2-tinystories":
    case "astrophysics":
      return "research";
    case "search-engine":
      return "search";
    case "financial-analysis":
      return "finance";
    case "skills-and-tools":
      return "skills";
    case "agentic-coding":
      return "coding";
    case "p2p-network":
    case "academic-papers":
      return "causes";
    case "general-intelligence":
      return "agi";
    default:
      return null;
  }
}

function projectToTopic(project) {
  switch (project) {
    case "gpt2-tinystories":
    case "astrophysics":
      return TOPICS.RESEARCH_ROUNDS;
    case "search-engine":
      return TOPICS.SEARCH_EXPERIMENTS;
    case "financial-analysis":
      return TOPICS.FINANCE_EXPERIMENTS;
    case "skills-and-tools":
      return TOPICS.SKILLS;
    case "agentic-coding":
      return TOPICS.CODING_EXPERIMENTS;
    case "general-intelligence":
      return TOPICS.RESEARCH_ROUNDS;
    default:
      return TOPICS.INSPIRATION;
  }
}
