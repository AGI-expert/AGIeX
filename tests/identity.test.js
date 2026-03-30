import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadOrCreateIdentity, sign, verify } from "../src/identity.js";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { resolve } from "path";

const TEST_DATA_DIR = resolve("./tests/.tmp-identity");

describe("Identity", () => {
  beforeEach(() => {
    if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DATA_DIR)) rmSync(TEST_DATA_DIR, { recursive: true });
  });

  describe("loadOrCreateIdentity", () => {
    it("creates a new identity when none exists", () => {
      const id = loadOrCreateIdentity(TEST_DATA_DIR);
      expect(id).toHaveProperty("publicKey");
      expect(id).toHaveProperty("privateKey");
      expect(id).toHaveProperty("peerId");
      expect(id.peerId).toMatch(/^12D3KooW/);
      expect(Buffer.isBuffer(id.publicKey)).toBe(true);
      expect(Buffer.isBuffer(id.privateKey)).toBe(true);
    });

    it("persists identity to disk and reloads it", () => {
      const id1 = loadOrCreateIdentity(TEST_DATA_DIR);
      const id2 = loadOrCreateIdentity(TEST_DATA_DIR);
      expect(id1.peerId).toBe(id2.peerId);
      expect(id1.publicKey.equals(id2.publicKey)).toBe(true);
      expect(id1.privateKey.equals(id2.privateKey)).toBe(true);
    });

    it("creates data directory if it does not exist", () => {
      const nested = resolve(TEST_DATA_DIR, "deep", "nested");
      const id = loadOrCreateIdentity(nested);
      expect(existsSync(nested)).toBe(true);
      expect(id.peerId).toMatch(/^12D3KooW/);
      rmSync(nested, { recursive: true });
    });

    it("stores keys as hex strings on disk", () => {
      loadOrCreateIdentity(TEST_DATA_DIR);
      const raw = JSON.parse(readFileSync(resolve(TEST_DATA_DIR, "identity.json"), "utf-8"));
      expect(raw.publicKey).toMatch(/^[0-9a-f]+$/);
      expect(raw.privateKey).toMatch(/^[0-9a-f]+$/);
    });

    it("createdAt is a valid ISO timestamp", () => {
      loadOrCreateIdentity(TEST_DATA_DIR);
      const raw = JSON.parse(readFileSync(resolve(TEST_DATA_DIR, "identity.json"), "utf-8"));
      const ts = new Date(raw.createdAt);
      expect(ts.getTime()).not.toBeNaN();
      expect(ts.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it("produces different peerIds for different keypairs", () => {
      const id1 = loadOrCreateIdentity(resolve(TEST_DATA_DIR, "a"));
      const id2 = loadOrCreateIdentity(resolve(TEST_DATA_DIR, "b"));
      expect(id1.peerId).not.toBe(id2.peerId);
    });
  });

  describe("sign / verify", () => {
    it("signs data and verifies with matching key", () => {
      const id = loadOrCreateIdentity(TEST_DATA_DIR);
      const data = "hello world";
      const signature = sign(data, id.privateKey);
      expect(Buffer.isBuffer(signature)).toBe(true);
      expect(verify(data, signature, id.publicKey)).toBe(true);
    });

    it("rejects tampered data", () => {
      const id = loadOrCreateIdentity(TEST_DATA_DIR);
      const signature = sign("original", id.privateKey);
      expect(verify("tampered", signature, id.publicKey)).toBe(false);
    });

    it("rejects wrong key", () => {
      const id1 = loadOrCreateIdentity(TEST_DATA_DIR);
      rmSync(TEST_DATA_DIR, { recursive: true });
      const id2 = loadOrCreateIdentity(TEST_DATA_DIR);
      const signature = sign("data", id1.privateKey);
      expect(verify("data", signature, id2.publicKey)).toBe(false);
    });

    it("signs empty string without error", () => {
      const id = loadOrCreateIdentity(TEST_DATA_DIR);
      const sig = sign("", id.privateKey);
      expect(Buffer.isBuffer(sig)).toBe(true);
      expect(verify("", sig, id.publicKey)).toBe(true);
    });

    it("produces different signatures for different data", () => {
      const id = loadOrCreateIdentity(TEST_DATA_DIR);
      const sig1 = sign("data-a", id.privateKey);
      const sig2 = sign("data-b", id.privateKey);
      expect(sig1.equals(sig2)).toBe(false);
    });

    it("produces deterministic Ed25519 signatures", () => {
      const id = loadOrCreateIdentity(TEST_DATA_DIR);
      const sig1 = sign("deterministic", id.privateKey);
      const sig2 = sign("deterministic", id.privateKey);
      expect(sig1.equals(sig2)).toBe(true);
    });

    it("verifies long payload", () => {
      const id = loadOrCreateIdentity(TEST_DATA_DIR);
      const longData = "x".repeat(100_000);
      const sig = sign(longData, id.privateKey);
      expect(verify(longData, sig, id.publicKey)).toBe(true);
    });

    it("rejects truncated signature", () => {
      const id = loadOrCreateIdentity(TEST_DATA_DIR);
      const sig = sign("msg", id.privateKey);
      const truncated = sig.subarray(0, sig.length - 1);
      expect(verify("msg", truncated, id.publicKey)).toBe(false);
    });
  });
});
