import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ResearchPipeline } from "../src/research/pipeline.js";
import { rmSync, existsSync, mkdirSync, writeFileSync, readdirSync } from "fs";
import { resolve } from "path";

const PROJECTS_DIR = resolve("./projects");
const SILENT = { log: () => {}, warn: () => {}, error: () => {} };

const ALL_PROJECTS = [
  "gpt2-tinystories",
  "astrophysics",
  "search-engine",
  "financial-analysis",
  "skills-and-tools",
  "academic-papers",
  "p2p-network",
  "agentic-coding",
  "general-intelligence",
];

describe("Research Pipeline", () => {
  describe("constructor", () => {
    it("sets project and peerId", () => {
      const pipeline = new ResearchPipeline({ project: "gpt2-tinystories", peerId: "test-peer", logger: SILENT });
      expect(pipeline.project).toBe("gpt2-tinystories");
      expect(pipeline.peerId).toBe("test-peer");
    });

    it("initializes empty inspirations array", () => {
      const pipeline = new ResearchPipeline({ project: "gpt2-tinystories", peerId: "test-peer", logger: SILENT });
      expect(pipeline.inspirations).toEqual([]);
    });

    it("starts with runNumber 0", () => {
      const pipeline = new ResearchPipeline({ project: "gpt2-tinystories", peerId: "fresh-ctor-peer", logger: SILENT });
      expect(pipeline.runNumber).toBe(0);
    });
  });

  describe("loadBaselineConfig", () => {
    for (const project of ALL_PROJECTS) {
      it(`loads baseline config for ${project}`, () => {
        const pipeline = new ResearchPipeline({
          project,
          peerId: "test-peer-config",
          logger: SILENT,
        });
        const config = pipeline.loadBaselineConfig();
        expect(config).not.toBeNull();
        expect(typeof config).toBe("object");
      });
    }

    it("returns null for project with no baseline dir", () => {
      const pipeline = new ResearchPipeline({ project: "nonexistent-project", peerId: "test", logger: SILENT });
      expect(pipeline.loadBaselineConfig()).toBeNull();
    });
  });

  describe("generateHypothesis", () => {
    for (const project of ALL_PROJECTS) {
      it(`generates hypothesis for ${project}`, () => {
        const pipeline = new ResearchPipeline({
          project,
          peerId: "test-peer-hyp",
          logger: SILENT,
        });
        const hypothesis = pipeline.generateHypothesis();
        expect(hypothesis).not.toBeNull();
        expect(hypothesis).toHaveProperty("mutation");
        expect(hypothesis).toHaveProperty("config");
        expect(hypothesis).toHaveProperty("hypothesis");
        expect(typeof hypothesis.hypothesis).toBe("string");
      });
    }

    it("incorporates peer inspiration sometimes", () => {
      const pipeline = new ResearchPipeline({
        project: "gpt2-tinystories",
        peerId: "test-peer-insp",
        logger: SILENT,
      });
      // Add many inspirations to increase chance of picking one
      for (let i = 0; i < 50; i++) {
        pipeline.addInspiration({
          peerId: `peer-${i}`,
          metricValue: 2.0 + Math.random(),
          config: { optimizer: { learningRate: 0.001 } },
        });
      }
      // Run many hypotheses; at least one should be inspired
      let foundInspired = false;
      for (let i = 0; i < 100; i++) {
        const h = pipeline.generateHypothesis();
        if (h.inspiredBy) { foundInspired = true; break; }
      }
      expect(foundInspired).toBe(true);
    });

    it("hypothesis string contains mutation name", () => {
      const pipeline = new ResearchPipeline({ project: "financial-analysis", peerId: "test-peer-mut", logger: SILENT });
      const h = pipeline.generateHypothesis();
      expect(h.hypothesis).toContain(h.mutation);
    });

    it("returns null if no baseline config and no best result", () => {
      const pipeline = new ResearchPipeline({ project: "nonexistent", peerId: "test", logger: SILENT });
      expect(pipeline.generateHypothesis()).toBeNull();
    });
  });

  describe("runExperiment", () => {
    for (const project of ALL_PROJECTS) {
      it(`runs simulated experiment for ${project}`, async () => {
        const pipeline = new ResearchPipeline({
          project,
          peerId: "test-peer-exp",
          logger: SILENT,
        });
        const hypothesis = pipeline.generateHypothesis();
        const result = await pipeline.runExperiment(hypothesis);

        expect(result).toHaveProperty("version", 1);
        expect(result).toHaveProperty("project", project);
        expect(result.runNumber).toBeGreaterThan(0);
        expect(result).toHaveProperty("result");
        expect(result).toHaveProperty("hypothesis");
        expect(result).toHaveProperty("timestamp");
        expect(typeof result.isNewBest).toBe("boolean");
      });
    }

    it("increments runNumber", async () => {
      const pipeline = new ResearchPipeline({ project: "gpt2-tinystories", peerId: "test-rn", logger: SILENT });
      const h = pipeline.generateHypothesis();
      await pipeline.runExperiment(h);
      expect(pipeline.runNumber).toBe(1);
    });

    it("first run is always new best", async () => {
      const pipeline = new ResearchPipeline({ project: "search-engine", peerId: "test-first", logger: SILENT });
      const h = pipeline.generateHypothesis();
      const result = await pipeline.runExperiment(h);
      expect(result.isNewBest).toBe(true);
    });

    it("result includes peerId and project", async () => {
      const pipeline = new ResearchPipeline({ project: "astrophysics", peerId: "test-fields", logger: SILENT });
      const h = pipeline.generateHypothesis();
      const r = await pipeline.runExperiment(h);
      expect(r.peerId).toBe("test-fields");
      expect(r.project).toBe("astrophysics");
    });

    it("result includes timestamp", async () => {
      const pipeline = new ResearchPipeline({ project: "gpt2-tinystories", peerId: "test-ts", logger: SILENT });
      const before = Date.now();
      const h = pipeline.generateHypothesis();
      const r = await pipeline.runExperiment(h);
      expect(r.timestamp).toBeGreaterThanOrEqual(before);
    });

    it("result has durationSec field", async () => {
      const pipeline = new ResearchPipeline({ project: "gpt2-tinystories", peerId: "test-dur", logger: SILENT });
      const h = pipeline.generateHypothesis();
      const r = await pipeline.runExperiment(h);
      expect(r.result.durationSec).toBeGreaterThan(0);
    });
  });

  describe("domain-specific result shapes", () => {
    it("gpt2-tinystories returns valLoss and trainLoss", async () => {
      const pipeline = new ResearchPipeline({ project: "gpt2-tinystories", peerId: "test-shape", logger: SILENT });
      const h = pipeline.generateHypothesis();
      const r = await pipeline.runExperiment(h);
      expect(r.result).toHaveProperty("valLoss");
      expect(r.result).toHaveProperty("trainLoss");
      expect(r.result.valLoss).toBeGreaterThan(0);
    });

    it("search-engine returns ndcg10", async () => {
      const pipeline = new ResearchPipeline({ project: "search-engine", peerId: "test-shape", logger: SILENT });
      const h = pipeline.generateHypothesis();
      const r = await pipeline.runExperiment(h);
      expect(r.result).toHaveProperty("ndcg10");
    });

    it("financial-analysis returns sharpeRatio", async () => {
      const pipeline = new ResearchPipeline({ project: "financial-analysis", peerId: "test-shape", logger: SILENT });
      const h = pipeline.generateHypothesis();
      const r = await pipeline.runExperiment(h);
      expect(r.result).toHaveProperty("sharpeRatio");
    });

    it("agentic-coding returns compositeScore and sub-benchmarks", async () => {
      const pipeline = new ResearchPipeline({ project: "agentic-coding", peerId: "test-shape", logger: SILENT });
      const h = pipeline.generateHypothesis();
      const r = await pipeline.runExperiment(h);
      expect(r.result).toHaveProperty("compositeScore");
      expect(r.result).toHaveProperty("humaneval");
      expect(r.result).toHaveProperty("mbpp");
      expect(r.result).toHaveProperty("mlBench");
      expect(r.result).toHaveProperty("ds1000");
      expect(r.result).toHaveProperty("classeval");
    });

    it("general-intelligence returns compositeScore and all benchmarks", async () => {
      const pipeline = new ResearchPipeline({ project: "general-intelligence", peerId: "test-shape", logger: SILENT });
      const h = pipeline.generateHypothesis();
      const r = await pipeline.runExperiment(h);
      expect(r.result).toHaveProperty("compositeScore");
      expect(r.result).toHaveProperty("arcAgi2");
      expect(r.result).toHaveProperty("gpqa");
      expect(r.result).toHaveProperty("math500");
      expect(r.result).toHaveProperty("humaneval");
      expect(r.result).toHaveProperty("mmluPro");
      expect(r.result).toHaveProperty("bbh");
      expect(r.result).toHaveProperty("drop");
      expect(r.result).toHaveProperty("hellaswag");
      expect(r.result.compositeScore).toBeGreaterThan(0);
      expect(r.result.compositeScore).toBeLessThan(1);
    });

    it("skills-and-tools returns score", async () => {
      const pipeline = new ResearchPipeline({ project: "skills-and-tools", peerId: "test-shape", logger: SILENT });
      const h = pipeline.generateHypothesis();
      const r = await pipeline.runExperiment(h);
      expect(r.result).toHaveProperty("score");
    });

    it("academic-papers returns score and extractionF1", async () => {
      const pipeline = new ResearchPipeline({ project: "academic-papers", peerId: "test-shape", logger: SILENT });
      const h = pipeline.generateHypothesis();
      const r = await pipeline.runExperiment(h);
      expect(r.result).toHaveProperty("score");
      expect(r.result).toHaveProperty("extractionF1");
    });

    it("p2p-network returns bestResult and score", async () => {
      const pipeline = new ResearchPipeline({ project: "p2p-network", peerId: "test-shape", logger: SILENT });
      const h = pipeline.generateHypothesis();
      const r = await pipeline.runExperiment(h);
      expect(r.result).toHaveProperty("bestResult");
      expect(r.result).toHaveProperty("score");
    });

    it("astrophysics produces valLoss < 10", async () => {
      const pipeline = new ResearchPipeline({ project: "astrophysics", peerId: "test-bound", logger: SILENT });
      const h = pipeline.generateHypothesis();
      const r = await pipeline.runExperiment(h);
      expect(r.result.valLoss).toBeGreaterThan(0);
      expect(r.result.valLoss).toBeLessThan(10);
    });

    it("agentic-coding sub-scores are in [0, 1]", async () => {
      const pipeline = new ResearchPipeline({ project: "agentic-coding", peerId: "test-bound", logger: SILENT });
      const h = pipeline.generateHypothesis();
      const r = await pipeline.runExperiment(h);
      for (const key of ["humaneval", "mbpp", "mlBench", "ds1000", "classeval"]) {
        expect(r.result[key]).toBeGreaterThanOrEqual(0);
        expect(r.result[key]).toBeLessThanOrEqual(1);
      }
    });

    it("financial-analysis sharpeRatio is positive", async () => {
      const pipeline = new ResearchPipeline({ project: "financial-analysis", peerId: "test-bound", logger: SILENT });
      const h = pipeline.generateHypothesis();
      const r = await pipeline.runExperiment(h);
      expect(r.result.sharpeRatio).toBeGreaterThan(0);
    });
  });

  describe("runCycle", () => {
    it("runs a full 5-stage cycle", async () => {
      const pipeline = new ResearchPipeline({
        project: "gpt2-tinystories",
        peerId: "test-peer-cycle",
        logger: SILENT,
      });
      const result = await pipeline.runCycle();
      expect(result).toHaveProperty("result");
      expect(result.result).toHaveProperty("result");
      expect(result.paper).toBeNull(); // Paper only at run 10
    });

    it("generates paper every 10 runs", async () => {
      const pipeline = new ResearchPipeline({
        project: "gpt2-tinystories",
        peerId: "test-peer-paper",
        logger: SILENT,
      });
      let paper = null;
      for (let i = 0; i < 10; i++) {
        const result = await pipeline.runCycle();
        paper = result.paper;
      }
      expect(paper).not.toBeNull();
      expect(paper).toHaveProperty("title");
      expect(paper).toHaveProperty("abstract");
      expect(paper).toHaveProperty("findings");
    });

    it("returns null when no config available", async () => {
      const pipeline = new ResearchPipeline({ project: "nonexistent", peerId: "test", logger: SILENT });
      expect(await pipeline.runCycle()).toBeNull();
    });
  });

  describe("critiquePaper", () => {
    it("scores a paper between 5 and 10", () => {
      const pipeline = new ResearchPipeline({
        project: "gpt2-tinystories",
        peerId: "reviewer",
        logger: SILENT,
      });
      const paper = {
        peerId: "author-peer",
        project: "gpt2-tinystories",
        title: "Test Paper",
      };
      const critique = pipeline.critiquePaper(paper);
      expect(critique.score).toBeGreaterThanOrEqual(5);
      expect(critique.score).toBeLessThanOrEqual(10);
      expect(critique.reviewer).toBe("reviewer");
    });

    it("includes paperId", () => {
      const pipeline = new ResearchPipeline({ project: "gpt2-tinystories", peerId: "reviewer", logger: SILENT });
      const critique = pipeline.critiquePaper({ peerId: "author", project: "proj" });
      expect(critique.paperId).toBe("author:proj");
    });

    it("includes comment string", () => {
      const pipeline = new ResearchPipeline({ project: "gpt2-tinystories", peerId: "reviewer", logger: SILENT });
      const critique = pipeline.critiquePaper({ peerId: "a", project: "p" });
      expect(typeof critique.comment).toBe("string");
      expect(critique.comment.length).toBeGreaterThan(0);
    });
  });

  describe("addInspiration", () => {
    it("keeps at most 20 inspirations", () => {
      const pipeline = new ResearchPipeline({
        project: "gpt2-tinystories",
        peerId: "test-peer-insp2",
        logger: SILENT,
      });
      for (let i = 0; i < 30; i++) {
        pipeline.addInspiration({ peerId: `peer-${i}`, metricValue: i });
      }
      expect(pipeline.inspirations.length).toBe(20);
    });

    it("keeps most recent inspirations when capped", () => {
      const pipeline = new ResearchPipeline({ project: "gpt2-tinystories", peerId: "test-recent", logger: SILENT });
      for (let i = 0; i < 25; i++) {
        pipeline.addInspiration({ peerId: `p${i}`, metricValue: i });
      }
      expect(pipeline.inspirations[0].peerId).toBe("p5");
      expect(pipeline.inspirations[19].peerId).toBe("p24");
    });
  });

  describe("saveResult", () => {
    const agentDir = resolve(PROJECTS_DIR, "gpt2-tinystories", "agents", "test-save-peer");

    afterEach(() => {
      if (existsSync(agentDir)) rmSync(agentDir, { recursive: true });
    });

    it("saves result to disk", async () => {
      const pipeline = new ResearchPipeline({
        project: "gpt2-tinystories",
        peerId: "test-save-peer",
        logger: SILENT,
      });
      const h = pipeline.generateHypothesis();
      const result = await pipeline.runExperiment(h);
      expect(existsSync(agentDir)).toBe(true);
    });

    it("saves run files with zero-padded names", async () => {
      const peerId = "run-files-peer";
      const agentDir = resolve(PROJECTS_DIR, "gpt2-tinystories", "agents", peerId);

      const pipeline = new ResearchPipeline({ project: "gpt2-tinystories", peerId, logger: SILENT });
      for (let i = 0; i < 3; i++) {
        const h = pipeline.generateHypothesis();
        await pipeline.runExperiment(h);
      }

      const files = readdirSync(agentDir).filter((f) => f.startsWith("run-") && f.endsWith(".json"));
      expect(files.length).toBe(3);
      expect(files).toContain("run-0001.json");
      expect(files).toContain("run-0002.json");
      expect(files).toContain("run-0003.json");

      rmSync(agentDir, { recursive: true });
    });
  });

  describe("_loadPersistedState", () => {
    it("restores runNumber from disk", async () => {
      const peerId = "persist-test-peer";
      const agentDir = resolve(PROJECTS_DIR, "gpt2-tinystories", "agents", peerId);

      const p1 = new ResearchPipeline({ project: "gpt2-tinystories", peerId, logger: SILENT });
      for (let i = 0; i < 3; i++) {
        const h = p1.generateHypothesis();
        await p1.runExperiment(h);
      }

      const p2 = new ResearchPipeline({ project: "gpt2-tinystories", peerId, logger: SILENT });
      expect(p2.runNumber).toBe(3);

      rmSync(agentDir, { recursive: true });
    });

    it("restores bestResult from disk", async () => {
      const peerId = "restore-best-test-peer";
      const agentDir = resolve(PROJECTS_DIR, "gpt2-tinystories", "agents", peerId);

      const p1 = new ResearchPipeline({ project: "gpt2-tinystories", peerId, logger: SILENT });
      const h = p1.generateHypothesis();
      await p1.runExperiment(h);

      const p2 = new ResearchPipeline({ project: "gpt2-tinystories", peerId, logger: SILENT });
      expect(p2.bestResult).not.toBeNull();
      expect(p2.bestResult.result).toHaveProperty("valLoss");

      rmSync(agentDir, { recursive: true });
    });
  });
});
