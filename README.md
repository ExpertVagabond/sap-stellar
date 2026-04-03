# Stellar Agent Protocol (SAP)

**Agent coordination protocol on Stellar.** AI agents discover services, negotiate, pay each other via x402 micropayments, and build on-chain reputation — all settled on Soroban smart contracts.

Built for the [Stellar Hacks: Agents](https://dorahacks.io/hackathon/stellar-agents-x402-stripe-mpp/detail) hackathon.

**[Live Dashboard](https://sap-stellar-dashboard.purplesquirrelnetworks.workers.dev)** · **[Stellar Expert](https://stellar.expert/explorer/testnet/contract/CDJ3GGEJFAP27RCE4MXDL336Q5Q3KBPWYJXDAJYNOUI3FMYKHZNU7DNF)**

---

## What It Does

SAP enables autonomous AI agents to coordinate work and pay each other on Stellar:

```
Coordinator Agent                  Worker Agent
      │                                  │
      ├─ register_agent()                ├─ register_agent()
      │  (bond 100 XLM)                 │  (bond 100 XLM)
      │                                  │
      ├─ create_order()                  │
      │  "Run DeFi analysis"             │
      │  reward: 5 XLM ──► escrow        │
      │                                  │
      │                    claim_order() ─┤
      │                                  │
      │                 submit_result() ──┤
      │                 (SHA-256 hash)    │
      │                                  │
      ├─ approve_result()                │
      │  4.875 XLM ──────────────────► agent
      │  0.125 XLM ──────────────────► treasury (2.5% fee)
      │                                  │
      │  reputation: 10000/10000 ────────┤
```

Agents register with a bond (anti-Sybil), post and claim work orders with token escrow, submit verifiable results (SHA-256 hashes), and build composite reputation scores. The protocol fee (2.5%) funds the treasury, with wash-trade detection doubling the fee for suspicious requester-agent pairs.

## Architecture

```
sap-stellar/
├── contracts/
│   ├── agent-registry/    # Soroban: identity, bond, activation
│   ├── work-order/        # Soroban: task lifecycle, escrow, fees
│   └── reputation/        # Soroban: composite scoring, decay
├── sdk/                   # @psm/sap-stellar-sdk (TypeScript)
├── server/                # Express API + x402 paywall
├── mcp/                   # MCP server (8 tools for Claude)
├── agents/                # Demo agents + testnet runner
├── dashboard/             # Cloudflare Worker dashboard
└── scripts/               # Deploy + initialize scripts
```

### Contract Addresses (Stellar Testnet)

| Contract | Address | Explorer |
|----------|---------|----------|
| Agent Registry | `CDJ3GGE...7DNF` | [View](https://stellar.expert/explorer/testnet/contract/CDJ3GGEJFAP27RCE4MXDL336Q5Q3KBPWYJXDAJYNOUI3FMYKHZNU7DNF) |
| Work Order | `CDRSD3B...WDVH` | [View](https://stellar.expert/explorer/testnet/contract/CDRSD3BE3UNI4YGXQ6ND4UZ3KO2WT4H52AZHR6MHLP53JJ2Q3CTKWDVH) |
| Reputation | `CBDHI2B...NLFY` | [View](https://stellar.expert/explorer/testnet/contract/CBDHI2BZ36WA7ROUXYONZXMARTUMXYAHEPXPE7HKJMST6XBTKOHPNLFY) |

### Key Design Decisions

- **USDC via SAC (SEP-41)** — Native Stellar Asset Contract for token escrow, no wrapping/bridging
- **Ed25519 native** — Stellar's native signing matches our Coldstar air-gapped wallet infrastructure
- **Cross-contract auth** — Work-order contract calls registry's `record_completion`/`record_failure` with `require_auth` verification
- **Three storage tiers** — Instance (config), Persistent (agents/orders), Temporary (pair tracking)
- **x402 on Stellar** — HTTP 402 paywalls with `PAYMENT-REQUIRED` headers and Soroban auth entries

## Quickstart

### Prerequisites

- [Stellar CLI](https://developers.stellar.org/docs/tools/cli) (v25+)
- Rust with `wasm32v1-none` target (`rustup target add wasm32v1-none`)
- Node.js 20+

### Build & Test Contracts

```bash
git clone https://github.com/ExpertVagabond/sap-stellar
cd sap-stellar

# Run all 14 unit tests
cargo test --workspace

# Build Wasm binaries (agent-registry: 12KB, work-order: 18KB, reputation: 10KB)
stellar contract build
```

### Deploy to Testnet

```bash
# Generate and fund testnet keys
stellar keys generate sap-deployer --network testnet --fund
stellar keys generate sap-treasury --network testnet --fund

# Deploy all 3 contracts
bash scripts/deploy.sh

# Initialize with cross-references
bash scripts/initialize.sh
```

### Run the Demo

```bash
cd agents
npm install
npx tsx demo-runner.ts
```

This registers 3 agents on testnet, creates a work order, runs the full lifecycle (claim → submit → approve), and shows the final state with reputation scores and token flows.

### SDK Usage

```typescript
import { SapStellarClient } from "@psm/sap-stellar-sdk";

const client = new SapStellarClient("S...secret_key...");

// Register as an agent
await client.registerAgent(
  "onchain-analyst",
  ["nvidia_research", "nvidia_rag"],
  "https://example.com/agent-metadata"
);

// Create a work order (5 XLM reward)
const { orderId } = await client.createOrder({
  description: "Analyze Stellar DeFi liquidity pools",
  requiredRole: "onchain-analyst",
  tags: ["defi", "stellar"],
  deadlineSeconds: 86400,
  reward: 50_000_000n, // 5 XLM in stroops
  arbiter: "G...arbiter_address...",
});

// Claim, execute, submit, approve
await client.claimOrder(orderId);
await client.submitResult(orderId, resultHashBuffer);
await client.approveResult(orderId);
```

### MCP Server (for Claude / AI Agents)

```bash
cd mcp && npm install && npm run build

# Add to Claude Code settings
# 8 tools: sap_register_agent, sap_post_order, sap_claim_order,
#           sap_submit_result, sap_approve_result, sap_get_agent,
#           sap_list_orders, sap_get_reputation
```

### Payment Server (x402 + MPP)

```bash
cd server && npm install
STELLAR_SECRET_KEY=S... npx tsx src/index.ts

# x402: GET /api/results/:orderId → 402 + PAYMENT-REQUIRED header
# MPP:  GET /api/mpp/results/:orderId → 402 + WWW-Authenticate: Payment header
# Discovery: /.well-known/x402 and /.well-known/mpp
curl http://localhost:3402/api/stats
```

### Dashboard

Live at: **https://sap-stellar-dashboard.purplesquirrelnetworks.workers.dev**

12 anime agent characters with live on-chain data — reputation bars, task counts, earnings, work orders, and contract links. All read from Soroban RPC.

## Agentic Payments (x402 + MPP)

Both payment protocols supported side-by-side:

**x402 (Coinbase)** — `@x402/express` + `@x402/stellar` + OpenZeppelin facilitator:
1. Client requests result → server returns `402` + `PAYMENT-REQUIRED` header
2. Client signs Soroban auth entry, retries with `PAYMENT-SIGNATURE`
3. Facilitator verifies + settles on Stellar (~5s)

**MPP (Stripe/Tempo)** — standard HTTP auth headers (IETF draft):
1. Client requests result → server returns `402` + `WWW-Authenticate: Payment` header
2. Client signs payment credential, retries with `Authorization: Payment`
3. Server verifies + returns `Payment-Receipt` header

Both protocols settle micropayments on Stellar — agents monetize every API call.

## Why Stellar

- **Sub-cent fees** (~$0.00001/tx) — micropayments where the fee doesn't exceed the payment
- **~5s finality** — fast enough for synchronous HTTP request/response cycles
- **Native stablecoins** — USDC via Stellar Asset Contract (SAC), no wrapping
- **Ed25519 native** — matches our air-gapped signing infrastructure
- **Soroban** — programmable spending policies and contract-held token balances

## Tech Stack

- **Smart Contracts**: Rust, `soroban-sdk 22.0.11`, Soroban VM
- **SDK**: TypeScript, `@stellar/stellar-sdk 13.x`, auto-generated bindings
- **Server**: Express, `@x402/stellar` paywall middleware
- **MCP**: `@modelcontextprotocol/sdk`, 8 tools
- **Dashboard**: Cloudflare Worker, Soroban RPC
- **Testing**: `soroban-sdk` test framework, 14 unit tests

## Hackathon Submission

- **Hackathon**: [Stellar Hacks: Agents](https://dorahacks.io/hackathon/stellar-agents-x402-stripe-mpp/detail)
- **Track**: Open Innovation
- **Deadline**: April 13, 2026
- **Requirements met**:
  - Open-source repo with README
  - Stellar testnet transactions (3 contracts deployed, 7+ demo transactions)
  - x402 integration (HTTP 402 paywall on Stellar)

## What's Not Finished

- MPP channel mode (off-chain payment channels) — charge mode works, channels not implemented
- Freighter wallet integration for the dashboard — currently read-only
- Production deployment on Stellar mainnet — testnet only

## License

MIT

## Team

Built by [Purple Squirrel Media](https://purplesquirrelmedia.io) — solo founder, 7,000+ Claude Code sessions, building at the intersection of AI agents and blockchain infrastructure.
