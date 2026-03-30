/**
 * On-chain proof submission client.
 *
 * Nodes call this after each pulse round to submit their matmul proof
 * to the Solana program, which verifies and mints tokens automatically.
 *
 * Flow:
 *   1. Node computes matmul from round seed (already done in pulse/verification.js)
 *   2. Node builds Merkle tree of result rows
 *   3. Node calls submitPulseProof() with the proof data
 *   4. Solana program verifies on-chain and mints tokens to node's wallet
 *
 * No human approval needed. No multisig. The program IS the authority.
 */

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  clusterApiUrl,
  SystemProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

const RPC_URL = process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");
const PROGRAM_ID = new PublicKey(
  process.env.AGI_PROGRAM_ID || "3gFo4GUwn3ayTgKKBAaMX8u9fZFdYXTyytPZShRfdVBp"
);

/**
 * Derive all PDA addresses used by the program.
 */
export function derivePDAs(programId = PROGRAM_ID) {
  const [programState] = PublicKey.findProgramAddressSync(
    [Buffer.from("program_state")],
    programId,
  );

  const [mintAuthority, mintAuthorityBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_authority")],
    programId,
  );

  return { programState, mintAuthority, mintAuthorityBump };
}

/**
 * Derive a node's on-chain account address.
 */
export function deriveNodeAccount(ownerPubkey, programId = PROGRAM_ID) {
  const [nodeAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("node"), ownerPubkey.toBuffer()],
    programId,
  );
  return nodeAccount;
}

/**
 * Encode capability bitmask from a list of capability names.
 *
 * Bit layout:
 *   bit 0: inference
 *   bit 1: research
 *   bit 2: proxy
 *   bit 3: storage
 *   bit 4: embedding
 *   bit 5: memory
 *   bit 6: orchestration
 *   bit 7: validation
 *   bit 8: relay
 */
export function encodeCapabilities(capabilities) {
  const CAP_BITS = {
    inference: 0,
    research: 1,
    proxy: 2,
    storage: 3,
    embedding: 4,
    memory: 5,
    orchestration: 6,
    validation: 7,
    relay: 8,
  };

  let bitmask = 0;
  for (const cap of capabilities) {
    if (CAP_BITS[cap] !== undefined) {
      bitmask |= 1 << CAP_BITS[cap];
    }
  }
  return bitmask;
}

/**
 * Initialize the on-chain program state (one-time setup).
 * Any node can call this — it's idempotent (fails silently if already initialized).
 */
export async function initializeProgram(payerKeypair, mint) {
  const connection = new Connection(RPC_URL, "confirmed");
  const { programState, mintAuthority } = derivePDAs();

  // Check if already initialized
  const existing = await connection.getAccountInfo(programState);
  if (existing) return null; // already initialized

  const discriminator = instructionDiscriminator("initialize");
  const data = Buffer.alloc(8 + 8);
  discriminator.copy(data, 0);
  // supply_cap = 0 means use default MAX_SUPPLY
  data.writeBigUInt64LE(0n, 8);

  const tx = new Transaction();
  tx.add(
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: programState, isSigner: false, isWritable: true },
        { pubkey: mintAuthority, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: payerKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    })
  );

  const sig = await connection.sendTransaction(tx, [payerKeypair], { skipPreflight: false });
  await connection.confirmTransaction(sig, "confirmed");
  console.log(`\x1b[34m[chain]\x1b[0m Program state initialized \x1b[2m(tx: ${sig.slice(0, 16)}...)\x1b[0m`);
  return sig;
}

/**
 * Submit a pulse proof to the on-chain program.
 *
 * @param {object} opts
 * @param {Keypair} opts.nodeKeypair     — Node's Solana keypair (signs the tx)
 * @param {number}  opts.roundNumber     — Pulse round number
 * @param {Buffer}  opts.merkleRoot      — 32-byte Merkle root of result matrix
 * @param {number[]} opts.challengedRows — Row indices that were challenged
 * @param {Buffer[]} opts.rowHashes      — SHA-256 hashes of challenged rows
 * @param {Buffer[][]} opts.merkleProofs — Merkle proof siblings for each row
 * @param {PublicKey} opts.mint          — SPL token mint address
 */
