# AGI Rewards — Solana On-Chain Program

Trustless reward minting for the AGI agent network. Nodes register, stake AGIEX tokens as collateral, submit proof-of-compute, get cross-validated by peers, and receive minted tokens — all enforced on-chain with zero trust assumptions.

**Program ID:** `AH4DbYggwSiyX3TePMoo66k8P31Qn2a1gUH1PcHESKRo`

## What This Program Does

The program manages the full lifecycle of a compute node in the AGI network:

1. **Register** — A node registers on-chain, starting a 14-day maturation period.
2. **Stake** — The node locks at least 100 AGIEX tokens as collateral (slashable).
3. **Prove** — Every ~90 seconds the node submits a pulse proof (Merkle root + challenged rows from a 256×256 compute matrix). The program verifies the proof on-chain.
4. **Validate** — Three independent peer nodes must confirm the proof within a 2-minute window.
5. **Finalize** — Anyone can trigger minting once validators reach quorum. Tokens go to the node's registered wallet.
6. **Slash** — Invalid proofs, collusion, or Sybil attacks result in stake slashing, reputation loss, and eventual bans.

## Project Structure

```
program/
├── .devcontainer/          # VS Code Dev Container (Ubuntu 20.04 + Rust + Solana + Anchor)
│   ├── devcontainer.json
│   └── Dockerfile
├── Anchor.toml             # Anchor workspace config (program IDs, cluster, test script)
├── Cargo.toml              # Cargo workspace root
└── programs/
    └── agi-rewards/
        ├── Cargo.toml      # Crate manifest (anchor-lang 0.31.1, anchor-spl 0.31.1)
        └── src/
            ├── lib.rs          # Program entry — 11 instruction handlers
            ├── state.rs        # On-chain account structs (ProgramState, NodeAccount, PendingProof, ValidationRecord)
            ├── contexts.rs     # Anchor account validation contexts (PDA seeds, constraints)
            ├── constants.rs    # All tunable parameters (economics, timing, weights)
            ├── helpers.rs      # Pure functions: reward math, reputation, slashing, Merkle verification + unit tests
            └── errors.rs       # RewardError + SecurityError enums
```

## Prerequisites

You need **one** of:

- **VS Code + Dev Containers extension** (recommended) — everything is pre-configured
- **Manual install** — Rust, Solana CLI 1.18.26, Anchor 0.31.1

## Development with Dev Container

The included Dev Container gives you a ready-to-go environment based on Ubuntu 20.04 with Rust (stable), Solana CLI 1.18.26, Anchor 0.31.1, and Node.js 20.

### Setup

