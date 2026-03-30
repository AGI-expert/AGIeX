# Node Requirements and Rewards

Everything about running a node, earning tokens, and the on-chain reward mechanics.

## Quick Start

```bash
git clone <repo-url> && cd agi.expert
chmod +x start.sh setup/detect-hardware.sh
./start.sh                  # manual staking later
./start.sh --auto-stake     # auto-stake when balance >= 100 tokens
```

That's it. The script detects your hardware, enables capabilities, initializes the SPL token mint, and starts the node. Rewards begin accumulating automatically via pulse rounds every ~90 seconds.

## Hardware Requirements

### Minimum

| Resource | Minimum | Notes |
|----------|---------|-------|
| CPU | 2 cores | Needed for validation + embedding |
| RAM | 4 GB | Bare minimum for embedding capability |
| Disk | 1 GB free | Without storage capability |
| Node.js | v18+ | Runtime |
| Network | Any | Local mDNS discovery works without public IP |

A 2-core CPU with 4 GB RAM qualifies for 2 capabilities (validation + embedding) and earns the base reward rate.

### Recommended

| Resource | Recommended | What it unlocks |
|----------|-------------|-----------------|
| GPU | 8+ GB VRAM (NVIDIA/AMD/Metal) | Inference + research |
| CPU | 4+ cores | Orchestration |
| RAM | 8+ GB | Memory (vector store) |
| Disk | 50+ GB free | Storage (block store) |
| Network | Public IP | Proxy + relay |

### Capability Thresholds

Hardware detection (`setup/detect-hardware.sh`) auto-enables capabilities based on these thresholds:

| Capability | Requirement | What it does |
|------------|-------------|--------------|
| **inference** | GPU with >= 4 GB VRAM | Serve AI models via local API |
| **research** | GPU >= 6 GB VRAM, or 4+ CPU cores + 8 GB RAM | Run ML training experiments |
| **proxy** | Public IP address | HTTP proxy for agent traffic |
| **storage** | >= 50 GB free disk | SHA-256-keyed block store |
| **embedding** | 2+ CPU cores + 4 GB RAM | Vector embeddings (all-MiniLM-L6-v2) |
| **memory** | 8+ GB RAM + 20 GB free disk | Distributed vector store with cosine similarity search |
| **orchestration** | 4+ CPU cores + 8 GB RAM | Task decomposition and routing |
| **validation** | 2+ CPU cores | Verify pulse proofs from other nodes |
| **relay** | Public IP address | libp2p circuit relay for browser nodes behind NAT |

### Model Selection

The node auto-selects a model based on available VRAM:

| VRAM | Model |
|------|-------|
| >= 80 GB | qwen2.5-coder-32b |
| >= 48 GB | gemma-3-27b |
| >= 24 GB | gpt-oss-20b |
| >= 16 GB | gemma-3-12b |
| >= 12 GB | glm-4-9b |
| >= 8 GB | gemma-3-4b |
| >= 4 GB | gemma-3-1b |
| < 4 GB | Proxy mode (no local inference) |

## Reward System

### Overview

Nodes earn SPL tokens on Solana. There is no off-chain points system — all rewards are minted on-chain by a Solana program (`3gFo4GUwn3ayTgKKBAaMX8u9fZFdYXTyytPZShRfdVBp`). The program holds mint authority via a PDA, so token minting is fully trustless and permissionless.

Two types of rewards:

1. **Presence rewards** — earned automatically every pulse round (~90s) just for being online and passing verification
2. **Work rewards** — earned for serving tasks (inference, proxy, training)

### Presence Reward Formula

```
reward = BASE * uptime_bonus * capability_multiplier
```

Where:
- **BASE** = `10` tokens per pulse round
- **uptime_bonus** = `1 + 0.2 * ln(1 + hours / 12)`
- **capability_multiplier** = `1 + sum(weights of enabled capabilities)`

#### Capability Weights

| Capability | Weight |
|------------|--------|
| research | 0.12 |
| inference | 0.10 |
| proxy | 0.08 |
| storage | 0.06 |
| embedding | 0.05 |
| memory | 0.05 |
| orchestration | 0.05 |
| validation | 0.04 |
| relay | 0.03 |

**Total possible bonus**: 0.58 (all 9 capabilities enabled)

#### Example Daily Earnings

