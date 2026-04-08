# VynX — Headless Settlement for the M2M Economy

[![Network](https://img.shields.io/badge/Network-Base%20L2-0052FF?style=for-the-badge&logo=coinbase&logoColor=white)](https://base.org)
[![Runtime](https://img.shields.io/badge/Relayer-Go%20%7C%20Zero--DB-00ADD8?style=for-the-badge&logo=go&logoColor=white)](./vynx-relayer-mvp)
[![Agent](https://img.shields.io/badge/Agent-Coinbase%20AgentKit-0052FF?style=for-the-badge)](https://docs.cdp.coinbase.com/agentkit/docs/welcome)
[![Wallets](https://img.shields.io/badge/Custody-CDP%20MPC-0052FF?style=for-the-badge)](https://docs.cdp.coinbase.com)
[![Latency](https://img.shields.io/badge/p99%20Latency-%3C200ms-success?style=for-the-badge)](./vynx-relayer-mvp)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

---

## The M2M Settlement Standard

Autonomous agents will not wait for humans, 12-second block times, or Postgres.
The moment AI agents start transacting with other AI agents at machine speed,
the settlement layer becomes the bottleneck of the entire economy. **VynX is
built to be that layer.**

VynX is a headless, sub-200ms settlement relayer purpose-built for the
machine-to-machine (M2M) economy. It gives autonomous agents a deterministic,
non-custodial execution path from intent to on-chain finality — with zero
human-in-the-loop, zero database dependencies, and zero tolerance for latency.

This is not a wallet. This is not a bridge. This is the settlement fabric that
agent-to-agent commerce is missing.

### Why Base — and why *only* Base

Every technical choice in this repository is downstream of one conviction:
**the M2M economy is only economically viable on Base.** Nowhere else does the
math work.

- **Sub-second finality** on Base's OP-Stack L2 is what turns settlement from a
  batch process into a real-time primitive. VynX's Relayer is engineered to
  match that cadence — a RAM-only, zero-disk event loop with a p99 submission
  latency under 200ms. The Relayer is never the bottleneck; Base is the floor.
- **Sub-cent gas** makes per-interaction settlement economically rational.
  Agents can settle *every* micro-intent on-chain instead of batching through
  a trusted off-chain ledger. This is the death of the custodial middleman.
- **CDP-native infrastructure** — AgentKit, MPC Wallets, Paymaster, Onramp —
  collapses the stack. VynX is not integrating with Coinbase; VynX is the
  missing execution primitive *inside* the Coinbase developer ecosystem.

### The Holy Trinity

VynX is the composition of three best-in-class primitives into a single,
coherent settlement loop:

| Layer | Primitive | Role |
|---|---|---|
| 🧠 **The Brain** | **Coinbase AgentKit** | Autonomous reasoning and intent construction. The agent decides *what* to settle and *why*, exposed as typed AgentKit actions validated by Zod schemas. |
| 🔐 **The Trustless Vault** | **CDP MPC Wallets** | Threshold-signed custody with no private keys at rest. Signing authority is distributed; compromise of any single node is non-fatal. |
| ⚡ **The Execution Engine** | **Base L2** | Sub-second finality and sub-cent fees. The only EVM network where machine-speed settlement is economically and physically possible today. |

Remove any one leg and the architecture collapses. This is not coincidence —
it is the only stack in existence where headless, trustless, real-time
settlement is a solved problem.

### What makes the Relayer different

Most "relayers" are thin RPC proxies bolted to a queue and a database. VynX is
a ground-up rewrite of the settlement hot path:

- **Zero-DB architecture** — the Relayer holds zero persistent state. No
  Postgres, no Redis, no write-ahead log. Intents live in RAM, transactions
  live on-chain, and the chain itself is the source of truth. The crash
  recovery story is "restart the binary."
- **Lock-sharded concurrency** — nonce management, intent validation, and
  submission pipelines are partitioned across sharded mutexes, eliminating
  global locks on the hot path. The Relayer saturates CPU before it
  serializes.
- **EIP-712 parity with the on-chain verifier** — intent signatures are
  validated off-chain against the *exact* struct hash enforced by the Solidity
  settlement contract. What the Relayer accepts is, by construction, what the
  contract will accept. No drift, no surprises, no failed broadcasts.
- **Deterministic submission loop** — one WebSocket subscription to Base, one
  bounded event loop, one signed transaction per intent. No speculative
  re-broadcasts, no mempool games, no hidden queues.

The Relayer is designed to be *boring* under load. That is the point.

---

## Quickstart for Grant Reviewers

> Prerequisites: [Docker Desktop](https://www.docker.com/products/docker-desktop/) ≥ 4.x and `make`.

**Step 1 — Configure credentials.**

```bash
cp .env.example .env
```

Open `.env` and fill in the four required secrets:
`RELAYER_PRIVATE_KEY`, `CDP_API_KEY_NAME`, `CDP_API_KEY_PRIVATE_KEY`, and
`OPENAI_API_KEY`. All network endpoints are pre-configured for Base Sepolia.

**Step 2 — Launch the full stack with a single command.**

```bash
make reviewer-demo
```

This command builds both Docker images from source, starts the relayer and agent
services, and attaches to the live log stream.

**Step 3 — Observe the HFT execution.**

Watch the terminal output. The `vynx-agent` will autonomously construct a
settlement intent, submit it to the `vynx-relayer` over the internal network,
and the relayer will broadcast the signed transaction to Base Sepolia. The
on-chain confirmation hash will appear in the logs within seconds.

---

## Architecture

VynX ships as a Git monorepo of three independently auditable submodules. Each
is versioned, tested, and deployable on its own — but together they form the
end-to-end settlement loop.

| Submodule | Language | Role |
|---|---|---|
| [`vynx-settlement-mvp`](./vynx-settlement-mvp) | Solidity / Foundry | The on-chain trust anchor. An EIP-712 settlement contract that verifies signed intents and executes atomic transfers. This is the final authority; everything else serves it. |
| [`vynx-relayer-mvp`](./vynx-relayer-mvp) | Go | The zero-DB, lock-sharded execution engine. Ingests intents over HTTP/WebSocket, validates them against the on-chain EIP-712 domain, co-signs via CDP MPC, and broadcasts to Base — all in under 200ms p99. |
| [`vynx-plugin-mvp`](./vynx-plugin-mvp) | TypeScript | The AgentKit surface. A headless plugin that exposes settlement as first-class AgentKit actions, type-safe end-to-end via Zod, so any LLM-driven agent can transact without touching chain primitives. |

### Settlement Loop

```
┌──────────────────────────────────────────────────────────────┐
│                  Docker Bridge Network                        │
│                                                               │
│  ┌──────────────────┐   EIP-712     ┌────────────────────┐   │
│  │   vynx-agent     │   Intent      │   vynx-relayer     │   │
│  │  AgentKit / TS   │ ────────────► │  Go · Zero-DB      │   │
│  │  (The Brain)     │               │  Lock-sharded      │   │
│  └──────────────────┘               └─────────┬──────────┘   │
│                                               │               │
└───────────────────────────────────────────────┼──────────────┘
                                                │ signed tx
                                                ▼
                                   ┌────────────────────────┐
                                   │     Base L2 (OP-Stack) │
                                   │  Settlement Contract   │
                                   │  (The Trust Anchor)    │
                                   └────────────────────────┘
```

One agent. One relayer. One contract. One chain. No databases, no queues, no
human in the loop.

---

## Environment Variables Reference

| Variable | Description | Required |
|---|---|---|
| `SETTLEMENT_CONTRACT_ADDRESS` | Deployed address of the VynX settlement contract on Base Sepolia | Pre-filled |
| `BASE_RPC_URL` | Alchemy HTTP RPC endpoint for Base Sepolia | Pre-filled |
| `BASE_WS_URL` | Alchemy WebSocket endpoint for Base Sepolia | Pre-filled |
| `CHAIN_ID` | EVM chain ID (84532 = Base Sepolia) | Pre-filled |
| `RELAYER_PRIVATE_KEY` | Hex-encoded private key for the relayer's hot wallet | **Required** |
| `CDP_API_KEY_NAME` | CDP API key identifier from the Coinbase Developer Portal | **Required** |
| `CDP_API_KEY_PRIVATE_KEY` | CDP API private key for MPC wallet operations | **Required** |
| `OPENAI_API_KEY` | OpenAI API key for AgentKit LLM reasoning | **Required** |

---

## License

MIT © 2025 VynX — Built for Base.
