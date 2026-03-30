#!/usr/bin/env node
/**
 * SPL Token Rewards Module
 *
 * On-chain $AGIEX tokens for rewards.
 * Each pulse round and work receipt mints tokens to the contributing node's
 * Solana wallet only and no off-chain counter.
 *
 * Usage:
 *   node rewards.js init                          # Create mint + authority keypair
 *   node rewards.js mint --to <wallet> --amount N  # Mint tokens to a node
 *   node rewards.js balance --wallet <wallet>      # Check token balance
 *
 * Environment:
 *   SOLANA_RPC_URL   — RPC endpoint (default: devnet)
 *   MINT_KEYPAIR     — Path to mint authority keypair JSON
 *   TOKEN_DECIMALS   — Token decimals (default: 6)
 */

import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const RPC_URL = process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");
const KEYPAIR_PATH = process.env.MINT_KEYPAIR || resolve(__dirname, "mint-authority.json");
const TOKEN_DECIMALS = parseInt(process.env.TOKEN_DECIMALS || "6", 10);
const MINT_INFO_PATH = resolve(__dirname, "mint-info.json");

// ---------------------------------------------------------------------------
// Capability weights — mirrors the 9-capability bonus table from the network.
// When a node earns rewards, its base amount is multiplied by the sum of
// weights for all capabilities it provides.
// ---------------------------------------------------------------------------
const CAPABILITY_WEIGHTS = {
  inference:     0.10,
  research:      0.12,
  proxy:         0.08,
  storage:       0.06,
  embedding:     0.05,
  memory:        0.05,
  orchestration: 0.05,
  validation:    0.04,
  relay:         0.03,
};

// ---------------------------------------------------------------------------
// Reward formulas (ported from the points system)
// ---------------------------------------------------------------------------

/**
 * Presence reward per pulse round (~90 s).
 * base_tokens * uptime_bonus * capability_multiplier
 *
 * @param {number} uptimeHours  — hours this node has been online
 * @param {string[]} capabilities — list of enabled capability names
 * @returns {number} tokens to mint (before decimals)
 */
export function presenceReward(uptimeHours, capabilities) {
  const BASE = 10; // same as upstream 10 points/epoch
  const uptimeBonus = 1 + 0.2 * Math.log(1 + uptimeHours / 12);
  const capBonus = 1 + capabilities.reduce(
    (sum, c) => sum + (CAPABILITY_WEIGHTS[c] || 0),
    0,
  );
  return Math.round(BASE * uptimeBonus * capBonus * 100) / 100;
}

/**
 * Work reward for serving a task (inference, proxy, training).
 *
 * @param {number} tokens       — number of tokens processed
 * @param {number} costPerToken — cost multiplier
 * @param {number} modelMult    — model-size multiplier
 * @param {number} uptimeHours  — node uptime
 * @returns {number} tokens to mint
 */
export function workReward(tokens, costPerToken, modelMult, uptimeHours) {
  const uptimeBonus = 1 + 0.2 * Math.log(1 + uptimeHours / 12);
  return Math.round(tokens * costPerToken * modelMult * uptimeBonus * 100) / 100;
}

// ---------------------------------------------------------------------------
// Solana helpers
// ---------------------------------------------------------------------------

function loadKeypair(path) {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function saveKeypair(kp, path) {
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)));
}

function loadMintInfo() {
  if (!existsSync(MINT_INFO_PATH)) return null;
  return JSON.parse(readFileSync(MINT_INFO_PATH, "utf-8"));
}