With 960 pulse rounds per day (~90s each):

| Node Type | Capabilities | Daily Tokens (approx) |
|-----------|-------------|----------------------|
| Browser node (2 cores, no GPU) | validation, embedding | ~228 |
| Desktop with 8 GB GPU | +inference, research, orchestration, memory | ~503 |
| Server with 80 GB GPU + public IP | All 9/9 | ~1,912 |

These estimates assume 24h uptime. The logarithmic uptime bonus means the first 12 hours matter most — after that, returns diminish.

#### Uptime Bonus Curve

| Hours Online | Bonus Multiplier |
|-------------|-----------------|
| 0 | 1.00x |
| 1 | 1.02x |
| 6 | 1.07x |
| 12 | 1.14x |
| 24 | 1.18x |
| 48 | 1.23x |
| 168 (1 week) | 1.30x |

#### Reputation Multiplier

On-chain, the final reward is also scaled by a reputation factor (0.1x to 1.0x):

```
composite = (honesty * 30% + quality * 30% + loyalty * 20% + consistency * 20%)
multiplier = max(reputation * composite, 0.1)
```

New nodes start at 1.0x. Nodes with violations see their multiplier drop, reducing earnings.

### Work Reward Formula

```
reward = tokens_processed * cost_per_token * model_multiplier * uptime_bonus
```

Earned when the node serves inference, proxy, or training tasks. The `model_multiplier` scales with model size (larger models earn more per token).

## Pulse Verification

Pulse rounds prove your node is actually running compute, not just idling. Every ~90 seconds:

### 7-Step Protocol

1. **VRF Leader Election** — A leader is deterministically elected from the round seed + peer list using `SHA-256(seed) mod peer_count`. Every node computes the same leader.

2. **Seed Broadcast** — The leader broadcasts the round seed to the committee over GossipSub.

3. **Matrix Computation** — Each node generates two deterministic 256x256 float matrices from the seed and multiplies them (`C = A * B`). This takes real compute.

4. **Merkle Commitment** — Each node hashes all 256 rows of the result matrix and builds a Merkle tree. The root is the node's commitment.

5. **Random Index Challenge** — The leader picks 4 random row indices to challenge (derived deterministically from the seed).

6. **Proof Reveal** — Nodes send Merkle proofs for the 4 challenged rows (the row data + sibling hashes).

7. **Verification + Reward** — Proofs are verified against the Merkle root. Valid proofs create a `PendingProof` on-chain (no tokens minted yet).

8. **Cross-Validation** — 3 independent validator nodes must confirm the proof within a 120-second validation window. Validators must have reputation >= 2000.

9. **Finalize** — After the validation window, anyone can call `finalize_reward`. If >= 3 validators confirmed and the majority agreed, tokens are minted to the node's wallet.

### Why This Works

- The matrix computation is deterministic from the seed, so anyone can verify the result
- The Merkle tree means a node can't fake individual rows without recomputing the entire matrix
- 4 random row challenges make cheating probabilistically expensive
- The computation is lightweight enough to run every 90s on modest hardware (256x256 matmul)

## Staking

Staking is **manual** and **required after the maturation period**.

### Maturation Period

New nodes get a **14-day grace period** where they can earn rewards without staking. This lets you build up tokens before needing to stake. After 14 days, you must stake >= 100 tokens to keep earning.

### How It Works

1. **Register** — Your node registers on-chain via `register_node`, starting the 14-day maturation
2. **Earn during maturation** — Earn tokens from pulse rounds without staking (14 days)
3. **Stake** — Call `stakeTokens(nodeKeypair, mint, amount)` to lock >= 100 tokens into the stake vault PDA
4. **Earn** — Staked nodes continue earning pulse rewards
5. **Unstake** — Call `requestUnstake(nodeKeypair, amount)` to begin a 7-day cooldown (remaining stake must be >= 100 or fully unstaked)
6. **Withdraw** — After 7 days, call `withdrawUnstake(nodeKeypair, mint)` to get tokens back

### On-Chain Mechanics

| Action | Function | What Happens |
|--------|----------|-------------|
| Stake | `stakeTokens()` | Tokens transfer from your ATA to the `stake_vault` PDA |
| Request Unstake | `requestUnstake()` | Marks tokens as `pendingUnstake`, starts 7-day timer |
| Withdraw | `withdrawUnstake()` | After cooldown, tokens return to your ATA |

