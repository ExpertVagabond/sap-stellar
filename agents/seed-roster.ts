#!/usr/bin/env npx tsx
/**
 * Seed the full 12-agent roster on Stellar testnet.
 * Each agent gets its own keypair, Friendbot funding, and registration.
 */

import { Keypair } from "@stellar/stellar-sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { Client as RegistryClient } from "sap-registry";

const REGISTRY =
  process.env.SAP_REGISTRY_CONTRACT ??
  "CDJ3GGEJFAP27RCE4MXDL336Q5Q3KBPWYJXDAJYNOUI3FMYKHZNU7DNF";
const RPC = process.env.STELLAR_RPC ?? "https://soroban-testnet.stellar.org";
const PASSPHRASE = "Test SDF Network ; September 2015";
const SITE = "https://sap-stellar-dashboard.purplesquirrelnetworks.workers.dev";

const ROSTER = [
  { name: "Nexus", role: "protocol-engineer", tools: ["sap_post_order", "sap_approve_result", "sap_list_orders"] },
  { name: "Cipher", role: "onchain-analyst", tools: ["nvidia_research", "nvidia_rag", "nvidia_multimodal"] },
  { name: "Veil", role: "smart-contract-auditor", tools: ["sap_get_agent", "sap_list_orders", "nvidia_codereview"] },
  { name: "Glitch", role: "rpc-infra-engineer", tools: ["nvidia_scan", "nvidia_quality", "sap_get_agent"] },
  { name: "Bastion", role: "network-engineer", tools: ["nvidia_guardrails", "nvidia_safety", "sap_list_orders"] },
  { name: "Luna", role: "indexer-engineer", tools: ["nvidia_parse", "nvidia_ocr", "sap_list_orders"] },
  { name: "Archon", role: "governance-analyst", tools: ["nvidia_research", "nvidia_finance", "sap_get_reputation"] },
  { name: "Katana", role: "security-scanner", tools: ["nvidia_scan", "nvidia_pii", "nvidia_safety"] },
  { name: "Helix", role: "tokenomics-designer", tools: ["nvidia_finance", "nvidia_research", "nvidia_quality"] },
  { name: "Dash", role: "full-stack-degen", tools: ["sap_post_order", "sap_claim_order", "sap_submit_result"] },
  { name: "Sterling", role: "payments-infra", tools: ["nvidia_finance", "sap_post_order", "sap_approve_result"] },
  { name: "Bolt", role: "crypto-engineer", tools: ["nvidia_codereview", "nvidia_scan", "sap_get_agent"] },
];

function makeClient(keypair: Keypair) {
  const { signTransaction, signAuthEntry } = basicNodeSigner(keypair, PASSPHRASE);
  return new RegistryClient({
    publicKey: keypair.publicKey(),
    rpcUrl: RPC,
    networkPassphrase: PASSPHRASE,
    signTransaction,
    signAuthEntry,
    contractId: REGISTRY,
  });
}

function txId(r: any): string {
  return r.getTransactionResponse?.txHash ?? r.getTransactionResponse?.hash ?? "?";
}

async function fund(pubkey: string) {
  const r = await fetch(`https://friendbot.stellar.org?addr=${pubkey}`);
  if (!r.ok) {
    const t = await r.text();
    if (!t.includes("createAccountAlreadyExist")) throw new Error(`Friendbot: ${t}`);
  }
}

async function main() {
  console.log("\n=== Seeding 12-Agent Roster on Stellar Testnet ===\n");

  // Check how many agents already exist
  const checkClient = makeClient(Keypair.random());
  // We'll just register fresh ones

  const addresses: { name: string; role: string; address: string }[] = [];

  for (let i = 0; i < ROSTER.length; i++) {
    const agent = ROSTER[i];
    const kp = Keypair.random();
    const client = makeClient(kp);

    process.stdout.write(`[${i + 1}/12] ${agent.name} (${agent.role})... `);

    // Fund via Friendbot
    try {
      await fund(kp.publicKey());
    } catch (e: any) {
      console.log(`FUND FAILED: ${e.message}`);
      continue;
    }

    // Register
    try {
      const tx = await client.register_agent({
        authority: kp.publicKey(),
        role: agent.role,
        tools: agent.tools,
        coldstar_vault: undefined,
        metadata_uri: SITE,
      });
      const result = await tx.signAndSend();
      console.log(`OK (${kp.publicKey().slice(0, 8)}... tx: ${txId(result).slice(0, 12)}...)`);
      addresses.push({ name: agent.name, role: agent.role, address: kp.publicKey() });
    } catch (e: any) {
      console.log(`REG FAILED: ${e.message?.slice(0, 60)}`);
      continue;
    }

    // Small delay to avoid rate limiting
    if (i < ROSTER.length - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log(`\n=== ${addresses.length}/12 Agents Registered ===\n`);

  // Print all addresses for the site to use
  console.log("Addresses (for KNOWN_AGENTS in dashboard):");
  console.log(JSON.stringify(addresses.map(a => a.address), null, 2));

  // Save to file
  const fs = await import("fs");
  fs.writeFileSync(
    new URL("./roster-addresses.json", import.meta.url),
    JSON.stringify(addresses, null, 2)
  );
  console.log("\nSaved to agents/roster-addresses.json");

  console.log(`\nVerify: ${SITE}`);
  console.log(`Registry: https://stellar.expert/explorer/testnet/contract/${REGISTRY}`);
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
