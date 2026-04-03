# SAP-on-Stellar

Stellar Agent Protocol — agent coordination with x402 micropayments on Soroban.

## Stack
- **Contracts**: Soroban Rust (`soroban-sdk 22.0.1`), `#![no_std]`
- **SDK**: TypeScript (`@stellar/stellar-sdk`)
- **Server**: Express + `@x402/stellar` + `@stellar/mpp`
- **MCP**: 8 tools via `@modelcontextprotocol/sdk`
- **Dashboard**: Cloudflare Worker
- **Deploy**: `stellar contract deploy --network testnet`

## Contracts
- `agent-registry` — agent identity, registration bond, activation
- `work-order` — task lifecycle, USDC escrow via SAC (SEP-41)
- `reputation` — composite scoring, decay, specializations

## Key Addresses
- Deployer: `sap-deployer` (stellar keys alias)
- Treasury: `sap-treasury` (stellar keys alias)
- Network: Stellar testnet

## Build
```bash
stellar contract build
cargo test
```

## Deploy
```bash
bash scripts/deploy.sh
bash scripts/initialize.sh
```

## Rules
- All Wasm must be < 64KB (use `opt-level = "z"` + LTO)
- Target dir on VS volume (avoid filling root SSD)
- Pin `soroban-sdk = "22.0.1"` — must match CLI version
- Use SEP-41 token interface for all token ops
- `env.require_auth()` for all state-changing calls
- Cross-contract calls via `ContractClient::new()`