The stake vault is a PDA at seeds `["stake_vault"]` controlled by the program. No human can touch staked tokens — only the program logic.

### Why Stake?

- **Required to keep earning** — After the 14-day maturation, unstaked nodes stop receiving pulse rewards
- **Sybil resistance** — Spinning up 1000 fake nodes is expensive if each needs 100 tokens staked
- **Skin in the game** — Nodes that submit invalid proofs or get reported lose a percentage of their stake (slashing: 5% for invalid proofs, 50% for collusion, 100% for sybil)
- **Higher reputation** — Staked nodes build reputation faster, which increases the reputation reward multiplier (up to 1.0x)
- **Cross-validation eligibility** — Only nodes with reputation >= 2000 can validate peers, and reputation builds through consistent staked participation
- **Network trust** — The 7-day unstake cooldown prevents hit-and-run attacks (stake, cheat, withdraw immediately)

### Auto-Stake

To avoid having to manually stake, use the `--auto-stake` flag:

```bash
./start.sh --auto-stake
```

This checks your token balance every 5 minutes. When it reaches >= 100 tokens, your entire balance is automatically staked. The node logs staking activity:

```
[stake] Auto-stake enabled — will stake when balance >= 100 tokens
[stake] Balance: 142.3 tokens — auto-staking 142.3 tokens...
[stake] Staked successfully (tx: 4xK9m2...)
```

**Requirements for auto-stake:**
- `NODE_SOLANA_KEYPAIR` env var must point to your node's Solana keypair JSON
- `AGI_MINT_ADDRESS` env var must be set to the SPL token mint address

### How First Tokens Are Created

There is no pre-mine. The first node runners earn tokens from day one:

1. Node registers on-chain → starts 14-day maturation period
2. Every 90 seconds, the node runs a pulse round and earns ~10-15 base tokens
3. During early network (few nodes), proofs are self-verified locally since cross-validation requires 3 validators with reputation >= 2000
4. After 14 days (or ~9,600 rounds), the node has earned enough to stake the 100 token minimum
5. Once staked, the node continues earning and can participate in cross-validation

The optional genesis ceremony (`node rewards.js genesis`) can mint an initial treasury allocation (default 1M tokens), but this is separate from node rewards and entirely optional.

## On-Chain Program

The Solana program at `3gFo4GUwn3ayTgKKBAaMX8u9fZFdYXTyytPZShRfdVBp` handles all trustless operations.

### PDAs (Program Derived Addresses)

| PDA | Seeds | Purpose |
|-----|-------|---------|
| Program State | `["program_state"]` | Global config, round tracking |
| Mint Authority | `["mint_authority"]` | Controls SPL token minting |
| Stake Vault | `["stake_vault"]` | Holds all staked tokens |
| Node Account | `["node", owner_pubkey]` | Per-node state (one per wallet) |
| Validation Record | `["validation", validator, target, round]` | Cross-validation receipts |

### Instructions

| Instruction | Description |
|-------------|-------------|
| `register_node` | Register a new node with capability bitmask |
| `submit_pulse_proof` | Submit matmul proof for a round — triggers minting |
| `heartbeat` | Prove liveness between rounds |
| `stake` | Lock tokens into stake vault |
| `request_unstake` | Begin 7-day unstake cooldown |
| `withdraw_unstake` | Withdraw after cooldown expires |
| `validate_peer` | Cross-validate another node's proof |
| `report_violation` | Report cheating (invalid_proof, collusion, sybil) |
| `update_capabilities` | Update node's capability bitmask |

### Node Account Fields

Each registered node has on-chain state tracking:

| Field | Description |
|-------|-------------|
| `totalEarned` | Lifetime tokens earned |
| `totalRoundsParticipated` | Number of pulse rounds completed |
| `reputation` | Composite reputation score |
| `honestyScore` | Based on proof validity |
| `loyaltyScore` | Based on uptime consistency |
| `qualityScore` | Based on work quality |
| `consistencyScore` | Based on round participation streak |
| `isMatured` | Whether node passed maturation period |
| `isBanned` | Whether node is banned |
| `strikes` | Number of violations |
| `consecutiveFailures` | Failed proofs in a row |
| `stakeAmount` | Currently staked tokens |
| `pendingUnstake` | Tokens in unstake cooldown |
| `validationsPerformed` | Cross-validations done |
| `validProofsSubmitted` | Successful proof count |
| `invalidProofsSubmitted` | Failed proof count |

