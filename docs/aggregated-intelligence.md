# AGI.expert — Aggregated Intelligence Architecture

## Overview

The AGI.expert network is a decentralized swarm of autonomous research nodes.
Each node independently runs ML experiments, benchmarks, and evaluations across
8 research domains. Intelligence is aggregated across the network through three
mechanisms: gossip broadcast, CRDT leaderboards, and inspiration feedback.

There is no central brain — the "collective intelligence" emerges from nodes
sharing high-scoring configurations and incorporating each other's discoveries.

---

## The Three-Layer Aggregation System

### Layer 1: Gossip Broadcast (Experiment Results)

When a node completes a research run, it publishes the result to a
domain-specific GossipSub topic:

| Topic                    | Domains                            |
|--------------------------|------------------------------------|
| `agi/research/rounds`    | gpt2-tinystories, astrophysics     |
| `agi/search/experiments` | search-engine                      |
| `agi/finance/experiments`| financial-analysis                 |
| `agi/coding/experiments` | agentic-coding                     |
| `agi/cause/skills`       | skills-and-tools                   |
| `agi/cause/inspiration`  | academic-papers, p2p-network       |
| `agi/leaderboard/sync`   | CRDT state vectors (all domains)   |
| `agi/pulse`              | Consensus verification proofs      |

Each broadcast message contains:

```json
{
  "type": "experiment_result",
  "project": "agentic-coding",
  "peerId": "12D3KooW...",
  "result": { "compositeScore": 0.7076, ... },
  "config": { "finetuning": { "loraRank": 64, ... } },
  "hypothesis": "Apply tied_embeddings mutation",
  "isNewBest": true,
  "metricValue": 0.7076,
  "timestamp": 1711036800000
}
```

**Source:** `src/brain/agent.js:121-143`

### Layer 2: CRDT Leaderboards (Conflict-Free Ranking)

Each node maintains 6 Yjs CRDT documents — one per domain:

| Domain     | Metric         | Direction       | Label     |
|------------|----------------|-----------------|-----------|
| `research` | `valLoss`      | ascending (↓)   | Val Loss  |
| `search`   | `ndcg10`       | descending (↑)  | NDCG@10   |
| `finance`  | `sharpeRatio`  | descending (↑)  | Sharpe    |
| `coding`   | `compositeScore`| descending (↑) | Composite |
| `skills`   | `score`        | descending (↑)  | Score     |
| `causes`   | `bestResult`   | descending (↑)  | Score     |

When a result arrives (local or via gossip), it's submitted to the CRDT:

1. The leaderboard checks if this beats the peer's **personal best**
2. If yes, it replaces the old entry in the `Y.Map("entries")`
3. The CRDT guarantees conflict-free convergence — no coordination needed

Every ~50 seconds, nodes broadcast their full CRDT state to peers via
`agi/leaderboard/sync`. Receiving nodes apply the update with
`Y.applyUpdate()`, and Yjs handles merge resolution automatically.

**Source:** `src/crdt/leaderboard.js:28-168`

### Layer 3: Inspiration Feedback (Cross-Pollination)

When a node receives a peer's experiment result via gossip, it stores the
configuration as "inspiration":

1. The brain routes the gossip to the appropriate research pipeline
2. The pipeline buffers the last 20 peer configs
3. During hypothesis generation, there's a **30% chance** the pipeline borrows
   a setting from a high-scoring peer's config instead of randomly mutating

This creates a feedback loop where good hyperparameter choices propagate across
the network organically — without any centralized coordination.

**Source:** `src/research/pipeline.js:184-197`

---

## Research Pipeline (Per-Node)

Each node runs a 5-stage research loop for each of the 8 projects:

```
┌──────────────────────────────────────────────────┐
│  Stage 1: Hypothesis                             │
│  Generate experiment by mutating best config     │
│  (30% chance of peer inspiration)                │
│                                                  │
│  Stage 2: Experiment                             │
│  Run the training/eval (simulated or real GPU)   │
│                                                  │
│  Stage 3: Paper                                  │
│  Synthesize findings every 10 runs               │
│                                                  │
│  Stage 4: Critique                               │
│  Score peer papers (1-10)                         │
│                                                  │
│  Stage 5: Discovery                              │
│  Papers scoring 8+ feed back as inspiration      │
└──────────────────────────────────────────────────┘
```

### Research Domains

