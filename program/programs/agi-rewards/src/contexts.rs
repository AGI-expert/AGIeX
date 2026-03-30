use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::errors::RewardError;
use crate::state::*;

// ═══════════════════════════════════════════════════════════════════════════
// INSTRUCTION CONTEXTS
// ═══════════════════════════════════════════════════════════════════════════

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init, payer = deployer,
        space = 8 + std::mem::size_of::<ProgramState>(),
        seeds = [b"program_state"], bump,
    )]
    pub program_state: Account<'info, ProgramState>,

    /// CHECK: PDA — no private key.
    #[account(seeds = [b"mint_authority"], bump)]
    pub mint_authority: UncheckedAccount<'info>,

    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub deployer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterNode<'info> {
    #[account(
        init, payer = owner,
        space = 8 + std::mem::size_of::<NodeAccount>(),
        seeds = [b"node", owner.key().as_ref()], bump,
    )]
    pub node_account: Account<'info, NodeAccount>,

    #[account(mut, seeds = [b"program_state"], bump)]
    pub program_state: Account<'info, ProgramState>,

    pub node_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateNode<'info> {
    #[account(mut, seeds = [b"node", owner.key().as_ref()], bump, has_one = owner)]
    pub node_account: Account<'info, NodeAccount>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut, seeds = [b"node", owner.key().as_ref()], bump, has_one = owner)]
    pub node_account: Account<'info, NodeAccount>,

    #[account(
        mut,
        seeds = [b"stake_vault"],
        bump,
    )]
    pub stake_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub staker_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(mut, seeds = [b"node", owner.key().as_ref()], bump, has_one = owner)]
    pub node_account: Account<'info, NodeAccount>,

    #[account(seeds = [b"program_state"], bump)]
    pub program_state: Account<'info, ProgramState>,

    #[account(
        mut,
        seeds = [b"stake_vault"],
        bump,
    )]
    pub stake_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub staker_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

/// Submit a pulse proof. Creates a PendingProof that must be cross-validated
/// before tokens are minted. Minting moves to `finalize_reward`.
#[derive(Accounts)]
#[instruction(round_number: u64)]
pub struct SubmitPulseProof<'info> {
    #[account(mut, seeds = [b"program_state"], bump)]
    pub program_state: Account<'info, ProgramState>,

    #[account(mut, seeds = [b"node", owner.key().as_ref()], bump, has_one = owner)]
    pub node_account: Account<'info, NodeAccount>,

    /// PDA holding the pending proof for this node + round.
    /// Initialized here; updated by validators; finalized by finalize_reward.
    #[account(
        init, payer = owner,
        space = 8 + std::mem::size_of::<PendingProof>(),
        seeds = [b"pending_proof", node_account.key().as_ref(), &round_number.to_le_bytes()],
        bump,
    )]
    pub pending_proof: Account<'info, PendingProof>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Cross-validation context.
///
/// Validators confirm or dispute a pending proof within the validation window.
/// The PendingProof PDA is derived from the target node account + round.
#[derive(Accounts)]
#[instruction(round_number: u64)]
pub struct ValidatePeer<'info> {
    #[account(
        mut,
        seeds = [b"node", validator_owner.key().as_ref()],
        bump,
    )]
    pub validator_account: Account<'info, NodeAccount>,

    #[account(mut)]
    pub target_account: Account<'info, NodeAccount>,

    /// The pending proof being validated.
    #[account(
        mut,
        seeds = [b"pending_proof", target_account.key().as_ref(), &round_number.to_le_bytes()],
        bump,
    )]
    pub pending_proof: Account<'info, PendingProof>,

    #[account(
        init, payer = validator_owner,
        space = 8 + std::mem::size_of::<ValidationRecord>(),
        seeds = [
            b"validation",
            validator_owner.key().as_ref(),
            target_account.key().as_ref(),
            &round_number.to_le_bytes(),
        ],
        bump,
    )]
    pub validation_record: Account<'info, ValidationRecord>,

    #[account(mut)]
    pub validator_owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Finalize a proof after cross-validation threshold is met.
/// Mints the reward tokens. Can be called by anyone (permissionless crank).
#[derive(Accounts)]
#[instruction(round_number: u64)]
pub struct FinalizeReward<'info> {
    #[account(mut, seeds = [b"program_state"], bump)]
    pub program_state: Account<'info, ProgramState>,

    #[account(
        mut,
        constraint = node_account.key() == pending_proof.node_account @ RewardError::TokenAccountMismatch,
    )]
    pub node_account: Account<'info, NodeAccount>,

    #[account(
        mut,
        seeds = [b"pending_proof", node_account.key().as_ref(), &round_number.to_le_bytes()],
        bump,
    )]
    pub pending_proof: Account<'info, PendingProof>,

    /// CHECK: PDA mint authority — seeds verified.
    #[account(seeds = [b"mint_authority"], bump = program_state.authority_bump)]
    pub mint_authority: UncheckedAccount<'info>,

    #[account(mut, constraint = mint.key() == program_state.mint @ RewardError::MintMismatch)]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = node_token_account.key() == node_account.token_account @ RewardError::TokenAccountMismatch,
    )]
    pub node_token_account: Account<'info, TokenAccount>,

    /// Anyone can call finalize — the reward destination is locked to the node's token account.
    pub caller: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ReportViolation<'info> {
    #[account(mut)]
    pub target_account: Account<'info, NodeAccount>,

    #[account(mut, seeds = [b"node", reporter_owner.key().as_ref()], bump)]
    pub reporter_account: Account<'info, NodeAccount>,

    #[account(mut, seeds = [b"program_state"], bump)]
    pub program_state: Account<'info, ProgramState>,

    #[account(mut)]
    pub reporter_owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct Heartbeat<'info> {
    #[account(mut, seeds = [b"node", owner.key().as_ref()], bump, has_one = owner)]
    pub node_account: Account<'info, NodeAccount>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct CheckEligibility<'info> {
    pub node_account: Account<'info, NodeAccount>,
}