### Capability Bitmask

Capabilities are stored as a 16-bit integer on-chain:

| Bit | Capability |
|-----|------------|
| 0 | inference |
| 1 | research |
| 2 | proxy |
| 3 | storage |
| 4 | embedding |
| 5 | memory |
| 6 | orchestration |
| 7 | validation |
| 8 | relay |

Example: a node with inference + research + validation = `0b10000011` = `0x83` = `131`.

## Violations and Slashing

Nodes can report three types of violations, each with different slashing severity:

| Type | Code | Slash % | Description |
|------|------|---------|-------------|
| Invalid Proof | 0 | 5% of stake | Node submitted a proof that doesn't match the expected computation |
| Collusion | 1 | 50% of stake | Multiple nodes coordinating to fake proofs |
| Sybil | 2 | 100% of stake | One operator running many fake identities |

Reports include the evidence round number and a hash of the evidence. The on-chain program tracks strikes — **5 strikes = permanent ban**.

### Cooldown Escalation

After a failed proof, nodes enter a cooldown before they can submit again:

| Consecutive Failures | Cooldown |
|---------------------|----------|
| 1 | 5 minutes |
| 2 | 10 minutes |
| 3 | 20 minutes |
| 4 | 40 minutes |
| 5+ | Banned |

Formula: `5min * 2^(failures - 1)`, capped at 7 days.

## Cross-Validation

Nodes validate each other's proofs. When you validate a peer:

1. You independently compute the matmul for the round
2. You compare your Merkle root to the target's reported root
3. You submit a `validate_peer` transaction recording whether you agree or disagree
4. The on-chain program updates both nodes' validation counts and reputation

This creates a web of trust — honest nodes build reputation, dishonest ones accumulate strikes.

## Governance

Research projects and network changes go through a 3-stage process:

1. **Proposal** — Any node can propose a new project or change
2. **Council Review** (3 days) — A 7-seat expert council reviews; 4/7 must approve
3. **Community Vote** (7 days) — Network-wide vote; requires quorum (percentage of active nodes), 60% approval to pass

Council seats are domain-specific (ML, security, economics, etc.) and appointed by the network.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` | Solana RPC endpoint |
| `NODE_SOLANA_KEYPAIR` | `data/node-wallet.json` | Path to node's Solana keypair JSON (for on-chain rewards) |
| `AGI_MINT_ADDRESS` | `Dnw5R5Kn4WZZLkH62Ys48VsYeBR7PWz1dMb7QRfJKg47` | SPL token mint public key |
| `AGI_PROGRAM_ID` | `3gFo4GUwn3ayTgKKBAaMX8u9fZFdYXTyytPZShRfdVBp` | Solana program ID |
| `MINT_KEYPAIR` | `tokens/mint-authority.json` | Path to mint authority keypair |
| `TOKEN_DECIMALS` | `6` | Token decimal places |

`start.sh` sets these automatically. It looks for a wallet in this order:
1. `NODE_SOLANA_KEYPAIR` env var (if already set)
2. `data/node-wallet.json` (auto-generated on first run)

## Token Info

| Property | Value |
|----------|-------|
| Standard | SPL Token (Solana) |
| Decimals | 6 |
| Network | Devnet (default) |
| Max Supply | 1,000,000,000 |
| Genesis Supply | 1,000,000 (to treasury) |
| Min Stake | 100 tokens (after 14-day maturation) |
| Emission | ~228–1,912 tokens/day/node depending on hardware |
| Pulse Interval | 90 seconds |
| Mint Authority | PDA (trustless, no human control) |

## CLI Reference

```bash
# Initialize the mint (first time only)
node tokens/rewards.js init

# Check balance
node tokens/rewards.js balance --wallet <your-wallet>

# Mint tokens manually (requires authority)
node tokens/rewards.js mint --to <wallet> --amount 100

# Transfer authority to multisig (irreversible)
node tokens/rewards.js transfer-authority --to <multisig-address>

# Full genesis ceremony
node tokens/rewards.js genesis --multisig <addr> --allocation 1000000
```