export async function submitPulseProof(opts) {
  const {
    nodeKeypair,
    roundNumber,
    merkleRoot,
    challengedRows,
    rowHashes,
    merkleProofs,
    mint,
  } = opts;

  const connection = new Connection(RPC_URL, "confirmed");
  const { programState } = derivePDAs();
  const nodeAccount = deriveNodeAccount(nodeKeypair.publicKey);

  // Auto-initialize program state if needed (first node to run does this)
  await initializeProgram(nodeKeypair, mint);

  // Auto-register node if needed (creates node_account PDA)
  const nodeInfo = await connection.getAccountInfo(nodeAccount);
  if (!nodeInfo) {
    console.log(`\x1b[34m[chain]\x1b[0m Registering node \x1b[1;37m${nodeKeypair.publicKey.toBase58().slice(0, 12)}...\x1b[0m`);
    await registerNode(nodeKeypair, opts.capabilities || 0x07, mint);
    console.log(`\x1b[34m[chain]\x1b[0m \x1b[32mNode registered on-chain\x1b[0m`);
  }

  // Derive pending_proof PDA: seeds = ["pending_proof", node_account_key, round_number_le_bytes]
  const roundBuf = Buffer.alloc(8);
  roundBuf.writeBigUInt64LE(BigInt(roundNumber));
  const [pendingProof] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending_proof"), nodeAccount.toBuffer(), roundBuf],
    PROGRAM_ID,
  );

  // Skip if proof already submitted for this round (account already exists)
  const existingProof = await connection.getAccountInfo(pendingProof);
  if (existingProof) {
    console.log(`\x1b[34m[chain]\x1b[0m \x1b[2mRound ${roundNumber} proof already submitted, skipping\x1b[0m`);
    return "already_submitted";
  }

  const tx = new Transaction();

  // Build instruction data
  // Format: [8-byte discriminator][round_number u64][merkle_root [u8;32]][challenged_rows [u16;4]][row_hashes [[u8;32];4]][merkle_proofs_serialized]
  const discriminator = instructionDiscriminator("submit_pulse_proof");

  const data = Buffer.alloc(8 + 8 + 32 + 8 + 128); // base size
  let offset = 0;

  // Discriminator
  discriminator.copy(data, offset);
  offset += 8;

  // round_number (u64 LE)
  data.writeBigUInt64LE(BigInt(roundNumber), offset);
  offset += 8;

  // merkle_root ([u8; 32])
  merkleRoot.copy(data, offset, 0, 32);
  offset += 32;

  // challenged_rows ([u16; 4])
  for (let i = 0; i < 4; i++) {
    data.writeUInt16LE(challengedRows[i] || 0, offset);
    offset += 2;
  }

  // row_hashes ([[u8; 32]; 4])
  for (let i = 0; i < 4; i++) {
    if (rowHashes[i]) {
      rowHashes[i].copy(data, offset, 0, 32);
    }
    offset += 32;
  }

  // merkle_proofs (Vec<Vec<[u8; 32]>>)
  // Borsh: length prefix (u32) for outer vec, then each inner vec
  const proofBufs = [];
  const outerLen = Buffer.alloc(4);
  outerLen.writeUInt32LE(merkleProofs.length);
  proofBufs.push(outerLen);

  for (const proof of merkleProofs) {
    const innerLen = Buffer.alloc(4);
    innerLen.writeUInt32LE(proof.length);
    proofBufs.push(innerLen);
    for (const sibling of proof) {
      proofBufs.push(Buffer.from(sibling));
    }
  }

  const proofData = Buffer.concat(proofBufs);
  const fullData = Buffer.concat([data.slice(0, offset), proofData]);

  // Build instruction — accounts must match SubmitPulseProof context:
  //   program_state, node_account, pending_proof (init), owner (signer+mut), system_program
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: programState, isSigner: false, isWritable: true },
      { pubkey: nodeAccount, isSigner: false, isWritable: true },
      { pubkey: pendingProof, isSigner: false, isWritable: true },
      { pubkey: nodeKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: fullData,
  });

  tx.add(ix);

  // Sign and send
  const sig = await connection.sendTransaction(tx, [nodeKeypair], {
    skipPreflight: false,
  });
  await connection.confirmTransaction(sig, "confirmed");

  return sig;
}

/**
 * Register a node on-chain.
 */
