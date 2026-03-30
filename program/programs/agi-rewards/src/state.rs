use anchor_lang::prelude::*;

#[account]
pub struct ProgramState {
    pub mint: Pubkey,            // 32
    pub authority_bump: u8,      // 1
    pub supply_cap: u64,         // 8
    pub total_minted: u64,       // 8
    pub total_nodes: u32,        // 4
    pub total_slashed: u64,      // 8
    pub total_banned: u32,       // 4
    pub current_round: u64,      // 8
    pub initialized_at: i64,     // 8
    pub _reserved: [u8; 64],     // 64
}

#[account]
pub struct NodeAccount {
    // ── Identity ──
    pub owner: Pubkey,                  // 32
    pub token_account: Pubkey,          // 32
    pub capabilities: u16,              // 2

    // ── Timing ──
    pub registered_at: i64,             // 8
    pub last_claim_at: i64,             // 8
    pub last_claim_round: u64,          // 8
    pub last_heartbeat: i64,            // 8

    // ── Earnings ──
    pub total_earned: u64,              // 8
    pub total_rounds_participated: u32, // 4

    // ── Reputation (0-10000 scale) ──
    pub reputation: u32,                // 4
    pub honesty_score: u32,             // 4
    pub loyalty_score: u32,             // 4
    pub quality_score: u32,             // 4
    pub consistency_score: u32,         // 4

    // ── Security ──
    pub is_matured: bool,               // 1
    pub is_banned: bool,                // 1
    pub maturation_proofs: u32,         // 4
    pub strikes: u8,                    // 1
    pub consecutive_failures: u8,       // 1
    pub consecutive_misses: u8,         // 1
    pub cooldown_until: i64,            // 8
    pub last_failure_at: i64,           // 8

    // ── Staking ──
    pub stake_amount: u64,              // 8
    pub stake_locked_until: i64,        // 8
    pub pending_unstake: u64,           // 8
    pub unstake_requested_at: i64,      // 8

    // ── Validation tracking ──
    pub valid_proofs_submitted: u32,    // 4
    pub invalid_proofs_submitted: u32,  // 4
    pub validations_performed: u32,     // 4
    pub validations_received: u32,      // 4

    // ── Padding ──
    pub _reserved: [u8; 64],           // 64
}

#[account]
pub struct ValidationRecord {
    pub validator: Pubkey,              // 32
    pub target: Pubkey,                 // 32
    pub round_number: u64,             // 8
    pub validator_computed_root: [u8; 32], // 32
    pub target_reported_root: [u8; 32],   // 32
    pub agrees: bool,                   // 1
    pub timestamp: i64,                 // 8
}

/// A pending proof awaiting cross-validation before reward minting.
///
/// Flow:
///   1. Node submits proof → PendingProof created (reward calculated, not minted)
///   2. Validators call validate_peer → validations_for/against updated
///   3. Anyone calls finalize_reward after window closes → tokens minted if threshold met
#[account]
pub struct PendingProof {
    pub node_account: Pubkey,       // 32 — the node PDA key
    pub owner: Pubkey,              // 32 — the node owner wallet
    pub round_number: u64,          // 8
    pub merkle_root: [u8; 32],      // 32
    pub submitted_at: i64,          // 8
    pub reward_amount: u64,         // 8
    pub validations_for: u8,        // 1
    pub validations_against: u8,    // 1
    pub is_finalized: bool,         // 1
}
