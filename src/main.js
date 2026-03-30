#!/usr/bin/env node
/**
 * AGI Network Node — Main entry point.
 *
 * Wires together all subsystems:
 *   1. Identity     — Ed25519 keypair + peer ID
 *   2. P2P          — libp2p + GossipSub networking
 *   3. Inference    — OpenAI-compatible API server
 *   4. CRDT         — Conflict-free leaderboard sync
 *   5. Pulse        — Commit-reveal verification rounds
 *   6. Capabilities — 9 auto-detected services
 *   7. Research     — 5-stage experiment pipeline
 *   8. Brain        — Autonomous decision loop
 *   9. Rewards      — SPL token minting
 *
 * Usage:
 *   node src/main.js                        # Start with defaults
 *   node src/main.js --config node-config.json  # Use config file
 *   AGI_DATA_DIR=./data node src/main.js    # Custom data directory
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { loadOrCreateIdentity } from "./identity.js";
import { createP2PNode, subscribeAll, getConnectedPeers } from "./p2p/node.js";
import { startInferenceServer } from "./inference/server.js";
import { LeaderboardManager } from "./crdt/leaderboard.js";
import { PulseRunner } from "./pulse/verification.js";
import { CapabilityManager } from "./capabilities/index.js";
import { AgentBrain } from "./brain/agent.js";
import { P2PSecurity } from "./p2p/security.js";
import { GovernanceManager } from "./governance/council.js";

// ── Parse CLI args ───────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(flag, defaultVal) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const CONFIG_PATH = getArg("--config", "./node-config.json");
const DATA_DIR = process.env.AGI_DATA_DIR || "./data";
const INFERENCE_PORT = parseInt(process.env.INFERENCE_PORT || "8080", 10);
const AUTO_STAKE = args.includes("--auto-stake");

// ── Load config ──────────────────────────────────────────────────────────
let config = {};
if (existsSync(CONFIG_PATH)) {
  config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  console.log(`\x1b[2m[config]\x1b[0m Loaded \x1b[1;37m${CONFIG_PATH}\x1b[0m`);
} else {
  console.log(`\x1b[2m[config]\x1b[0m No config file — using defaults`);
}

// ── Load hardware profile ────────────────────────────────────────────────
let hwProfile = null;
const hwPath = resolve("./hw-profile.json");
if (existsSync(hwPath)) {
  hwProfile = JSON.parse(readFileSync(hwPath, "utf-8"));
}

// ── Colors ───────────────────────────────────────────────────────────────
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
};

// ── Colorize subsystem log prefixes ──────────────────────────────────────
const TAG_COLORS = {
  "[inference]": C.cyan,
  "[proxy]":     C.cyan,
  "[research]":  C.green,
  "[brain]":     C.magenta,
  "[pulse]":     C.magenta,
  "[stake]":     C.blue,
  "[chain]":     C.blue,
  "[p2p]":       C.yellow,
  "[crdt]":      C.yellow,
};
const _origLog = console.log.bind(console);
console.log = (...args) => {
  if (typeof args[0] === "string") {
    for (const [tag, color] of Object.entries(TAG_COLORS)) {
      if (args[0].startsWith(tag)) {
        args[0] = `${color}${tag}${C.reset}${args[0].slice(tag.length)}`;
        break;
      }
    }
  }
  _origLog(...args);
};

// ── Banner ───────────────────────────────────────────────────────────────
console.log(`
${C.cyan}        ___   ________ ___
       /   | / ____/  /  /
      / /| |/ / __/ / / /
     / ___ / /_/ / / / /
    /_/  |_\\____/_/_/_/${C.reset}  ${C.white}expert${C.reset}  ${C.dim}node${C.reset}
`);

// ══════════════════════════════════════════════════════════════════════════
// BOOT SEQUENCE
// ══════════════════════════════════════════════════════════════════════════

async function boot() {
  const bootTime = Date.now();

  // ── 1. Identity ──────────────────────────────────────────────────────
  console.log(`${C.green}  ▸${C.reset} ${C.bold}Loading identity...${C.reset}`);
  const identity = loadOrCreateIdentity(DATA_DIR);
  console.log(`    ${C.cyan}Peer ID  ${C.white}${identity.peerId}${C.reset}`);

  // ── 2. P2P Network ──────────────────────────────────────────────────
  console.log(`${C.green}  ▸${C.reset} ${C.bold}Starting P2P network...${C.reset}`);
  const bootstrapList = config.network?.bootstrap_nodes?.filter(
    (addr) => !addr.includes("REPLACE_PEER_ID")
  ) || [];

  const isRelay = hwProfile?.capabilities?.relay === true;

  let p2pNode = null;
  try {
    p2pNode = await createP2PNode({
      bootstrapList,
      listenAddrs: config.network?.listen_addresses || [
        "/ip4/0.0.0.0/tcp/4001",
        "/ip4/0.0.0.0/tcp/4002/ws",
      ],
      isRelay,
    });
  } catch (err) {
    console.warn(`[main] P2P startup failed: ${err.message}`);
    console.warn("[main] Continuing in solo mode (no peers)");
  }

  // ── 2b. P2P Security ────────────────────────────────────────────────
  let p2pSecurity = null;
  if (p2pNode) {
    console.log(`    ${C.dim}Starting P2P security layer...${C.reset}`);
    p2pSecurity = new P2PSecurity({
      peerId: identity.peerId,
      privateKey: identity.privateKey,
      publicKey: identity.publicKey,
      p2pNode,
    });
    p2pSecurity.start(() =>
      getConnectedPeers(p2pNode).map((p) => p.peerId || p)
    );
  }

  // ── 3. CRDT Leaderboards ────────────────────────────────────────────
  console.log(`${C.green}  ▸${C.reset} ${C.bold}Initializing CRDT leaderboards...${C.reset}`);
  const leaderboards = new LeaderboardManager();

  // ── 4. Capabilities ─────────────────────────────────────────────────
  console.log(`${C.green}  ▸${C.reset} ${C.bold}Starting capabilities...${C.reset}`);
  const capabilities = new CapabilityManager({
    hwProfile,
    peerId: identity.peerId,
    p2pNode,
  });
  await capabilities.startAll();

  // ── 4b. Research Governance ─────────────────────────────────────────
  console.log(`    ${C.dim}Starting research governance...${C.reset}`);
  const governance = new GovernanceManager({ peerId: identity.peerId });

  // ── 5. Inference Server ──────────────────────────────────────────────
  console.log(`${C.green}  ▸${C.reset} ${C.bold}Starting inference server...${C.reset}`);
  const modelName = config.inference?.model || hwProfile?.recommended_model || "none";
  const modelPath = resolve("./models", `${modelName}.gguf`);

  const inferenceOpts = {
    port: INFERENCE_PORT,
    modelName,
    modelPath: existsSync(modelPath) ? modelPath : null,
  };

  let inferenceServer = null;
  try {
    inferenceServer = await startInferenceServer(inferenceOpts);
  } catch (err) {
    console.warn(`[main] Inference server error: ${err.message}`);
  }

  // ── 6. Pulse Verification ───────────────────────────────────────────
  console.log(`${C.green}  ▸${C.reset} ${C.bold}Starting pulse verification...${C.reset}`);

  // Import reward modules — try on-chain first, fall back to local logging
  let mintReward = null;
  try {
    // On-chain trustless minting via Solana program
    const { submitPulseProof } = await import("../tokens/client/submit-proof.js");
    const rewardsModule = await import("../tokens/rewards.js");
    const { presenceReward } = rewardsModule;

    mintReward = async (roundNumber, pulseResult) => {
      const uptimeHours = (Date.now() - bootTime) / 3_600_000;
      const amount = presenceReward(uptimeHours, capabilities.getEnabled());

      // If we have a node keypair and mint configured, submit proof on-chain
      if (process.env.NODE_SOLANA_KEYPAIR && process.env.AGI_MINT_ADDRESS) {
        let walletAddr = "unknown";
        try {
          const { Keypair, PublicKey } = await import("@solana/web3.js");
          const { readFileSync } = await import("fs");
          const kpRaw = JSON.parse(readFileSync(process.env.NODE_SOLANA_KEYPAIR, "utf-8"));
          const nodeKeypair = Keypair.fromSecretKey(Uint8Array.from(kpRaw));
          walletAddr = nodeKeypair.publicKey.toBase58();
          const mint = new PublicKey(process.env.AGI_MINT_ADDRESS);

          const sig = await submitPulseProof({
            nodeKeypair,
            roundNumber,
            merkleRoot: Buffer.from(pulseResult?.commitment || "", "hex"),
            challengedRows: pulseResult?.challengeRows || [0, 1, 2, 3],
            rowHashes: (pulseResult?.challengeRows || [0, 1, 2, 3]).map(() => Buffer.alloc(32)),
            merkleProofs: (pulseResult?.challengeRows || [0, 1, 2, 3]).map(() => []),
            mint,
            capabilities: capabilities.getEnabled(),
          });
          console.log(
            `${C.magenta}[pulse]${C.reset} Round ${roundNumber}: ${C.green}${amount} tokens${C.reset} minted on-chain ${C.dim}(tx: ${sig.slice(0, 16)}...)${C.reset}`
          );
        } catch (err) {
          if (err.message.includes("no record of a prior credit")) {
            console.log(
              `${C.magenta}[pulse]${C.reset} Round ${roundNumber}: ${C.green}${amount} tokens${C.reset} ${C.yellow}(wallet ${walletAddr} needs SOL — fund at https://faucet.solana.com)${C.reset}`
            );
          } else {
            console.log(
              `${C.magenta}[pulse]${C.reset} Round ${roundNumber}: ${C.green}${amount} tokens${C.reset} ${C.red}(on-chain failed: ${err.message})${C.reset}`
            );
          }
        }
      } else {
        console.log(
          `${C.magenta}[pulse]${C.reset} Round ${roundNumber}: ${C.green}${amount} tokens${C.reset} ` +
          `${C.dim}(uptime: ${uptimeHours.toFixed(1)}h, caps: ${capabilities.getEnabled().length})${C.reset}`
        );
      }
    };
  } catch {
    console.warn("[main] Rewards module not available — pulse runs without minting");
    mintReward = (roundNumber) => {
      console.log(`${C.magenta}[pulse]${C.reset} Round ${roundNumber}: ${C.dim}verified (no token minting configured)${C.reset}`);
    };
  }

  // Resume from last on-chain round so we don't re-submit existing proofs
  let startRound = 0;
  if (process.env.NODE_SOLANA_KEYPAIR) {
    try {
      const { fetchNodeAccount } = await import("../tokens/client/submit-proof.js");
      const { Keypair } = await import("@solana/web3.js");
      const kpRaw = JSON.parse(readFileSync(process.env.NODE_SOLANA_KEYPAIR, "utf-8"));
      const pubkey = Keypair.fromSecretKey(Uint8Array.from(kpRaw)).publicKey;
      const nodeData = await fetchNodeAccount(pubkey);
      if (nodeData) {
        startRound = nodeData.lastClaimRound;
        console.log(`    ${C.cyan}Resuming from round${C.reset} ${C.white}${startRound}${C.reset}`);
      }
    } catch {
      // Node not registered yet — start from 0
    }
  }

  const pulseRunner = new PulseRunner({
    peerId: identity.peerId,
    onReward: mintReward,
    startRound,
  });

  pulseRunner.start(() =>
    p2pNode ? getConnectedPeers(p2pNode).map((p) => p.peerId) : []
  );

  // ── 7. Agent Brain ──────────────────────────────────────────────────
  console.log(`${C.green}  ▸${C.reset} ${C.bold}Starting agent brain...${C.reset}`);
  // Get storage capability if running
  const storageService = capabilities.services?.get("storage") || null;

  const brain = new AgentBrain({
    peerId: identity.peerId,
    p2pNode,
    leaderboards,
    capabilities,
    pulseRunner,
    p2pSecurity,
    governance,
    storage: storageService,
  });

  // Wire up GossipSub → security → brain + governance
  if (p2pNode) {
    subscribeAll(p2pNode, async (topic, data, from) => {
      // Route through security layer first
      if (p2pSecurity) {
        const check = await p2pSecurity.handleMessage(topic, data, from);
        if (!check.allowed) return; // Blocked by security
      }
      brain.handleGossip(topic, data, from);

      // Route governance messages
      if (topic === "agi/governance") {
        governance.handleGossip(data, from);
      }
    });
  }

  brain.start();

  // ── 8. Status endpoint ──────────────────────────────────────────────
  console.log(`${C.green}  ▸${C.reset} ${C.bold}Registering status endpoints...${C.reset}`);
  if (inferenceServer?.app) {
    inferenceServer.app.get("/status", (_req, res) => {
      res.json(brain.status());
    });

    inferenceServer.app.get("/leaderboard/:domain", (req, res) => {
      const top = leaderboards.getTop(req.params.domain, 20);
      res.json({ domain: req.params.domain, entries: top });
    });

    inferenceServer.app.get("/snapshot", (_req, res) => {
      res.json(leaderboards.snapshot(identity.peerId));
    });

    inferenceServer.app.get("/security", (_req, res) => {
      res.json(p2pSecurity ? p2pSecurity.status() : { active: false });
    });

    inferenceServer.app.get("/governance", (_req, res) => {
      res.json(governance.status());
    });

    inferenceServer.app.get("/governance/proposals", (_req, res) => {
      const status = _req.query.status || null;
      res.json(governance.getProposals(status));
    });

    inferenceServer.app.get("/governance/council", (_req, res) => {
      res.json(governance.getCouncil());
    });

    // ── Live dashboard SSE stream ──────────────────────────────────────
    inferenceServer.app.get("/dashboard/events", (_req, res) => {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.flushHeaders();

      const sendState = () => {
        const data = {
          status: brain.status(),
          snapshot: leaderboards.snapshot(identity.peerId),
          peers: p2pNode ? getConnectedPeers(p2pNode).length : 0,
          security: p2pSecurity ? p2pSecurity.status() : { active: false },
          governance: governance.status(),
          timestamp: Date.now(),
        };
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      sendState();
      const interval = setInterval(sendState, 3000);

      _req.on("close", () => clearInterval(interval));
    });

    // Serve dashboard HTML
    inferenceServer.app.get("/dashboard", (_req, res) => {
      const dashPath = resolve(import.meta.dirname, "../dashboard/index.html");
      if (existsSync(dashPath)) {
        res.sendFile(dashPath);
      } else {
        res.status(404).send("Dashboard not found. Expected at dashboard/index.html");
      }
    });
  }

  // ── Boot complete ───────────────────────────────────────────────────
  const capList = capabilities.getEnabled();
  console.log(`
${C.green}  ✓ Node is live!${C.reset}
${C.dim}  ─────────────────────────────────────────────${C.reset}
    ${C.cyan}Peer ID${C.reset}       ${C.white}${identity.peerId}${C.reset}
    ${C.cyan}Capabilities${C.reset}  ${C.white}${capList.length}/9${C.reset} ${C.dim}(${capList.join(", ")})${C.reset}
    ${C.cyan}Inference${C.reset}     ${C.white}http://localhost:${INFERENCE_PORT}/v1${C.reset}
    ${C.cyan}Status${C.reset}        ${C.white}http://localhost:${INFERENCE_PORT}/status${C.reset}
    ${C.cyan}Model${C.reset}         ${C.white}${modelName}${C.reset}
    ${C.cyan}P2P${C.reset}           ${p2pNode ? `${C.green}connected${C.reset}` : `${C.yellow}solo mode${C.reset}`}
    ${C.cyan}Security${C.reset}      ${p2pSecurity ? `${C.green}active${C.reset}` : `${C.dim}disabled (solo)${C.reset}`}
    ${C.cyan}Pulse${C.reset}         ${C.white}every ~90s${C.reset}
    ${C.cyan}Rewards${C.reset}       ${C.magenta}SPL tokens${C.reset}
    ${C.cyan}Auto-stake${C.reset}    ${AUTO_STAKE ? `${C.green}enabled${C.reset} ${C.dim}(>= 100 tokens)${C.reset}` : `${C.dim}disabled${C.reset}`}
${C.dim}  ─────────────────────────────────────────────${C.reset}
    ${C.dim}Press Ctrl+C to stop.${C.reset}
`);

  // ── Auto-stake loop ────────────────────────────────────────────────
  let autoStakeTimer = null;
  if (AUTO_STAKE && process.env.NODE_SOLANA_KEYPAIR && process.env.AGI_MINT_ADDRESS) {
    const AUTO_STAKE_INTERVAL_MS = 5 * 60_000; // check every 5 minutes
    const MIN_STAKE = 100;

    console.log(`${C.blue}[stake]${C.reset} Auto-stake ${C.green}enabled${C.reset} ${C.dim}(will stake when balance >= 100 tokens)${C.reset}`);

    autoStakeTimer = setInterval(async () => {
      try {
        const { Keypair, PublicKey, Connection, clusterApiUrl } = await import("@solana/web3.js");
        const { getAssociatedTokenAddress, getAccount } = await import("@solana/spl-token");
        const { stakeTokens, fetchNodeAccount } = await import("../tokens/client/submit-proof.js");
        const { readFileSync } = await import("fs");

        const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");
        const connection = new Connection(rpcUrl, "confirmed");
        const kpRaw = JSON.parse(readFileSync(process.env.NODE_SOLANA_KEYPAIR, "utf-8"));
        const nodeKeypair = Keypair.fromSecretKey(Uint8Array.from(kpRaw));
        const mint = new PublicKey(process.env.AGI_MINT_ADDRESS);

        // Check current stake
        const nodeInfo = await fetchNodeAccount(nodeKeypair.publicKey);
        const currentStake = nodeInfo ? nodeInfo.stakeAmount / 1e6 : 0;

        if (currentStake >= MIN_STAKE) {
          return; // already staked enough
        }

        // Check token balance
        const ata = await getAssociatedTokenAddress(mint, nodeKeypair.publicKey);
        const account = await getAccount(connection, ata);
        const balance = Number(account.amount) / 1e6;

        if (balance >= MIN_STAKE) {
          const stakeAmount = Math.floor(balance * 1e6); // stake entire balance
          console.log(`${C.blue}[stake]${C.reset} Balance: ${C.white}${balance} tokens${C.reset} — auto-staking...`);
          const sig = await stakeTokens(nodeKeypair, mint, stakeAmount);
          console.log(`${C.blue}[stake]${C.reset} ${C.green}Staked successfully${C.reset} ${C.dim}(tx: ${sig.slice(0, 16)}...)${C.reset}`);
        }
      } catch (err) {
        // Silently skip — node may not be registered yet or no tokens yet
        if (!err.message.includes("could not find account") &&
            !err.message.includes("Account does not exist")) {
          console.log(`${C.blue}[stake]${C.reset} ${C.yellow}${err.message}${C.reset}`);
        }
      }
    }, AUTO_STAKE_INTERVAL_MS);
  } else if (AUTO_STAKE) {
    console.log(`${C.blue}[stake]${C.reset} ${C.yellow}Auto-stake enabled but NODE_SOLANA_KEYPAIR or AGI_MINT_ADDRESS not set${C.reset}`);
  }

  // ── Graceful shutdown ───────────────────────────────────────────────
  async function shutdown() {
    console.log(`\n${C.dim}Shutting down...${C.reset}`);
    brain.stop();
    if (autoStakeTimer) clearInterval(autoStakeTimer);
    if (p2pSecurity) p2pSecurity.stop();
    pulseRunner.stop();
    await capabilities.stopAll();
    if (inferenceServer?.server) inferenceServer.server.close();
    if (p2pNode) await p2pNode.stop();
    console.log(`${C.dim}Goodbye.${C.reset}`);
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

boot().catch((err) => {
  console.error("[main] Fatal:", err);
  process.exit(1);
});
