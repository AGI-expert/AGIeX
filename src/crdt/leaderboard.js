/**
 * CRDT Leaderboard — Conflict-free replicated leaderboards using Yjs.
 *
 * Each research domain has its own Yjs document. When a node produces a
 * new result, it updates its local CRDT. State vectors are exchanged over
 * GossipSub so all nodes converge to the same leaderboard without a server.
 *
 * 5 leaderboard documents:
 *   - research    (ML val_loss, lower = better)
 *   - search      (NDCG@10, higher = better)
 *   - finance     (Sharpe ratio, higher = better)
 *   - skills      (score, higher = better)
 *   - causes      (per-cause metric, higher = better)
 */

import * as Y from "yjs";

// Leaderboard domain configs — matches the project metrics in build-leaderboard.js
const DOMAINS = {
  research: { field: "valLoss", direction: "asc", label: "Val Loss" },
  search: { field: "ndcg10", direction: "desc", label: "NDCG@10" },
  finance: { field: "sharpeRatio", direction: "desc", label: "Sharpe" },
  coding: { field: "compositeScore", direction: "desc", label: "Composite" },
  skills: { field: "score", direction: "desc", label: "Score" },
  causes: { field: "bestResult", direction: "desc", label: "Score" },
  agi: { field: "compositeScore", direction: "desc", label: "Composite" },
};

export class LeaderboardManager {
  constructor() {
    /** @type {Map<string, Y.Doc>} */
    this.docs = new Map();

    // Create one Yjs document per domain
    for (const domain of Object.keys(DOMAINS)) {
      this.docs.set(domain, new Y.Doc());
    }
  }

  /**
   * Submit an experiment result to a domain leaderboard.
   *
   * @param {string} domain   - "research" | "search" | "finance" | "skills" | "causes"
   * @param {string} peerId   - The submitting node's peer ID
   * @param {object} result   - { valLoss, ndcg10, sharpeRatio, score, bestResult, hypothesis, runNumber, gpu, timestamp }
   * @returns {boolean} true if this is a new personal best
   */
  submit(domain, peerId, result) {
    const doc = this.docs.get(domain);
    if (!doc) throw new Error(`Unknown domain: ${domain}`);

    const config = DOMAINS[domain];
    const entries = doc.getMap("entries");
    const existing = entries.get(peerId);
    const newValue = result[config.field] ?? 0;

    // Check if this beats the existing personal best
    let isNewBest = true;
    if (existing) {
      const oldValue = existing[config.field] ?? (config.direction === "asc" ? Infinity : 0);
      if (config.direction === "asc") {
        isNewBest = newValue < oldValue;
      } else {
        isNewBest = newValue > oldValue;
      }
    }

    if (isNewBest) {
      entries.set(peerId, {
        ...result,
        peerId,
        timestamp: Date.now(),
      });
    }

    return isNewBest;
  }

  /**
   * Get the top N entries for a domain, sorted by metric.
   */
  getTop(domain, n = 10) {
    const doc = this.docs.get(domain);
    if (!doc) return [];

    const config = DOMAINS[domain];
    const entries = doc.getMap("entries");
    const all = [];

    entries.forEach((value, key) => {
      all.push({ peerId: key, ...value });
    });

    all.sort((a, b) => {
      const va = a[config.field] ?? (config.direction === "asc" ? Infinity : 0);
      const vb = b[config.field] ?? (config.direction === "asc" ? Infinity : 0);
      return config.direction === "asc" ? va - vb : vb - va;
    });

    return all.slice(0, n);
  }

  /**
   * Get the global best for a domain.
   */
  getGlobalBest(domain) {
    const top = this.getTop(domain, 1);
    return top[0] || null;
  }

  /**
   * Get the full state vector for a domain (for sync over GossipSub).
   */
  getStateVector(domain) {
    const doc = this.docs.get(domain);
    return Y.encodeStateVector(doc);
  }

  /**
   * Get a state update relative to a remote state vector.
   */
  getStateUpdate(domain, remoteStateVector) {
    const doc = this.docs.get(domain);
    return Y.encodeStateAsUpdate(doc, remoteStateVector);
  }

  /**
   * Apply a state update received from a peer.
   */
  applyUpdate(domain, update) {
    const doc = this.docs.get(domain);
    Y.applyUpdate(doc, new Uint8Array(update));
  }

  /**
   * Get a full state snapshot for a domain (for new nodes joining).
   */
  getFullState(domain) {
    const doc = this.docs.get(domain);
    return Y.encodeStateAsUpdate(doc);
  }

  /**
   * Generate a snapshot of all leaderboards (for hourly JSON dumps).
   */
  snapshot(peerId) {
    const leaderboards = {};
    let totalExperiments = 0;
    let totalAgents = 0;

    for (const [domain, _config] of Object.entries(DOMAINS)) {
      const top10 = this.getTop(domain, 10);
      const globalBest = this.getGlobalBest(domain);
      leaderboards[domain] = { top10, globalBest };
      totalAgents += top10.length;
    }

    return {
      version: 2,
      timestamp: new Date().toISOString(),
      generatedBy: peerId,
      summary: `${totalAgents} agents across ${Object.keys(DOMAINS).length} domains`,
      leaderboards,
      disclaimer:
        "Raw CRDT leaderboard state. No statistical significance testing. Interpret the numbers yourself.",
    };
  }
}
