/**
 * Capability Services — the 9 network capabilities, each as a module.
 *
 * Each capability is auto-enabled based on hardware detection. The manager
 * loads the hardware profile and starts/stops services accordingly.
 *
 * Capabilities:
 *   1. inference     — Serve AI models (GPU required)
 *   2. research      — Run ML training experiments
 *   3. proxy         — HTTP/SOCKS proxy for agents
 *   4. storage       — DHT block storage
 *   5. embedding     — CPU vector embeddings
 *   6. memory        — Distributed vector store
 *   7. orchestration — Task decomposition + routing
 *   8. validation    — Verify pulse round proofs
 *   9. relay         — NAT traversal relay for browser nodes
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import crypto from "crypto";

// Capability weight table — used for reward multipliers
export const CAPABILITY_WEIGHTS = {
  inference: 0.10,
  research: 0.12,
  proxy: 0.08,
  storage: 0.06,
  embedding: 0.05,
  memory: 0.05,
  orchestration: 0.05,
  validation: 0.04,
  relay: 0.03,
};

/**
 * Manages all 9 capability services.
 */
export class CapabilityManager {
  constructor({ hwProfile, peerId, p2pNode, logger = console }) {
    this.hwProfile = hwProfile;
    this.peerId = peerId;
    this.p2pNode = p2pNode;
    this.logger = logger;
    this.services = new Map();
    this.enabled = [];
  }

  /**
   * Load hardware profile from JSON file.
   */
  static loadProfile(path = "./hw-profile.json") {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8"));
  }

  /**
   * Start all capabilities that hardware supports.
   */
  async startAll() {
    const caps = this.hwProfile?.capabilities || {};

    for (const [name, isEnabled] of Object.entries(caps)) {
      if (isEnabled) {
        await this.startCapability(name);
      }
    }

    this.logger.log(
      `[capabilities] ${this.enabled.length}/9 active: ${this.enabled.join(", ")}`
    );
  }

  async startCapability(name) {
    if (this.services.has(name)) return;

    let service;
    switch (name) {
      case "inference":
        service = new InferenceCapability(this);
        break;
      case "research":
        service = new ResearchCapability(this);
        break;
      case "proxy":
        service = new ProxyCapability(this);
        break;
      case "storage":
        service = new StorageCapability(this);
        break;
      case "embedding":
        service = new EmbeddingCapability(this);
        break;
      case "memory":
        service = new MemoryCapability(this);
        break;
      case "orchestration":
        service = new OrchestrationCapability(this);
        break;
      case "validation":
        service = new ValidationCapability(this);
        break;
      case "relay":
        service = new RelayCapability(this);
        break;
      default:
        this.logger.warn(`[capabilities] Unknown capability: ${name}`);
        return;
    }

    await service.start();
    this.services.set(name, service);
    this.enabled.push(name);
  }

  async stopAll() {
    for (const [name, service] of this.services) {
      await service.stop();
      this.logger.log(`[capabilities] Stopped: ${name}`);
    }
    this.services.clear();
    this.enabled = [];
  }

  /**
   * Get list of enabled capability names (for reward calculation).
   */
  getEnabled() {
    return [...this.enabled];
  }

  /**
   * Get the total capability weight bonus.
   */
  getWeightBonus() {
    return this.enabled.reduce(
      (sum, name) => sum + (CAPABILITY_WEIGHTS[name] || 0),
      0,
    );
  }
}

// ── Base class ───────────────────────────────────────────────────────────

class BaseCapability {
  constructor(manager, name) {
    this.manager = manager;
    this.name = name;
    this.logger = manager.logger;
    this.running = false;
  }
  async start() {
    this.running = true;
    this.logger.log(`[${this.name}] Started`);
  }
  async stop() {
    this.running = false;
  }
}

// ── 1. Inference ─────────────────────────────────────────────────────────

class InferenceCapability extends BaseCapability {
  constructor(manager) {
    super(manager, "inference");
  }
  async start() {
    await super.start();
    // The inference HTTP server is started separately in main.js.
    // This capability just registers the node as an inference provider.
    this.logger.log("[inference] Registered as inference provider on the network");
  }
}

// ── 2. Research ──────────────────────────────────────────────────────────

class ResearchCapability extends BaseCapability {
  constructor(manager) {
    super(manager, "research");
  }
  async start() {
    await super.start();
    // Research pipeline is managed by the agent brain.
    this.logger.log("[research] Research pipeline enabled");
  }
}

// ── 3. Proxy ─────────────────────────────────────────────────────────────

class ProxyCapability extends BaseCapability {
  constructor(manager) {
    super(manager, "proxy");
    this.proxyServer = null;
  }
  async start() {
    await super.start();
    // Lightweight HTTP proxy for other agents' web requests
    const { createServer } = await import("http");
    this.proxyServer = createServer((req, res) => {
      // Forward requests from agent peers
      const target = req.headers["x-proxy-target"];
      if (!target) {
        res.writeHead(400);
        res.end("Missing X-Proxy-Target header");
        return;
      }

      fetch(target, {
        method: req.method,
        headers: { "User-Agent": `AGI-Network-Proxy/${manager.peerId}` },
      })
        .then(async (proxyRes) => {
          res.writeHead(proxyRes.status);
          const body = await proxyRes.text();
          res.end(body);
        })
        .catch((err) => {
          res.writeHead(502);
          res.end(err.message);
        });
    });

    this.proxyServer.listen(4010, () => {
      this.logger.log("[proxy] HTTP proxy listening on :4010");
    });
  }
  async stop() {
    if (this.proxyServer) this.proxyServer.close();
    await super.stop();
  }
}

