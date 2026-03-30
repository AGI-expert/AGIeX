use crate::constants::*;
use crate::state::NodeAccount;

// ═══════════════════════════════════════════════════════════════════════════
// SECURITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/// Apply penalties for a failed proof submission.
pub fn apply_proof_failure(node: &mut NodeAccount, now: i64) {
    node.consecutive_failures += 1;
    node.invalid_proofs_submitted += 1;
    node.strikes += 1;
    node.last_failure_at = now;

    // Reputation loss
    node.reputation = node.reputation.saturating_sub(REPUTATION_LOSS_INVALID_PROOF);
    node.honesty_score = node.honesty_score.saturating_sub(1000);

    // Escalating cooldown: BASE × 2^(consecutive_failures - 1)
    let cooldown = (BASE_COOLDOWN * COOLDOWN_MULTIPLIER.pow(
        (node.consecutive_failures as u32).saturating_sub(1).min(10)
    )).min(MAX_COOLDOWN);
    node.cooldown_until = now + cooldown;

    // Slash stake
    let slash = slash_amount(node.stake_amount, SLASH_INVALID_PROOF_BPS);
    node.stake_amount = node.stake_amount.saturating_sub(slash);

    // Ban check
    if node.strikes >= MAX_STRIKES_BEFORE_BAN {
        node.is_banned = true;
    }
}

/// Calculate slash amount from stake and basis points.
pub fn slash_amount(stake: u64, bps: u64) -> u64 {
    (stake as u128 * bps as u128 / 10000) as u64
}

// ═══════════════════════════════════════════════════════════════════════════
// REPUTATION SCORE CALCULATIONS
// ═══════════════════════════════════════════════════════════════════════════

/// Honesty score: ratio of valid proofs to total proofs submitted.
/// Scale: 0-10000 (10000 = 100% honest).
pub fn update_honesty(node: &NodeAccount) -> u32 {
    let total = node.valid_proofs_submitted + node.invalid_proofs_submitted;
    if total == 0 {
        return 5000;
    }
    ((node.valid_proofs_submitted as u64 * 10000) / total as u64) as u32
}

/// Loyalty score: based on continuous participation duration.
/// Scale: 0-10000.
pub fn update_loyalty(node: &NodeAccount, now: i64) -> u32 {
    let active_duration = now - node.registered_at;
    if active_duration <= 0 {
        return 0;
    }
    let loyalty = (active_duration as u64 * 10000 / LOYALTY_THRESHOLD_DAYS as u64).min(10000);
    loyalty as u32
}

/// Quality score: based on consistency of valid proofs in recent window.
/// Scale: 0-10000.
pub fn update_quality(node: &NodeAccount) -> u32 {
    let recent_valid = node.valid_proofs_submitted.min(QUALITY_WINDOW);
    let recent_invalid = node.invalid_proofs_submitted;

    if recent_valid == 0 && recent_invalid == 0 {
        return 5000;
    }

    let total = recent_valid + recent_invalid;
    let base = (recent_valid as u64 * 10000 / total as u64) as u32;
    let failure_penalty = (node.consecutive_failures as u32) * 500;
    base.saturating_sub(failure_penalty)
}

/// Consistency score: based on missed rounds and heartbeat frequency.
/// Scale: 0-10000.
pub fn update_consistency(node: &NodeAccount) -> u32 {
    if node.total_rounds_participated == 0 {
        return 5000;
    }
    let miss_penalty = (node.consecutive_misses as u32) * 200;
    10000u32.saturating_sub(miss_penalty)
}

/// Reputation-based reward multiplier.
/// Combines: reputation, honesty, loyalty, quality, consistency.
/// Scale: 0-10000 (10000 = 1.0x). Floor at 1000 (0.1x).
pub fn reputation_reward_multiplier(node: &NodeAccount) -> u64 {
    let rep_factor = node.reputation as u64;

    let composite = (
        (node.honesty_score as u64 * 3000) +
        (node.loyalty_score as u64 * 2000) +
        (node.quality_score as u64 * 3000) +
        (node.consistency_score as u64 * 2000)
    ) / 10000;

    (rep_factor * composite / 10000).max(1000)
}