export async function registerNode(nodeKeypair, capabilities, mint) {
  const connection = new Connection(RPC_URL, "confirmed");
  const { programState } = derivePDAs();
  const nodeAccount = deriveNodeAccount(nodeKeypair.publicKey);
  const nodeAta = await getAssociatedTokenAddress(mint, nodeKeypair.publicKey);

  // Auto-initialize program state if needed
  await initializeProgram(nodeKeypair, mint);

  const capBitmask = Array.isArray(capabilities)
    ? encodeCapabilities(capabilities)
    : capabilities;

  const discriminator = instructionDiscriminator("register_node");
  const data = Buffer.alloc(8 + 2);
  discriminator.copy(data, 0);
  data.writeUInt16LE(capBitmask, 8);

  const tx = new Transaction();

  // Create ATA if needed
  try {
    await getAccount(connection, nodeAta);
  } catch {
    tx.add(
      createAssociatedTokenAccountInstruction(
        nodeKeypair.publicKey,
        nodeAta,
        nodeKeypair.publicKey,
        mint,
      )
    );
  }

  tx.add(
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: nodeAccount, isSigner: false, isWritable: true },
        { pubkey: programState, isSigner: false, isWritable: true },
        { pubkey: nodeAta, isSigner: false, isWritable: false },
        { pubkey: nodeKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    })
  );

  const sig = await connection.sendTransaction(tx, [nodeKeypair], {
    skipPreflight: false,
  });
  await connection.confirmTransaction(sig, "confirmed");

  return sig;
}

/**
 * Derive the stake vault PDA.
 */
export function deriveStakeVault(programId = PROGRAM_ID) {
  const [stakeVault, stakeVaultBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("stake_vault")],
    programId,
  );
  return { stakeVault, stakeVaultBump };
}

/**
 * Derive a validation record PDA.
 */
export function deriveValidationRecord(validatorPubkey, targetPubkey, roundNumber, programId = PROGRAM_ID) {
  const roundBuf = Buffer.alloc(8);
  roundBuf.writeBigUInt64LE(BigInt(roundNumber));
  const [record] = PublicKey.findProgramAddressSync(
    [Buffer.from("validation"), validatorPubkey.toBuffer(), targetPubkey.toBuffer(), roundBuf],
    programId,
  );
  return record;
}

/**
 * Stake tokens as collateral. Required before earning rewards.
 */
export async function stakeTokens(nodeKeypair, mint, amount) {
  const connection = new Connection(RPC_URL, "confirmed");
  const { programState } = derivePDAs();
  const nodeAccount = deriveNodeAccount(nodeKeypair.publicKey);
  const { stakeVault } = deriveStakeVault();
  const stakerAta = await getAssociatedTokenAddress(mint, nodeKeypair.publicKey);

  const discriminator = instructionDiscriminator("stake");
  const data = Buffer.alloc(8 + 8);
  discriminator.copy(data, 0);
  data.writeBigUInt64LE(BigInt(amount), 8);

  const tx = new Transaction();
  tx.add(
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: nodeAccount, isSigner: false, isWritable: true },
        { pubkey: stakerAta, isSigner: false, isWritable: true },
        { pubkey: stakeVault, isSigner: false, isWritable: true },
        { pubkey: nodeKeypair.publicKey, isSigner: true, isWritable: false },
        { pubkey: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), isSigner: false, isWritable: false },
      ],
      data,
    })
  );

  const sig = await connection.sendTransaction(tx, [nodeKeypair], { skipPreflight: false });
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

/**
 * Request unstaking. Starts a 7-day cooldown.
 */
export async function requestUnstake(nodeKeypair, amount) {
  const connection = new Connection(RPC_URL, "confirmed");
  const nodeAccount = deriveNodeAccount(nodeKeypair.publicKey);

  const discriminator = instructionDiscriminator("request_unstake");
  const data = Buffer.alloc(8 + 8);
  discriminator.copy(data, 0);
  data.writeBigUInt64LE(BigInt(amount), 8);

  const tx = new Transaction();
  tx.add(
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: nodeAccount, isSigner: false, isWritable: true },
        { pubkey: nodeKeypair.publicKey, isSigner: true, isWritable: false },
      ],
      data,
    })
  );

  const sig = await connection.sendTransaction(tx, [nodeKeypair], { skipPreflight: false });
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