1. Install [Docker](https://docs.docker.com/get-docker/) and the [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) VS Code extension.

2. Open the `program/` folder in VS Code:
   ```bash
   code program/
   ```

3. When prompted "Reopen in Container", click yes. Or run the command palette (`Ctrl+Shift+P`) → **Dev Containers: Reopen in Container**.

4. Wait for the container to build (first time takes a few minutes). When it finishes you'll see version output in the terminal:
   ```
   solana-cli 1.18.26
   anchor-cli 0.31.1
   rustc 1.xx.x (stable)
   ```

You're ready to develop. The container includes rust-analyzer, clippy, CodeLLDB debugger, and format-on-save.

### Forwarded Ports

| Port | Service |
|------|---------|
| 8899 | Solana RPC (when running `solana-test-validator`) |
| 8900 | Solana WebSocket |

## Building

```bash
# Compile the BPF program
anchor build

# Or just check for errors without producing artifacts
cargo check
```

## Testing

The project uses Rust-native unit tests (`#[cfg(test)]`) to cover the core business logic — reward calculation, reputation scoring, slashing mechanics, and Merkle proof verification. These are pure functions that don't need a running Solana validator.

```bash
# Run all unit tests
cargo test

# Run with output (see test names)
cargo test -- --nocapture

# Run a specific test group
cargo test merkle
cargo test slash
cargo test reward
cargo test rep_multiplier
```

### What's Tested

| Area | Coverage |
|------|----------|
| Slashing | `slash_amount` at 5%, 50%, 100%; full `apply_proof_failure` flow (counters, rep, cooldown escalation, stake slash, ban) |
| Reputation | `update_honesty`, `update_loyalty`, `update_quality`, `update_consistency` — edge cases and scaling |
| Reward multiplier | Floor at 0.1x, perfect 1.0x, weighted composite verification |
| Reward calculation | Base reward, uptime scaling, capability bonus |
| Capabilities | No capabilities, single, all 9; weight correctness |
| Uptime bonus | Zero baseline, monotonic increase across full range |
| Merkle verification | 1-leaf, 2-leaf, 4-leaf trees; wrong root rejection; wrong index rejection |
| Constants | Token values, slash ordering, reputation bounds, matrix dimensions |

### Running Anchor Integration Tests

To run full integration tests against a local validator (requires TypeScript test files in `tests/`):

```bash
# Start local validator + deploy + run tests
anchor test

# Or manually:
solana-test-validator &
anchor deploy
# run your test framework of choice
```

## Deploying

```bash
# Deploy to the configured cluster (see Anchor.toml → [provider].cluster)
anchor deploy

# Deploy to a specific cluster
anchor deploy --provider.cluster devnet
```

The deployer wallet is configured in `Anchor.toml` at `~/.config/solana/deployer.json`. The Dev Container generates a throwaway keypair at `~/.config/solana/id.json` for local development — do **not** use it for mainnet deployments.

## AGIEX Token Mint Setup

The program does **not** create the AGIEX SPL token — it must exist on-chain before the program is initialized. The program acts as the **minting authority** via a PDA, meaning only the program can mint new tokens and no private key for the mint authority ever exists.

### How It Works

```
                          ┌──────────────────┐
 1. Create SPL mint ───►  │  AGIEX Token Mint │
    (mint authority =      │  (SPL Token)      │
     program PDA)          └────────┬─────────┘
                                    │
 2. initialize() ──────►  Program stores mint address
                          in ProgramState.mint
                                    │
 3. finalize_reward() ──► Program signs mint_to CPI
                          using mint_authority PDA
                                    ▼
                          Tokens arrive in node's wallet
```

### Step 1: Create the Token Mint

The mint must be created with the program's `mint_authority` PDA as the mint authority. Derive the PDA address first:

```bash
# Find the mint authority PDA (seeds = ["mint_authority"])
solana find-program-derived-address \
  AH4DbYggwSiyX3TePMoo66k8P31Qn2a1gUH1PcHESKRo \
  --bytes mint_authority
```

Then create the mint using the Solana CLI:

```bash
# Create AGIEX token with 6 decimals, PDA as mint authority
spl-token create-token \
  --decimals 6 \
  --mint-authority <MINT_AUTHORITY_PDA_ADDRESS>
```

Or use the parent project's CLI which automates this:

```bash
node tokens/rewards.js init
```

### Step 2: Initialize the Program

Call the `initialize` instruction, passing the mint account. The program records the mint address and the PDA bump in `ProgramState`:

```rust
// What happens inside initialize():
state.mint = ctx.accounts.mint.key();
state.authority_bump = ctx.bumps.mint_authority;
state.supply_cap = supply_cap; // or MAX_SUPPLY (1 billion tokens)
```

### Step 3: Minting (Automatic)

After this setup, the reward flow is fully autonomous:

1. Nodes submit proofs → program calculates reward
2. Validators confirm → program tracks quorum
3. Anyone calls `finalize_reward` → program mints tokens via CPI:

```rust
// PDA signs the mint_to instruction — no private key needed
let seeds = &[b"mint_authority".as_ref(), &[state.authority_bump]];
token::mint_to(ctx_with_pda_signer, reward_amount)?;
```

### Key Points

- **The mint is created once**, before the program is initialized. It cannot be changed after.
- **Only the program can mint** — the mint authority is a PDA with no corresponding private key.
- **Supply is capped** — `MAX_SUPPLY` (1 billion tokens) is checked on every proof submission and finalization. Once reached, no more tokens can be minted.
- **Decimals = 6** — all token amounts in the code use 6 decimal places (e.g., `10_000_000` = 10 tokens, `100_000_000` = 100 tokens).
- **Staking uses a separate vault** — staked tokens go to a `stake_vault` PDA token account, not the mint. Slashed tokens are subtracted from this vault balance.

## Key Concepts

### Security Layers

The program enforces 10 security layers entirely on-chain:

1. **PDA mint authority** — only the program can mint; no private key exists
2. **Maturation** — 14 days + 100 proofs before earning
3. **Stake bond** — 100 token minimum, slashable
4. **Reputation gate** — minimum 500 to earn, 2000 to validate
5. **Cross-validation** — 3 peers must confirm within 2 minutes
6. **Slashing** — 5% (bad proof), 50% (collusion), 100% (Sybil)
7. **Cooldown escalation** — exponential lockout on repeated failures
8. **Round ordering** — monotonic round numbers prevent replay
9. **Supply cap** — 1 billion tokens, checked at submit and finalize
10. **Self-validation forbidden** — nodes cannot attest their own proofs

### Reward Formula

```
final_reward = BASE_REWARD × uptime_bonus × capability_bonus × reputation_multiplier
```

- **BASE_REWARD** = 10 tokens (6 decimals)
- **uptime_bonus** = piecewise log curve, capped
- **capability_bonus** = sum of per-capability weights (inference, research, proxy, etc.)
- **reputation_multiplier** = weighted composite of honesty (30%), quality (30%), loyalty (20%), consistency (20%); floor 0.1x

### Account Layout

| Account | PDA Seeds | Purpose |
|---------|-----------|---------|
| `ProgramState` | `["program_state"]` | Global singleton: mint, supply, round counter |
| `NodeAccount` | `["node", owner]` | Per-node: identity, reputation, staking, security |
| `PendingProof` | `["pending_proof", node_account, round]` | Per-proof: awaiting cross-validation |
| `ValidationRecord` | `["validation", validator, target, round]` | Prevents duplicate validations |

## License

See repository root for license information.
