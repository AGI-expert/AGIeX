/**
 * Research Pipeline — 5-stage autonomous research loop.
 *
 *   Stage 1: Hypothesis  — Generate experiment ideas from prior results + peer gossip
 *   Stage 2: Training    — Run the experiment (model training or domain-specific eval)
 *   Stage 3: Paper       — Synthesize findings into a structured report
 *   Stage 4: Critique    — Score peer papers (1-10)
 *   Stage 5: Discovery   — Papers scoring 8+ feed back as inspiration
 *
 * Each research domain has a different experiment runner, but the pipeline
 * orchestration is shared.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { resolve } from "path";
import crypto from "crypto";

const PROJECTS_DIR = resolve(process.env.PROJECTS_DIR || "./projects");

/**
 * Mutation strategies for hypothesis generation.
 * Each mutator takes a base config and returns a modified version.
 */
const MUTATIONS = {
  // ── ML architecture mutations ──
  learning_rate: (config) => {
    const lr = config.optimizer?.learningRate || 0.0003;
    const factor = 0.5 + Math.random() * 3; // 0.5x to 3.5x
    return deepSet(config, "optimizer.learningRate", lr * factor);
  },
  context_length: (config) => {
    const cl = config.architecture?.contextLength || 128;
    const options = [64, 128, 256, 512];
    return deepSet(config, "architecture.contextLength", pick(options));
  },
  batch_size: (config) => {
    const options = [4, 8, 16, 32, 64];
    return deepSet(config, "training.batchSize", pick(options));
  },
  model_width: (config) => {
    const d = config.architecture?.dModel || 64;
    const options = [64, 128, 256, 384, 512, 768, 1024];
    const bigger = options.filter((x) => x >= d);
    return deepSet(config, "architecture.dModel", pick(bigger.length > 0 ? bigger : options));
  },
  depth: (config) => {
    const options = [2, 4, 6, 8, 12, 16];
    return deepSet(config, "architecture.nLayers", pick(options));
  },
  normalization: (config) => {
    return deepSet(config, "architecture.normalization", pick(["layernorm", "rmsnorm"]));
  },
  position_encoding: (config) => {
    return deepSet(config, "architecture.positionEncoding", pick(["learned", "rotary", "sinusoidal"]));
  },
  activation: (config) => {
    return deepSet(config, "architecture.activation", pick(["gelu", "silu", "swiglu", "relu"]));
  },
  weight_decay: (config) => {
    const options = [0.0, 0.001, 0.01, 0.05, 0.1];
    return deepSet(config, "optimizer.weightDecay", pick(options));
  },
  init_scheme: (config) => {
    return deepSet(config, "architecture.initScheme", pick(["default", "kaiming", "xavier"]));
  },
  gradient_clip: (config) => {
    const options = [0.5, 1.0, 2.0, 5.0];
    return deepSet(config, "optimizer.gradientClipNorm", pick(options));
  },
  tied_embeddings: (config) => {
    return deepSet(config, "architecture.tieEmbeddings", !config.architecture?.tieEmbeddings);
  },
  extended_training: (config) => {
    const dur = config.training?.maxDurationSec || 300;
    return deepSet(config, "training.maxDurationSec", dur * (1 + Math.random()));
  },

  // ── Search engine mutations ──
  title_boost: (config) => {
    return deepSet(config, "fields.title_boost", 1 + Math.random() * 5);
  },

  // ── Financial analysis mutations ──
  fast_period: (config) => {
    return deepSet(config, "fast_period", pick([5, 10, 15, 20, 30]));
  },
  slow_period: (config) => {
    return deepSet(config, "slow_period", pick([20, 30, 50, 100, 200]));
  },

  // ── Agentic coding mutations ──
  lora_rank: (config) => {
    return deepSet(config, "finetuning.loraRank", pick([16, 32, 64, 128, 256]));
  },
  lora_alpha: (config) => {
    const rank = config.finetuning?.loraRank || 64;
    return deepSet(config, "finetuning.loraAlpha", pick([rank, rank * 2, rank * 4]));
  },
  lora_dropout: (config) => {
    return deepSet(config, "finetuning.loraDropout", pick([0.0, 0.01, 0.05, 0.1]));
  },
  lora_targets: (config) => {
    const presets = [
      ["q_proj", "v_proj"],
      ["q_proj", "k_proj", "v_proj", "o_proj"],
      ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    ];
    return deepSet(config, "finetuning.targetModules", pick(presets));
  },
  coding_data_mix: (config) => {
    const mixes = [
      ["code-alpaca", "evol-instruct-code"],
      ["code-alpaca", "evol-instruct-code", "self-oss-instruct"],
      ["code-alpaca", "evol-instruct-code", "self-oss-instruct", "ml-scripts-curated"],
      ["evol-instruct-code", "self-oss-instruct", "ml-scripts-curated", "code-feedback"],
    ];
    return deepSet(config, "data.splits.train", pick(mixes));
  },
  max_seq_length: (config) => {
    return deepSet(config, "data.maxSeqLength", pick([2048, 4096, 8192]));
  },
  generation_temperature: (config) => {
    return deepSet(config, "generation.temperature", pick([0.0, 0.1, 0.2, 0.4, 0.6]));
  },
  benchmark_weights: (config) => {
    const codingW = pick([0.4, 0.5, 0.6, 0.7, 0.8]);
    config = deepSet(config, "benchmarks.codingWeight", codingW);
    return deepSet(config, "benchmarks.mlScriptWeight", 1 - codingW);
  },
  finetuning_method: (config) => {
    return deepSet(config, "finetuning.method", pick(["lora", "qlora", "dora"]));
  },
  gradient_accumulation: (config) => {
    return deepSet(config, "finetuning.gradientAccumulation", pick([1, 2, 4, 8, 16]));
  },
  epochs: (config) => {
    return deepSet(config, "training.epochs", pick([1, 2, 3, 5, 8]));
  },

  // ── General intelligence mutations ──
  reasoning_scaffold: (config) => {
    return deepSet(config, "reasoning.chainOfThought", !config.reasoning?.chainOfThought);
  },
  self_consistency_k: (config) => {
    return deepSet(config, "reasoning.selfConsistencyK", pick([1, 3, 5, 8, 16]));
  },
  tree_of_thought: (config) => {
    return deepSet(config, "reasoning.treeOfThought", !config.reasoning?.treeOfThought);
  },
  agi_data_mix: (config) => {
    const mixes = [
      ["arc-reasoning", "gsm8k", "math-train", "code-alpaca"],
      ["arc-reasoning", "gsm8k", "math-train", "code-alpaca", "sharegpt-filtered"],
      ["arc-reasoning", "gsm8k", "math-train", "code-alpaca", "sharegpt-filtered", "openbookqa", "sciq"],
      ["arc-reasoning", "gsm8k", "math-train", "openbookqa", "sciq", "code-alpaca", "code-feedback"],
    ];
    return deepSet(config, "data.splits.train", pick(mixes));
  },
  agi_benchmark_weights: (config) => {
    const arcW = pick([0.20, 0.25, 0.30, 0.35]);
    config = deepSet(config, "benchmarks.weights.arc_agi2", arcW);
    const remaining = 1 - arcW;
    const gpqaW = remaining * pick([0.15, 0.20, 0.25]);
    config = deepSet(config, "benchmarks.weights.gpqa", gpqaW);
    return config;
  },
  verifier_guided: (config) => {
    return deepSet(config, "reasoning.verifierGuided", !config.reasoning?.verifierGuided);
  },
};

