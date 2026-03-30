// ═══════════════════════════════════════════════════════════════════════════
// HARDCODED CONSTANTS (immutable after deploy)
// ═══════════════════════════════════════════════════════════════════════════

pub const BASE_REWARD: u64 = 10_000_000; // 10 tokens (6 decimals) per pulse round
pub const MAX_SUPPLY: u64 = 1_000_000_000_000_000; // 1 billion tokens (6 decimals)
pub const MIN_PULSE_INTERVAL: i64 = 80; // Minimum seconds between claims
pub const MATRIX_SIZE: u16 = 256;
pub const CHALLENGE_ROWS: u8 = 4;

// ── Maturation ───────────────────────────────────────────────────────────
pub const MATURATION_PERIOD: i64 = 14 * 24 * 3600; // 14 days in seconds
pub const MATURATION_PROOFS_REQUIRED: u32 = 100;

// ── Staking ──────────────────────────────────────────────────────────────
pub const MIN_STAKE: u64 = 100_000_000; // 100 tokens minimum stake (6 decimals)
pub const STAKE_LOCK_PERIOD: i64 = 7 * 24 * 3600; // 7-day unstake cooldown

// ── Reputation ───────────────────────────────────────────────────────────
pub const INITIAL_REPUTATION: u32 = 1000;
pub const MAX_REPUTATION: u32 = 10000;
pub const REPUTATION_GAIN_PER_PROOF: u32 = 5;
pub const REPUTATION_GAIN_PER_VALIDATION: u32 = 3;
pub const REPUTATION_LOSS_INVALID_PROOF: u32 = 200;
pub const REPUTATION_LOSS_MISSED_ROUND: u32 = 10;
pub const MIN_REPUTATION_TO_EARN: u32 = 500;
pub const MIN_REPUTATION_TO_VALIDATE: u32 = 2000;

// ── Slashing ─────────────────────────────────────────────────────────────
pub const SLASH_INVALID_PROOF_BPS: u64 = 500;  // 5%
pub const SLASH_COLLUSION_BPS: u64 = 5000;      // 50%
pub const SLASH_SYBIL_BPS: u64 = 10000;         // 100%
pub const MAX_STRIKES_BEFORE_BAN: u8 = 5;

// ── Cooldown escalation ──────────────────────────────────────────────────
pub const BASE_COOLDOWN: i64 = 300;       // 5 min
pub const COOLDOWN_MULTIPLIER: i64 = 2;
pub const MAX_COOLDOWN: i64 = 7 * 24 * 3600; // 7 days

// ── Cross-validation ─────────────────────────────────────────────────────
pub const VALIDATORS_REQUIRED: u8 = 3;
pub const VALIDATION_WINDOW: i64 = 120; // 2-minute window

// ── Consistency ──────────────────────────────────────────────────────────
pub const MAX_CONSECUTIVE_MISSES: u8 = 10;
pub const LOYALTY_THRESHOLD_DAYS: i64 = 30 * 24 * 3600;
pub const QUALITY_WINDOW: u32 = 100;

// ── Capability weights (basis points, 100 = 1%) ─────────────────────────
pub const WEIGHT_INFERENCE: u16 = 1000;
pub const WEIGHT_RESEARCH: u16 = 1200;
pub const WEIGHT_PROXY: u16 = 800;
pub const WEIGHT_STORAGE: u16 = 600;
pub const WEIGHT_EMBEDDING: u16 = 500;
pub const WEIGHT_MEMORY: u16 = 500;
pub const WEIGHT_ORCHESTRATION: u16 = 500;
pub const WEIGHT_VALIDATION: u16 = 400;
pub const WEIGHT_RELAY: u16 = 300;
