import { describe, it, expect, afterAll } from "vitest";
import { startInferenceServer } from "../src/inference/server.js";

const SILENT = { log: () => {}, warn: () => {}, error: () => {} };
let serverInstance = null;

afterAll(async () => {
  if (serverInstance?.server) {
    await new Promise((resolve) => serverInstance.server.close(resolve));
  }
});

describe("Inference Server", () => {
  describe("startInferenceServer", () => {
    it("returns app, server, model, context", async () => {
      serverInstance = await startInferenceServer({
        port: 0,
        modelPath: null,
        logger: SILENT,
      });
      expect(serverInstance).toHaveProperty("app");
      expect(serverInstance).toHaveProperty("server");
      expect(serverInstance).toHaveProperty("model");
      expect(serverInstance).toHaveProperty("context");
    });

    it("model and context are null without a model file", async () => {
      const prev = serverInstance;
      if (prev?.server) await new Promise((r) => prev.server.close(r));

      serverInstance = await startInferenceServer({
        port: 0,
        modelPath: null,
        logger: SILENT,
      });
      expect(serverInstance.model).toBeNull();
      expect(serverInstance.context).toBeNull();
    });
  });

  describe("GET /health", () => {
    it("returns status ok", async () => {
      const prev = serverInstance;
      if (prev?.server) await new Promise((r) => prev.server.close(r));

      serverInstance = await startInferenceServer({
        port: 0,
        modelPath: null,
        modelName: "test-model",
        logger: SILENT,
      });

      const addr = serverInstance.server.address();
      const res = await fetch(`http://127.0.0.1:${addr.port}/health`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.status).toBe("ok");
      expect(body.model_loaded).toBe(false);
      expect(body.model).toBe("test-model");
      expect(typeof body.uptime_seconds).toBe("number");
    });
  });

  describe("GET /v1/models", () => {
    it("returns model list", async () => {
      const prev = serverInstance;
      if (prev?.server) await new Promise((r) => prev.server.close(r));

      serverInstance = await startInferenceServer({
        port: 0,
        modelPath: null,
        modelName: "my-model",
        logger: SILENT,
      });

      const addr = serverInstance.server.address();
      const res = await fetch(`http://127.0.0.1:${addr.port}/v1/models`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.object).toBe("list");
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data[0].id).toBe("my-model");
      expect(body.data[0].owned_by).toBe("local");
    });
  });

  describe("POST /v1/chat/completions", () => {
    it("returns 400 without messages array", async () => {
      const prev = serverInstance;
      if (prev?.server) await new Promise((r) => prev.server.close(r));

      serverInstance = await startInferenceServer({
        port: 0,
        modelPath: null,
        logger: SILENT,
      });

      const addr = serverInstance.server.address();
      const res = await fetch(`http://127.0.0.1:${addr.port}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });

    it("returns 503 when no model loaded", async () => {
      const prev = serverInstance;
      if (prev?.server) await new Promise((r) => prev.server.close(r));

      serverInstance = await startInferenceServer({
        port: 0,
        modelPath: null,
        logger: SILENT,
      });

      const addr = serverInstance.server.address();
      const res = await fetch(`http://127.0.0.1:${addr.port}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      });

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error.type).toBe("model_not_loaded");
    });
  });

  describe("POST /v1/embeddings", () => {
    it("returns 400 without input", async () => {
      const prev = serverInstance;
      if (prev?.server) await new Promise((r) => prev.server.close(r));

      serverInstance = await startInferenceServer({
        port: 0,
        modelPath: null,
        logger: SILENT,
      });

      const addr = serverInstance.server.address();
      const res = await fetch(`http://127.0.0.1:${addr.port}/v1/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it("returns 503 when no model loaded", async () => {
      const prev = serverInstance;
      if (prev?.server) await new Promise((r) => prev.server.close(r));

      serverInstance = await startInferenceServer({
        port: 0,
        modelPath: null,
        logger: SILENT,
      });

      const addr = serverInstance.server.address();
      const res = await fetch(`http://127.0.0.1:${addr.port}/v1/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: "hello" }),
      });

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error.type).toBe("model_not_loaded");
    });
  });
});
