# Documentation

Human-readable reference material for the AGI Expert network: token economics, node operation, research domains, and system architecture. Optional local `AGENTS.md` in this directory can hold AI orientation; it is not tracked in git.

## Contents

| File | Description |
|------|----------------|
|  | Trustless launch: Solana program deployment, PDA mint authority, and why the economy has no admin keys after genesis. |
| [`NODE_REWARDS.md`](NODE_REWARDS.md) | Hardware tiers, capabilities, staking, pulse rewards, reputation, slashing, and AGIEX CLI usage. |
| [`aggregated-intelligence.md`](aggregated-intelligence.md) | How nodes combine gossip, CRDT leaderboards, and inspiration to aggregate research results without a central coordinator. |
| [`adding-a-research-domain.md`](adding-a-research-domain.md) | Step-by-step guide to adding a new research project under `projects/` and wiring it into the node brain. |
| [`whitepaper.html`](whitepaper.html) | Printable HTML version of the AGIEX technical whitepaper (formulas, emission, on-chain design). |

The root [`README.md`](../README.md) also links `docs/AGIEX_Whitepaper_v1.0.pdf` when a PDF build is distributed; that file may not be present in every clone.

## Related

- Repository root [`README.md`](../README.md) — product overview, quick start, and links into this folder.
- [`program/README.md`](../program/README.md) — Anchor program and on-chain instructions (optional local `program/AGENTS.md` for AI context, not in git).
- Node runtime: see [`src/`](../src/) and root [`README.md`](../README.md) (optional local `src/AGENTS.md` for AI context, not in git).