// ═══════════════════════════════════════════════════════════════════════════
// REWARD CALCULATION
// ═══════════════════════════════════════════════════════════════════════════

pub fn calculate_reward(node: &NodeAccount, now: i64) -> u64 {
    let base = BASE_REWARD;

    let uptime_seconds = if node.registered_at > 0 {
        (now - node.registered_at).max(0) as u64
    } else {
        0
    };
    let uptime_hours_x100 = uptime_seconds * 100 / 3600;
    let uptime_bonus = uptime_bonus_fixed(uptime_hours_x100);
    let cap_bonus = capability_bonus_fixed(node.capabilities);

    let reward = (base as u128)
        .checked_mul(uptime_bonus as u128).unwrap()
        .checked_mul(cap_bonus as u128).unwrap()
        / 10000 / 10000;

    reward as u64
}

fn uptime_bonus_fixed(uptime_hours_x100: u64) -> u64 {
    let x = uptime_hours_x100 / 12;

    let ln_x10000 = if x == 0 {
        0
    } else if x <= 50 {
        x * 100
    } else if x <= 100 {
        4055 + (x - 50) * 57
    } else if x <= 200 {
        6930 + (x - 100) * 41
    } else if x <= 500 {
        10990 + (x - 200) * 23
    } else if x <= 1000 {
        17920 + (x - 500) * 12
    } else {
        23980 + (x - 1000).min(2000) * 6
    };

    10000 + (ln_x10000 * 2000 / 10000)
}

fn capability_bonus_fixed(capabilities: u16) -> u64 {
    let weights = [
        WEIGHT_INFERENCE, WEIGHT_RESEARCH, WEIGHT_PROXY, WEIGHT_STORAGE,
        WEIGHT_EMBEDDING, WEIGHT_MEMORY, WEIGHT_ORCHESTRATION,
        WEIGHT_VALIDATION, WEIGHT_RELAY,
    ];

    let mut bonus: u64 = 0;
    for (i, &weight) in weights.iter().enumerate() {
        if capabilities & (1 << i) != 0 {
            bonus += weight as u64;
        }
    }
    10000 + bonus
}

// ═══════════════════════════════════════════════════════════════════════════
// MERKLE PROOF VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

pub fn verify_merkle_proof(
    leaf_hash: &[u8; 32],
    proof: &[[u8; 32]],
    root: &[u8; 32],
    index: usize,
) -> bool {
    let mut current = *leaf_hash;
    let mut idx = index;

    for sibling in proof.iter() {
        let (left, right) = if idx % 2 == 0 {
            (&current, sibling)
        } else {
            (sibling, &current)
        };
        current = hash_pair(left, right);
        idx /= 2;
    }

    current == *root
}