/**
 * Withdraw unstaked tokens after the 7-day cooldown.
 */
export async function withdrawUnstake(nodeKeypair, mint) {
  const connection = new Connection(RPC_URL, "confirmed");
  const { programState } = derivePDAs();
  const nodeAccount = deriveNodeAccount(nodeKeypair.publicKey);
  const { stakeVault } = deriveStakeVault();
  const stakerAta = await getAssociatedTokenAddress(mint, nodeKeypair.publicKey);

  const discriminator = instructionDiscriminator("withdraw_unstake");
  const data = Buffer.alloc(8);
  discriminator.copy(data, 0);

  const tx = new Transaction();
  tx.add(
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: nodeAccount, isSigner: false, isWritable: true },
        { pubkey: programState, isSigner: false, isWritable: false },
        { pubkey: stakeVault, isSigner: false, isWritable: true },
        { pubkey: stakerAta, isSigner: false, isWritable: true },
        { pubkey: nodeKeypair.publicKey, isSigner: true, isWritable: false },
        { pubkey: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), isSigner: false, isWritable: false },
      ],
      data,
    })
  );

  const sig = await connection.sendTransaction(tx, [nodeKeypair], { skipPreflight: false });
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

/**
 * Send a heartbeat to prove liveness.
 */
export async function sendHeartbeat(nodeKeypair, roundNumber) {
  const connection = new Connection(RPC_URL, "confirmed");
  const nodeAccount = deriveNodeAccount(nodeKeypair.publicKey);

  const discriminator = instructionDiscriminator("heartbeat");
  const data = Buffer.alloc(8 + 8);
  discriminator.copy(data, 0);
  data.writeBigUInt64LE(BigInt(roundNumber), 8);

  const tx = new Transaction();
  tx.add(
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: nodeAccount, isSigner: false, isWritable: true },
        { pubkey: nodeKeypair.publicKey, isSigner: true, isWritable: false },
      ],
      data,
    })
  );

  const sig = await connection.sendTransaction(tx, [nodeKeypair], { skipPreflight: false });
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

/**
 * Validate a peer's proof (cross-validation).
 */
export async function validatePeer(opts) {
  const {
    validatorKeypair,
    targetOwner,
    roundNumber,
    computedMerkleRoot,
    targetReportedRoot,
    agrees,
  } = opts;

  const connection = new Connection(RPC_URL, "confirmed");
  const validatorAccount = deriveNodeAccount(validatorKeypair.publicKey);
  const targetAccount = deriveNodeAccount(targetOwner);
  const validationRecord = deriveValidationRecord(
    validatorKeypair.publicKey, targetOwner, roundNumber
  );

  const discriminator = instructionDiscriminator("validate_peer");
  const data = Buffer.alloc(8 + 8 + 32 + 32 + 1);
  let offset = 0;

  discriminator.copy(data, offset); offset += 8;
  data.writeBigUInt64LE(BigInt(roundNumber), offset); offset += 8;
  computedMerkleRoot.copy(data, offset, 0, 32); offset += 32;
  targetReportedRoot.copy(data, offset, 0, 32); offset += 32;
  data.writeUInt8(agrees ? 1 : 0, offset);

  const tx = new Transaction();
  tx.add(
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: validatorAccount, isSigner: false, isWritable: true },
        { pubkey: targetAccount, isSigner: false, isWritable: true },
        { pubkey: validationRecord, isSigner: false, isWritable: true },
        { pubkey: validatorKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    })
  );

  const sig = await connection.sendTransaction(tx, [validatorKeypair], { skipPreflight: false });
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

/**
 * Report a violation against a node.
 * @param {number} violationType — 0=invalid_proof, 1=collusion, 2=sybil
 */