| Project            | Metric            | What it optimizes                       |
|--------------------|-------------------|-----------------------------------------|
| gpt2-tinystories   | val_loss ↓        | Language model on TinyStories           |
| astrophysics       | val_loss ↓        | Domain-specific LM for astrophysics     |
| search-engine      | ndcg@10 ↑         | Search ranking quality                  |
| financial-analysis | sharpe_ratio ↑    | Trading strategy risk-adjusted returns  |
| agentic-coding     | composite_score ↑ | Code generation (HumanEval+MBPP+ML)     |
| skills-and-tools   | score ↑           | Tool-use capability evaluation          |
| academic-papers    | score ↑           | Paper extraction and analysis           |
| p2p-network        | score ↑           | Network protocol optimization           |

### Mutation Strategies

The pipeline uses 25+ mutation strategies to explore the hyperparameter space:

- **Architecture:** depth, model_width, normalization, position_encoding, activation, tied_embeddings, init_scheme
- **Optimizer:** learning_rate, weight_decay, gradient_clip
- **Training:** batch_size, context_length, extended_training, epochs, gradient_accumulation
- **Fine-tuning:** lora_rank, lora_alpha, lora_dropout, lora_targets, finetuning_method
- **Data:** coding_data_mix, max_seq_length
- **Evaluation:** generation_temperature, benchmark_weights
- **Domain-specific:** title_boost, fast_period, slow_period

---

## State Persistence

### What persists across restarts
- **best.json** — Best experiment result per project per agent
- **run-XXXX.json** — Individual experiment logs
- **Run counter** — Recovered by counting existing run files
- **Governance state** — Proposals and council from `./governance/`
- **Pulse round** — Resumed from on-chain `lastClaimRound`

### What does NOT persist
- **Inspiration buffer** — Starts empty; refills via gossip
- **CRDT leaderboard** — Starts empty; refills via peer sync
- **Brain stats** — Counters reset to zero

---

## Network Data Flow

```
 Node A                          Node B                         Node C
 ──────                          ──────                         ──────
 Run experiment
   │
   ├─ Save best.json (local)
   │
   ├─ Submit to local CRDT
   │
   ├─ Broadcast via GossipSub ──→ Receive gossip
   │                               │
   │                               ├─ Add to inspiration buffer
   │                               │
   │                               ├─ Update local CRDT
   │                               │
   │                               └─ Maybe use config in ──→ Receive experiment
   │                                  next hypothesis           │
   │                                                            ├─ Update CRDT
   │                                                            │
   ├─ Sync CRDT state ──────────→ Apply CRDT update ─────────→ Apply CRDT update
   │                               │                            │
   │                               └─ All nodes converge        └─ Same leaderboard
```

---

## API Endpoints

| Endpoint                   | Method | Description                              |
|----------------------------|--------|------------------------------------------|
| `/status`                  | GET    | Brain status, stats, best results        |
| `/snapshot`                | GET    | Full leaderboard snapshot (all domains)  |
| `/leaderboard/:domain`    | GET    | Top 20 for a specific domain             |
| `/security`                | GET    | P2P security layer status                |
| `/governance`              | GET    | Governance system status                 |
| `/governance/proposals`    | GET    | List proposals (optional ?status=filter) |
| `/governance/council`      | GET    | Council members                          |
| `/dashboard`               | GET    | Live HTML dashboard                      |
| `/dashboard/events`        | GET    | SSE stream (3s interval) for real-time   |

---

## Monitoring

### HTML Dashboard

Open `http://localhost:8080/dashboard` for a real-time visual dashboard showing:

- Network overview (experiments, gossip, peers)
- Domain progress bars with best scores
- Per-domain leaderboards (top 8 per domain)
- Network topology visualization
- Live activity log

### CLI Watch Script

```bash
# Watch local node
node scripts/watch-intelligence.js

# Watch multiple remote nodes
node scripts/watch-intelligence.js http://node1:8080 http://node2:8081

# Via environment variable
AGI_WATCH_URL=http://remote:8080 node scripts/watch-intelligence.js
```

---

## Key Design Decisions

1. **No model weight sharing** — Only hyperparameter configs flow across the
   network. Weights stay local. This keeps bandwidth low and avoids trust
   issues with binary model data.

2. **Personal bests only** — The CRDT leaderboard tracks each peer's best
   result, not every run. This keeps the state compact.

3. **Probabilistic inspiration** — The 30% adoption rate prevents the swarm
   from converging too fast on a local optimum. Most mutations are still
   random, maintaining exploration.

4. **Conflict-free convergence** — Yjs CRDTs guarantee that all nodes arrive
   at the same leaderboard state regardless of message ordering or network
   partitions.

5. **Stateless-friendly restart** — State is recoverable from disk (best.json,
   run files) and from the network (CRDT sync). A restarted node catches up
   within one sync cycle (~50s).
