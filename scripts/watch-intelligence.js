#!/usr/bin/env node
/**
 * watch-intelligence.js — Live terminal dashboard for AGI.expert network intelligence.
 *
 * Connects to one or more node SSE streams and renders a real-time view of
 * research progress, leaderboards, and peer activity.
 *
 * Usage:
 *   node scripts/watch-intelligence.js                          # localhost:8080
 *   node scripts/watch-intelligence.js http://node1:8080 http://node2:8081
 *   AGI_WATCH_URL=http://remote:8080 node scripts/watch-intelligence.js
 */

const BASE_URLS = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : [process.env.AGI_WATCH_URL || "http://localhost:8080"];

// ── ANSI colors ───────────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[1;37m",
  bgBlack: "\x1b[40m",
  clear: "\x1b[2J\x1b[H",
};

const DOMAIN_META = {
  research: { label: "ML Research", field: "valLoss",        unit: "val_loss",   dir: "asc"  },
  search:   { label: "Search",      field: "ndcg10",         unit: "ndcg@10",    dir: "desc" },
  finance:  { label: "Finance",     field: "sharpeRatio",    unit: "sharpe",     dir: "desc" },
  coding:   { label: "Coding",      field: "compositeScore", unit: "composite",  dir: "desc" },
  skills:   { label: "Skills",      field: "score",          unit: "score",      dir: "desc" },
  causes:   { label: "Causes",      field: "bestResult",     unit: "score",      dir: "desc" },
};

// ── State ─────────────────────────────────────────────────────────────────
const nodeStates = new Map(); // url -> last SSE data
const logBuffer = [];         // last 20 log events
let refreshCount = 0;

function addLog(msg) {
  const ts = new Date().toLocaleTimeString("en-GB", { hour12: false });
  logBuffer.push({ ts, msg });
  if (logBuffer.length > 20) logBuffer.shift();
}

// ── Bar chart helper ──────────────────────────────────────────────────────
function bar(value, max, width = 20, color = C.cyan) {
  const pct = Math.min(1, Math.max(0, value / max));
  const filled = Math.round(pct * width);
  const empty = width - filled;
  return `${color}${"█".repeat(filled)}${C.dim}${"░".repeat(empty)}${C.reset}`;
}

// ── Format helpers ────────────────────────────────────────────────────────
function fmtUptime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

function fmtPeer(id) {
  if (!id) return "unknown";
  return id.length > 16 ? id.slice(0, 16) + "…" : id;
}

function fmtVal(v) {
  return typeof v === "number" ? v.toFixed(4) : "-";
}