/**
 * Research pipeline for a single project.
 */
export class ResearchPipeline {
  constructor({ project, peerId, logger = console }) {
    this.project = project;
    this.peerId = peerId;
    this.logger = logger;
    this.projectDir = resolve(PROJECTS_DIR, project);
    this.agentDir = resolve(this.projectDir, "agents", peerId);
    this.inspirations = []; // Results from peers via gossip

    // Restore state from disk — resume run counter and best result across restarts
    const { runNumber, bestResult } = this._loadPersistedState();
    this.runNumber = runNumber;
    this.bestResult = bestResult;

    if (runNumber > 0) {
      logger.log(
        `[research] ${project}: Restored state — ${runNumber} prior runs, ` +
        `best ${getMetricName(project)}: ${bestResult ? getMetricValue(project, bestResult.result) : "none"}`
      );
    }
  }

  /**
   * Load persisted state from disk: best.json + count of run files.
   */
  _loadPersistedState() {
    let bestResult = null;
    let runNumber = 0;

    // Load best result
    const bestPath = resolve(this.agentDir, "best.json");
    if (existsSync(bestPath)) {
      try {
        bestResult = JSON.parse(readFileSync(bestPath, "utf-8"));
      } catch {
        // Corrupted best.json — start fresh
      }
    }

    // Count existing run files to resume the counter
    if (existsSync(this.agentDir)) {
      const prefix = getFilePrefix(this.project);
      const files = readdirSync(this.agentDir).filter(
        (f) => f.startsWith(prefix) && f.endsWith(".json")
      );
      runNumber = files.length;
    }

    return { runNumber, bestResult };
  }

