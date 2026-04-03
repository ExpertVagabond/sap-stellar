#!/usr/bin/env npx tsx
/**
 * Full SAP Demo: 12 agents + work orders with real token flows.
 * ALL agents both request and complete work for varied reputation.
 * Saves keypairs to ~/.sap-stellar/ (outside git repo).
 */

import { Keypair } from "@stellar/stellar-sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { Client as RegistryClient } from "sap-registry";
import { Client as WorkOrderClient } from "sap-work-order";
import { createHash } from "crypto";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const REGISTRY = process.env.SAP_REGISTRY_CONTRACT ?? "CDJ3GGEJFAP27RCE4MXDL336Q5Q3KBPWYJXDAJYNOUI3FMYKHZNU7DNF";
const WORK_ORDER = process.env.SAP_WORK_ORDER_CONTRACT ?? "CDRSD3BE3UNI4YGXQ6ND4UZ3KO2WT4H52AZHR6MHLP53JJ2Q3CTKWDVH";
const RPC = process.env.STELLAR_RPC ?? "https://soroban-testnet.stellar.org";
const PASSPHRASE = "Test SDF Network ; September 2015";
const KEYS_DIR = join(homedir(), ".sap-stellar");
const KEYS_FILE = join(KEYS_DIR, "roster-keypairs.json");

const ROSTER = [
  { name: "Nexus",    role: "protocol-engineer",       tools: ["sap_post_order", "sap_approve_result", "sap_list_orders"] },
  { name: "Cipher",   role: "onchain-analyst",          tools: ["nvidia_research", "nvidia_rag", "nvidia_multimodal"] },
  { name: "Veil",     role: "smart-contract-auditor",   tools: ["sap_get_agent", "nvidia_codereview", "nvidia_scan"] },
  { name: "Glitch",   role: "rpc-infra-engineer",       tools: ["nvidia_scan", "nvidia_quality", "sap_get_agent"] },
  { name: "Bastion",  role: "network-engineer",          tools: ["nvidia_guardrails", "nvidia_safety", "sap_list_orders"] },
  { name: "Luna",     role: "indexer-engineer",          tools: ["nvidia_parse", "nvidia_ocr", "sap_list_orders"] },
  { name: "Archon",   role: "governance-analyst",        tools: ["nvidia_research", "nvidia_finance", "sap_get_reputation"] },
  { name: "Katana",   role: "security-scanner",          tools: ["nvidia_scan", "nvidia_pii", "nvidia_safety"] },
  { name: "Helix",    role: "tokenomics-designer",       tools: ["nvidia_finance", "nvidia_research", "nvidia_quality"] },
  { name: "Dash",     role: "full-stack-degen",          tools: ["sap_post_order", "sap_claim_order", "sap_submit_result"] },
  { name: "Sterling", role: "payments-infra",            tools: ["nvidia_finance", "sap_post_order", "sap_approve_result"] },
  { name: "Bolt",     role: "crypto-engineer",           tools: ["nvidia_codereview", "nvidia_scan", "sap_get_agent"] },
];

// Orders where every agent does at least one task
const ORDERS = [
  { req: 9, agent: 0,  desc: "Coordinate multi-agent pipeline for Stellar DeFi analytics sprint",            reward: 6,  role: "protocol-engineer" },
  { req: 0, agent: 1,  desc: "Analyze Stellar DeFi liquidity — TVL, yield, risk scoring across top pools",   reward: 5,  role: "onchain-analyst" },
  { req: 0, agent: 2,  desc: "Audit the SAP work-order Soroban contract for reentrancy and overflow",        reward: 8,  role: "smart-contract-auditor" },
  { req: 10,agent: 3,  desc: "Benchmark Soroban RPC latency across 5 providers — p50/p95/p99 report",        reward: 6,  role: "rpc-infra-engineer" },
  { req: 0, agent: 4,  desc: "Monitor Stellar validator network for partition events and latency spikes",     reward: 4,  role: "network-engineer" },
  { req: 0, agent: 5,  desc: "Index all SAP contract events from last 2000 ledgers into queryable feeds",    reward: 3,  role: "indexer-engineer" },
  { req: 10,agent: 6,  desc: "Evaluate SAP fee structure proposal — model impact on agent participation",     reward: 7,  role: "governance-analyst" },
  { req: 0, agent: 7,  desc: "Scan agent registry for Sybil patterns and suspicious registration bursts",    reward: 4,  role: "security-scanner" },
  { req: 0, agent: 8,  desc: "Design token emission curve for SAP staking rewards — 4 year vesting",         reward: 10, role: "tokenomics-designer" },
  { req: 10,agent: 9,  desc: "Build rapid prototype: agent dashboard with live Soroban RPC feeds",           reward: 5,  role: "full-stack-degen" },
  { req: 0, agent: 10, desc: "Architect cross-border USDC settlement flow for agent-to-agent payments",      reward: 8,  role: "payments-infra" },
  { req: 9, agent: 11, desc: "Build Ed25519 multi-sig key ceremony tool for agent wallet upgrades",          reward: 5,  role: "crypto-engineer" },
  // Second round — give some agents multiple completions for varied scores
  { req: 10,agent: 1,  desc: "Run sentiment analysis on Stellar ecosystem Twitter feeds — weekly report",     reward: 4,  role: "onchain-analyst" },
  { req: 9, agent: 7,  desc: "Penetration test the x402 payment endpoint for auth bypass vulnerabilities",   reward: 6,  role: "security-scanner" },
  { req: 0, agent: 8,  desc: "Model liquidity mining incentives for SAP agent staking pool launch",          reward: 7,  role: "tokenomics-designer" },
  { req: 10,agent: 2,  desc: "Review Soroban reputation contract for storage tier optimization",              reward: 5,  role: "smart-contract-auditor" },
];

