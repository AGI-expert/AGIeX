# AGI Expert

**Distributed & Autonomous Intelligence Network**

```
     ╔═══════════════════════════════════════════════════════════════╗
     ║                                                               ║
     ║            █████╗  ██████╗ ██╗███████╗██╗  ██╗                ║
     ║           ██╔══██╗██╔════╝ ██║██╔════╝╚██╗██╔╝                ║
     ║           ███████║██║  ███╗██║█████╗   ╚███╔╝                 ║
     ║           ██╔══██║██║   ██║██║██╔══╝   ██╔██╗                 ║
     ║           ██║  ██║╚██████╔╝██║███████╗██╔╝ ██╗                ║
     ║           ╚═╝  ╚═╝ ╚═════╝ ╚═╝╚══════╝╚═╝  ╚═╝                ║
     ║                                                               ║
     ║       Peer-to-Peer AGI  ·  Trustless  ·  One Command          ║
     ╚═══════════════════════════════════════════════════════════════╝
```

AGI won't come from one company behind closed doors. It will emerge from a network.

**AGI Expert** is a decentralized compute network where anyone — from a laptop owner to a data center operator — contributes GPU power to a collective AI research effort. Nodes autonomously run experiments, share breakthroughs with each other in real time, and build on each other's best results. The more peers join, the faster the network learns.

The network is backed by **Solana**. Every contribution is cryptographically verified on-chain, and in return participants earn **AGIEX** — an SPL token minted directly by an immutable Solana program. No pre-mine, no team allocation, no middlemen. Just proven compute in, tokens out.

**One command to join. Zero infrastructure to manage. Fully autonomous from day one.**

---

### Index