fn hash_pair(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut combined = [0u8; 64];
    combined[..32].copy_from_slice(left);
    combined[32..].copy_from_slice(right);
    anchor_lang::solana_program::hash::hash(&combined).to_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::NodeAccount;
    use anchor_lang::prelude::Pubkey;

    fn default_node() -> NodeAccount {
        NodeAccount {
            owner: Pubkey::default(),
            token_account: Pubkey::default(),
            capabilities: 0,
            registered_at: 1_000_000,
            last_claim_at: 0,
            last_claim_round: 0,
            last_heartbeat: 0,
            total_earned: 0,
            total_rounds_participated: 0,
            reputation: INITIAL_REPUTATION,
            honesty_score: 5000,
            loyalty_score: 0,
            quality_score: 5000,
            consistency_score: 5000,
            is_matured: false,
            is_banned: false,
            maturation_proofs: 0,
            strikes: 0,
            consecutive_failures: 0,
            consecutive_misses: 0,
            cooldown_until: 0,
            last_failure_at: 0,
            stake_amount: 0,
            stake_locked_until: 0,
            pending_unstake: 0,
            unstake_requested_at: 0,
            valid_proofs_submitted: 0,
            invalid_proofs_submitted: 0,
            validations_performed: 0,
            validations_received: 0,
            _reserved: [0u8; 64],
        }
    }

    // ── slash_amount ────────────────────────────────────────────────────

    #[test]
    fn slash_amount_zero_stake() {
        assert_eq!(slash_amount(0, SLASH_INVALID_PROOF_BPS), 0);
    }

    #[test]
    fn slash_amount_five_percent() {
        let stake = 1_000_000_000; // 1000 tokens
        let slashed = slash_amount(stake, SLASH_INVALID_PROOF_BPS); // 500 bps = 5%
        assert_eq!(slashed, 50_000_000); // 50 tokens
    }

    #[test]
    fn slash_amount_fifty_percent() {
        let stake = 200_000_000; // 200 tokens
        assert_eq!(slash_amount(stake, SLASH_COLLUSION_BPS), 100_000_000);
    }

    #[test]
    fn slash_amount_sybil_full() {
        let stake = 500_000_000;
        assert_eq!(slash_amount(stake, SLASH_SYBIL_BPS), stake);
    }

    // ── apply_proof_failure ─────────────────────────────────────────────

    #[test]
    fn proof_failure_increments_counters() {
        let mut node = default_node();
        node.stake_amount = MIN_STAKE;
        let now = 2_000_000;

        apply_proof_failure(&mut node, now);

        assert_eq!(node.consecutive_failures, 1);
        assert_eq!(node.invalid_proofs_submitted, 1);
        assert_eq!(node.strikes, 1);
        assert_eq!(node.last_failure_at, now);
    }

    #[test]
    fn proof_failure_reduces_reputation() {
        let mut node = default_node();
        node.reputation = 5000;
        node.honesty_score = 8000;

        apply_proof_failure(&mut node, 2_000_000);

        assert_eq!(node.reputation, 5000 - REPUTATION_LOSS_INVALID_PROOF);
        assert_eq!(node.honesty_score, 7000);
    }

    #[test]
    fn proof_failure_sets_cooldown() {
        let mut node = default_node();
        let now = 2_000_000;

        apply_proof_failure(&mut node, now);

        // First failure: BASE_COOLDOWN * 2^0 = 300
        assert_eq!(node.cooldown_until, now + BASE_COOLDOWN);
    }

    #[test]
    fn proof_failure_escalating_cooldown() {
        let mut node = default_node();
        let now = 2_000_000;

        // Simulate 3 consecutive failures
        apply_proof_failure(&mut node, now);
        apply_proof_failure(&mut node, now + 1000);
        apply_proof_failure(&mut node, now + 2000);

        // 3rd failure: BASE_COOLDOWN * 2^2 = 300 * 4 = 1200
        assert_eq!(node.cooldown_until, now + 2000 + BASE_COOLDOWN * 4);
    }

    #[test]
    fn proof_failure_slashes_stake() {
        let mut node = default_node();
        node.stake_amount = 1_000_000_000; // 1000 tokens

        apply_proof_failure(&mut node, 2_000_000);

        let expected_slash = slash_amount(1_000_000_000, SLASH_INVALID_PROOF_BPS);
        assert_eq!(node.stake_amount, 1_000_000_000 - expected_slash);
    }

    #[test]
    fn proof_failure_bans_after_max_strikes() {
        let mut node = default_node();
        node.strikes = MAX_STRIKES_BEFORE_BAN - 1;

        apply_proof_failure(&mut node, 2_000_000);

        assert!(node.is_banned);
    }

    #[test]
    fn proof_failure_no_ban_before_max_strikes() {
        let mut node = default_node();
        node.strikes = MAX_STRIKES_BEFORE_BAN - 2;

        apply_proof_failure(&mut node, 2_000_000);

        assert!(!node.is_banned);
    }

    // ── update_honesty ──────────────────────────────────────────────────

    #[test]
    fn honesty_default_when_no_proofs() {
        let node = default_node();
        assert_eq!(update_honesty(&node), 5000);
    }

    #[test]
    fn honesty_perfect_when_all_valid() {
        let mut node = default_node();
        node.valid_proofs_submitted = 100;
        node.invalid_proofs_submitted = 0;
        assert_eq!(update_honesty(&node), 10000);
    }

    #[test]
    fn honesty_half_when_equal_valid_invalid() {
        let mut node = default_node();
        node.valid_proofs_submitted = 50;
        node.invalid_proofs_submitted = 50;
        assert_eq!(update_honesty(&node), 5000);
    }

    #[test]
    fn honesty_zero_when_all_invalid() {
        let mut node = default_node();
        node.valid_proofs_submitted = 0;
        node.invalid_proofs_submitted = 100;
        assert_eq!(update_honesty(&node), 0);
    }

    // ── update_loyalty ──────────────────────────────────────────────────

    #[test]
    fn loyalty_zero_for_new_node() {
        let node = default_node();
        assert_eq!(update_loyalty(&node, node.registered_at), 0);
    }

    #[test]
    fn loyalty_caps_at_10000() {
        let node = default_node();
        let far_future = node.registered_at + LOYALTY_THRESHOLD_DAYS * 2;
        assert_eq!(update_loyalty(&node, far_future), 10000);
    }

    #[test]
    fn loyalty_scales_linearly() {
        let node = default_node();
        let halfway = node.registered_at + LOYALTY_THRESHOLD_DAYS / 2;
        let score = update_loyalty(&node, halfway);
        assert!(score >= 4900 && score <= 5100, "expected ~5000, got {score}");
    }

    // ── update_quality ──────────────────────────────────────────────────

    #[test]
    fn quality_default_when_no_proofs() {
        let node = default_node();
        assert_eq!(update_quality(&node), 5000);
    }

    #[test]
    fn quality_high_for_valid_proofs() {
        let mut node = default_node();
        node.valid_proofs_submitted = 80;
        node.invalid_proofs_submitted = 0;
        node.consecutive_failures = 0;
        assert_eq!(update_quality(&node), 10000);
    }

    #[test]
    fn quality_penalized_by_consecutive_failures() {
        let mut node = default_node();
        node.valid_proofs_submitted = 80;
        node.invalid_proofs_submitted = 0;
        node.consecutive_failures = 3;
        // base = 10000, penalty = 3 * 500 = 1500
        assert_eq!(update_quality(&node), 8500);
    }

    // ── update_consistency ──────────────────────────────────────────────

    #[test]
    fn consistency_default_when_no_participation() {
        let node = default_node();
        assert_eq!(update_consistency(&node), 5000);
    }

    #[test]
    fn consistency_perfect_with_no_misses() {
        let mut node = default_node();
        node.total_rounds_participated = 50;
        node.consecutive_misses = 0;
        assert_eq!(update_consistency(&node), 10000);
    }

    #[test]
    fn consistency_degrades_with_misses() {
        let mut node = default_node();
        node.total_rounds_participated = 50;
        node.consecutive_misses = 5;
        // 10000 - 5 * 200 = 9000
        assert_eq!(update_consistency(&node), 9000);
    }

    // ── reputation_reward_multiplier ────────────────────────────────────

    #[test]
    fn rep_multiplier_floor_at_1000() {
        let mut node = default_node();
        node.reputation = 0;
        node.honesty_score = 0;
        node.loyalty_score = 0;
        node.quality_score = 0;
        node.consistency_score = 0;

        assert_eq!(reputation_reward_multiplier(&node), 1000);
    }

    #[test]
    fn rep_multiplier_with_perfect_scores() {
        let mut node = default_node();
        node.reputation = 10000;
        node.honesty_score = 10000;
        node.loyalty_score = 10000;
        node.quality_score = 10000;
        node.consistency_score = 10000;

        // composite = (10000*3000 + 10000*2000 + 10000*3000 + 10000*2000) / 10000 = 10000
        // result = 10000 * 10000 / 10000 = 10000
        assert_eq!(reputation_reward_multiplier(&node), 10000);
    }

    #[test]
    fn rep_multiplier_weighted_correctly() {
        let mut node = default_node();
        node.reputation = 10000;
        node.honesty_score = 10000; // weight 30%
        node.loyalty_score = 0;     // weight 20%
        node.quality_score = 10000; // weight 30%
        node.consistency_score = 0; // weight 20%

        // composite = (10000*3000 + 0 + 10000*3000 + 0) / 10000 = 6000
        // result = 10000 * 6000 / 10000 = 6000
        assert_eq!(reputation_reward_multiplier(&node), 6000);
    }

    // ── calculate_reward ────────────────────────────────────────────────

    #[test]
    fn reward_base_for_fresh_node() {
        let node = default_node();
        let now = node.registered_at; // 0 uptime

        let reward = calculate_reward(&node, now);
        // With 0 uptime: uptime_bonus = 10000, cap_bonus = 10000 (no capabilities)
        // reward = BASE_REWARD * 10000 * 10000 / 10000 / 10000 = BASE_REWARD
        assert_eq!(reward, BASE_REWARD);
    }

    #[test]
    fn reward_increases_with_uptime() {
        let node = default_node();
        let one_day_later = node.registered_at + 86400;
        let one_week_later = node.registered_at + 86400 * 7;

        let r1 = calculate_reward(&node, one_day_later);
        let r2 = calculate_reward(&node, one_week_later);

        assert!(r2 > r1, "longer uptime should yield higher reward: {r1} vs {r2}");
        assert!(r1 > BASE_REWARD, "any uptime should exceed base: {r1}");
    }

    #[test]
    fn reward_increases_with_capabilities() {
        let mut node = default_node();
        let now = node.registered_at;

        let r_none = calculate_reward(&node, now);

        node.capabilities = 0b111111111; // all 9 capabilities
        let r_all = calculate_reward(&node, now);

        assert!(r_all > r_none, "capabilities should boost reward");
    }

    // ── capability_bonus_fixed ──────────────────────────────────────────

    #[test]
    fn cap_bonus_no_capabilities() {
        assert_eq!(capability_bonus_fixed(0), 10000);
    }

    #[test]
    fn cap_bonus_single_inference() {
        assert_eq!(capability_bonus_fixed(0b1), 10000 + WEIGHT_INFERENCE as u64);
    }

    #[test]
    fn cap_bonus_all_capabilities() {
        let all: u64 = [
            WEIGHT_INFERENCE, WEIGHT_RESEARCH, WEIGHT_PROXY, WEIGHT_STORAGE,
            WEIGHT_EMBEDDING, WEIGHT_MEMORY, WEIGHT_ORCHESTRATION,
            WEIGHT_VALIDATION, WEIGHT_RELAY,
        ].iter().map(|w| *w as u64).sum();

        assert_eq!(capability_bonus_fixed(0b111111111), 10000 + all);
    }

    // ── uptime_bonus_fixed ──────────────────────────────────────────────

    #[test]
    fn uptime_bonus_zero() {
        assert_eq!(uptime_bonus_fixed(0), 10000);
    }

    #[test]
    fn uptime_bonus_monotonically_increasing() {
        let mut prev = uptime_bonus_fixed(0);
        for h in (100..50000).step_by(500) {
            let cur = uptime_bonus_fixed(h);
            assert!(cur >= prev, "uptime bonus should not decrease: {prev} -> {cur} at {h}");
            prev = cur;
        }
    }

    // ── verify_merkle_proof ─────────────────────────────────────────────

    fn hash_leaf(data: &[u8]) -> [u8; 32] {
        anchor_lang::solana_program::hash::hash(data).to_bytes()
    }

    #[test]
    fn merkle_single_leaf_is_root() {
        let leaf = hash_leaf(b"leaf0");
        assert!(verify_merkle_proof(&leaf, &[], &leaf, 0));
    }

    #[test]
    fn merkle_two_leaves_valid() {
        let l0 = hash_leaf(b"leaf0");
        let l1 = hash_leaf(b"leaf1");
        let root = hash_pair(&l0, &l1);

        assert!(verify_merkle_proof(&l0, &[l1], &root, 0));
        assert!(verify_merkle_proof(&l1, &[l0], &root, 1));
    }

    #[test]
    fn merkle_rejects_wrong_root() {
        let l0 = hash_leaf(b"leaf0");
        let l1 = hash_leaf(b"leaf1");
        let root = hash_pair(&l0, &l1);
        let bad_root = hash_leaf(b"bad");

        assert!(!verify_merkle_proof(&l0, &[l1], &bad_root, 0));
        assert_ne!(root, bad_root);
    }

    #[test]
    fn merkle_rejects_wrong_index() {
        let l0 = hash_leaf(b"leaf0");
        let l1 = hash_leaf(b"leaf1");
        let root = hash_pair(&l0, &l1);

        // l0 at index 1 should fail (it's at index 0)
        assert!(!verify_merkle_proof(&l0, &[l1], &root, 1));
    }

    #[test]
    fn merkle_four_leaves() {
        let l0 = hash_leaf(b"row0");
        let l1 = hash_leaf(b"row1");
        let l2 = hash_leaf(b"row2");
        let l3 = hash_leaf(b"row3");

        let n01 = hash_pair(&l0, &l1);
        let n23 = hash_pair(&l2, &l3);
        let root = hash_pair(&n01, &n23);

        assert!(verify_merkle_proof(&l0, &[l1, n23], &root, 0));
        assert!(verify_merkle_proof(&l1, &[l0, n23], &root, 1));
        assert!(verify_merkle_proof(&l2, &[l3, n01], &root, 2));
        assert!(verify_merkle_proof(&l3, &[l2, n01], &root, 3));
    }

    // ── Constants sanity checks ─────────────────────────────────────────

    #[test]
    fn base_reward_is_ten_tokens() {
        assert_eq!(BASE_REWARD, 10_000_000);
    }

    #[test]
    fn min_stake_is_hundred_tokens() {
        assert_eq!(MIN_STAKE, 100_000_000);
    }

    #[test]
    fn slash_bps_ordering() {
        assert!(SLASH_INVALID_PROOF_BPS < SLASH_COLLUSION_BPS);
        assert!(SLASH_COLLUSION_BPS < SLASH_SYBIL_BPS);
        assert_eq!(SLASH_SYBIL_BPS, 10000); // 100%
    }

    #[test]
    fn reputation_bounds() {
        assert!(INITIAL_REPUTATION <= MAX_REPUTATION);
        assert!(MIN_REPUTATION_TO_EARN < MIN_REPUTATION_TO_VALIDATE);
        assert!(MIN_REPUTATION_TO_VALIDATE <= MAX_REPUTATION);
    }

    #[test]
    fn capability_weights_nine_capabilities() {
        let weights = [
            WEIGHT_INFERENCE, WEIGHT_RESEARCH, WEIGHT_PROXY, WEIGHT_STORAGE,
            WEIGHT_EMBEDDING, WEIGHT_MEMORY, WEIGHT_ORCHESTRATION,
            WEIGHT_VALIDATION, WEIGHT_RELAY,
        ];
        assert_eq!(weights.len(), 9);
        assert!(weights.iter().all(|&w| w > 0));
    }

    #[test]
    fn max_supply_is_one_billion() {
        assert_eq!(MAX_SUPPLY, 1_000_000_000_000_000);
    }

    #[test]
    fn validators_required_is_three() {
        assert_eq!(VALIDATORS_REQUIRED, 3);
    }

    #[test]
    fn matrix_dimensions() {
        assert_eq!(MATRIX_SIZE, 256);
        assert_eq!(CHALLENGE_ROWS, 4);
    }
}