function saveMintInfo(info) {
  writeFileSync(MINT_INFO_PATH, JSON.stringify(info, null, 2));
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export async function cmdInit() {
  const connection = new Connection(RPC_URL, "confirmed");

  // Generate or load mint authority
  let authority;
  if (existsSync(KEYPAIR_PATH)) {
    authority = loadKeypair(KEYPAIR_PATH);
    console.log(`Loaded existing authority: ${authority.publicKey.toBase58()}`);
  } else {
    authority = Keypair.generate();
    saveKeypair(authority, KEYPAIR_PATH);
    console.log(`Generated new authority: ${authority.publicKey.toBase58()}`);
  }

  // Check SOL balance — print pubkey for manual funding
  if (RPC_URL.includes("devnet")) {
    const balance = await connection.getBalance(authority.publicKey);
    const solBalance = (balance / LAMPORTS_PER_SOL).toFixed(4);
    console.log(`\nBalance: ${solBalance} SOL`);
    if (balance < 0.5 * LAMPORTS_PER_SOL) {
      console.log(`\n  Fund this account with devnet SOL to pay for transactions:`);
      console.log(`  \x1b[1;36m${authority.publicKey.toBase58()}\x1b[0m`);
      console.log(`\n  Options:`);
      console.log(`    solana airdrop 2 ${authority.publicKey.toBase58()} --url devnet`);
      console.log(`    Or visit: https://faucet.solana.com\n`);
    }
  }

  // Create the SPL token mint
  const existing = loadMintInfo();
  if (existing) {
    console.log(`Mint already exists: ${existing.mint}`);
    return;
  }

  console.log(`Creating SPL token mint (${TOKEN_DECIMALS} decimals)...`);
  const mint = await createMint(
    connection,
    authority,       // payer
    authority.publicKey,  // mint authority
    authority.publicKey,  // freeze authority (can revoke later)
    TOKEN_DECIMALS,
  );

  const info = {
    mint: mint.toBase58(),
    authority: authority.publicKey.toBase58(),
    decimals: TOKEN_DECIMALS,
    network: RPC_URL.includes("devnet") ? "devnet" : RPC_URL.includes("mainnet") ? "mainnet-beta" : "custom",
    createdAt: new Date().toISOString(),
  };
  saveMintInfo(info);
  console.log(`Mint created: ${mint.toBase58()}`);
  console.log(`Mint info saved to ${MINT_INFO_PATH}`);
}

async function cmdMint(recipientPubkey, amount) {
  const connection = new Connection(RPC_URL, "confirmed");
  const authority = loadKeypair(KEYPAIR_PATH);
  const mintInfo = loadMintInfo();
  if (!mintInfo) {
    console.error("No mint found. Run `node rewards.js init` first.");
    process.exit(1);
  }

  const mint = new PublicKey(mintInfo.mint);
  const recipient = new PublicKey(recipientPubkey);

  // Get or create the recipient's associated token account
  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    authority,  // payer
    mint,
    recipient,
  );

  // Mint tokens (amount is in human-readable units, convert to raw)
  const rawAmount = BigInt(Math.round(amount * 10 ** TOKEN_DECIMALS));
  await mintTo(connection, authority, mint, ata.address, authority, rawAmount);

  console.log(`Minted ${amount} tokens to ${recipient.toBase58()}`);
  console.log(`ATA: ${ata.address.toBase58()}`);
}

async function cmdBalance(walletPubkey) {
  const connection = new Connection(RPC_URL, "confirmed");
  const mintInfo = loadMintInfo();
  if (!mintInfo) {
    console.error("No mint found. Run `node rewards.js init` first.");
    process.exit(1);
  }

  const mint = new PublicKey(mintInfo.mint);
  const wallet = new PublicKey(walletPubkey);

  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    Keypair.generate(), // dummy payer — won't create if doesn't exist in practice
    mint,
    wallet,
  );

  const account = await getAccount(connection, ata.address);
  const balance = Number(account.amount) / 10 ** TOKEN_DECIMALS;
  console.log(`Balance: ${balance} tokens`);
}

// ---------------------------------------------------------------------------
// CLI dispatch
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const cmd = args[0];

function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

switch (cmd) {
  case "init":
    await cmdInit();
    break;
  case "mine":
  case "mint": {
    const to = getArg("--to");
    const amount = parseFloat(getArg("--amount") || "0");
    if (!to || amount <= 0) {
      console.error("Usage: node rewards.js mine --to <wallet> --amount <number>");
      process.exit(1);
    }
    await cmdMint(to, amount);
    break;
  }
  case "balance": {
    const wallet = getArg("--wallet");
    if (!wallet) {
      console.error("Usage: node rewards.js balance --wallet <wallet>");
      process.exit(1);
    }
    await cmdBalance(wallet);
    break;
  }
  default:
    console.log(`
\x1b[36m  AGI.expert\x1b[0m — SPL Token Rewards

\x1b[1mCommands:\x1b[0m
  \x1b[32minit\x1b[0m                                           Initialize token mint
  \x1b[32mbalance\x1b[0m --wallet <wallet>                      Check token balance
  \x1b[32mmine\x1b[0m --to <wallet> --amount <N>                Mint tokens to a node wallet

\x1b[2mEnvironment:
  SOLANA_RPC_URL   RPC endpoint (default: devnet)
  MINT_KEYPAIR     Path to mint authority keypair JSON
  TOKEN_DECIMALS   Token decimals (default: 6)

For admin commands (genesis, transfer-authority), use: node admin.js\x1b[0m
`);
}
