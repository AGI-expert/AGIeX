#!/usr/bin/env node
/**
 * Download a GGUF model from HuggingFace into the models/ directory.
 *
 * Usage:
 *   node scripts/download-model.js                           # Interactive — picks a small default
 *   node scripts/download-model.js <hf-repo> <filename>      # Direct download
 *
 * Examples:
 *   node scripts/download-model.js bartowski/Qwen3-0.6B-GGUF Qwen3-0.6B-Q4_K_M.gguf
 *   node scripts/download-model.js TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf
 *   node scripts/download-model.js bartowski/Phi-4-mini-instruct-GGUF Phi-4-mini-instruct-Q4_K_M.gguf
 */

import { createWriteStream, existsSync, mkdirSync, statSync } from "fs";
import { resolve, basename } from "path";
import { get as httpsGet } from "https";

const MODELS_DIR = resolve(process.env.MODELS_DIR || "./models");

// ── Curated small models for quick start ────────────────────────────────
const PRESETS = [
  {
    name: "Qwen3 0.6B (Q4_K_M) — 0.5 GB, fast CPU inference",
    repo: "bartowski/Qwen3-0.6B-GGUF",
    file: "Qwen3-0.6B-Q4_K_M.gguf",
  },
  {
    name: "TinyLlama 1.1B Chat (Q4_K_M) — 0.7 GB, good for chat",
    repo: "TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF",
    file: "tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf",
  },
  {
    name: "Phi-4 Mini Instruct (Q4_K_M) — 2.4 GB, strong reasoning",
    repo: "bartowski/Phi-4-mini-instruct-GGUF",
    file: "Phi-4-mini-instruct-Q4_K_M.gguf",
  },
  {
    name: "Qwen3 4B (Q4_K_M) — 2.7 GB, balanced quality/speed",
    repo: "bartowski/Qwen3-4B-GGUF",
    file: "Qwen3-4B-Q4_K_M.gguf",
  },
];

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function download(url, destPath) {
  return new Promise((resolvePromise, reject) => {
    const follow = (u) => {
      httpsGet(u, (res) => {
        // Follow redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          follow(res.headers.location);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${u}`));
          return;
        }

        const totalBytes = parseInt(res.headers["content-length"] || "0", 10);
        let downloaded = 0;
        let lastPct = -1;

        const file = createWriteStream(destPath);
        res.on("data", (chunk) => {
          downloaded += chunk.length;
          file.write(chunk);
          if (totalBytes > 0) {
            const pct = Math.floor((downloaded / totalBytes) * 100);
            if (pct !== lastPct) {
              lastPct = pct;
              process.stdout.write(`\r  Downloading... ${pct}%  ${formatBytes(downloaded)} / ${formatBytes(totalBytes)}`);
            }
          } else {
            process.stdout.write(`\r  Downloading... ${formatBytes(downloaded)}`);
          }
        });

        res.on("end", () => {
          file.end();
          process.stdout.write("\n");
          resolvePromise();
        });

        res.on("error", reject);
      }).on("error", reject);
    };
    follow(url);
  });
}

async function main() {
  if (!existsSync(MODELS_DIR)) {
    mkdirSync(MODELS_DIR, { recursive: true });
  }

  let repo, file;

  if (process.argv.length >= 4) {
    // Direct mode: node download-model.js <repo> <file>
    repo = process.argv[2];
    file = process.argv[3];
  } else {
    // Show presets
    console.log("\n\x1b[1;36m  AGI.expert\x1b[0m — GGUF Model Downloader\n");
    console.log("  Available presets:\n");
    PRESETS.forEach((p, i) => {
      console.log(`    \x1b[1;32m${i + 1}.\x1b[0m ${p.name}`);
      console.log(`       \x1b[2m${p.repo}/${p.file}\x1b[0m\n`);
    });
    console.log("  Or run with custom repo:");
    console.log("    \x1b[2mnode scripts/download-model.js <hf-repo> <filename>\x1b[0m\n");

    // Default to the smallest model
    const choice = parseInt(process.argv[2] || "1", 10);
    const preset = PRESETS[choice - 1] || PRESETS[0];
    repo = preset.repo;
    file = preset.file;
    console.log(`  Selected: \x1b[1m${preset.name}\x1b[0m\n`);
  }

  const destPath = resolve(MODELS_DIR, file);
  const destName = file.replace(".gguf", "");

  // Check if already downloaded
  if (existsSync(destPath)) {
    const size = statSync(destPath).size;
    console.log(`  Model already exists: ${destPath} (${formatBytes(size)})`);
    console.log(`\n  Start your node with:\n    node src/main.js\n`);
    return;
  }

  const url = `https://huggingface.co/${repo}/resolve/main/${file}`;
  console.log(`  Source:  ${url}`);
  console.log(`  Dest:    ${destPath}\n`);

  try {
    await download(url, destPath);

    const size = statSync(destPath).size;
    console.log(`\n  \x1b[1;32mDone!\x1b[0m Downloaded ${formatBytes(size)} to models/${file}`);
    console.log(`\n  Start your node with:\n    node src/main.js\n`);
    console.log(`  Or test inference:\n    curl http://localhost:8080/v1/chat/completions \\`);
    console.log(`      -H "Content-Type: application/json" \\`);
    console.log(`      -d '{"messages":[{"role":"user","content":"Hello"}]}'\n`);
  } catch (err) {
    console.error(`\n  \x1b[31mDownload failed:\x1b[0m ${err.message}`);
    // Clean up partial file
    const { unlinkSync } = await import("fs");
    if (existsSync(destPath)) {
      try { unlinkSync(destPath); } catch {}
    }
    process.exit(1);
  }
}

main();