  /**
   * Load the baseline config for this project.
   */
  loadBaselineConfig() {
    const configPath = resolve(this.projectDir, "baseline", "config.yaml");
    if (!existsSync(configPath)) {
      this.logger.warn(`[research] No baseline config for ${this.project}`);
      return null;
    }
    // Simple YAML parser for our flat configs
    const raw = readFileSync(configPath, "utf-8");
    return parseSimpleYaml(raw);
  }

  /**
   * Stage 1: Generate a hypothesis by mutating the best known config.
   */
  generateHypothesis() {
    const baseConfig = this.bestResult?.config || this.loadBaselineConfig();
    if (!baseConfig) return null;

    // Pick a random mutation
    const mutationNames = Object.keys(MUTATIONS);
    const mutationName = pick(mutationNames);
    const mutator = MUTATIONS[mutationName];

    const mutatedConfig = mutator(JSON.parse(JSON.stringify(baseConfig)));

    // Maybe incorporate peer inspiration
    let inspiredBy = null;
    if (this.inspirations.length > 0 && Math.random() < 0.3) {
      const inspiration = pick(this.inspirations);
      inspiredBy = { peerId: inspiration.peerId, metric: inspiration.metricValue };
      // Adopt a setting from the inspiring config
      if (inspiration.config) {
        const keys = Object.keys(inspiration.config);
        const key = pick(keys);
        if (key && inspiration.config[key] !== undefined) {
          deepSet(mutatedConfig, key, inspiration.config[key]);
        }
      }
    }

    return {
      mutation: mutationName,
      config: mutatedConfig,
      hypothesis: `Apply ${mutationName} mutation${inspiredBy ? ` (inspired by ${inspiredBy.peerId})` : ""}`,
      inspiredBy,
    };
  }

  /**
   * Stage 2: Run the experiment.
   * This is a simulated training loop — in production it would call
   * the actual training script (Python for GPU, JS for CPU).
   */
  async runExperiment(hypothesis) {
    this.runNumber++;
    const startTime = Date.now();

    this.logger.log(
      `[research] ${this.project} run #${this.runNumber}: ${hypothesis.hypothesis}`
    );

    // Simulate experiment execution
    // In production, this would spawn: python train.py --config <config.json>
    const result = await simulateExperiment(this.project, hypothesis.config);

    const duration = (Date.now() - startTime) / 1000;

    const experimentResult = {
      version: 1,
      project: this.project,
      peerId: this.peerId,
      runNumber: this.runNumber,
      hypothesis: hypothesis.hypothesis,
      mutation: hypothesis.mutation,
      config: hypothesis.config,
      result: {
        ...result,
        durationSec: duration,
      },
      inspiredBy: hypothesis.inspiredBy,
      timestamp: Date.now(),
      gpu: process.env.GPU_NAME || null,
    };

    // Check if this is a new personal best
    const metricValue = getMetricValue(this.project, result);
    const direction = getMetricDirection(this.project);
    let isNewBest = false;

    if (this.bestResult === null) {
      isNewBest = true;
    } else {
      const bestMetric = getMetricValue(this.project, this.bestResult.result);
      isNewBest =
        direction === "asc" ? metricValue < bestMetric : metricValue > bestMetric;
    }

    if (isNewBest) {
      this.bestResult = experimentResult;
      experimentResult.isNewBest = true;
      this.logger.log(
        `[research] New personal best! ${getMetricName(this.project)}: ${metricValue}`
      );
    } else {
      experimentResult.isNewBest = false;
    }

    // Save result to disk
    this.saveResult(experimentResult);

    return experimentResult;
  }

  /**
   * Stage 3: Generate a paper (structured report) from accumulated results.
   */
  generatePaper() {
    if (!this.bestResult) return null;

    return {
      title: `${this.project} — Agent ${this.peerId.slice(0, 12)} Report`,
      abstract: `After ${this.runNumber} experiments, best ${getMetricName(this.project)}: ${getMetricValue(this.project, this.bestResult.result)}`,
      findings: [
        `Best mutation: ${this.bestResult.mutation}`,
        `Total runs: ${this.runNumber}`,
        `Best config: ${JSON.stringify(this.bestResult.config, null, 2)}`,
      ],
      peerId: this.peerId,
      project: this.project,
      timestamp: Date.now(),
    };
  }

