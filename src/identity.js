/**
 * Node Identity — Ed25519 keypair generation and persistence.
 *
 * Each node is identified by a libp2p PeerId derived from an Ed25519 key.
 * The keypair is generated once and stored at DATA_DIR/identity.json.
 * It is also used to sign experiment results and pulse proofs.
 */

import { createRequire } from "module";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import crypto from "crypto";

const DEFAULT_DATA_DIR = resolve(
  process.env.AGI_DATA_DIR || "./data",
);

/**
 * Load or create a persistent Ed25519 identity.
 * Returns { publicKey, privateKey, peerId } where peerId is a short
 * deterministic ID derived from the public key (mimics 12D3KooW... format).
 */
export function loadOrCreateIdentity(dataDir = DEFAULT_DATA_DIR) {
  const idPath = resolve(dataDir, "identity.json");

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  if (existsSync(idPath)) {
    const stored = JSON.parse(readFileSync(idPath, "utf-8"));
    return {
      publicKey: Buffer.from(stored.publicKey, "hex"),
      privateKey: Buffer.from(stored.privateKey, "hex"),
      peerId: stored.peerId,
    };
  }

  // Generate new Ed25519 keypair
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });

  // Derive a human-readable peer ID from public key hash
  const hash = crypto.createHash("sha256").update(publicKey).digest();
  const peerId = "12D3KooW" + hash.toString("base64url").slice(0, 12);

  const identity = {
    publicKey: publicKey.toString("hex"),
    privateKey: privateKey.toString("hex"),
    peerId,
    createdAt: new Date().toISOString(),
  };

  writeFileSync(idPath, JSON.stringify(identity, null, 2));
  return {
    publicKey,
    privateKey,
    peerId,
  };
}

/**
 * Sign arbitrary data with the node's Ed25519 private key.
 */
export function sign(data, privateKeyDer) {
  const key = crypto.createPrivateKey({
    key: privateKeyDer,
    format: "der",
    type: "pkcs8",
  });
  return crypto.sign(null, Buffer.from(data), key);
}

/**
 * Verify a signature against a public key.
 */
export function verify(data, signature, publicKeyDer) {
  const key = crypto.createPublicKey({
    key: publicKeyDer,
    format: "der",
    type: "spki",
  });
  return crypto.verify(null, Buffer.from(data), key, signature);
}