export async function reportViolation(opts) {
  const {
    reporterKeypair,
    targetOwner,
    violationType,
    evidenceRound,
    evidenceHash,
  } = opts;

  const connection = new Connection(RPC_URL, "confirmed");
  const { programState } = derivePDAs();
  const reporterAccount = deriveNodeAccount(reporterKeypair.publicKey);
  const targetAccount = deriveNodeAccount(targetOwner);

  const discriminator = instructionDiscriminator("report_violation");
  const data = Buffer.alloc(8 + 1 + 8 + 32);
  let offset = 0;

  discriminator.copy(data, offset); offset += 8;
  data.writeUInt8(violationType, offset); offset += 1;
  data.writeBigUInt64LE(BigInt(evidenceRound), offset); offset += 8;
  evidenceHash.copy(data, offset, 0, 32);

  const tx = new Transaction();
  tx.add(
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: targetAccount, isSigner: false, isWritable: true },
        { pubkey: reporterAccount, isSigner: false, isWritable: true },
        { pubkey: programState, isSigner: false, isWritable: true },
        { pubkey: reporterKeypair.publicKey, isSigner: true, isWritable: false },
      ],
      data,
    })
  );

  const sig = await connection.sendTransaction(tx, [reporterKeypair], { skipPreflight: false });
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

/**
 * Update node capabilities.
 */
export async function updateCapabilities(nodeKeypair, capabilities) {
  const connection = new Connection(RPC_URL, "confirmed");
  const nodeAccount = deriveNodeAccount(nodeKeypair.publicKey);

  const capBitmask = Array.isArray(capabilities)
    ? encodeCapabilities(capabilities)
    : capabilities;

  const discriminator = instructionDiscriminator("update_capabilities");
  const data = Buffer.alloc(8 + 2);
  discriminator.copy(data, 0);
  data.writeUInt16LE(capBitmask, 8);

  const tx = new Transaction();
  tx.add(
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: nodeAccount, isSigner: false, isWritable: true },
        { pubkey: nodeKeypair.publicKey, isSigner: true, isWritable: false },
      ],
      data,
    })
  );

  const sig = await connection.sendTransaction(tx, [nodeKeypair], { skipPreflight: false });
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

/**
 * Fetch a node's on-chain account data.
 */
export async function fetchNodeAccount(ownerPubkey) {
  const connection = new Connection(RPC_URL, "confirmed");
  const nodeAccount = deriveNodeAccount(ownerPubkey);
  const info = await connection.getAccountInfo(nodeAccount);
  if (!info) return null;

  // Anchor accounts have an 8-byte discriminator prefix
  const data = info.data.slice(8);
  return {
    address: nodeAccount.toBase58(),
    owner: new PublicKey(data.slice(0, 32)).toBase58(),
    tokenAccount: new PublicKey(data.slice(32, 64)).toBase58(),
    capabilities: data.readUInt16LE(64),
    registeredAt: Number(data.readBigInt64LE(66)),
    lastClaimAt: Number(data.readBigInt64LE(74)),
    lastClaimRound: Number(data.readBigUInt64LE(82)),
    lastHeartbeat: Number(data.readBigInt64LE(90)),
    totalEarned: Number(data.readBigUInt64LE(98)),
    totalRoundsParticipated: data.readUInt32LE(106),
    reputation: data.readUInt32LE(110),
    honestyScore: data.readUInt32LE(114),
    loyaltyScore: data.readUInt32LE(118),
    qualityScore: data.readUInt32LE(122),
    consistencyScore: data.readUInt32LE(126),
    isMatured: data.readUInt8(130) === 1,
    isBanned: data.readUInt8(131) === 1,
    maturationProofs: data.readUInt32LE(132),
    strikes: data.readUInt8(136),
    consecutiveFailures: data.readUInt8(137),
    consecutiveMisses: data.readUInt8(138),
    cooldownUntil: Number(data.readBigInt64LE(139)),
    lastFailureAt: Number(data.readBigInt64LE(147)),
    stakeAmount: Number(data.readBigUInt64LE(155)),
    stakeLocked: Number(data.readBigInt64LE(163)),
    pendingUnstake: Number(data.readBigUInt64LE(171)),
    unstakeRequestedAt: Number(data.readBigInt64LE(179)),
    validationsPerformed: data.readUInt32LE(187),
    validationsReceived: data.readUInt32LE(191),
    validProofsSubmitted: data.readUInt32LE(195),
    invalidProofsSubmitted: data.readUInt32LE(199),
  };
}

/**
 * Compute an Anchor instruction discriminator.
 * SHA-256("global:<instruction_name>")[0..8]
 */
function instructionDiscriminator(name) {
  const hash = crypto
    .createHash("sha256")
    .update(`global:${name}`)
    .digest();
  return hash.slice(0, 8);
}
