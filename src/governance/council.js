/**
 * Research Governance — Modular project proposals, community voting, council oversight.
 *
 * The governance system ensures research direction is:
 *   1. Community-driven — any node can propose a new project
 *   2. Democratically voted — token-weighted + reputation-weighted voting
 *   3. Council-reviewed — a multidisciplinary council of experts provides oversight
 *   4. Modular — projects can be added/paused/retired without code changes
 *   5. Transparent — all proposals, votes, and decisions are on GossipSub + CRDT
 *
 * Council seats (7 seats, each representing a domain of expertise):
 *   - AI/ML Researcher       — evaluates technical feasibility and novelty
 *   - Systems Engineer       — evaluates infrastructure and scalability
 *   - Ethicist/Philosopher   — evaluates alignment, safety, societal impact
 *   - Legal Counsel          — evaluates regulatory compliance and IP
 *   - Domain Scientist       — evaluates scientific rigor and methodology
 *   - Community Advocate     — represents node operators and end users
 *   - Security Auditor       — evaluates attack surfaces and game theory
 *
 * Proposal lifecycle:
 *   DRAFT → REVIEW → VOTING → APPROVED/REJECTED → ACTIVE → SUNSET
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { resolve } from "path";
import crypto from "crypto";

const GOVERNANCE_DIR = resolve(process.env.GOVERNANCE_DIR || "./governance");
const PROPOSALS_DIR = resolve(GOVERNANCE_DIR, "proposals");

// ── Governance constants ──────────────────────────────────────────────────
const VOTING_PERIOD_MS = 7 * 24 * 3600 * 1000; // 7 days for voting
const REVIEW_PERIOD_MS = 3 * 24 * 3600 * 1000;  // 3 days for council review
const QUORUM_PERCENTAGE = 10; // 10% of active nodes must vote
const APPROVAL_THRESHOLD = 66; // 66% approval needed
const COUNCIL_APPROVAL_REQUIRED = 4; // 4 of 7 council members must approve
const MIN_REPUTATION_TO_PROPOSE = 2000; // Need 2000+ rep to propose
const MIN_REPUTATION_TO_VOTE = 500; // Need 500+ rep to vote

// ── Council seat types ────────────────────────────────────────────────────
export const COUNCIL_SEATS = {
  AI_ML_RESEARCHER: {
    id: "ai_ml",
    title: "AI/ML Researcher",
    description: "Evaluates technical feasibility, model architecture choices, benchmark validity",
    requirements: "Published ML research or demonstrated expertise in model training",
  },
  SYSTEMS_ENGINEER: {
    id: "systems",
    title: "Systems Engineer",
    description: "Evaluates infrastructure needs, scalability, resource requirements",
    requirements: "Experience with distributed systems, P2P networks, or HPC",
  },
  ETHICIST: {
    id: "ethics",
    title: "Ethicist / Philosopher",
    description: "Evaluates alignment, safety implications, societal impact, dual-use concerns",
    requirements: "Background in AI ethics, philosophy of mind, or technology policy",
  },
  LEGAL_COUNSEL: {
    id: "legal",
    title: "Legal Counsel",
    description: "Evaluates regulatory compliance, data licensing, IP implications",
    requirements: "Legal expertise in technology, open-source licensing, or data privacy",
  },
  DOMAIN_SCIENTIST: {
    id: "science",
    title: "Domain Scientist",
    description: "Evaluates scientific rigor, methodology, reproducibility",
    requirements: "Active researcher or domain expert in relevant field",
  },
  COMMUNITY_ADVOCATE: {
    id: "community",
    title: "Community Advocate",
    description: "Represents node operators, evaluates accessibility and practical impact",
    requirements: "Active network participant with 30+ days uptime and community engagement",
  },
  SECURITY_AUDITOR: {
    id: "security",
    title: "Security Auditor",
    description: "Evaluates attack surfaces, game theory, adversarial scenarios",
    requirements: "Security research experience, adversarial ML, or formal verification",
  },
};

// ── Proposal status ───────────────────────────────────────────────────────
export const ProposalStatus = {
  DRAFT: "draft",
  REVIEW: "review",           // Council review period (3 days)
  VOTING: "voting",           // Community vote (7 days)
  APPROVED: "approved",       // Passed — ready to activate
  REJECTED: "rejected",       // Did not pass
  ACTIVE: "active",           // Running as a research project
  SUNSET: "sunset",           // Retired / completed
};

/**
 * A research project proposal.
 */