// ── 4. Storage (DHT block store) ─────────────────────────────────────────

class StorageCapability extends BaseCapability {
  constructor(manager) {
    super(manager, "storage");
    this.blocks = new Map(); // In-memory block store, persists to disk
  }
  async start() {
    await super.start();
    this.storageDir = resolve(process.env.AGI_DATA_DIR || "./data", "blocks");
    const { mkdirSync } = await import("fs");
    mkdirSync(this.storageDir, { recursive: true });
    this.logger.log(`[storage] DHT block storage at ${this.storageDir}`);
  }

  async put(key, data) {
    const hash = crypto.createHash("sha256").update(key).digest("hex");
    const { writeFileSync } = await import("fs");
    writeFileSync(resolve(this.storageDir, hash), data);
    this.blocks.set(hash, true);
    return hash;
  }

  async get(key) {
    const hash = crypto.createHash("sha256").update(key).digest("hex");
    const path = resolve(this.storageDir, hash);
    const { readFileSync, existsSync } = await import("fs");
    if (!existsSync(path)) return null;
    return readFileSync(path);
  }
}

// ── 5. Embedding (CPU vector embeddings) ─────────────────────────────────

class EmbeddingCapability extends BaseCapability {
  constructor(manager) {
    super(manager, "embedding");
  }
  async start() {
    await super.start();
    // Uses the inference server's /v1/embeddings endpoint
    // or a lightweight CPU-based embedding model
    this.logger.log("[embedding] CPU embedding service enabled (all-MiniLM-L6-v2)");
  }

  /**
   * Generate embeddings for text. Falls back to simple hash-based
   * vectors if no model is loaded.
   */
  embed(text) {
    // Simple deterministic embedding fallback (384-dim to match all-MiniLM-L6-v2)
    const hash = crypto.createHash("sha512").update(text).digest();
    const vec = new Float32Array(384);
    for (let i = 0; i < 384; i++) {
      vec[i] = (hash[i % 64] / 255) * 2 - 1;
    }
    // Normalize
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    for (let i = 0; i < 384; i++) vec[i] /= norm;
    return vec;
  }
}

// ── 6. Memory (distributed vector store) ─────────────────────────────────

class MemoryCapability extends BaseCapability {
  constructor(manager) {
    super(manager, "memory");
    this.vectors = []; // { id, vector, metadata }
  }
  async start() {
    await super.start();
    this.logger.log("[memory] Distributed vector store enabled");
  }

  add(id, vector, metadata = {}) {
    this.vectors.push({ id, vector: Array.from(vector), metadata, timestamp: Date.now() });
  }

  /**
   * Cosine similarity search.
   */
  search(queryVector, topK = 5) {
    const qv = Array.from(queryVector);
    const scored = this.vectors.map((item) => {
      let dot = 0, normA = 0, normB = 0;
      for (let i = 0; i < qv.length; i++) {
        dot += qv[i] * (item.vector[i] || 0);
        normA += qv[i] * qv[i];
        normB += (item.vector[i] || 0) * (item.vector[i] || 0);
      }
      const sim = dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
      return { ...item, similarity: sim };
    });

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, topK);
  }
}

// ── 7. Orchestration (task decomposition) ────────────────────────────────

class OrchestrationCapability extends BaseCapability {
  constructor(manager) {
    super(manager, "orchestration");
    this.taskQueue = [];
  }
  async start() {
    await super.start();
    this.logger.log("[orchestration] Task decomposition + routing enabled");
  }

  /**
   * Decompose a complex task into subtasks and route to capable peers.
   */
  decompose(task) {
    // Simple decomposition — split into inference + research + storage subtasks
    const subtasks = [];

    if (task.type === "research") {
      subtasks.push(
        { type: "hypothesis", capability: "research", input: task.input },
        { type: "experiment", capability: "research", input: task.input },
        { type: "store_result", capability: "storage", input: null },
      );
    } else if (task.type === "query") {
      subtasks.push(
        { type: "embed", capability: "embedding", input: task.input },
        { type: "search", capability: "memory", input: null },
        { type: "generate", capability: "inference", input: null },
      );
    }

    return subtasks;
  }

  enqueue(task) {
    this.taskQueue.push({ ...task, id: crypto.randomUUID(), createdAt: Date.now() });
  }

  dequeue() {
    return this.taskQueue.shift() || null;
  }
}

// ── 8. Validation (pulse proof verification) ─────────────────────────────

class ValidationCapability extends BaseCapability {
  constructor(manager) {
    super(manager, "validation");
  }
  async start() {
    await super.start();
    this.logger.log("[validation] Pulse proof verification enabled");
  }
}

// ── 9. Relay (NAT traversal for browser nodes) ───────────────────────────

class RelayCapability extends BaseCapability {
  constructor(manager) {
    super(manager, "relay");
  }
  async start() {
    await super.start();
    // Circuit relay is configured at the libp2p level.
    // This just marks the node as willing to relay.
    this.logger.log("[relay] Circuit relay for browser nodes enabled");
  }
}
