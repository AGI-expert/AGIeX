import { describe, it, expect, beforeEach } from "vitest";
import { CapabilityManager, CAPABILITY_WEIGHTS } from "../src/capabilities/index.js";

const SILENT = { log: () => {}, warn: () => {}, error: () => {} };

describe("Capabilities", () => {
  describe("CAPABILITY_WEIGHTS", () => {
    it("defines weights for all 9 capabilities", () => {
      const expected = ["inference", "research", "proxy", "storage", "embedding", "memory", "orchestration", "validation", "relay"];
      for (const cap of expected) {
        expect(CAPABILITY_WEIGHTS).toHaveProperty(cap);
        expect(typeof CAPABILITY_WEIGHTS[cap]).toBe("number");
        expect(CAPABILITY_WEIGHTS[cap]).toBeGreaterThan(0);
      }
    });

    it("weights sum to less than 1", () => {
      const total = Object.values(CAPABILITY_WEIGHTS).reduce((a, b) => a + b, 0);
      expect(total).toBeLessThan(1);
      expect(total).toBeGreaterThan(0);
    });

    it("total weight is approximately 0.58", () => {
      const sum = Object.values(CAPABILITY_WEIGHTS).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(0.58);
    });
  });

  describe("CapabilityManager", () => {
    it("constructs with empty state", () => {
      const mgr = new CapabilityManager({
        hwProfile: {},
        peerId: "test-peer",
        p2pNode: null,
        logger: SILENT,
      });
      expect(mgr.getEnabled()).toEqual([]);
      expect(mgr.getWeightBonus()).toBe(0);
    });

    it("stores peerId and p2pNode", () => {
      const mgr = new CapabilityManager({
        hwProfile: {},
        peerId: "test-peer",
        p2pNode: null,
        logger: SILENT,
      });
      expect(mgr.peerId).toBe("test-peer");
      expect(mgr.p2pNode).toBeNull();
    });

    it("getEnabled returns a copy, not the original", () => {
      const mgr = new CapabilityManager({
        hwProfile: {},
        peerId: "test-peer",
        p2pNode: null,
        logger: SILENT,
      });
      const enabled = mgr.getEnabled();
      enabled.push("fake");
      expect(mgr.getEnabled()).not.toContain("fake");
    });

    it("starts capabilities based on hw profile", async () => {
      const mgr = new CapabilityManager({
        hwProfile: {
          capabilities: {
            research: true,
            validation: true,
            relay: true,
          },
        },
        peerId: "test-peer",
        p2pNode: null,
        logger: SILENT,
      });

      await mgr.startAll();
      const enabled = mgr.getEnabled();
      expect(enabled).toContain("research");
      expect(enabled).toContain("validation");
      expect(enabled).toContain("relay");
      expect(enabled.length).toBe(3);
    });

    it("calculates weight bonus", async () => {
      const mgr = new CapabilityManager({
        hwProfile: { capabilities: { research: true, validation: true } },
        peerId: "test-peer",
        p2pNode: null,
        logger: SILENT,
      });
      await mgr.startAll();
      const bonus = mgr.getWeightBonus();
      expect(bonus).toBe(CAPABILITY_WEIGHTS.research + CAPABILITY_WEIGHTS.validation);
    });

    it("stops all capabilities", async () => {
      const mgr = new CapabilityManager({
        hwProfile: { capabilities: { research: true, relay: true } },
        peerId: "test-peer",
        p2pNode: null,
        logger: SILENT,
      });
      await mgr.startAll();
      expect(mgr.getEnabled().length).toBe(2);
      await mgr.stopAll();
      expect(mgr.getEnabled()).toEqual([]);
      expect(mgr.getWeightBonus()).toBe(0);
    });

    it("ignores disabled capabilities", async () => {
      const mgr = new CapabilityManager({
        hwProfile: { capabilities: { research: true, inference: false } },
        peerId: "test-peer",
        p2pNode: null,
        logger: SILENT,
      });
      await mgr.startAll();
      expect(mgr.getEnabled()).toContain("research");
      expect(mgr.getEnabled()).not.toContain("inference");
    });

    it("handles empty capabilities object", async () => {
      const mgr = new CapabilityManager({
        hwProfile: { capabilities: {} },
        peerId: "test-peer",
        p2pNode: null,
        logger: SILENT,
      });
      await mgr.startAll();
      expect(mgr.getEnabled().length).toBe(0);
    });

    it("handles null hwProfile", async () => {
      const mgr = new CapabilityManager({
        hwProfile: null,
        peerId: "test-peer",
        p2pNode: null,
        logger: SILENT,
      });
      await mgr.startAll();
      expect(mgr.getEnabled().length).toBe(0);
    });

    it("does not start the same capability twice", async () => {
      const mgr = new CapabilityManager({
        hwProfile: { capabilities: {} },
        peerId: "test-peer",
        p2pNode: null,
        logger: SILENT,
      });
      await mgr.startCapability("research");
      await mgr.startCapability("research");
      expect(mgr.getEnabled().filter((c) => c === "research").length).toBe(1);
    });

    it("warns on unknown capability", async () => {
      const warnings = [];
      const mgr = new CapabilityManager({
        hwProfile: {},
        peerId: "test-peer",
        p2pNode: null,
        logger: { ...SILENT, warn: (msg) => warnings.push(msg) },
      });
      await mgr.startCapability("nonexistent");
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain("Unknown capability");
    });

    it("starts all 9 capability types without error", async () => {
      const mgr = new CapabilityManager({
        hwProfile: {
          capabilities: {
            inference: true,
            research: true,
            // proxy: skip (binds to port 4010)
            storage: true,
            embedding: true,
            memory: true,
            orchestration: true,
            validation: true,
            relay: true,
          },
        },
        peerId: "test-peer",
        p2pNode: null,
        logger: SILENT,
      });
      await mgr.startAll();
      expect(mgr.getEnabled().length).toBe(8);
      await mgr.stopAll();
    });

    it("stopAll is safe when nothing started", async () => {
      const mgr = new CapabilityManager({
        hwProfile: {},
        peerId: "test-peer",
        p2pNode: null,
        logger: SILENT,
      });
      await mgr.stopAll();
      expect(mgr.getEnabled()).toEqual([]);
    });

    it("storage capability starts without error", async () => {
      const mgr = new CapabilityManager({
        hwProfile: {},
        peerId: "test-peer",
        p2pNode: null,
        logger: SILENT,
      });
      await mgr.startCapability("storage");
      expect(mgr.getEnabled()).toContain("storage");
    });
  });

  describe("loadProfile", () => {
    it("returns null for missing file", () => {
      const profile = CapabilityManager.loadProfile("./nonexistent-hw-profile.json");
      expect(profile).toBeNull();
    });
  });
});
