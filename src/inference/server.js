/**
 * Inference Server — OpenAI-compatible API backed by llama.cpp via node-llama-cpp.
 *
 * Endpoints:
 *   GET  /v1/models          — List loaded models
 *   POST /v1/chat/completions — Chat completion (streaming + non-streaming)
 *   POST /v1/embeddings       — Text embeddings
 *   GET  /health              — Health check
 *
 * The server loads GGUF models from the models/ directory. Which model to
 * load is determined by hardware detection (VRAM → recommended model).
 */

import express from "express";
import { existsSync, readdirSync } from "fs";
import { resolve } from "path";

const MODELS_DIR = resolve(process.env.MODELS_DIR || "./models");

/**
 * Start the inference HTTP server.
 *
 * @param {object} opts
 * @param {number} opts.port        - Port to listen on (default 8080)
 * @param {string} opts.modelPath   - Path to GGUF model file
 * @param {string} opts.modelName   - Model name for API responses
 * @param {object} opts.logger      - Logger
 * @returns {Promise<object>}       - { app, server, model }
 */
export async function startInferenceServer(opts = {}) {
  const {
    port = 8080,
    modelPath = null,
    modelName = "local-model",
    logger = console,
  } = opts;

  const app = express();
  app.use(express.json({ limit: "10mb" }));

  // ── Model loading ──────────────────────────────────────────────────────
  let llamaModel = null;
  let llamaContext = null;

  if (modelPath && existsSync(modelPath)) {
    try {
      const { getLlama } = await import("node-llama-cpp");
      const llama = await getLlama();
      llamaModel = await llama.loadModel({ modelPath });
      llamaContext = await llamaModel.createContext({ contextSize: 4096 });
      logger.log(`[inference] Loaded model: ${modelPath}`);
    } catch (err) {
      logger.warn(`[inference] Failed to load model: ${err.message}`);
      logger.warn("[inference] Running in API-proxy mode (no local model)");
    }
  } else {
    logger.log("[inference] No model path provided — running in proxy mode");
  }

  // ── GET /v1/models ─────────────────────────────────────────────────────
  app.get("/v1/models", (_req, res) => {
    const models = [{ id: modelName, object: "model", owned_by: "local" }];

    // Also list any GGUF files in models/ dir
    if (existsSync(MODELS_DIR)) {
      for (const f of readdirSync(MODELS_DIR)) {
        if (f.endsWith(".gguf")) {
          models.push({ id: f.replace(".gguf", ""), object: "model", owned_by: "local" });
        }
      }
    }

    res.json({ object: "list", data: models });
  });

  // ── POST /v1/chat/completions ──────────────────────────────────────────
  app.post("/v1/chat/completions", async (req, res) => {
    const { messages, stream = false, max_tokens = 512, temperature = 0.7 } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages array required" });
    }

    // If no local model, return a helpful error
    if (!llamaContext) {
      return res.status(503).json({
        error: {
          message: "No model loaded. Download a GGUF model to models/ and restart.",
          type: "model_not_loaded",
        },
      });
    }

    try {
      const { LlamaChatSession } = await import("node-llama-cpp");
      const session = new LlamaChatSession({ contextSequence: llamaContext.getSequence() });

      // Build prompt from messages
      const lastUserMsg = messages.filter((m) => m.role === "user").pop();
      const prompt = lastUserMsg?.content || "";

      if (stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        const id = `chatcmpl-${Date.now()}`;
        let fullText = "";

        await session.prompt(prompt, {
          maxTokens: max_tokens,
          temperature,
          onTextChunk: (text) => {
            fullText += text;
            const chunk = {
              id,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: modelName,
              choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
            };
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          },
        });

        // Final chunk
        const done = {
          id,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: modelName,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        };
        res.write(`data: ${JSON.stringify(done)}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      } else {
        const response = await session.prompt(prompt, {
          maxTokens: max_tokens,
          temperature,
        });

        res.json({
          id: `chatcmpl-${Date.now()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: modelName,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: response },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
      }
    } catch (err) {
      res.status(500).json({ error: { message: err.message, type: "inference_error" } });
    }
  });

  // ── POST /v1/embeddings ────────────────────────────────────────────────
  app.post("/v1/embeddings", async (req, res) => {
    const { input, model: _model } = req.body;

    if (!input) {
      return res.status(400).json({ error: "input required" });
    }

    if (!llamaModel) {
      return res.status(503).json({
        error: { message: "No model loaded for embeddings.", type: "model_not_loaded" },
      });
    }

    try {
      const { LlamaEmbeddingContext } = await import("node-llama-cpp");
      const embCtx = await llamaModel.createEmbeddingContext();

      const texts = Array.isArray(input) ? input : [input];
      const data = [];
      for (let i = 0; i < texts.length; i++) {
        const vec = await embCtx.getEmbeddingFor(texts[i]);
        data.push({
          object: "embedding",
          index: i,
          embedding: Array.from(vec.vector),
        });
      }

      res.json({ object: "list", data, model: modelName, usage: { total_tokens: 0 } });
    } catch (err) {
      res.status(500).json({ error: { message: err.message, type: "embedding_error" } });
    }
  });

  // ── GET /health ────────────────────────────────────────────────────────
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      model_loaded: !!llamaContext,
      model: modelName,
      uptime_seconds: Math.floor(process.uptime()),
    });
  });

  // ── Start server ───────────────────────────────────────────────────────
  const server = app.listen(port, () => {
    logger.log(`[inference] API server listening on http://localhost:${port}/v1`);
  });

  return { app, server, model: llamaModel, context: llamaContext };
}