- **[1. Project Overview](#1-project-overview)** — General information about the project
  - [What is AGI Expert?](#what-is-agi-expert) — The vision, the network, and why it matters
  - [Quick Start](#quick-start) — Install and launch a node in one command
  - [AGIEX Token](#agiex-token) — Token parameters, reward formula, daily earnings
  - [Prerequisites](#prerequisites) — Runtime and driver requirements
- **[2. Network Concept](#2-network-concept)** — How the peer-to-peer network operates
  - [Collective Intelligence](#collective-intelligence--how-nodes-learn-together) — How nodes learn together and why it works
  - [How It Works](#how-it-works) — High-level overview of the P2P network
  - [Pulse Verification](#pulse-verification) — 7-step commit-reveal proof-of-compute protocol
  - [Reputation System](#reputation-system) — Four on-chain scores that scale your rewards
  - [Governance](#governance) — Council, proposals, and community voting
- **[3. Research Projects](#3-research-projects)** — What they are, how they work, and how to add new ones
  - [What is a Research Project?](#what-is-a-research-project) — The concept behind long-running optimization domains
  - [The 5-Stage Research Pipeline](#the-5-stage-research-pipeline) — Hypothesis, experiment, paper, critique, discovery
  - [Active Research Domains](#active-research-domains) — The 9 domains the network currently works on
  - [Anatomy of a Project](#anatomy-of-a-project) — Directory structure, baseline config, and a real example
  - [Mutation Strategies](#mutation-strategies) — 25+ structured ways nodes explore hyperparameter space
  - [Example: A Complete Experiment Cycle](#example-a-complete-experiment-cycle) — Step-by-step walkthrough
  - [Adding a New Research Domain](#adding-a-new-research-domain) — How to propose and configure a new project
- **[4. Architecture](#4-architecture)** — Technical details and system internals
  - [Source Tree & Subsystems](#source-tree--subsystems) — Module map and service overview
  - [Hardware Auto-Detection](#hardware-auto-detection) — Capability thresholds and model selection
  - [Security](#security) — 10 on-chain security layers and slashing rules
- **[5. Appendix](#5-appendix)** — API reference, docs, and project info
  - [API](#api) — OpenAI-compatible HTTP endpoints
  - [Documentation](#documentation) — Links to whitepaper, genesis, and guides
  - [Credits](#credits) — Inspiration and acknowledgements
  - [License](#license) — MIT
- **[6. For Developers & Contributors](#6-for-developers--contributors)** — Dev containers, testing, and local setup
  - [Prerequisites](#prerequisites-1) — Docker and Dev Containers extension
  - [JavaScript / Node.js Development](#javascript--nodejs-development) — Container setup, running tests, test coverage
  - [Solana / Anchor Development](#solana--anchor-development) — On-chain program build and test

---

# 1. Project Overview

### What is AGI Expert?

Today's AI breakthroughs happen inside walled gardens — massive GPU clusters owned by a handful of corporations. The rest of the world's compute sits idle. AGI Expert changes that.

The network connects thousands of independent machines — laptops, desktops, servers, even browsers — into a single decentralized research swarm. Each node runs real ML experiments across 9 research domains, shares its best results with every other peer, and builds on discoveries made elsewhere in the network. There is no central coordinator. Intelligence emerges organically as nodes cross-pollinate winning configurations through gossip protocols and conflict-free replicated leaderboards.

Every 90 seconds, each node proves it performed genuine computation. That proof is verified on-chain by an immutable Solana program, which mints **AGIEX** tokens directly to the node's wallet. The token has no pre-mine, no team allocation, and no human mint authority — only math and code decide who earns what.

The result: an open, permissionless AI research network that gets smarter with every peer that joins, and rewards every participant fairly for the compute they contribute.

**Run a node. Contribute to the next generation of AI. Earn AGIEX.**

### Quick Start

Get a node running in under a minute. A single command detects your hardware, installs dependencies, and connects you to the network.

```bash
curl -sL agi.expert/install | sh
```

Or clone manually:

```bash
git clone git@github.com:AGI-expert/AGIeX.git && cd AGIeX && ./start.sh
```

The launcher will:

1. Scan your hardware (GPU, CPU, RAM, disk, public IP)
2. Auto-enable every capability your machine can handle
3. Generate `node-config.json` (your node's identity, capabilities, and network settings)
4. Install all dependencies (libp2p, Solana, llama.cpp, etc.)
5. Set up your node wallet and connect to the AGIEX token mint
6. Launch the node — P2P, inference API, research pipeline, pulse verification

### AGIEX Token

AGIEX is the token node runners earn for contributing compute to the network. Every ~90 seconds, your node performs a small math challenge to prove it is genuinely running — not idling, not faking work. If the proof checks out, the Solana program mints tokens directly to your wallet. No human approves it, no company distributes it. This mechanism is called a **pulse proof**.

| Parameter | Value |
|---|---|
| **Token** | AGIEX |
| **Blockchain** | Solana (SPL Token) |
| **Max Supply** | 1,000,000,000 |
| **Decimals** | 6 |
| **Base Reward** | 10 AGIEX / pulse round (~90s) |
| **Mint Authority** | PDA (no private key exists) |
| **Upgrade Authority** | None (deployed `--final`) |
| **Pre-mine** | None |
| **Team Allocation** | None |

The AGIEX token mint was created once during the genesis ceremony, with its mint authority permanently assigned to a Program Derived Address (PDA) controlled by the on-chain program. No private key for this authority exists — only the program can mint new tokens, and only in response to a verified and cross-validated pulse proof. The Solana program itself is deployed immutable (`--final`), so this cannot be changed after the fact.

**Reward formula:**

```
reward = 10 × (1 + 0.2 × ln(1 + uptimeHours / 12)) × (1 + Σ capability_weights) × reputation_multiplier
```

**Daily earnings by hardware:**

| Setup | Capabilities | AGIEX / Day |
|---|---|---|
| Browser, 2 h/day | 2–3 | ~19 |
| Browser, 24 h | 3–4 | ~228 |
| Desktop, 8 GB GPU | 5–7 | ~503 |
| Server, 80 GB GPU | 8–9 | ~1,912 |

```bash
# Check balance
cd tokens && node rewards.js balance --wallet <solana-wallet>

# Use mainnet
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com ./start.sh
```

### Prerequisites

- **Node.js >= 18**
- **GPU drivers** (optional) — CUDA, ROCm, or Metal for inference/research
- **GGUF model** (optional) — place in `models/` for local inference

---

# 2. Network Concept

### Collective Intelligence — How Nodes Learn Together

Think of each node as an independent researcher in a massive global lab. Every node picks up a research task — say, training a small language model — and tries a slightly different approach: a different learning rate, a different model size, a different data mix. After each experiment, the node measures how well it worked and announces the result to the entire network.

Here is where it gets powerful. When a node hears that a peer somewhere in the world just found a configuration that scores higher than anything seen before, it doesn't ignore it. There is a 30% chance it will borrow a piece of that winning recipe and fold it into its own next experiment. Good ideas spread. Bad ones die off. The network converges on better solutions faster than any individual node could on its own — the same way a team of scientists outperforms a single researcher working in isolation.

All results are tracked on a shared, conflict-free leaderboard that every node can read and write to simultaneously. No central server decides the ranking — the data structure itself guarantees that all nodes eventually agree on the same scoreboard, even if messages arrive out of order or the network temporarily splits.

```
  Node A finds a good config
       │
       ├──► Broadcasts result to the swarm via gossip
       │
       ├──► Result lands on the shared leaderboard
       │
       └──► Node B, C, D receive it
              │
              └──► 30% chance: borrow a setting for their next experiment
                   70% chance: keep mutating independently
                         │
                         └──► Over hundreds of rounds, the best ideas
                              propagate and compound across the network
```

This cycle — experiment, share, learn, repeat — runs continuously across all nodes, 24/7. The more peers join, the more experiments run in parallel, and the faster the network discovers breakthroughs.

### How It Works

Every peer runs a node. Every node detects its hardware and takes on a role. Nodes communicate directly over libp2p to share work, exchange knowledge, and coordinate tasks — no central server.

```
                      P2P AGI Network

  +----------+       GossipSub        +----------+
  |  Node A  |<---------------------->|  Node B  |
  |  Laptop  |      (mDNS + DHT)      |  Server  |
  |  4GB GPU |                         | 80GB GPU |
  +----+-----+                         +----+-----+
       |                                    |
       |           +----------+             |
       +---------->|  Node C  |<------------+
                   |  Browser |
                   |  (relay) |
                   +----+-----+
                        |
                        v
                   +----------+
                   |  Node D  |   Every ~90s each node:
                   |  Desktop |   1. Proves compute (matmul)
                   |  8GB GPU |   2. Cross-validates peers
                   +----------+   3. Earns AGIEX on Solana
```

Intelligence grows from the combined contribution of all peers. Rewards are distributed automatically as Solana SPL tokens based on compute power and uptime.

### Pulse Verification

Every ~90 seconds, nodes prove genuine computation through a 7-step commit-reveal protocol:

```
  Node                         P2P Network                  Solana Program
  ────                         ───────────                  ──────────────

  1. VRF leader elected
     (SHA-256 of seed mod N)
                                2. Leader broadcasts
                                   round seed via GossipSub
  3. Compute 256×256 matmul
     from seeded PRNG
  4. Build Merkle tree
     (SHA-256 per row → root)
                                5. Leader picks 4 random
                                   row indices to challenge
  6. Reveal Merkle proofs
     for challenged rows
                                7. Cross-validation:
                                   3 independent validators
                                   verify proof
                                                             8.  Ban check
                                                             9.  Cooldown check
                                                             10. Maturation check
                                                             11. Stake bond check
                                                             12. Reputation gate
                                                             13. Round uniqueness
                                                             14. Timing check (>= 80s)
                                                             15. Merkle proof verify
                                                             16. Calculate reward × rep
                                                             17. Supply cap check
                                                             18. Mint AGIEX ──► Wallet
```

The matrix computation is deterministic from the seed so anyone can verify the result. The Merkle tree means a node cannot fake individual rows without recomputing the entire matrix. 4 random row challenges make cheating probabilistically expensive.

### Reputation System

Four on-chain scores determine your reward multiplier (0.1x – 1.0x):

| Score | Weight | How it works |
|---|---|---|
| Honesty | 30% | Valid proofs / total proofs |
| Quality | 30% | Recent success rate (last 100 proofs) |
| Loyalty | 20% | Linear ramp over 30 days |
| Consistency | 20% | Penalized for consecutive missed rounds |

Minimum reputation to earn: **500 / 10,000**. Minimum to validate peers: **2,000**.

### Governance

Research direction is governed by a 7-seat multidisciplinary council and community voting.

| Seat | Evaluates |
|---|---|
| AI/ML Researcher | Technical feasibility, architecture, benchmarks |
| Systems Engineer | Scalability, resource requirements, P2P impact |
| Ethicist / Philosopher | Safety, alignment, societal impact, dual-use |
| Legal Counsel | Data licensing, IP, regulatory compliance |
| Domain Scientist | Methodology, reproducibility, statistical validity |
| Community Advocate | Accessibility, hardware requirements, practical value |
| Security Auditor | Attack surfaces, game theory, adversarial scenarios |

**Proposal flow:**

```
DRAFT ──► REVIEW (3 days, 4/7 council) ──► VOTING (7 days, 66%, 10% quorum) ──► ACTIVE ──► SUNSET
```

**Voting power:** `sqrt(reputation)` — reduces plutocratic effects. Council members serve 90-day terms.

---

# 3. Research Projects

### What is a Research Project?

A research project is not a one-off question or a task you submit to the network. It is a **long-running optimization problem**. Every project starts from a general-purpose artifact — an untrained AI model, a basic search engine, a simple trading strategy — and the network's job is to make it better. Nodes continuously experiment with different configurations, measure the results against a defined metric, and share improvements with the swarm. A metric is simply a number that tells you how good a result is — for example, how accurately a model predicts the next word in a sentence, how relevant the top 10 search results are for a given query, or how much return a trading strategy generates relative to its risk. **The end goal is a production-ready artifact that can be directly deployed in real-world applications.** For example, the network is currently fine-tuning a coding AI that outperforms its baseline on industry benchmarks, evolving a search ranking algorithm that surfaces more relevant results, and backtesting financial strategies to maximize risk-adjusted returns on the S&P 500.

Think of it like a global R&D lab where every participant starts from a shared blueprint, makes a small deliberate change, tests the outcome, and publishes the result if it improves on the state of the art. Across thousands of nodes running in parallel, the network systematically explores millions of possible configurations that no single team could cover — all discovered collectively without any human hand-tuning.

Every node on the network works on all active projects simultaneously. The Agent Brain cycles through them, running one experiment at a time. Each experiment tweaks the configuration slightly (a mutation), measures the outcome, and compares it to the best known result. If it's better, the new configuration replaces the old one and gets broadcast to the entire network.

No one tells the network "solve this problem right now." Instead, research projects define *what to optimize*, and the swarm figures out *how* — autonomously, 24/7, across every participating node.

**A key benefit of participating:** every node has real-time access to the best-known configurations discovered across the entire network. The CRDT leaderboards sync continuously, so as soon as any peer anywhere in the world finds a better config, your node sees it within seconds. You don't just contribute compute — you get access to the collective research output of the entire swarm. Note that only configurations and results are shared, not trained model weights. To reproduce a top result, your node runs the winning config locally — keeping bandwidth low and avoiding trust issues with binary data.

The network currently ships with 9 active research domains, but this list is designed to grow. Anyone can propose a new domain through the governance process or by opening a pull request — once accepted, every node on the network picks it up automatically.

### The 5-Stage Research Pipeline

Every experiment follows the same pipeline, regardless of the domain:

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  Stage 1: Hypothesis                                     │
│  Mutate the best-known config (or borrow from a peer)    │
│                     │                                    │
│                     v                                    │
│  Stage 2: Experiment                                     │
│  Run the training or evaluation with the new config      │
│                     │                                    │
│                     v                                    │
│  Stage 3: Paper                                          │
│  Every 10 runs, synthesize findings into a report        │
│                     │                                    │
│                     v                                    │
│  Stage 4: Critique                                       │
│  Score peer papers (1-10)                                │
│                     │                                    │
│                     v                                    │
│  Stage 5: Discovery                                      │
│  Papers scoring 8+ feed back as inspiration              │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

In **Stage 1**, the pipeline picks a random mutation strategy and applies it to the current best config. There is a 30% chance it will instead borrow a setting from a high-scoring peer's config (inspiration). In **Stage 2**, the experiment runs — either on real GPU hardware or in simulation. The result is measured against the project's metric and saved to disk. If it beats the node's personal best, it gets broadcast to the swarm and submitted to the shared CRDT leaderboard.

### Active Research Domains

| Project | Starting Artifact | Goal | Metric |
|---|---|---|---|
| `gpt2-tinystories` | Untrained 2-layer GPT-2 | Build a small language model that generates coherent short stories by optimizing architecture, optimizer, and training hyperparameters | val_loss (lower = better) |
| `astrophysics` | Untrained 2-layer LM | Train a language model specialized in scientific text from astrophysics paper abstracts — exploring whether scientific language benefits from different architectures than narrative text | val_loss (lower = better) |
| `search-engine` | Basic BM25 ranking algorithm | Evolve a high-quality search engine by tuning field boosting weights, query expansion, synonym injection, and semantic re-ranking strategies | NDCG@10 (higher = better) |
| `financial-analysis` | Simple moving-average crossover strategy | Discover profitable, risk-adjusted trading strategies by exploring momentum signals, position sizing, multi-factor combinations, and regime detection | Sharpe ratio (higher = better) |
| `agentic-coding` | Pre-trained Qwen 3.5 Coder 7B | Fine-tune a state-of-the-art coding AI using LoRA across industry benchmarks (HumanEval, MBPP, ML-Bench, DS-1000, ClassEval) to maximize code generation quality | composite_score (higher = better) |
| `general-intelligence` | Pre-trained LLM | Train LLMs toward AGI-level reasoning across 8 diverse benchmarks (ARC-AGI 2, GPQA, MATH-500, HumanEval+, MMLU-Pro, BBH, DROP, HellaSwag) — ARC-AGI 2 weighted highest as the closest proxy for general intelligence | composite_score (higher = better) |
| `skills-and-tools` | Seed tool-use patterns | Evolve reusable WASM-based skills that AI agents can chain together — optimizing for correctness, utility, and composability | score (higher = better) |
| `academic-papers` | Basic extraction pipeline | Build an AI system that reliably extracts entities, relationships, and claims from scientific papers — useful for automated literature review and knowledge graph construction | F1 (higher = better) |
| `p2p-network` | Network cause definitions | Optimize the AGI Expert network itself — tuning infrastructure parameters, data curation pipelines, and cross-node scheduling for better collective performance | cause score (higher = better) |

### Anatomy of a Project

Every project lives in `projects/<name>/` and follows the same structure:

```
projects/gpt2-tinystories/
├── README.md                  # Objective, benchmarks, what to explore
├── LEADERBOARD.md             # Auto-updated every 6 hours
└── baseline/
    ├── config.yaml            # Starting configuration (what nodes mutate from)
    └── results.json           # Baseline metric values
```

The **baseline config** (`baseline/config.yaml`) defines the starting point — architecture choices, optimizer settings, training parameters, and data sources. Every node starts from here and mutates parameters, trying to improve on the baseline metric. See any project in `projects/` for a real example.

### Mutation Strategies

A mutation strategy is a single, targeted change to one parameter of the current best configuration — for example, doubling the number of layers, switching the activation function, or adjusting the learning rate. Instead of changing everything at once, each experiment isolates one variable so the network can learn which changes actually improve the result and which don't.

The pipeline ships with 25+ mutation strategies organized by category:

| Category | Mutations | Example |
|---|---|---|
| **Architecture** | depth, model_width, normalization, position_encoding, activation, tied_embeddings, init_scheme | Switch from LayerNorm to RMSNorm |
| **Optimizer** | learning_rate, weight_decay, gradient_clip | Multiply LR by 2.5x |
| **Training** | batch_size, context_length, extended_training, epochs, gradient_accumulation | Double context length to 256 |
| **Fine-tuning** | lora_rank, lora_alpha, lora_dropout, lora_targets, finetuning_method | Switch from LoRA to DoRA |
| **Data** | coding_data_mix, max_seq_length | Add `ml-scripts-curated` to training data |
| **Evaluation** | generation_temperature, benchmark_weights | Shift coding weight from 60% to 70% |
| **Domain-specific** | title_boost, fast_period, slow_period | Increase title boost for search ranking |

Each mutation picks from a predefined set of sensible values — it's not random noise, it's structured exploration within boundaries that make scientific sense.

### Example: A Complete Experiment Cycle

Here is what happens inside a single node during one research cycle for `gpt2-tinystories`:

1. **Brain picks the project** — The Agent Brain's tick selects `gpt2-tinystories` as the next project to work on
2. **Hypothesis** — The pipeline loads the current best config (or baseline if it's the first run) and applies the `depth` mutation, changing `nLayers` from 2 to 6
3. **Experiment** — The node trains the model with the new config and measures `val_loss = 2.91`
4. **Comparison** — The previous best was 3.12, so this is a new personal best
5. **Persist** — The result is saved to `projects/gpt2-tinystories/agents/<peerId>/best.json`
6. **Broadcast** — The result is published to the `agi/research/rounds` GossipSub topic
7. **Leaderboard** — The local CRDT leaderboard is updated; all peers see the new top score within ~50 seconds
8. **Inspiration** — Other nodes receive this result and may borrow the `nLayers: 6` setting in their next experiment

Multiply this by hundreds of nodes running 24/7, and the network rapidly converges on configurations that no single researcher would find manually.

### Adding a New Research Domain

Anyone can propose a new research domain. The process is:

1. Copy the template: `cp -r projects/_template projects/my-domain`
2. Write a `README.md` describing the objective, benchmarks, and what to explore
3. Define a baseline `config.yaml` that trains in under 5 minutes on a single GPU
4. Record baseline results in `results.json`
5. Register the project in `src/brain/agent.js` (add to `RESEARCH_PROJECTS` array) and `src/research/pipeline.js` (add metric, mutations, and simulation)
6. Submit through governance (council review + community vote) or open a PR

Once merged, every node on the network will automatically pick up the new domain and begin running experiments — no restarts, no manual configuration.

See [`docs/adding-a-research-domain.md`](docs/adding-a-research-domain.md) for the full step-by-step guide.

---

# 4. Architecture

### Source Tree & Subsystems

```
start.sh
  └── src/main.js                    ← Orchestrates all subsystems
       ├── src/identity.js           ← Ed25519 keypair + peer ID
       ├── src/p2p/node.js           ← libp2p + GossipSub networking
       ├── src/inference/server.js   ← OpenAI-compatible /v1/* API
       ├── src/crdt/leaderboard.js   ← Yjs CRDT leaderboards (7 domains)
       ├── src/pulse/verification.js ← 7-step commit-reveal protocol
       ├── src/research/pipeline.js  ← 5-stage research loop (9 projects)
       ├── src/governance/council.js ← Research governance (proposals, voting, council)
       ├── src/capabilities/index.js ← 9 auto-detected services
       ├── src/brain/agent.js        ← Autonomous decision loop
       └── tokens/rewards.js         ← AGIEX token minting
```

| Subsystem | What it does | Port | Details |
|---|---|---|---|
| **P2P Network** | libp2p node with GossipSub, mDNS, Kademlia DHT, circuit relay | TCP 4001, WS 4002 | — |
| **Inference API** | OpenAI-compatible `/v1/chat/completions`, `/v1/models`, `/v1/embeddings` | HTTP 8080 | [API](#api) |
| **Pulse Verification** | VRF leader election, matmul challenge, Merkle proofs every ~90s | — | [Pulse Verification](#pulse-verification) |
| **Research Pipeline** | Autonomous hypothesis → experiment → paper → critique loop | — | [Research Projects](#research-projects) |
| **CRDT Leaderboards** | 7 Yjs documents synced over GossipSub (research, search, finance, coding, skills, causes, agi) | — | — |
| **Agent Brain** | Round-robins through 9 research projects, gossips results to peers | — | [Research Projects](#research-projects) |
| **Governance** | Proposal submission, council review, community voting | — | [Governance](#governance) |
| **AGIEX Rewards** | Mints tokens per pulse round based on uptime + capabilities + reputation | — | [AGIEX Token](#agiex-token) |
| **Status API** | `GET /status`, `GET /snapshot`, `GET /leaderboard/:domain` | HTTP 8080 | [API](#api) |

### Hardware Auto-Detection

Your hardware is scanned at startup. Capabilities are enabled automatically:

| Capability | Auto-enabled when | Reward Weight |
|---|---|---|
| **Inference** | GPU with >= 4 GB VRAM | +10% |
| **Research** | GPU >= 6 GB, or CPU >= 4 cores + 8 GB RAM | +12% |
| **Proxy** | Public IP detected | +8% |
| **Storage** | >= 50 GB free disk | +6% |
| **Embedding** | CPU >= 2 cores + 4 GB RAM | +5% |
| **Memory** | >= 8 GB RAM + 20 GB free disk | +5% |
| **Orchestration** | CPU >= 4 cores + 8 GB RAM | +5% |
| **Validation** | CPU >= 2 cores | +4% |
| **Relay** | Public IP detected | +3% |

**Model auto-selection based on VRAM:**

| VRAM | Model |
|---|---|
| >= 80 GB | qwen2.5-coder-32b |
| >= 48 GB | gemma-3-27b |
| >= 24 GB | gpt-oss-20b |
| >= 16 GB | gemma-3-12b |
| >= 12 GB | glm-4-9b |
| >= 8 GB | gemma-3-4b |
| >= 4 GB | gemma-3-1b |
| < 4 GB | Proxy mode (no local inference) |

### Security

10 on-chain security layers protect every proof submission:

| # | Layer | What it checks | On failure |
|---|---|---|---|
| 1 | Ban check | `is_banned == false` | Permanent rejection |
| 2 | Cooldown | `now >= cooldown_until` | Wait for expiry |
| 3 | Maturation | 14 days + 100 valid proofs | No rewards until matured |
| 4 | Stake bond | `stake >= 100 tokens` | Must stake before earning |
| 5 | Reputation gate | `reputation >= 500` | Must rebuild reputation |
| 6 | Round uniqueness | `round > last_claim_round` | `RoundAlreadyClaimed` |
| 7 | Timing | `elapsed >= 80 seconds` | `ClaimTooFrequent` |
| 8 | Merkle proof | 4 challenged rows verified | Slash 5% + cooldown escalation |
| 9 | Reputation scaling | `reward × reputation_multiplier` | Lower rep = lower earnings |
| 10 | Supply cap | `total_minted + reward <= 1B` | `SupplyCapReached` |

**Slashing schedule:**

| Violation | Penalty |
|---|---|
| Invalid proof | 5% of stake + 1 strike + cooldown escalation |
| Collusion | 50% of stake |
| Sybil attack | 100% of stake + permanent ban |
| 5 strikes | Permanent ban |

**Cooldown escalation:** `300 × 2^(failures − 1)` seconds. First failure = 5 min, doubles each time, max 7 days.

---

# 5. Appendix

### API

The node exposes an OpenAI-compatible HTTP API on port 8080.

```bash
# Chat completion
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello"}]}'

# List models
curl http://localhost:8080/v1/models

# Embeddings
curl http://localhost:8080/v1/embeddings \
  -d '{"input":"some text"}'

# Node status
curl http://localhost:8080/status

# Leaderboard
curl http://localhost:8080/leaderboard/coding

# Governance
curl http://localhost:8080/governance
```

### Documentation

| Document | Description |
|---|---|
| [`docs/AGIEX_Whitepaper_v1.0.pdf`](docs/AGIEX_Whitepaper_v1.0.pdf) | Full technical whitepaper with formulas, emission curves, and program details |
| [`docs/GENESIS.md`](docs/GENESIS.md) | Trustless launch ceremony — Solana program deployment and token creation |
| [`docs/NODE_REWARDS.md`](docs/NODE_REWARDS.md) | Detailed node requirements, staking, reward mechanics, and CLI reference |
| [`docs/aggregated-intelligence.md`](docs/aggregated-intelligence.md) | How the network collaborates on research topics |
| [`docs/adding-a-research-domain.md`](docs/adding-a-research-domain.md) | Guide for adding new research projects to the network |

---

# 6. For Developers & Contributors

The project ships two Dev Containers — one for JavaScript/Node.js work and one for Rust/Solana work. Each is self-contained; pick whichever matches the area you're working on.

| Dev Container | Location | Stack | Use For |
|---|---|---|---|
| **AGI Expert — Node.js** | `.devcontainer/` (repo root) | Ubuntu 22.04, Node.js 22, npm, Vitest | Node runtime, P2P, research pipeline, tests |
| **AGI Rewards — Anchor/Solana** | `program/.devcontainer/` | Ubuntu 20.04, Rust, Solana CLI 1.18.26, Anchor 0.31.1 | On-chain program, `cargo test` |

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/)
- [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) VS Code extension

### JavaScript / Node.js Development

1. Open the repo root in VS Code:
   ```bash
   code .
   ```

2. VS Code detects both Dev Containers. Pick **"AGI Expert — Node.js"**, or use the command palette (`Ctrl+Shift+P`) → **Dev Containers: Reopen in Container**.

3. Wait for the build (first time takes a few minutes). When it finishes, the terminal shows:
   ```
   v22.x.x
   10.x.x
   vitest/4.x.x
   ```

4. Run tests:
   ```bash
   # All tests
   npm test

   # Single test file
   npx vitest run tests/identity.test.js

   # Watch mode (re-runs on file changes)
   npm run test:watch

   # Verbose output
   npx vitest run --reporter=verbose

   # Filter by test name
   npx vitest run -t "Merkle"
   ```

The container forwards port **8080** so you can start the node (`node src/main.js`) and hit the API from your host browser.

#### What's Tested

Tests live in `tests/` as `*.test.js` files. Coverage spans all 10 source modules:

| Module | Test File | Key Areas |
|---|---|---|
| `identity.js` | `identity.test.js` | Key generation, persistence, Ed25519 sign/verify |
| `pulse/verification.js` | `pulse-verification.test.js` | Round seeds, leader election, matmul, Merkle tree, PulseRunner |
| `crdt/leaderboard.js` | `leaderboard.test.js` | All 7 domains, CRDT sync, snapshot |
| `p2p/security.js` | `security.test.js` | Rate limiting, anomaly detection, sybil detection, peer scoring |
| `p2p/node.js` | `p2p-node.test.js` | TOPICS constant, module exports |
| `brain/agent.js` | `brain.test.js` | Action picking, gossip routing, tick execution |
| `research/pipeline.js` | `pipeline.test.js` | 9 project configs, hypothesis, experiment, persistence |
| `inference/server.js` | `inference-server.test.js` | HTTP endpoints, 400/503 paths |
| `governance/council.js` | `governance.test.js` | Proposal lifecycle, council review, voting, persistence |
| `capabilities/index.js` | `capabilities.test.js` | Capability weights, hw-profile gating, start/stop |

### Solana / Anchor Development

For on-chain program work, use the **program/** Dev Container instead:

```bash
code program/
# → Reopen in Container when prompted
```

See [`program/README.md`](program/README.md) for full setup, building (`anchor build`), and testing (`cargo test`) instructions.

---

### Credits

Inspired by [Hyperspace](https://github.com/hyperspaceai). AGI Expert builds on the vision of decentralized AI infrastructure and extends it into a fully open, trustless, and autonomous research network.

### License

MIT
