use anchor_lang::prelude::*;

#[error_code]
pub enum RewardError {
    #[msg("This round has already been claimed")]
    RoundAlreadyClaimed,

    #[msg("Claims too frequent — wait at least 80 seconds")]
    ClaimTooFrequent,

    #[msg("Invalid Merkle proof — proof verification failed. Stake slashed.")]
    InvalidMerkleProof,

    #[msg("Invalid row index in challenge")]
    InvalidRowIndex,

    #[msg("Supply cap reached — no more tokens can be minted")]
    SupplyCapReached,

    #[msg("Mint address mismatch")]
    MintMismatch,

    #[msg("Token account mismatch")]
    TokenAccountMismatch,

    #[msg("Proof already finalized")]
    AlreadyFinalized,

    #[msg("Validation window still open — wait for validators to confirm")]
    ValidationWindowOpen,

    #[msg("Not enough validators confirmed this proof — need 3")]
    InsufficientValidations,

    #[msg("Majority of validators disagreed with this proof")]
    ValidationFailed,

    #[msg("Validation window has closed — cannot validate after 2 minutes")]
    ValidationWindowClosed,

    #[msg("Target merkle root does not match pending proof")]
    MerkleRootMismatch,

    #[msg("Pending proof not found or already finalized")]
    ProofNotPending,
}

#[error_code]
pub enum SecurityError {
    #[msg("Node is permanently banned")]
    NodeBanned,

    #[msg("Node is in cooldown — wait for cooldown to expire")]
    InCooldown,

    #[msg("Node has not completed the 14-day maturation period")]
    NotMatured,

    #[msg("Insufficient stake — minimum 100 tokens required")]
    InsufficientStake,

    #[msg("Stake below minimum after unstake")]
    StakeBelowMinimum,

    #[msg("Stake is locked — wait for lock period")]
    StakeLocked,

    #[msg("No pending unstake request")]
    NoPendingUnstake,

    #[msg("Reputation too low — minimum 500 required")]
    ReputationTooLow,

    #[msg("Cannot validate your own proofs")]
    SelfValidation,

    #[msg("Invalid violation type")]
    InvalidViolationType,

    #[msg("Unauthorized")]
    Unauthorized,
}