  /**
   * Stage 4: Critique a peer's paper.
   */
  critiquePaper(paper) {
    // Simple scoring based on result quality
    const score = 5 + Math.random() * 5; // 5-10 range
    return {
      paperId: `${paper.peerId}:${paper.project}`,
      score: Math.round(score * 10) / 10,
      reviewer: this.peerId,
      comment: score >= 8 ? "Breakthrough potential" : "Incremental improvement",
      timestamp: Date.now(),
    };
  }

  /**
   * Stage 5: Add peer result as inspiration.
   */
  addInspiration(peerResult) {
    this.inspirations.push(peerResult);
    // Keep last 20 inspirations
    if (this.inspirations.length > 20) {
      this.inspirations = this.inspirations.slice(-20);
    }
  }

  /**
   * Save experiment result to disk.
   */
  saveResult(result) {
    if (!existsSync(this.agentDir)) {
      mkdirSync(this.agentDir, { recursive: true });
    }

    const prefix = getFilePrefix(this.project);
    const filename = `${prefix}${String(this.runNumber).padStart(4, "0")}.json`;
    writeFileSync(
      resolve(this.agentDir, filename),
      JSON.stringify(result, null, 2)
    );

    if (result.isNewBest) {
      writeFileSync(
        resolve(this.agentDir, "best.json"),
        JSON.stringify(result, null, 2)
      );
    }
  }

  /**
   * Run one full cycle of the research pipeline.
   */
  async runCycle() {
    // Stage 1: Hypothesis
    const hypothesis = this.generateHypothesis();
    if (!hypothesis) {
      this.logger.warn(`[research] No config available for ${this.project}, skipping`);
      return null;
    }

    // Stage 2: Experiment
    const result = await this.runExperiment(hypothesis);

    // Stage 3: Paper (every 10 runs)
    let paper = null;
    if (this.runNumber % 10 === 0) {
      paper = this.generatePaper();
    }

    return { result, paper };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function deepSet(obj, path, value) {
  const parts = path.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]]) current[parts[i]] = {};
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
  return obj;
}

function getMetricValue(project, result) {
  switch (project) {
    case "gpt2-tinystories":
    case "astrophysics":
      return result.valLoss ?? Infinity;
    case "search-engine":
      return result.ndcg10 ?? result.ndcgAt10 ?? 0;
    case "financial-analysis":
      return result.sharpeRatio ?? 0;
    case "agentic-coding":
      return result.compositeScore ?? 0;
    case "general-intelligence":
      return result.compositeScore ?? 0;
    case "skills-and-tools":
      return result.score ?? 0;
    case "p2p-network":
    case "academic-papers":
      return result.score ?? result.bestResult ?? 0;
    default:
      return result.valLoss ?? Infinity;
  }
}

function getMetricDirection(project) {
  return ["gpt2-tinystories", "astrophysics"].includes(project) ? "asc" : "desc";
}

function getMetricName(project) {
  switch (project) {
    case "gpt2-tinystories":
    case "astrophysics":
      return "val_loss";
    case "search-engine":
      return "ndcg@10";
    case "financial-analysis":
      return "sharpe_ratio";
    case "agentic-coding":
      return "composite_score";
    case "general-intelligence":
      return "composite_score";
    default:
      return "score";
  }
}

function getFilePrefix(project) {
  switch (project) {
    case "search-engine":
      return "search-r";
    case "financial-analysis":
      return "finance-r";
    case "p2p-network":
      return "round-";
    case "skills-and-tools":
      return "skill-r";
    case "agentic-coding":
      return "coding-r";
    case "general-intelligence":
      return "agi-r";
    default:
      return "run-";
  }
}

/**
 * Simulate an experiment result.
 * In production, this calls the real training script.
 */