interface SavedAgent { name: string; role: string; address: string; secret: string }

function makeClients(kp: Keypair) {
  const { signTransaction, signAuthEntry } = basicNodeSigner(kp, PASSPHRASE);
  const opts = { publicKey: kp.publicKey(), rpcUrl: RPC, networkPassphrase: PASSPHRASE, signTransaction, signAuthEntry };
  return {
    pub: kp.publicKey(),
    registry: new RegistryClient({ ...opts, contractId: REGISTRY }),
    workOrder: new WorkOrderClient({ ...opts, contractId: WORK_ORDER }),
  };
}

function txId(r: any): string { return r.getTransactionResponse?.txHash?.slice(0, 12) ?? "?"; }
function unwrap(r: any): any { return r && typeof r === "object" && "unwrap" in r ? r.unwrap() : r; }
async function fund(pub: string) {
  const r = await fetch(`https://friendbot.stellar.org?addr=${pub}`);
  if (!r.ok) { const t = await r.text(); if (!t.includes("createAccountAlreadyExist")) throw new Error(t); }
}
async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log("\n=== SAP Full Demo: 12 Agents + 16 Work Orders ===\n");

  // Load or generate keypairs
  mkdirSync(KEYS_DIR, { recursive: true });
  let savedAgents: SavedAgent[];
  let keypairs: Keypair[];
  let needsRegistration = true;

  if (existsSync(KEYS_FILE)) {
    console.log("Loading existing keypairs from ~/.sap-stellar/roster-keypairs.json");
    savedAgents = JSON.parse(readFileSync(KEYS_FILE, "utf-8"));
    keypairs = savedAgents.map(a => Keypair.fromSecret(a.secret));
    needsRegistration = false;
    // Check if first agent is registered
    try {
      const c = makeClients(keypairs[0]);
      await c.registry.get_agent({ authority: c.pub });
      console.log("Agents already registered, skipping to orders.\n");
    } catch {
      needsRegistration = true;
    }
  } else {
    console.log("Generating fresh keypairs...");
    keypairs = ROSTER.map(() => Keypair.random());
    savedAgents = ROSTER.map((r, i) => ({
      name: r.name, role: r.role, address: keypairs[i].publicKey(), secret: keypairs[i].secret()
    }));
    writeFileSync(KEYS_FILE, JSON.stringify(savedAgents, null, 2));
    console.log(`Keypairs saved to ${KEYS_FILE}\n`);
  }

  // Fund
  console.log("Funding accounts...");
  for (let i = 0; i < keypairs.length; i += 4) {
    const batch = ROSTER.slice(i, i + 4);
    await Promise.all(keypairs.slice(i, i + 4).map(kp => fund(kp.publicKey())));
    console.log(`  Funded: ${batch.map(r => r.name).join(", ")}`);
  }

  // Register if needed
  if (needsRegistration) {
    console.log("\nRegistering agents...");
    for (let i = 0; i < ROSTER.length; i++) {
      const r = ROSTER[i];
      const c = makeClients(keypairs[i]);
      try {
        const tx = await c.registry.register_agent({
          authority: c.pub, role: r.role, tools: r.tools,
          coldstar_vault: undefined,
          metadata_uri: "https://sap-stellar-dashboard.purplesquirrelnetworks.workers.dev",
        });
        const res = await tx.signAndSend();
        console.log(`  [${i+1}/12] ${r.name} (${r.role}) — tx: ${txId(res)}`);
      } catch (e: any) {
        console.log(`  [${i+1}/12] ${r.name} — ${e.message?.slice(0, 50)}`);
      }
      await sleep(500);
    }
  }

  // Save addresses for dashboard
  writeFileSync(
    new URL("./roster-addresses.json", import.meta.url),
    JSON.stringify(savedAgents.map(a => ({ name: a.name, address: a.address })), null, 2)
  );

  // Run work orders
  console.log(`\nExecuting ${ORDERS.length} work orders...\n`);
  const now = Math.floor(Date.now() / 1000);

  for (let i = 0; i < ORDERS.length; i++) {
    const o = ORDERS[i];
    const reqC = makeClients(keypairs[o.req]);
    const agentC = makeClients(keypairs[o.agent]);
    const reqName = ROSTER[o.req].name;
    const agentName = ROSTER[o.agent].name;
    const rewardStroops = BigInt(o.reward * 10_000_000);

    process.stdout.write(`  [${i+1}/${ORDERS.length}] ${reqName}→${agentName} ${o.reward}XLM "${o.desc.slice(0, 45)}..." `);

    try {
      // Create
      const cTx = await reqC.workOrder.create_order({
        requester: reqC.pub, description: o.desc, required_role: o.role,
        tags: [o.role.split("-")[0], "sap"], deadline: BigInt(now + 86400) as any,
        reward: rewardStroops as any, arbiter: reqC.pub,
      });
      const cRes = await cTx.signAndSend();
      const orderId = Number(unwrap(cRes.result));
      await sleep(300);

      // Claim
      const clTx = await agentC.workOrder.claim_order({ agent_authority: agentC.pub, order_id: BigInt(orderId) as any });
      await clTx.signAndSend();
      await sleep(300);

      // Submit
      const report = JSON.stringify({ order: orderId, agent: agentName, analysis: o.desc, ts: new Date().toISOString() });
      const hash = createHash("sha256").update(report).digest();
      const sTx = await agentC.workOrder.submit_result({ agent_authority: agentC.pub, order_id: BigInt(orderId) as any, result_hash: Buffer.from(hash) });
      await sTx.signAndSend();
      await sleep(300);

      // Approve
      const aTx = await reqC.workOrder.approve_result({ requester: reqC.pub, order_id: BigInt(orderId) as any });
      await aTx.signAndSend();
      console.log(`✓ #${orderId}`);
      await sleep(300);
    } catch (e: any) {
      console.log(`✗ ${e.message?.slice(0, 60)}`);
    }
  }

  // Final state
  console.log("\n=== Final State ===\n");
  const checkC = makeClients(keypairs[0]);
  const ac = await checkC.registry.get_agent_count();
  const oc = await checkC.workOrder.get_order_count();
  console.log(`  Agents: ${ac.result}  |  Orders: ${oc.result}\n`);

  console.log("  Agent Scoreboard:");
  console.log("  " + "-".repeat(65));
  for (let i = 0; i < ROSTER.length; i++) {
    try {
      const c = makeClients(keypairs[i]);
      const aTx = await c.registry.get_agent({ authority: c.pub });
      const a = unwrap(aTx.result);
      const earned = (Number(a.total_earned ?? 0) / 10_000_000).toFixed(2);
      const rep = Number(a.reputation_score ?? 0);
      const tasks = Number(a.tasks_completed ?? 0);
      const bar = "█".repeat(Math.round(rep / 1000)) + "░".repeat(10 - Math.round(rep / 1000));
      console.log(`  ${ROSTER[i].name.padEnd(10)} [${bar}] ${String(rep).padStart(5)}/10000  ${String(tasks).padStart(2)} tasks  ${earned.padStart(6)} XLM`);
    } catch {}
  }

  console.log(`\n  Dashboard: https://sap-stellar-dashboard.purplesquirrelnetworks.workers.dev`);
  console.log(`  Registry:  https://stellar.expert/explorer/testnet/contract/${REGISTRY}`);
  console.log(`\n=== Done ===\n`);
}

main().catch(e => { console.error("Failed:", e); process.exit(1); });
