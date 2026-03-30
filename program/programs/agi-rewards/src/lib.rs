use anchor_lang::prelude::*;
use anchor_spl::token::{self, MintTo, Transfer};

mod constants;
mod contexts;
mod errors;
mod helpers;
mod state;

use constants::*;
use contexts::*;
use errors::*;
use helpers::*;

declare_id!("AH4DbYggwSiyX3TePMoo66k8P31Qn2a1gUH1PcHESKRo");

/// Trustless on-chain reward minting with multi-layer security.
///
/// Security layers:
///   1. PDA mint authority — no private key exists
///   2. Maturation period — 14 days before first reward eligible
///   3. Stake bond — nodes lock tokens as collateral (slashable)
///   4. Reputation system — on-chain honesty/loyalty/quality scores
///   5. Cross-validation — peers verify each other's proofs (ENFORCED: 3 validators, 2-min window)
///   6. Slashing — bad actors lose stake + reputation
///   7. Anomaly detection — statistical outlier rejection
///   8. Consecutive proof requirement — must prove liveness, not just show up
///   9. Cooldown escalation — repeated failures = exponential lockout
///  10. Supply cap — 1 billion tokens, hardcoded
///
/// Two-phase proof flow:
///   Phase 1: submit_pulse_proof → verifies proof, creates PendingProof (no mint)
///   Phase 2: validate_peer × 3 → validators confirm within 2-minute window
///   Phase 3: finalize_reward → mints tokens after validation threshold met
#[program]
pub mod agi_rewards {
    use super::*;

    // ═════════════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ═════════════════════════════════════════════════════════════════════

    pub fn initialize(ctx: Context<Initialize>, supply_cap: u64) -> Result<()> {
        let state = &mut ctx.accounts.program_state;
        state.mint = ctx.accounts.mint.key();
        state.authority_bump = ctx.bumps.mint_authority;
        state.supply_cap = if supply_cap > 0 { supply_cap } else { MAX_SUPPLY };
        state.total_minted = 0;
        state.total_nodes = 0;
        state.total_slashed = 0;
        state.total_banned = 0;
        state.current_round = 0;
        state.initialized_at = Clock::get()?.unix_timestamp;

        msg!("AGI Rewards initialized. Supply cap: {}", state.supply_cap / 1_000_000);
        Ok(())
    }

    // ═════════════════════════════════════════════════════════════════════
    // NODE REGISTRATION + STAKING
    // ═════════════════════════════════════════════════════════════════════

    /// Register a new node. Starts the 14-day maturation period.
    /// Node must stake MIN_STAKE tokens as collateral.
    pub fn register_node(
        ctx: Context<RegisterNode>,
        capabilities: u16,
    ) -> Result<()> {
        let clock = Clock::get()?;
        let node = &mut ctx.accounts.node_account;

        node.owner = ctx.accounts.owner.key();
        node.token_account = ctx.accounts.node_token_account.key();
        node.capabilities = capabilities;
        node.registered_at = clock.unix_timestamp;
        node.last_claim_at = 0;
        node.last_claim_round = 0;
        node.total_earned = 0;
        node.total_rounds_participated = 0;

        // ── Reputation init ──
        node.reputation = INITIAL_REPUTATION;
        node.honesty_score = 5000;
        node.loyalty_score = 0;
        node.quality_score = 5000;
        node.consistency_score = 5000;

        // ── Security state ──
        node.maturation_proofs = 0;
        node.is_matured = false;
        node.is_banned = false;
        node.strikes = 0;
        node.consecutive_failures = 0;
        node.consecutive_misses = 0;
        node.cooldown_until = 0;
        node.last_failure_at = 0;

        // ── Staking ──
        node.stake_amount = 0;
        node.stake_locked_until = 0;
        node.pending_unstake = 0;
        node.unstake_requested_at = 0;

        // ── Validation tracking ──
        node.validations_performed = 0;
        node.validations_received = 0;
        node.valid_proofs_submitted = 0;
        node.invalid_proofs_submitted = 0;

        let state = &mut ctx.accounts.program_state;
        state.total_nodes += 1;

        msg!(
            "Node registered: {}. Maturation period: 14 days. Stake required: {} tokens.",
            node.owner,
            MIN_STAKE / 1_000_000
        );
        Ok(())
    }