// ── Render ────────────────────────────────────────────────────────────────
function render() {
  const cols = process.stdout.columns || 100;
  const lines = [];

  // Header
  lines.push("");
  lines.push(`  ${C.cyan}${C.bold}AGI.expert${C.reset} ${C.dim}— Live Intelligence Watch${C.reset}   ${C.dim}refresh #${refreshCount}${C.reset}`);
  lines.push(`  ${C.dim}${"─".repeat(Math.min(60, cols - 4))}${C.reset}`);

  if (nodeStates.size === 0) {
    lines.push(`  ${C.yellow}Waiting for data...${C.reset}`);
    lines.push(`  ${C.dim}Connecting to: ${BASE_URLS.join(", ")}${C.reset}`);
    process.stdout.write(C.clear + lines.join("\n") + "\n");
    return;
  }

  // Aggregate stats across all connected nodes
  let totalExperiments = 0;
  let totalGossipSent = 0;
  let totalGossipRecv = 0;
  let totalPeers = 0;

  for (const [url, data] of nodeStates) {
    const s = data.status?.stats || {};
    totalExperiments += s.totalExperiments || 0;
    totalGossipSent += s.totalGossipSent || 0;
    totalGossipRecv += s.totalGossipReceived || 0;
    totalPeers += data.peers || 0;
  }

  lines.push("");
  lines.push(`  ${C.white}NETWORK OVERVIEW${C.reset}`);
  lines.push(`  ${C.cyan}Nodes:${C.reset} ${C.white}${nodeStates.size}${C.reset}    ${C.cyan}Experiments:${C.reset} ${C.green}${totalExperiments}${C.reset}    ${C.cyan}Gossip:${C.reset} ${C.green}↑${totalGossipSent} ↓${totalGossipRecv}${C.reset}    ${C.cyan}Peers:${C.reset} ${C.yellow}${totalPeers}${C.reset}`);

  // Per-node status
  lines.push("");
  lines.push(`  ${C.white}NODES${C.reset}`);
  for (const [url, data] of nodeStates) {
    const s = data.status;
    const peerId = fmtPeer(s?.peerId);
    const uptime = fmtUptime(s?.uptime_seconds || 0);
    const exp = s?.stats?.totalExperiments || 0;
    const proj = s?.stats?.currentProject || "-";
    const caps = (s?.capabilities || []).length;
    lines.push(`  ${C.cyan}●${C.reset} ${C.white}${peerId}${C.reset}  ${C.dim}up:${C.reset}${uptime}  ${C.dim}exp:${C.reset}${C.green}${exp}${C.reset}  ${C.dim}now:${C.reset}${C.magenta}${proj}${C.reset}  ${C.dim}caps:${C.reset}${caps}/9  ${C.dim}${url}${C.reset}`);
  }

  // Aggregated leaderboards — pick the best snapshot
  let bestSnapshot = null;
  for (const [, data] of nodeStates) {
    if (data.snapshot?.leaderboards) bestSnapshot = data.snapshot;
  }

  if (bestSnapshot) {
    lines.push("");
    lines.push(`  ${C.white}DOMAIN LEADERBOARDS${C.reset}`);
    lines.push("");

    for (const [domain, meta] of Object.entries(DOMAIN_META)) {
      const lb = bestSnapshot.leaderboards[domain];
      const entries = lb?.top10 || [];
      const best = lb?.globalBest;
      const field = meta.field;

      const bestVal = best ? (best[field] ?? best.score ?? 0) : 0;
      const maxBar = meta.dir === "asc" ? 5 : 1;
      const barVal = meta.dir === "asc" ? Math.max(0, maxBar - bestVal) : bestVal;

      lines.push(`  ${C.cyan}${meta.label.padEnd(14)}${C.reset} ${bar(barVal, maxBar, 16)} ${C.white}${fmtVal(bestVal)}${C.reset} ${C.dim}${meta.unit}${C.reset}  ${C.dim}(${entries.length} agents)${C.reset}`);

      // Top 3 for each domain
      for (let i = 0; i < Math.min(3, entries.length); i++) {
        const e = entries[i];
        const rank = i === 0 ? `${C.green}#1` : i === 1 ? `${C.yellow}#2` : `${C.dim}#3`;
        const val = e[field] ?? e.score ?? 0;
        lines.push(`    ${rank}${C.reset} ${C.cyan}${fmtPeer(e.peerId)}${C.reset}  ${C.white}${fmtVal(val)}${C.reset}`);
      }
      lines.push("");
    }
  }

  // Per-node best results
  lines.push(`  ${C.white}LOCAL BEST RESULTS${C.reset}`);
  for (const [url, data] of nodeStates) {
    const bests = data.status?.bestResults || {};
    for (const [project, info] of Object.entries(bests)) {
      const metric = info.bestMetric || {};
      const key = Object.keys(metric).find(k => !["durationSec", "trainLoss", "lossCurve"].includes(k));
      const val = key ? metric[key] : "-";
      lines.push(`  ${C.green}★${C.reset} ${C.magenta}${project.padEnd(20)}${C.reset} run ${C.white}#${info.runNumber}${C.reset}  ${C.yellow}${fmtVal(typeof val === "number" ? val : 0)}${C.reset}`);
    }
  }

  // Live log
  lines.push("");
  lines.push(`  ${C.white}ACTIVITY LOG${C.reset}`);
  const recentLogs = logBuffer.slice(-10);
  for (const entry of recentLogs) {
    lines.push(`  ${C.dim}${entry.ts}${C.reset} ${entry.msg}`);
  }
  if (recentLogs.length === 0) {
    lines.push(`  ${C.dim}No activity yet...${C.reset}`);
  }

  lines.push("");
  lines.push(`  ${C.dim}Press Ctrl+C to exit${C.reset}`);
  lines.push("");

  process.stdout.write(C.clear + lines.join("\n") + "\n");
}

// ── SSE polling (fetch-based since EventSource is not in Node) ────────────
async function pollNode(url) {
  const endpoint = `${url}/status`;
  const snapshotUrl = `${url}/snapshot`;

  while (true) {
    try {
      const [statusRes, snapRes] = await Promise.all([
        fetch(endpoint),
        fetch(snapshotUrl),
      ]);

      if (statusRes.ok && snapRes.ok) {
        const status = await statusRes.json();
        const snapshot = await snapRes.json();

        const prevExp = nodeStates.get(url)?.status?.stats?.totalExperiments || 0;
        const newExp = status.stats?.totalExperiments || 0;

        nodeStates.set(url, {
          status,
          snapshot,
          peers: 0, // peers not directly available from /status, will be estimated
          timestamp: Date.now(),
        });

        if (newExp > prevExp) {
          const proj = status.stats?.currentProject || "?";
          addLog(`${C.green}[research]${C.reset} ${proj} — experiment #${newExp} completed on ${fmtPeer(status.peerId)}`);

          // Check for new bests
          for (const [project, info] of Object.entries(status.bestResults || {})) {
            if (info.runNumber === newExp || info.runNumber === newExp - 1) {
              addLog(`${C.yellow}[best]${C.reset} ${C.white}★ NEW BEST${C.reset} ${project}: run #${info.runNumber}`);
            }
          }
        }

        refreshCount++;
      }
    } catch (err) {
      addLog(`${C.red}[error]${C.reset} Failed to reach ${url}: ${err.message}`);
    }

    await new Promise((r) => setTimeout(r, 3000));
  }
}

// ── Main ──────────────────────────────────────────────────────────────────
console.log(`${C.cyan}AGI.expert${C.reset} Intelligence Watcher`);
console.log(`${C.dim}Connecting to: ${BASE_URLS.join(", ")}${C.reset}`);

// Start polling all nodes
for (const url of BASE_URLS) {
  pollNode(url);
}

// Render loop
setInterval(render, 2000);
render();

// Also open the HTML dashboard hint
console.log(`\n${C.dim}Tip: Open ${C.cyan}http://localhost:8080/dashboard${C.dim} for the HTML dashboard${C.reset}\n`);
