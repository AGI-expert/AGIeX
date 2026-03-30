import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GovernanceManager, Proposal, ProposalStatus, COUNCIL_SEATS } from "../src/governance/council.js";
import { rmSync, existsSync } from "fs";
import { resolve } from "path";

const GOV_DIR = resolve("./governance");
const SILENT = { log: () => {}, warn: () => {}, error: () => {} };

function makeProposalData(overrides = {}) {
  return {
    title: "Test Project",
    description: "A test research project",
    category: "ml-training",
    proposer: "proposer-peer",
    ethicsStatement: "No ethical concerns",
    successCriteria: ["Achieve 0.5 score"],
    ...overrides,
  };
}

describe("Governance", () => {
  let gov;

  beforeEach(() => {
    if (existsSync(GOV_DIR)) rmSync(GOV_DIR, { recursive: true });
    gov = new GovernanceManager({ peerId: "gov-test-peer", logger: SILENT });
  });

  afterEach(() => {
    if (existsSync(GOV_DIR)) rmSync(GOV_DIR, { recursive: true });
  });

  describe("COUNCIL_SEATS", () => {
    it("defines 7 seats", () => {
      const seats = Object.keys(COUNCIL_SEATS);
      expect(seats.length).toBe(7);
    });

    it("each seat has id, title, description, requirements", () => {
      for (const seat of Object.values(COUNCIL_SEATS)) {
        expect(seat).toHaveProperty("id");
        expect(seat).toHaveProperty("title");
        expect(seat).toHaveProperty("description");
        expect(seat).toHaveProperty("requirements");
      }
    });

    const expectedIds = ["ai_ml", "systems", "ethics", "legal", "science", "community", "security"];
    for (const seatId of expectedIds) {
      it(`includes seat with id "${seatId}"`, () => {
        const seat = Object.values(COUNCIL_SEATS).find((s) => s.id === seatId);
        expect(seat).toBeDefined();
      });
    }
  });

  describe("ProposalStatus", () => {
    it("has 7 statuses", () => {
      expect(Object.keys(ProposalStatus).length).toBe(7);
    });

    it("all values are lowercase strings", () => {
      for (const val of Object.values(ProposalStatus)) {
        expect(val).toBe(val.toLowerCase());
      }
    });
  });

  describe("ProposalStatus", () => {
    it("has all lifecycle states", () => {
      expect(ProposalStatus.DRAFT).toBe("draft");
      expect(ProposalStatus.REVIEW).toBe("review");
      expect(ProposalStatus.VOTING).toBe("voting");
      expect(ProposalStatus.APPROVED).toBe("approved");
      expect(ProposalStatus.REJECTED).toBe("rejected");
      expect(ProposalStatus.ACTIVE).toBe("active");
      expect(ProposalStatus.SUNSET).toBe("sunset");
    });
  });

  describe("Proposal", () => {
    it("creates with generated ID", () => {
      const p = new Proposal(makeProposalData());
      expect(p.id).toBeDefined();
      expect(p.title).toBe("Test Project");
      expect(p.status).toBe(ProposalStatus.DRAFT);
    });

    it("serializes and deserializes", () => {
      const p = new Proposal(makeProposalData());
      p.votes.set("voter1", { approve: true, weight: 10 });
      const json = p.toJSON();
      const restored = Proposal.fromJSON(json);
      expect(restored.title).toBe("Test Project");
      expect(restored.votes.get("voter1").approve).toBe(true);
    });

    it("auto-generates id with 16-char length", () => {
      const p = new Proposal(makeProposalData());
      expect(p.id.length).toBe(16);
    });

    it("uses provided id", () => {
      const p = new Proposal(makeProposalData({ id: "custom-id" }));
      expect(p.id).toBe("custom-id");
    });

    it("initializes votes as empty Map", () => {
      const p = new Proposal(makeProposalData());
      expect(p.votes).toBeInstanceOf(Map);
      expect(p.votes.size).toBe(0);
    });

    it("toJSON converts votes Map to object", () => {
      const p = new Proposal(makeProposalData());
      p.votes.set("v1", { approve: true, weight: 10 });
      const json = p.toJSON();
      expect(json.votes).toHaveProperty("v1");
      expect(json.votes.v1.approve).toBe(true);
    });

    it("fromJSON restores all state including status and councilReviews", () => {
      const p = new Proposal(makeProposalData());
      p.status = ProposalStatus.VOTING;
      p.votingStartedAt = Date.now();
      p.votes.set("v1", { approve: false, weight: 5 });
      p.councilReviews.ai_ml = { approved: true, comment: "yes" };

      const restored = Proposal.fromJSON(p.toJSON());
      expect(restored.status).toBe("voting");
      expect(restored.votes.get("v1").approve).toBe(false);
      expect(restored.councilReviews.ai_ml.approved).toBe(true);
    });

    it("fromJSON handles empty votes", () => {
      const p = new Proposal(makeProposalData());
      const restored = Proposal.fromJSON(p.toJSON());
      expect(restored.votes.size).toBe(0);
    });
  });

  describe("submitProposal", () => {
    it("accepts valid proposal with sufficient reputation", () => {
      const p = gov.submitProposal(makeProposalData(), 2000);
      expect(p.status).toBe(ProposalStatus.DRAFT);
      expect(gov.proposals.size).toBe(1);
    });

    it("rejects low-reputation proposers", () => {
      expect(() => gov.submitProposal(makeProposalData(), 100)).toThrow("Insufficient reputation");
    });

    it("requires title, description, category", () => {
      expect(() => gov.submitProposal({ ...makeProposalData(), title: "" }, 2000)).toThrow();
    });

    it("requires ethics statement", () => {
      expect(() => gov.submitProposal({ ...makeProposalData(), ethicsStatement: "" }, 2000)).toThrow("ethics");
    });

    it("requires success criteria", () => {
      expect(() => gov.submitProposal({ ...makeProposalData(), successCriteria: [] }, 2000)).toThrow("success criteria");
    });

    it("accepts exactly 2000 reputation", () => {
      expect(() => gov.submitProposal(makeProposalData(), 2000)).not.toThrow();
    });

    it("accepts Proposal instance directly", () => {
      const p = new Proposal(makeProposalData());
      const result = gov.submitProposal(p, 2000);
      expect(result.id).toBe(p.id);
    });

    it("persists proposal to disk", () => {
      const p = gov.submitProposal(makeProposalData(), 2000);
      expect(existsSync(resolve(GOV_DIR, "proposals", `${p.id}.json`))).toBe(true);
    });
  });

  describe("council review", () => {
    let proposalId;

    beforeEach(() => {
      const p = gov.submitProposal(makeProposalData(), 2000);
      proposalId = p.id;
      gov.startReview(proposalId);

      // Appoint council members
      const seatIds = Object.values(COUNCIL_SEATS).map((s) => s.id);
      seatIds.forEach((seatId, i) => {
        gov.appointCouncilMember(seatId, `council-peer-${i}`);
      });
    });

    it("moves to review status", () => {
      const p = gov.proposals.get(proposalId);
      expect(p.status).toBe(ProposalStatus.REVIEW);
    });

    it("sets reviewStartedAt timestamp", () => {
      const p = gov.proposals.get(proposalId);
      expect(p.reviewStartedAt).toBeGreaterThan(0);
    });

    it("rejects review of non-draft", () => {
      expect(() => gov.startReview(proposalId)).toThrow("Can only review drafts");
    });

    it("throws for unknown proposalId", () => {
      expect(() => gov.startReview("nonexistent")).toThrow();
    });

    it("accepts council review", () => {
      gov.submitCouncilReview(proposalId, "ai_ml", "council-peer-0", true, "Looks good");
      const p = gov.proposals.get(proposalId);
      expect(p.councilReviews.ai_ml.approved).toBe(true);
    });

    it("rejects review from non-council member", () => {
      expect(() => {
        gov.submitCouncilReview(proposalId, "ai_ml", "random-peer", true, "");
      }).toThrow("does not hold seat");
    });

    it("advances to voting after 4 approvals", () => {
      const seatIds = Object.values(COUNCIL_SEATS).map((s) => s.id);
      for (let i = 0; i < 4; i++) {
        gov.submitCouncilReview(proposalId, seatIds[i], `council-peer-${i}`, true, "Yes");
      }
      const p = gov.proposals.get(proposalId);
      expect(p.status).toBe(ProposalStatus.VOTING);
    });

    it("rejects if too many rejections", () => {
      const seatIds = Object.values(COUNCIL_SEATS).map((s) => s.id);
      for (let i = 0; i < 4; i++) {
        gov.submitCouncilReview(proposalId, seatIds[i], `council-peer-${i}`, false, "No");
      }
      const p = gov.proposals.get(proposalId);
      expect(p.status).toBe(ProposalStatus.REJECTED);
    });
  });

  describe("community voting", () => {
    let proposalId;

    beforeEach(() => {
      const p = gov.submitProposal(makeProposalData(), 2000);
      proposalId = p.id;
      gov.startReview(proposalId);
      const seatIds = Object.values(COUNCIL_SEATS).map((s) => s.id);
      seatIds.forEach((seatId, i) => gov.appointCouncilMember(seatId, `c-${i}`));
      for (let i = 0; i < 4; i++) {
        gov.submitCouncilReview(proposalId, seatIds[i], `c-${i}`, true, "Yes");
      }
    });

    it("accepts votes from peers with sufficient reputation", () => {
      gov.castVote(proposalId, "voter1", true, 500);
      const p = gov.proposals.get(proposalId);
      expect(p.votes.has("voter1")).toBe(true);
    });

    it("rejects low-reputation voters", () => {
      expect(() => gov.castVote(proposalId, "voter1", true, 100)).toThrow("Insufficient reputation");
    });

    it("overwrites previous vote from same peer", () => {
      gov.castVote(proposalId, "v1", true, 1000);
      gov.castVote(proposalId, "v1", false, 1000);
      expect(gov.proposals.get(proposalId).votes.get("v1").approve).toBe(false);
    });

    it("uses sqrt(reputation) for weight", () => {
      gov.castVote(proposalId, "voter1", true, 900);
      const p = gov.proposals.get(proposalId);
      expect(p.votes.get("voter1").weight).toBe(30); // sqrt(900)
    });

    it("tallies votes - rejected for quorum not met", () => {
      // Force voting period to have ended
      const p = gov.proposals.get(proposalId);
      p.votingStartedAt = Date.now() - 8 * 24 * 3600 * 1000;
      gov.castVote(proposalId, "voter1", true, 1000);
      const result = gov.tallyVotes(proposalId, 100); // quorum = 10
      expect(result.status).toBe("rejected");
      expect(result.reason).toBe("quorum_not_met");
    });

    it("tallies votes - approved", () => {
      const p = gov.proposals.get(proposalId);
      p.votingStartedAt = Date.now() - 8 * 24 * 3600 * 1000;
      for (let i = 0; i < 10; i++) {
        gov.castVote(proposalId, `voter-${i}`, true, 1000);
      }
      const result = gov.tallyVotes(proposalId, 100);
      expect(result.status).toBe("approved");
    });

    it("tallies votes - rejected for insufficient approval", () => {
      const p = gov.proposals.get(proposalId);
      p.votingStartedAt = Date.now() - 8 * 24 * 3600 * 1000;
      for (let i = 0; i < 10; i++) {
        gov.castVote(proposalId, `voter-${i}`, i < 3, 1000); // 3 yes, 7 no
      }
      const result = gov.tallyVotes(proposalId, 100);
      expect(result.status).toBe("rejected");
      expect(result.reason).toBe("insufficient_approval");
    });

    it("returns null for non-voting proposal", () => {
      const p2 = gov.submitProposal(makeProposalData({ title: "Draft" }), 2000);
      expect(gov.tallyVotes(p2.id, 10)).toBeNull();
    });

    it("returns voting_in_progress when period not ended", () => {
      gov.castVote(proposalId, "v1", true, 1000);
      const result = gov.tallyVotes(proposalId, 10);
      expect(result.status).toBe("voting_in_progress");
      expect(result.timeRemaining).toBeGreaterThan(0);
    });
  });

  describe("project lifecycle", () => {
    it("activates approved project", () => {
      const p = gov.submitProposal(makeProposalData(), 2000);
      p.status = ProposalStatus.APPROVED;
      const activated = gov.activateProject(p.id);
      expect(activated.status).toBe(ProposalStatus.ACTIVE);
      expect(gov.activeProjects.has(p.id)).toBe(true);
    });

    it("rejects activating non-approved proposal", () => {
      const p = gov.submitProposal(makeProposalData(), 2000);
      expect(() => gov.activateProject(p.id)).toThrow("Can only activate approved");
    });

    it("sunsets active project", () => {
      const p = gov.submitProposal(makeProposalData(), 2000);
      p.status = ProposalStatus.APPROVED;
      gov.activateProject(p.id);
      gov.sunsetProject(p.id);
      expect(gov.proposals.get(p.id).status).toBe(ProposalStatus.SUNSET);
      expect(gov.activeProjects.has(p.id)).toBe(false);
    });

    it("sunsetProject does nothing for non-active", () => {
      const p = gov.submitProposal(makeProposalData(), 2000);
      expect(gov.sunsetProject(p.id)).toBeUndefined();
    });
  });

  describe("council management", () => {
    it("appoints council members", () => {
      gov.appointCouncilMember("ai_ml", "ml-expert");
      const council = gov.getCouncil();
      expect(council.ai_ml.member).toBe("ml-expert");
    });

    it("sets appointedAt and expiresAt", () => {
      const before = Date.now();
      gov.appointCouncilMember("systems", "sys-peer");
      const member = gov.council.get("systems");
      expect(member.appointedAt).toBeGreaterThanOrEqual(before);
      expect(member.expiresAt).toBeGreaterThan(member.appointedAt);
    });

    it("default term is 90 days", () => {
      gov.appointCouncilMember("ethics", "eth-peer");
      const member = gov.council.get("ethics");
      expect(member.expiresAt - member.appointedAt).toBe(90 * 24 * 3600 * 1000);
    });

    it("accepts custom term", () => {
      gov.appointCouncilMember("legal", "legal-peer", 30 * 86400000);
      const member = gov.council.get("legal");
      expect(member.expiresAt - member.appointedAt).toBe(30 * 86400000);
    });

    it("getCouncil includes expired flag", () => {
      gov.appointCouncilMember("ai_ml", "ml-peer");
      const council = gov.getCouncil();
      expect(council.ai_ml).toHaveProperty("expired");
      expect(council.ai_ml.expired).toBe(false);
    });
  });

  describe("queries", () => {
    it("getProposals filters by status", () => {
      gov.submitProposal(makeProposalData({ title: "P1" }), 2000);
      gov.submitProposal(makeProposalData({ title: "P2" }), 2000);
      const drafts = gov.getProposals(ProposalStatus.DRAFT);
      expect(drafts.length).toBe(2);
      expect(gov.getProposals(ProposalStatus.ACTIVE).length).toBe(0);
    });

    it("status returns summary", () => {
      gov.submitProposal(makeProposalData(), 2000);
      const s = gov.status();
      expect(s.totalProposals).toBe(1);
      expect(s.proposalsByStatus.draft).toBe(1);
    });

    it("getProposals returns all when no status filter", () => {
      gov.submitProposal(makeProposalData({ title: "A" }), 2000);
      gov.submitProposal(makeProposalData({ title: "B" }), 2000);
      expect(gov.getProposals().length).toBe(2);
    });

    it("getActiveProjects returns empty initially", () => {
      expect(gov.getActiveProjects()).toEqual([]);
    });

    it("getActiveProjects lists activated proposals", () => {
      const p = gov.submitProposal(makeProposalData(), 2000);
      p.status = ProposalStatus.APPROVED;
      gov.activateProject(p.id);
      expect(gov.getActiveProjects().length).toBe(1);
    });
  });

  describe("handleGossip", () => {
    it("receives proposal from peer", () => {
      const proposal = new Proposal(makeProposalData());
      gov.handleGossip({ type: "proposal_submit", proposal: proposal.toJSON() }, "remote-peer");
      expect(gov.proposals.has(proposal.id)).toBe(true);
    });

    it("does not duplicate existing proposals", () => {
      const p = gov.submitProposal(makeProposalData(), 2000);
      gov.handleGossip({ type: "proposal_submit", proposal: p.toJSON() }, "remote-peer");
      expect(gov.proposals.size).toBe(1);
    });

    it("handles vote gossip", () => {
      const p = gov.submitProposal(makeProposalData(), 2000);
      gov.startReview(p.id);
      const seatIds = Object.values(COUNCIL_SEATS).map((s) => s.id);
      seatIds.forEach((id, i) => gov.appointCouncilMember(id, `c-${i}`));
      for (let i = 0; i < 4; i++) {
        gov.submitCouncilReview(p.id, seatIds[i], `c-${i}`, true, "OK");
      }
      gov.handleGossip({
        type: "vote",
        proposalId: p.id,
        approve: true,
        reputation: 1000,
      }, "voter-peer");
      expect(gov.proposals.get(p.id).votes.has("voter-peer")).toBe(true);
    });

    it("silently ignores bad gossip data", () => {
      expect(() => gov.handleGossip({ type: "vote" }, "p")).not.toThrow();
      expect(() => gov.handleGossip({ type: "council_review" }, "p")).not.toThrow();
    });
  });

  describe("persistence", () => {
    it("loads proposals from disk on construction", () => {
      const p = gov.submitProposal(makeProposalData(), 2000);
      const gov2 = new GovernanceManager({ peerId: "other", logger: SILENT });
      expect(gov2.proposals.has(p.id)).toBe(true);
    });

    it("persists council state", () => {
      gov.appointCouncilMember("ai_ml", "saved-peer");
      gov.saveState();
      const gov2 = new GovernanceManager({ peerId: "other", logger: SILENT });
      expect(gov2.council.get("ai_ml").peerId).toBe("saved-peer");
    });
  });
});