    /// Stake tokens as collateral. Required before earning rewards.
    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        require!(amount >= MIN_STAKE, SecurityError::InsufficientStake);
        require!(!ctx.accounts.node_account.is_banned, SecurityError::NodeBanned);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.staker_token_account.to_account_info(),
                    to: ctx.accounts.stake_vault.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
        )?;

        let node = &mut ctx.accounts.node_account;
        node.stake_amount = node.stake_amount.checked_add(amount).unwrap();
        node.stake_locked_until = Clock::get()?.unix_timestamp + STAKE_LOCK_PERIOD;

        msg!("Staked {} tokens. Total stake: {}", amount / 1_000_000, node.stake_amount / 1_000_000);
        Ok(())
    }

    /// Request unstaking. Starts a 7-day cooldown.
    pub fn request_unstake(ctx: Context<UpdateNode>, amount: u64) -> Result<()> {
        let node = &mut ctx.accounts.node_account;
        let clock = Clock::get()?;

        require!(amount <= node.stake_amount, SecurityError::InsufficientStake);
        require!(
            node.stake_amount - amount >= MIN_STAKE || amount == node.stake_amount,
            SecurityError::StakeBelowMinimum
        );
        require!(clock.unix_timestamp >= node.stake_locked_until, SecurityError::StakeLocked);

        node.pending_unstake = amount;
        node.unstake_requested_at = clock.unix_timestamp;

        msg!("Unstake requested: {} tokens. Available after 7 days.", amount / 1_000_000);
        Ok(())
    }

    /// Withdraw unstaked tokens after the cooldown period.
    pub fn withdraw_unstake(ctx: Context<Unstake>) -> Result<()> {
        let node = &mut ctx.accounts.node_account;
        let clock = Clock::get()?;

        require!(node.pending_unstake > 0, SecurityError::NoPendingUnstake);
        require!(
            clock.unix_timestamp >= node.unstake_requested_at + STAKE_LOCK_PERIOD,
            SecurityError::StakeLocked
        );

        let amount = node.pending_unstake;

        let seeds = &[b"stake_vault".as_ref(), &[ctx.bumps.stake_vault]];
        let signer = &[&seeds[..]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.stake_vault.to_account_info(),
                    to: ctx.accounts.staker_token_account.to_account_info(),
                    authority: ctx.accounts.stake_vault.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;

        node.stake_amount -= amount;
        node.pending_unstake = 0;
        node.unstake_requested_at = 0;

        msg!("Withdrew {} tokens. Remaining stake: {}", amount / 1_000_000, node.stake_amount / 1_000_000);
        Ok(())
    }

    /// Update capabilities (e.g., after hardware change).
    pub fn update_capabilities(ctx: Context<UpdateNode>, capabilities: u16) -> Result<()> {
        let node = &mut ctx.accounts.node_account;
        require!(!node.is_banned, SecurityError::NodeBanned);
        node.capabilities = capabilities;
        Ok(())
    }

    // ═════════════════════════════════════════════════════════════════════
    // PHASE 1: PULSE PROOF SUBMISSION
    // Creates a PendingProof — tokens are NOT minted here.
    // Minting happens in finalize_reward after cross-validation.
    // ═════════════════════════════════════════════════════════════════════

    /// Submit a pulse proof. Verifies the proof on-chain and creates a
    /// PendingProof account. Tokens are minted later via `finalize_reward`
    /// once 3 validators have confirmed within the 2-minute window.
    ///
    /// For maturation proofs (node not yet matured): PendingProof is created
    /// but immediately marked as finalized with zero reward. No cross-validation
    /// needed during maturation.
    ///
    /// Security checks (all on-chain):
    ///   1. Node is not banned
    ///   2. Node is not in cooldown
    ///   3. Node has matured (14 days + 100 proofs)
    ///   4. Node has sufficient stake
    ///   5. Node reputation >= 500
    ///   6. Round not already claimed
    ///   7. Minimum time elapsed
    ///   8. Merkle proofs valid
    ///   9. Supply cap not exceeded (pre-check)
    ///  10. Reward scaled by reputation + loyalty + quality
    pub fn submit_pulse_proof(
        ctx: Context<SubmitPulseProof>,
        round_number: u64,
        merkle_root: [u8; 32],
        challenged_rows: [u16; 4],
        row_hashes: [[u8; 32]; 4],
        merkle_proofs: Vec<Vec<[u8; 32]>>,
    ) -> Result<()> {
        let node_account_key = ctx.accounts.node_account.key();
        let state = &mut ctx.accounts.program_state;
        let node = &mut ctx.accounts.node_account;
        let pending = &mut ctx.accounts.pending_proof;
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;

        // ── Layer 1: Ban check ──
        require!(!node.is_banned, SecurityError::NodeBanned);

        // ── Layer 2: Cooldown check ──
        require!(now >= node.cooldown_until, SecurityError::InCooldown);

        // ── Layer 3: Maturation check ──
        let age = now - node.registered_at;
        let time_matured = age >= MATURATION_PERIOD;
        let proofs_matured = node.maturation_proofs >= MATURATION_PROOFS_REQUIRED;

        if !node.is_matured && time_matured && proofs_matured {
            node.is_matured = true;
            msg!("Node {} has matured! Now eligible for full rewards.", node.owner);
        }

        // ── Layer 4: Stake check ──
        if node.is_matured {
            require!(node.stake_amount >= MIN_STAKE, SecurityError::InsufficientStake);
        }

        // ── Layer 5: Reputation check ──
        if node.is_matured {
            require!(node.reputation >= MIN_REPUTATION_TO_EARN, SecurityError::ReputationTooLow);
        }

        // ── Layer 6: Round uniqueness ──
        require!(round_number > node.last_claim_round, RewardError::RoundAlreadyClaimed);

        // ── Layer 7: Timing ──
        if node.last_claim_at > 0 {
            let elapsed = now - node.last_claim_at;
            require!(elapsed >= MIN_PULSE_INTERVAL, RewardError::ClaimTooFrequent);
        }

        // ── Layer 8: Merkle proof verification ──
        for i in 0..CHALLENGE_ROWS as usize {
            require!(challenged_rows[i] < MATRIX_SIZE, RewardError::InvalidRowIndex);

            let valid = verify_merkle_proof(
                &row_hashes[i],
                &merkle_proofs[i],
                &merkle_root,
                challenged_rows[i] as usize,
            );

            if !valid {
                // INVALID PROOF — slash and penalize.
                // NOTE: We return Ok so the slash actually persists on-chain.
                // Returning Err would roll back all state changes including the slash.
                apply_proof_failure(node, now);
                state.total_slashed += slash_amount(node.stake_amount, SLASH_INVALID_PROOF_BPS);

                // Mark PendingProof as finalized with zero reward (nothing to claim)
                pending.node_account = node_account_key;
                pending.owner = node.owner;
                pending.round_number = round_number;
                pending.merkle_root = merkle_root;
                pending.submitted_at = now;
                pending.reward_amount = 0;
                pending.is_finalized = true;

                msg!(
                    "INVALID PROOF from {}. Slashed. Strike {}/{}. Reputation: {}",
                    node.owner, node.strikes, MAX_STRIKES_BEFORE_BAN, node.reputation
                );

                return Ok(());
            }
        }

        // ── All checks passed ──

        node.consecutive_misses = 0;
        node.last_claim_at = now;
        node.last_claim_round = round_number;
        node.total_rounds_participated += 1;
        node.valid_proofs_submitted += 1;
        node.consecutive_failures = 0;

        // Reputation gains (immediate, not deferred to finalize)
        node.reputation = (node.reputation + REPUTATION_GAIN_PER_PROOF).min(MAX_REPUTATION);
        node.honesty_score = update_honesty(node);
        node.loyalty_score = update_loyalty(node, now);
        node.quality_score = update_quality(node);
        node.consistency_score = update_consistency(node);

        if round_number > state.current_round {
            state.current_round = round_number;
        }

        // ── Maturation proofs: no reward, no validation needed ──
        if !node.is_matured {
            node.maturation_proofs += 1;

            pending.node_account = node_account_key;
            pending.owner = node.owner;
            pending.round_number = round_number;
            pending.merkle_root = merkle_root;
            pending.submitted_at = now;
            pending.reward_amount = 0;
            pending.is_finalized = true; // No validation needed during maturation

            msg!(
                "Maturation proof {}/{}. {} days remaining.",
                node.maturation_proofs,
                MATURATION_PROOFS_REQUIRED,
                (MATURATION_PERIOD - age).max(0) / 86400
            );
            return Ok(());
        }

        // ── Matured node: calculate reward, create PendingProof for cross-validation ──

        let base_reward = calculate_reward(node, now);
        let rep_mult = reputation_reward_multiplier(node);
        let adjusted_reward = (base_reward as u128 * rep_mult as u128 / 10000) as u64;

        // Layer 9: Supply cap pre-check
        require!(
            state.total_minted.checked_add(adjusted_reward).unwrap() <= state.supply_cap,
            RewardError::SupplyCapReached
        );

        // Create PendingProof — tokens minted after 3 validators confirm
        pending.node_account = node_account_key;
        pending.owner = node.owner;
        pending.round_number = round_number;
        pending.merkle_root = merkle_root;
        pending.submitted_at = now;
        pending.reward_amount = adjusted_reward;
        pending.validations_for = 0;
        pending.validations_against = 0;
        pending.is_finalized = false;

        msg!(
            "Round {}: proof submitted, {} tokens pending validation ({} validators needed within {}s)",
            round_number,
            adjusted_reward / 1_000_000,
            VALIDATORS_REQUIRED,
            VALIDATION_WINDOW
        );

        Ok(())
    }

    // ═════════════════════════════════════════════════════════════════════
    // PHASE 2: CROSS-VALIDATION (enforced on-chain)
    //
    // Validators must confirm within VALIDATION_WINDOW (120s).
    // Need VALIDATORS_REQUIRED (3) confirmations for finalization.
    // ═════════════════════════════════════════════════════════════════════

    /// A validator node attests that a target node's proof is valid.
    ///
    /// Enforced constraints:
    ///   - Must validate within 2-minute window of proof submission
    ///   - PendingProof must not be finalized
    ///   - Target merkle root must match what's on-chain
    ///   - Validator reputation >= 2000
    ///   - Cannot validate own proofs
    pub fn validate_peer(
        ctx: Context<ValidatePeer>,
        round_number: u64,
        computed_merkle_root: [u8; 32],
        target_reported_root: [u8; 32],
        agrees: bool,
    ) -> Result<()> {
        let validator = &mut ctx.accounts.validator_account;
        let target = &mut ctx.accounts.target_account;
        let pending = &mut ctx.accounts.pending_proof;
        let validation = &mut ctx.accounts.validation_record;
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;

        // ── Validator eligibility ──
        require!(validator.reputation >= MIN_REPUTATION_TO_VALIDATE, SecurityError::ReputationTooLow);
        require!(!validator.is_banned, SecurityError::NodeBanned);
        require!(validator.owner != target.owner, SecurityError::SelfValidation);
        require!(validator.is_matured, SecurityError::NotMatured);

        // ── PendingProof checks ──
        require!(!pending.is_finalized, RewardError::AlreadyFinalized);

        // Enforce validation window: must validate within 2 minutes of submission
        require!(
            now <= pending.submitted_at + VALIDATION_WINDOW,
            RewardError::ValidationWindowClosed
        );

        // Verify the target_reported_root matches what's stored on-chain
        require!(
            target_reported_root == pending.merkle_root,
            RewardError::MerkleRootMismatch
        );

        // ── Record the validation ──
        validation.validator = validator.owner;
        validation.target = target.owner;
        validation.round_number = round_number;
        validation.validator_computed_root = computed_merkle_root;
        validation.target_reported_root = target_reported_root;
        validation.agrees = agrees;
        validation.timestamp = now;

        // ── Honesty check: is the validator's vote consistent with their computation? ──
        let roots_match = computed_merkle_root == target_reported_root;
        let consistent = agrees == roots_match;

        if consistent {
            // Honest validation — reward the validator
            validator.reputation =
                (validator.reputation + REPUTATION_GAIN_PER_VALIDATION).min(MAX_REPUTATION);
            validator.validations_performed += 1;
        } else {
            // Inconsistent — validator lied about their computation
            validator.reputation =
                validator.reputation.saturating_sub(REPUTATION_LOSS_INVALID_PROOF);
            validator.strikes += 1;

            if validator.strikes >= MAX_STRIKES_BEFORE_BAN {
                validator.is_banned = true;
                msg!("Validator {} BANNED for dishonest validation", validator.owner);
            }
        }

        // ── Update PendingProof validation counts ──
        if agrees && consistent {
            pending.validations_for += 1;
            target.validations_received += 1;
            target.reputation = (target.reputation + 1).min(MAX_REPUTATION);

            msg!(
                "Validation CONFIRMED ({}/{}): validator {} for target {} round {}",
                pending.validations_for, VALIDATORS_REQUIRED,
                validator.owner, target.owner, round_number
            );
        } else if !agrees && consistent {
            pending.validations_against += 1;
            target.reputation =
                target.reputation.saturating_sub(REPUTATION_LOSS_INVALID_PROOF / 2);
            target.honesty_score = target.honesty_score.saturating_sub(500);
            target.validations_received += 1;

            msg!(
                "Validation DISAGREEMENT ({} against): validator {} flagged target {} round {}",
                pending.validations_against,
                validator.owner, target.owner, round_number
            );
        }
        // Inconsistent validators don't affect the pending proof counts

        Ok(())
    }

    // ═════════════════════════════════════════════════════════════════════
    // PHASE 3: FINALIZE REWARD (mint after cross-validation)
    //
    // Permissionless — anyone can call this once conditions are met.
    // ═════════════════════════════════════════════════════════════════════

    /// Finalize a validated proof and mint the reward tokens.
    ///
    /// Requirements:
    ///   - Validation window must have closed (2 minutes after submission)
    ///   - At least 3 validators must have confirmed (validations_for >= 3)
    ///   - More validators for than against
    ///   - Proof not already finalized
    ///   - Supply cap not exceeded
    ///
    /// Can be called by anyone (permissionless crank). The reward goes to
    /// the node's registered token account, not the caller's.
    pub fn finalize_reward(
        ctx: Context<FinalizeReward>,
        _round_number: u64,
    ) -> Result<()> {
        let pending = &mut ctx.accounts.pending_proof;
        let state = &mut ctx.accounts.program_state;
        let node = &mut ctx.accounts.node_account;

        // ── Pre-conditions ──
        require!(!pending.is_finalized, RewardError::AlreadyFinalized);
        require!(pending.reward_amount > 0, RewardError::ProofNotPending);

        let clock = Clock::get()?;
        let now = clock.unix_timestamp;

        // Validation window must have closed — give all validators time to submit
        require!(
            now >= pending.submitted_at + VALIDATION_WINDOW,
            RewardError::ValidationWindowOpen
        );

        // Need at least VALIDATORS_REQUIRED confirmations
        require!(
            pending.validations_for >= VALIDATORS_REQUIRED,
            RewardError::InsufficientValidations
        );

        // Majority must agree (more for than against)
        require!(
            pending.validations_for > pending.validations_against,
            RewardError::ValidationFailed
        );

        // Supply cap double-check (could have changed since submission)
        require!(
            state.total_minted.checked_add(pending.reward_amount).unwrap() <= state.supply_cap,
            RewardError::SupplyCapReached
        );

        // ── Mint tokens via PDA ──
        let seeds = &[b"mint_authority".as_ref(), &[state.authority_bump]];
        let signer = &[&seeds[..]];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.node_token_account.to_account_info(),
                    authority: ctx.accounts.mint_authority.to_account_info(),
                },
                signer,
            ),
            pending.reward_amount,
        )?;

        // ── Update global state ──
        state.total_minted += pending.reward_amount;
        node.total_earned += pending.reward_amount;

        // ── Mark finalized ──
        pending.is_finalized = true;

        msg!(
            "Round {} FINALIZED: {} tokens minted for {} (validated by {}/{} peers)",
            pending.round_number,
            pending.reward_amount / 1_000_000,
            pending.owner,
            pending.validations_for,
            pending.validations_for + pending.validations_against
        );

        Ok(())
    }

    // ═════════════════════════════════════════════════════════════════════
    // SLASHING (trustless, on-chain enforcement)
    // ═════════════════════════════════════════════════════════════════════

    /// Report a node for a provable on-chain violation.
    ///
    /// Violation types:
    ///   0 = invalid_proof (5% slash)
    ///   1 = collusion     (50% slash)
    ///   2 = sybil         (100% slash)
    pub fn report_violation(
        ctx: Context<ReportViolation>,
        violation_type: u8,
        _evidence_round: u64,
        _evidence_hash: [u8; 32],
    ) -> Result<()> {
        let target = &mut ctx.accounts.target_account;
        let reporter = &mut ctx.accounts.reporter_account;
        let state = &mut ctx.accounts.program_state;

        require!(!target.is_banned, SecurityError::NodeBanned);
        require!(reporter.reputation >= MIN_REPUTATION_TO_VALIDATE, SecurityError::ReputationTooLow);
        require!(reporter.owner != target.owner, SecurityError::SelfValidation);

        let slash_bps = match violation_type {
            0 => SLASH_INVALID_PROOF_BPS,
            1 => SLASH_COLLUSION_BPS,
            2 => SLASH_SYBIL_BPS,
            _ => return Err(SecurityError::InvalidViolationType.into()),
        };

        let slash = slash_amount(target.stake_amount, slash_bps);

        target.stake_amount = target.stake_amount.saturating_sub(slash);
        target.strikes += 1;
        target.reputation = target.reputation.saturating_sub(
            match violation_type {
                0 => REPUTATION_LOSS_INVALID_PROOF,
                1 => REPUTATION_LOSS_INVALID_PROOF * 3,
                2 => MAX_REPUTATION,
                _ => 0,
            }
        );

        state.total_slashed += slash;

        if target.strikes >= MAX_STRIKES_BEFORE_BAN || violation_type == 2 {
            target.is_banned = true;
            state.total_banned += 1;
            msg!("Node {} BANNED. Violation type: {}", target.owner, violation_type);
        }

        reporter.reputation =
            (reporter.reputation + REPUTATION_GAIN_PER_VALIDATION * 5).min(MAX_REPUTATION);

        msg!(
            "Violation reported: type={}, target={}, slashed={}, strikes={}/{}",
            violation_type, target.owner, slash / 1_000_000, target.strikes, MAX_STRIKES_BEFORE_BAN
        );

        Ok(())
    }

    // ═════════════════════════════════════════════════════════════════════
    // HEARTBEAT (liveness + consistency tracking)
    // ═════════════════════════════════════════════════════════════════════

    /// Lightweight heartbeat — proves liveness, tracks consistency.
    pub fn heartbeat(ctx: Context<Heartbeat>, round_number: u64) -> Result<()> {
        let node = &mut ctx.accounts.node_account;
        let clock = Clock::get()?;

        require!(!node.is_banned, SecurityError::NodeBanned);

        if round_number > node.last_claim_round + 1 {
            let missed = (round_number - node.last_claim_round - 1).min(255) as u8;
            node.consecutive_misses = node.consecutive_misses.saturating_add(missed);

            if node.consecutive_misses >= MAX_CONSECUTIVE_MISSES {
                node.reputation = node.reputation.saturating_sub(
                    REPUTATION_LOSS_MISSED_ROUND * (node.consecutive_misses as u32)
                );
                node.consistency_score = node.consistency_score.saturating_sub(200);
            }
        }

        node.last_heartbeat = clock.unix_timestamp;
        Ok(())
    }

    // ═════════════════════════════════════════════════════════════════════
    // QUERIES
    // ═════════════════════════════════════════════════════════════════════

    /// Check if a node is eligible to earn rewards.
    pub fn check_eligibility(ctx: Context<CheckEligibility>) -> Result<()> {
        let node = &ctx.accounts.node_account;
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;

        let mut status: u8 = 0;
        let mut reasons: Vec<&str> = vec![];

        if node.is_banned {
            status = 1;
            reasons.push("BANNED");
        }
        if now < node.cooldown_until {
            status = 2;
            reasons.push("IN_COOLDOWN");
        }
        if !node.is_matured {
            let age_days = (now - node.registered_at) / 86400;
            status = 3;
            reasons.push("NOT_MATURED");
            msg!("Maturation: {} days / 14, {} proofs / {}",
                age_days, node.maturation_proofs, MATURATION_PROOFS_REQUIRED);
        }
        if node.stake_amount < MIN_STAKE && node.is_matured {
            status = 4;
            reasons.push("INSUFFICIENT_STAKE");
        }
        if node.reputation < MIN_REPUTATION_TO_EARN {
            status = 5;
            reasons.push("LOW_REPUTATION");
        }

        if status == 0 {
            msg!("Node {} is ELIGIBLE. Rep: {}, Stake: {}, Quality: {}",
                node.owner, node.reputation, node.stake_amount / 1_000_000, node.quality_score);
        } else {
            msg!("Node {} INELIGIBLE: {:?}", node.owner, reasons);
        }

        Ok(())
    }
}
