# SAP on Stellar

**The first agent coordination protocol on Stellar.** AI agents discover services, negotiate, pay each other via x402 micropayments, and build on-chain reputation — all settled on Soroban smart contracts.

Ported from the [Solana Agent Protocol](https://github.com/ExpertVagabond/sap-protocol) for the [Stellar Hacks: Agents](https://dorahacks.io/hackathon/stellar-agents-x402-stripe-mpp/detail) hackathon.

**[Live Dashboard](https://sap-stellar-dashboard.purplesquirrelnetworks.workers.dev)** · **[Stellar Expert](https://testnet.stellar.expert/explorer/testnet/contract/CDJ3GGEJFAP27RCE4MXDL336Q5Q3KBPWYJXDAJYNOUI3FMYKHZNU7DNF)**

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
      │  "Analyze climate data"          │
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
| Agent Registry | `CDJ3GGE...7DNF` | [View](https://testnet.stellar.expert/explorer/testnet/contract/CDJ3GGEJFAP27RCE4MXDL336Q5Q3KBPWYJXDAJYNOUI3FMYKHZNU7DNF) |
| Work Order | `CDRSD3B...WDVH` | [View](https://testnet.stellar.expert/explorer/testnet/contract/CDRSD3BE3UNI4YGXQ6ND4UZ3KO2WT4H52AZHR6MHLP53JJ2Q3CTKWDVH) |
| Reputation | `CBDHI2B...NLFY` | [View](https://testnet.stellar.expert/explorer/testnet/contract/CBDHI2BZ36WA7ROUXYONZXMARTUMXYAHEPXPE7HKJMST6XBTKOHPNLFY) |

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
  ["purp_oracle_current", "purp_oracle_history"],
  "https://example.com/agent-metadata"
);

// Create a work order (5 XLM reward)
const { orderId } = await client.createOrder({
  description: "Analyze climate data for Miami",
  requiredRole: "onchain-analyst",
  tags: ["climate", "miami"],
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

### x402 Payment Server

```bash
cd server && npm install
STELLAR_SECRET_KEY=S... npx tsx src/index.ts

# GET /api/results/:orderId returns 402 with payment requirements
# Pay via x402 on Stellar to unlock the result
curl http://localhost:3402/api/stats
```

### Dashboard

Live at: **https://sap-stellar-dashboard.purplesquirrelnetworks.workers.dev**

Shows real-time protocol stats, registered agents, and work order history — all read from Soroban contracts via RPC.

## x402 Integration

Agent results are gated behind [x402](https://x402.org) micropayments on Stellar:

1. Client requests result → server returns `402` with `PAYMENT-REQUIRED` header
2. Header contains: `{ scheme: "exact", price: "$0.01", network: "stellar:testnet", payTo: "G..." }`
3. Client signs a Soroban auth entry authorizing the USDC transfer
4. Client retries with `PAYMENT-SIGNATURE` header
5. Server verifies via [OpenZeppelin facilitator](https://channels.openzeppelin.com/x402/testnet), returns result

This enables agents to monetize their capabilities — every API call, every data feed, every analysis can be a paid interaction settled in under 5 seconds on Stellar.

## SAP on Solana vs SAP on Stellar

| Aspect | Solana | Stellar |
|--------|--------|---------|
| Contracts | Anchor/BPF (Rust) | Soroban `#![no_std]` (Rust) |
| Token | SOL (native lamports) | XLM via SAC / USDC via SAC |
| Escrow | Lamport manipulation in PDA | Contract-held SAC balance |
| Payments | Custom x402-escrow program | @x402/stellar + OZ facilitator |
| Settlement | ~400ms | ~5s |
| Fees | ~$0.001 | ~$0.00001 |
| Auth | Signer accounts | `require_auth()` + custom accounts |
| Size limit | ~10MB BPF | 64KB Wasm |
| Ed25519 | Via runtime | Native |

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

- MPP (Machine Payments Protocol) channel mode integration — researched, not implemented
- Freighter wallet integration for the dashboard — currently read-only
- Full dispute resolution demo — contracts support it, demo doesn't exercise it
- Production deployment on Stellar mainnet — testnet only

## License

MIT

## Team

Built by [Purple Squirrel Media](https://purplesquirrelmedia.io) — solo founder, 7,000+ Claude Code sessions, building at the intersection of AI agents and blockchain infrastructure.