export class Proposal {
  constructor({
    id,
    title,
    description,
    category,
    proposer,
    baselineConfig,
    benchmarks,
    dataRequirements,
    computeRequirements,
    ethicsStatement,
    timeline,
    successCriteria,
  }) {
    this.id = id || crypto.randomBytes(8).toString("hex");
    this.title = title;
    this.description = description;
    this.category = category; // "ml-training", "benchmark", "infrastructure", "analysis"
    this.proposer = proposer; // peerId of proposer
    this.baselineConfig = baselineConfig || {};
    this.benchmarks = benchmarks || [];
    this.dataRequirements = dataRequirements || {};
    this.computeRequirements = computeRequirements || {};
    this.ethicsStatement = ethicsStatement || "";
    this.timeline = timeline || {};
    this.successCriteria = successCriteria || [];

    // State
    this.status = ProposalStatus.DRAFT;
    this.createdAt = Date.now();
    this.reviewStartedAt = null;
    this.votingStartedAt = null;
    this.resolvedAt = null;

    // Council reviews
    this.councilReviews = {}; // seatId → { approved, comment, reviewedBy, reviewedAt }

    // Community votes
    this.votes = new Map(); // peerId → { approve, weight, timestamp }
  }

  toJSON() {
    return {
      ...this,
      votes: Object.fromEntries(this.votes),
    };
  }

  static fromJSON(data) {
    const p = new Proposal(data);
    p.status = data.status;
    p.createdAt = data.createdAt;
    p.reviewStartedAt = data.reviewStartedAt;
    p.votingStartedAt = data.votingStartedAt;
    p.resolvedAt = data.resolvedAt;
    p.councilReviews = data.councilReviews || {};
    p.votes = new Map(Object.entries(data.votes || {}));
    return p;
  }
}

/**
 * Governance Manager — handles proposals, voting, council reviews.
 */