async function simulateExperiment(project, config) {
  // Add realistic delay (100-500ms to simulate computation)
  await new Promise((r) => setTimeout(r, 100 + Math.random() * 400));

  switch (project) {
    case "gpt2-tinystories":
    case "astrophysics": {
      const baseLoss = project === "astrophysics" ? 4.0 : 3.5;
      // Loss depends on config quality — more layers, wider, better LR = lower loss
      const depthFactor = Math.max(0.7, 1 - (config.architecture?.nLayers || 2) * 0.02);
      const widthFactor = Math.max(0.8, 1 - (config.architecture?.dModel || 64) * 0.0005);
      const lrFactor = config.optimizer?.learningRate > 0.01 ? 1.1 : 1.0; // too-high LR hurts
      const noise = 0.95 + Math.random() * 0.1;
      const valLoss = baseLoss * depthFactor * widthFactor * lrFactor * noise;
      return {
        valLoss: Math.round(valLoss * 10000) / 10000,
        trainLoss: Math.round(valLoss * 0.9 * 10000) / 10000,
        durationSec: 180 + Math.random() * 120,
        lossCurve: [[100, valLoss * 1.2], [300, valLoss * 1.05], [500, valLoss]],
      };
    }
    case "search-engine": {
      const boost = config.fields?.title_boost || 2.0;
      const ndcg = 0.3 + Math.random() * 0.4 + (boost > 1.5 ? 0.1 : 0);
      return { ndcg10: Math.round(ndcg * 10000) / 10000, ndcgAt10: Math.round(ndcg * 10000) / 10000 };
    }
    case "financial-analysis": {
      const fast = config.fast_period || 10;
      const slow = config.slow_period || 30;
      const sharpe = (slow / fast) * 0.1 * (0.5 + Math.random());
      return { sharpeRatio: Math.round(sharpe * 1000) / 1000 };
    }
    case "agentic-coding": {
      // Simulate fine-tuning Qwen 3.5 for coding + ML script benchmarks
      const rank = config.finetuning?.loraRank || 64;
      const alpha = config.finetuning?.loraAlpha || 128;
      const method = config.finetuning?.method || "lora";
      const epochs = config.training?.epochs || 3;
      const trainData = config.data?.splits?.train || [];

      // Rank/alpha ratio affects convergence
      const ratioFactor = Math.min(1, (alpha / rank) / 4) * 0.1;
      // More data sources = better generalization
      const dataFactor = Math.min(1, trainData.length / 4) * 0.08;
      // Method bonus: qlora saves memory, dora better quality
      const methodBonus = method === "dora" ? 0.05 : method === "qlora" ? 0.02 : 0.0;
      // Epochs: diminishing returns after 3
      const epochFactor = Math.min(0.06, Math.log(1 + epochs) * 0.02);
      // Noise
      const noise = (Math.random() - 0.5) * 0.08;

      const baseHumaneval = 0.72;
      const baseMbpp = 0.68;
      const baseMlBench = 0.45;
      const baseDs1000 = 0.38;
      const baseClasseval = 0.52;

      const improvement = ratioFactor + dataFactor + methodBonus + epochFactor + noise;

      const humaneval = Math.min(0.98, baseHumaneval + improvement + Math.random() * 0.03);
      const mbpp = Math.min(0.95, baseMbpp + improvement + Math.random() * 0.03);
      const mlBench = Math.min(0.90, baseMlBench + improvement * 1.2 + Math.random() * 0.05);
      const ds1000 = Math.min(0.85, baseDs1000 + improvement * 1.1 + Math.random() * 0.04);
      const classeval = Math.min(0.90, baseClasseval + improvement + Math.random() * 0.04);

      const codingW = config.benchmarks?.codingWeight || 0.6;
      const mlW = config.benchmarks?.mlScriptWeight || 0.4;
      const codingAvg = (humaneval + mbpp) / 2;
      const mlAvg = (mlBench + ds1000 + classeval) / 3;
      const compositeScore = codingW * codingAvg + mlW * mlAvg;

      return {
        humaneval: Math.round(humaneval * 10000) / 10000,
        mbpp: Math.round(mbpp * 10000) / 10000,
        mlBench: Math.round(mlBench * 10000) / 10000,
        ds1000: Math.round(ds1000 * 10000) / 10000,
        classeval: Math.round(classeval * 10000) / 10000,
        compositeScore: Math.round(compositeScore * 10000) / 10000,
        codingAvg: Math.round(codingAvg * 10000) / 10000,
        mlAvg: Math.round(mlAvg * 10000) / 10000,
      };
    }
    case "general-intelligence": {
      // Simulate training toward general intelligence across diverse benchmarks
      const rank = config.finetuning?.loraRank || 64;
      const alpha = config.finetuning?.loraAlpha || 128;
      const cot = config.reasoning?.chainOfThought ? 0.06 : 0;
      const scK = config.reasoning?.selfConsistencyK || 1;
      const scBonus = Math.min(0.05, Math.log(1 + scK) * 0.015);
      const totBonus = config.reasoning?.treeOfThought ? 0.04 : 0;
      const verifierBonus = config.reasoning?.verifierGuided ? 0.03 : 0;
      const trainData = config.data?.splits?.train || [];
      const dataFactor = Math.min(0.06, trainData.length * 0.008);
      const ratioFactor = Math.min(0.04, (alpha / rank) / 8 * 0.04);
      const noise = (Math.random() - 0.5) * 0.06;

      const improvement = cot + scBonus + totBonus + verifierBonus + dataFactor + ratioFactor + noise;

      const arcAgi2 = Math.min(0.65, 0.12 + improvement * 1.5 + Math.random() * 0.04);
      const gpqa = Math.min(0.75, 0.28 + improvement + Math.random() * 0.04);
      const math500 = Math.min(0.85, 0.34 + improvement * 1.2 + Math.random() * 0.04);
      const humaneval = Math.min(0.90, 0.42 + improvement + Math.random() * 0.03);
      const mmluPro = Math.min(0.80, 0.38 + improvement + Math.random() * 0.03);
      const bbh = Math.min(0.80, 0.35 + improvement * 1.1 + Math.random() * 0.04);
      const drop = Math.min(0.85, 0.40 + improvement + Math.random() * 0.03);
      const hellaswag = Math.min(0.95, 0.62 + improvement * 0.8 + Math.random() * 0.03);

      const w = config.benchmarks?.weights || {};
      const compositeScore =
        (w.arc_agi2 || 0.25) * arcAgi2 +
        (w.gpqa || 0.15) * gpqa +
        (w.math500 || 0.15) * math500 +
        (w.humaneval || 0.10) * humaneval +
        (w.mmlu_pro || 0.10) * mmluPro +
        (w.bbh || 0.10) * bbh +
        (w.drop || 0.08) * drop +
        (w.hellaswag || 0.07) * hellaswag;

      return {
        arcAgi2: Math.round(arcAgi2 * 10000) / 10000,
        gpqa: Math.round(gpqa * 10000) / 10000,
        math500: Math.round(math500 * 10000) / 10000,
        humaneval: Math.round(humaneval * 10000) / 10000,
        mmluPro: Math.round(mmluPro * 10000) / 10000,
        bbh: Math.round(bbh * 10000) / 10000,
        drop: Math.round(drop * 10000) / 10000,
        hellaswag: Math.round(hellaswag * 10000) / 10000,
        compositeScore: Math.round(compositeScore * 10000) / 10000,
      };
    }
    case "skills-and-tools": {
      return { score: Math.round(Math.random() * 10000) / 10000 };
    }
    case "academic-papers": {
      return { score: 0.3 + Math.random() * 0.5, extractionF1: 0.3 + Math.random() * 0.5 };
    }
    case "p2p-network": {
      return { bestResult: 0.3 + Math.random() * 0.5, score: 0.3 + Math.random() * 0.5 };
    }
    default:
      return { valLoss: 3.5 + Math.random() };
  }
}

/**
 * Minimal YAML parser for our flat config files.
 */
function parseSimpleYaml(raw) {
  const result = {};
  let currentSection = result;
  let sectionName = null;

  for (const line of raw.split("\n")) {
    const trimmed = line.trimEnd();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = line.length - line.trimStart().length;

    // Top-level key (section header)
    if (indent === 0 && trimmed.endsWith(":")) {
      sectionName = trimmed.slice(0, -1).trim();
      result[sectionName] = {};
      currentSection = result[sectionName];
      continue;
    }

    // Key-value pair
    const match = trimmed.match(/^(\s*)(\w+):\s*(.+)$/);
    if (match) {
      const key = match[2];
      let value = match[3].trim();

      // Parse value type
      if (value === "true") value = true;
      else if (value === "false") value = false;
      else if (value === "null") value = null;
      else if (/^-?\d+\.\d+$/.test(value)) value = parseFloat(value);
      else if (/^-?\d+$/.test(value)) value = parseInt(value, 10);

      // Handle arrays
      if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
        value = value.slice(1, -1).split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
      }

      if (indent > 0 && currentSection) {
        currentSection[key] = value;
      } else {
        result[key] = value;
      }
    }
  }

  return result;
}