export class GovernanceManager {
  constructor({ peerId, logger = console }) {
    this.peerId = peerId;
    this.logger = logger;

    /** @type {Map<string, Proposal>} */
    this.proposals = new Map();

    // Council membership: seatId → { peerId, appointedAt, term }
    this.council = new Map();

    // Active project registry (projects that passed governance)
    this.activeProjects = new Set();

    // Ensure directories exist
    if (!existsSync(PROPOSALS_DIR)) {
      mkdirSync(PROPOSALS_DIR, { recursive: true });
    }

    this.loadState();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PROPOSAL LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Submit a new project proposal.
   */
  submitProposal(proposal, proposerReputation) {
    if (proposerReputation < MIN_REPUTATION_TO_PROPOSE) {
      throw new Error(`Insufficient reputation (${proposerReputation} < ${MIN_REPUTATION_TO_PROPOSE})`);
    }

    // Validate required fields
    if (!proposal.title || !proposal.description || !proposal.category) {
      throw new Error("Proposal must include title, description, and category");
    }
    if (!proposal.ethicsStatement) {
      throw new Error("Proposal must include an ethics statement");
    }
    if (!proposal.successCriteria || proposal.successCriteria.length === 0) {
      throw new Error("Proposal must define success criteria");
    }

    const p = proposal instanceof Proposal ? proposal : new Proposal(proposal);
    p.status = ProposalStatus.DRAFT;
    this.proposals.set(p.id, p);
    this.saveProposal(p);

    this.logger.log(`[governance] Proposal submitted: "${p.title}" (${p.id})`);
    return p;
  }

  /**
   * Move a proposal to council review.
   */
  startReview(proposalId) {
    const p = this.proposals.get(proposalId);
    if (!p) throw new Error("Proposal not found");
    if (p.status !== ProposalStatus.DRAFT) throw new Error("Can only review drafts");

    p.status = ProposalStatus.REVIEW;
    p.reviewStartedAt = Date.now();
    this.saveProposal(p);

    this.logger.log(`[governance] Proposal "${p.title}" entered council review`);
    return p;
  }

  /**
   * A council member submits their review.
   */
  submitCouncilReview(proposalId, seatId, reviewerPeerId, approved, comment) {
    const p = this.proposals.get(proposalId);
    if (!p) throw new Error("Proposal not found");
    if (p.status !== ProposalStatus.REVIEW) throw new Error("Not in review phase");

    // Verify the reviewer holds this council seat
    const seat = this.council.get(seatId);
    if (!seat || seat.peerId !== reviewerPeerId) {
      throw new Error(`Reviewer ${reviewerPeerId} does not hold seat ${seatId}`);
    }

    p.councilReviews[seatId] = {
      approved,
      comment,
      reviewedBy: reviewerPeerId,
      reviewedAt: Date.now(),
    };

    this.saveProposal(p);
    this.logger.log(
      `[governance] Council review: ${COUNCIL_SEATS[seatId]?.title || seatId} ` +
      `${approved ? "APPROVED" : "REJECTED"} "${p.title}"`
    );

    // Check if review period is complete
    this.checkReviewComplete(proposalId);
    return p;
  }

  /**
   * Check if council review is complete and advance to voting if so.
   */
  checkReviewComplete(proposalId) {
    const p = this.proposals.get(proposalId);
    if (!p || p.status !== ProposalStatus.REVIEW) return;

    const reviews = Object.values(p.councilReviews);
    const approvals = reviews.filter((r) => r.approved).length;

    // Need COUNCIL_APPROVAL_REQUIRED approvals
    if (approvals >= COUNCIL_APPROVAL_REQUIRED) {
      p.status = ProposalStatus.VOTING;
      p.votingStartedAt = Date.now();
      this.saveProposal(p);
      this.logger.log(
        `[governance] "${p.title}" passed council review (${approvals}/${reviews.length}). Now open for community vote.`
      );
    }

    // If enough rejections that approval is impossible
    const possibleApprovals = approvals + (7 - reviews.length);
    if (possibleApprovals < COUNCIL_APPROVAL_REQUIRED) {
      p.status = ProposalStatus.REJECTED;
      p.resolvedAt = Date.now();
      this.saveProposal(p);
      this.logger.log(`[governance] "${p.title}" REJECTED by council`);
    }

    // If review period expired
    if (Date.now() - p.reviewStartedAt > REVIEW_PERIOD_MS && reviews.length < COUNCIL_APPROVAL_REQUIRED) {
      // Not enough reviews in time — auto-advance to voting if any approvals
      if (approvals > 0) {
        p.status = ProposalStatus.VOTING;
        p.votingStartedAt = Date.now();
        this.saveProposal(p);
      }
    }
  }

  /**
   * Cast a community vote on a proposal.
   */
  castVote(proposalId, voterPeerId, approve, voterReputation) {
    const p = this.proposals.get(proposalId);
    if (!p) throw new Error("Proposal not found");
    if (p.status !== ProposalStatus.VOTING) throw new Error("Not in voting phase");

    if (voterReputation < MIN_REPUTATION_TO_VOTE) {
      throw new Error(`Insufficient reputation to vote (${voterReputation} < ${MIN_REPUTATION_TO_VOTE})`);
    }

    // Voting power = sqrt(reputation) to reduce plutocratic effects
    const weight = Math.sqrt(voterReputation);

    p.votes.set(voterPeerId, {
      approve,
      weight,
      reputation: voterReputation,
      timestamp: Date.now(),
    });

    this.saveProposal(p);
    return p;
  }

  /**
   * Tally votes and resolve a proposal.
   */
  tallyVotes(proposalId, totalActiveNodes) {
    const p = this.proposals.get(proposalId);
    if (!p || p.status !== ProposalStatus.VOTING) return null;

    // Check if voting period has ended
    if (Date.now() - p.votingStartedAt < VOTING_PERIOD_MS) {
      return { status: "voting_in_progress", timeRemaining: VOTING_PERIOD_MS - (Date.now() - p.votingStartedAt) };
    }

    const votes = [...p.votes.values()];
    const totalVoters = votes.length;
    const quorum = Math.ceil(totalActiveNodes * QUORUM_PERCENTAGE / 100);

    if (totalVoters < quorum) {
      p.status = ProposalStatus.REJECTED;
      p.resolvedAt = Date.now();
      this.saveProposal(p);
      this.logger.log(`[governance] "${p.title}" REJECTED — quorum not met (${totalVoters}/${quorum})`);
      return { status: "rejected", reason: "quorum_not_met", voters: totalVoters, quorum };
    }

    const approveWeight = votes.filter((v) => v.approve).reduce((s, v) => s + v.weight, 0);
    const totalWeight = votes.reduce((s, v) => s + v.weight, 0);
    const approvalRate = (approveWeight / totalWeight) * 100;

    if (approvalRate >= APPROVAL_THRESHOLD) {
      p.status = ProposalStatus.APPROVED;
      p.resolvedAt = Date.now();
      this.saveProposal(p);
      this.logger.log(
        `[governance] "${p.title}" APPROVED (${approvalRate.toFixed(1)}% approval, ${totalVoters} voters)`
      );
      return { status: "approved", approvalRate, voters: totalVoters };
    } else {
      p.status = ProposalStatus.REJECTED;
      p.resolvedAt = Date.now();
      this.saveProposal(p);
      this.logger.log(
        `[governance] "${p.title}" REJECTED (${approvalRate.toFixed(1)}% < ${APPROVAL_THRESHOLD}%)`
      );
      return { status: "rejected", reason: "insufficient_approval", approvalRate, voters: totalVoters };
    }
  }

  /**
   * Activate an approved proposal as a live research project.
   */
  activateProject(proposalId) {
    const p = this.proposals.get(proposalId);
    if (!p || p.status !== ProposalStatus.APPROVED) {
      throw new Error("Can only activate approved proposals");
    }

    p.status = ProposalStatus.ACTIVE;
    this.activeProjects.add(p.id);
    this.saveProposal(p);
    this.logger.log(`[governance] Project "${p.title}" is now ACTIVE`);
    return p;
  }

  /**
   * Sunset (retire) a project — requires council vote.
   */
  sunsetProject(proposalId) {
    const p = this.proposals.get(proposalId);
    if (!p || p.status !== ProposalStatus.ACTIVE) return;

    p.status = ProposalStatus.SUNSET;
    this.activeProjects.delete(p.id);
    this.saveProposal(p);
    this.logger.log(`[governance] Project "${p.title}" has been sunset`);
    return p;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // COUNCIL MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Appoint a council member to a seat.
   * In production, this would be done via an on-chain election.
   */
  appointCouncilMember(seatId, peerId, term = 90 * 24 * 3600 * 1000) {
    this.council.set(seatId, {
      peerId,
      appointedAt: Date.now(),
      term,
      expiresAt: Date.now() + term,
    });
    this.saveState();
    this.logger.log(
      `[governance] Council seat "${COUNCIL_SEATS[seatId]?.title || seatId}" → ${peerId.slice(0, 16)}`
    );
  }

  /**
   * Get the current council composition.
   */
  getCouncil() {
    const seats = {};
    for (const [seatId, member] of this.council) {
      const seatInfo = Object.values(COUNCIL_SEATS).find((s) => s.id === seatId) || { title: seatId };
      seats[seatId] = {
        ...seatInfo,
        member: member.peerId,
        appointedAt: new Date(member.appointedAt).toISOString(),
        expiresAt: new Date(member.expiresAt).toISOString(),
        expired: Date.now() > member.expiresAt,
      };
    }
    return seats;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // QUERIES
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Get all proposals by status.
   */
  getProposals(status = null) {
    const results = [];
    for (const p of this.proposals.values()) {
      if (!status || p.status === status) {
        results.push(p.toJSON());
      }
    }
    return results;
  }

  /**
   * Get the list of active research projects (approved by governance).
   */
  getActiveProjects() {
    return [...this.activeProjects].map((id) => {
      const p = this.proposals.get(id);
      return p ? p.toJSON() : { id, status: "unknown" };
    });
  }

  /**
   * Get governance status summary.
   */
  status() {
    const byStatus = {};
    for (const p of this.proposals.values()) {
      byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    }

    return {
      totalProposals: this.proposals.size,
      activeProjects: this.activeProjects.size,
      councilSeats: this.council.size,
      proposalsByStatus: byStatus,
      council: this.getCouncil(),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // GOSSIPSUB INTEGRATION
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Handle governance-related gossip messages.
   */
  handleGossip(data, fromPeerId) {
    switch (data.type) {
      case "proposal_submit": {
        if (!this.proposals.has(data.proposal?.id)) {
          try {
            const p = Proposal.fromJSON(data.proposal);
            this.proposals.set(p.id, p);
            this.saveProposal(p);
            this.logger.log(`[governance] Received proposal from peer: "${p.title}"`);
          } catch {}
        }
        break;
      }
      case "council_review": {
        try {
          this.submitCouncilReview(
            data.proposalId, data.seatId, fromPeerId, data.approved, data.comment
          );
        } catch {}
        break;
      }
      case "vote": {
        try {
          this.castVote(data.proposalId, fromPeerId, data.approve, data.reputation || 500);
        } catch {}
        break;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PERSISTENCE
  // ═══════════════════════════════════════════════════════════════════════

  saveProposal(proposal) {
    const path = resolve(PROPOSALS_DIR, `${proposal.id}.json`);
    writeFileSync(path, JSON.stringify(proposal.toJSON(), null, 2));
  }

  saveState() {
    const statePath = resolve(GOVERNANCE_DIR, "state.json");
    writeFileSync(statePath, JSON.stringify({
      council: Object.fromEntries(this.council),
      activeProjects: [...this.activeProjects],
    }, null, 2));
  }

  loadState() {
    const statePath = resolve(GOVERNANCE_DIR, "state.json");
    if (existsSync(statePath)) {
      try {
        const data = JSON.parse(readFileSync(statePath, "utf-8"));
        if (data.council) {
          for (const [k, v] of Object.entries(data.council)) {
            this.council.set(k, v);
          }
        }
        if (data.activeProjects) {
          for (const id of data.activeProjects) {
            this.activeProjects.add(id);
          }
        }
      } catch {}
    }

    // Load proposals from disk
    if (existsSync(PROPOSALS_DIR)) {
      try {
        const files = readdirSync(PROPOSALS_DIR).filter((f) => f.endsWith(".json"));
        for (const file of files) {
          try {
            const data = JSON.parse(readFileSync(resolve(PROPOSALS_DIR, file), "utf-8"));
            const p = Proposal.fromJSON(data);
            this.proposals.set(p.id, p);
          } catch {}
        }
      } catch {}
    }
  }
}
