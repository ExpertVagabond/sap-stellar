#!/usr/bin/env npx tsx
/**
 * Full SAP Demo: 12 agents + work orders with real token flows.
 *
 * Registers all 12 roster agents, then runs 8 work orders between them:
 *   - Nexus (coordinator) posts orders for various roles
 *   - Matching agents claim, execute, submit, get approved
 *   - XLM flows through escrow, 2.5% fee collected
 *   - Reputation scores build up on-chain
 *
 * Saves keypairs so agents can be reused.
 */

import { Keypair } from "@stellar/stellar-sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { Client as RegistryClient } from "sap-registry";
import { Client as WorkOrderClient } from "sap-work-order";
import { createHash } from "crypto";
import { writeFileSync } from "fs";

const REGISTRY = process.env.SAP_REGISTRY_CONTRACT ?? "CDJ3GGEJFAP27RCE4MXDL336Q5Q3KBPWYJXDAJYNOUI3FMYKHZNU7DNF";
const WORK_ORDER = process.env.SAP_WORK_ORDER_CONTRACT ?? "CDRSD3BE3UNI4YGXQ6ND4UZ3KO2WT4H52AZHR6MHLP53JJ2Q3CTKWDVH";
const RPC = process.env.STELLAR_RPC ?? "https://soroban-testnet.stellar.org";
const PASSPHRASE = "Test SDF Network ; September 2015";

const ROSTER = [
  { name: "Nexus",    role: "protocol-engineer",       tools: ["sap_post_order", "sap_approve_result", "sap_list_orders"], img: "coordinator" },
  { name: "Cipher",   role: "onchain-analyst",          tools: ["nvidia_research", "nvidia_rag", "nvidia_multimodal"],      img: "inference" },
  { name: "Veil",     role: "smart-contract-auditor",   tools: ["sap_get_agent", "nvidia_codereview", "nvidia_scan"],       img: "auditor" },
  { name: "Glitch",   role: "rpc-infra-engineer",       tools: ["nvidia_scan", "nvidia_quality", "sap_get_agent"],          img: "hacker" },
  { name: "Bastion",  role: "network-engineer",          tools: ["nvidia_guardrails", "nvidia_safety", "sap_list_orders"],   img: "sentinel" },
  { name: "Luna",     role: "indexer-engineer",          tools: ["nvidia_parse", "nvidia_ocr", "sap_list_orders"],           img: "oracle" },
  { name: "Archon",   role: "governance-analyst",        tools: ["nvidia_research", "nvidia_finance", "sap_get_reputation"], img: "sage" },
  { name: "Katana",   role: "security-scanner",          tools: ["nvidia_scan", "nvidia_pii", "nvidia_safety"],              img: "blade" },
  { name: "Helix",    role: "tokenomics-designer",       tools: ["nvidia_finance", "nvidia_research", "nvidia_quality"],     img: "researcher" },
  { name: "Dash",     role: "full-stack-degen",          tools: ["sap_post_order", "sap_claim_order", "sap_submit_result"],  img: "runner" },
  { name: "Sterling", role: "payments-infra",            tools: ["nvidia_finance", "sap_post_order", "sap_approve_result"],  img: "executive" },
  { name: "Bolt",     role: "crypto-engineer",           tools: ["nvidia_codereview", "nvidia_scan", "sap_get_agent"],       img: "mechbot" },
];

// Work orders: { requester_idx, agent_idx, description, reward_xlm }
const ORDERS = [
  { req: 0, agent: 1, desc: "Analyze Stellar DeFi liquidity — TVL, yield, risk scoring across top 10 pools", reward: 5, role: "onchain-analyst" },
  { req: 0, agent: 2, desc: "Audit the SAP work-order Soroban contract for reentrancy and overflow bugs", reward: 8, role: "smart-contract-auditor" },
  { req: 0, agent: 7, desc: "Scan agent registry for suspicious registration patterns and Sybil attempts", reward: 4, role: "security-scanner" },
  { req: 0, agent: 5, desc: "Index all SAP events from the last 1000 ledgers into queryable format", reward: 3, role: "indexer-engineer" },
  { req: 9, agent: 3, desc: "Benchmark Soroban RPC latency across 5 providers and report p50/p95/p99", reward: 6, role: "rpc-infra-engineer" },
  { req: 10, agent: 6, desc: "Evaluate the SAP fee structure governance proposal — model impact on agent participation", reward: 7, role: "governance-analyst" },
  { req: 10, agent: 8, desc: "Design token emission curve for SAP staking rewards — 4 year schedule", reward: 10, role: "tokenomics-designer" },
  { req: 9, agent: 11, desc: "Build Ed25519 multi-sig key ceremony tool for agent wallet upgrades", reward: 5, role: "crypto-engineer" },
];

interface AgentKeypair { name: string; role: string; address: string; secret: string; img: string }

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
  console.log("\n=== SAP Full Demo: 12 Agents + 8 Work Orders ===\n");

  // Phase 1: Generate & fund keypairs
  console.log("Phase 1: Generating and funding 12 agent accounts...\n");
  const agents: AgentKeypair[] = [];
  const keypairs: Keypair[] = [];

  for (const r of ROSTER) {
    const kp = Keypair.random();
    keypairs.push(kp);
    agents.push({ name: r.name, role: r.role, address: kp.publicKey(), secret: kp.secret(), img: r.img });
  }

  // Fund in batches of 4
  for (let i = 0; i < agents.length; i += 4) {
    const batch = agents.slice(i, i + 4);
    await Promise.all(batch.map(a => fund(a.address)));
    console.log(`  Funded: ${batch.map(a => a.name).join(", ")}`);
  }

  // Phase 2: Register all agents
  console.log("\nPhase 2: Registering 12 agents on-chain...\n");
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
      console.log(`  [${i+1}/12] ${r.name} (${r.role}) — registered (tx: ${txId(res)})`);
    } catch (e: any) {
      console.log(`  [${i+1}/12] ${r.name} — FAILED: ${e.message?.slice(0, 50)}`);
    }
    await sleep(500);
  }

  // Phase 3: Run work orders
  console.log("\nPhase 3: Executing 8 work orders...\n");
  const now = Math.floor(Date.now() / 1000);

  for (let i = 0; i < ORDERS.length; i++) {
    const o = ORDERS[i];
    const reqClient = makeClients(keypairs[o.req]);
    const agentClient = makeClients(keypairs[o.agent]);
    const reqName = ROSTER[o.req].name;
    const agentName = ROSTER[o.agent].name;
    const rewardStroops = BigInt(o.reward * 10_000_000);

    console.log(`  Order ${i+1}/8: "${o.desc.slice(0, 50)}..."`);
    console.log(`    Requester: ${reqName} → Agent: ${agentName} (${o.reward} XLM)`);

    try {
      // Create order
      const createTx = await reqClient.workOrder.create_order({
        requester: reqClient.pub,
        description: o.desc,
        required_role: o.role,
        tags: [o.role.split("-")[0], "sap"],
        deadline: BigInt(now + 86400) as any,
        reward: rewardStroops as any,
        arbiter: reqClient.pub,
      });
      const createRes = await createTx.signAndSend();
      const orderId = Number(unwrap(createRes.result));
      process.stdout.write(`    create(#${orderId}) `);

      await sleep(500);

      // Claim
      const claimTx = await agentClient.workOrder.claim_order({
        agent_authority: agentClient.pub,
        order_id: BigInt(orderId) as any,
      });
      await claimTx.signAndSend();
      process.stdout.write("→ claim ");

      await sleep(500);

      // Submit result
      const report = JSON.stringify({ order: orderId, agent: agentName, result: `Analysis complete for: ${o.desc}`, timestamp: new Date().toISOString() });
      const hash = createHash("sha256").update(report).digest();
      const submitTx = await agentClient.workOrder.submit_result({
        agent_authority: agentClient.pub,
        order_id: BigInt(orderId) as any,
        result_hash: Buffer.from(hash),
      });
      await submitTx.signAndSend();
      process.stdout.write("→ submit ");

      await sleep(500);

      // Approve
      const approveTx = await reqClient.workOrder.approve_result({
        requester: reqClient.pub,
        order_id: BigInt(orderId) as any,
      });
      await approveTx.signAndSend();
      console.log("→ approved ✓");

      await sleep(500);
    } catch (e: any) {
      console.log(`\n    FAILED: ${e.message?.slice(0, 80)}`);
    }
  }

  // Phase 4: Print final state
  console.log("\nPhase 4: Final state...\n");
  const checkClient = makeClients(keypairs[0]);

  const agentCountTx = await checkClient.registry.get_agent_count();
  const orderCountTx = await checkClient.workOrder.get_order_count();
  console.log(`  Total agents on registry: ${agentCountTx.result}`);
  console.log(`  Total work orders: ${orderCountTx.result}`);

  console.log("\n  Agent Scores:");
  for (let i = 0; i < ROSTER.length; i++) {
    try {
      const c = makeClients(keypairs[i]);
      const agentTx = await c.registry.get_agent({ authority: c.pub });
      const a = unwrap(agentTx.result);
      const earned = (Number(a.total_earned ?? 0) / 10_000_000).toFixed(2);
      const rep = Number(a.reputation_score ?? 0);
      const tasks = Number(a.tasks_completed ?? 0);
      if (tasks > 0 || i < 3) {
        console.log(`    ${ROSTER[i].name.padEnd(10)} ${rep}/10000 rep  ${tasks} tasks  ${earned} XLM earned`);
      }
    } catch {}
  }

  // Save keypairs for future use
  const savedAgents = agents.map(a => ({ name: a.name, role: a.role, address: a.address, secret: a.secret, img: a.img }));
  writeFileSync(new URL("./roster-keypairs.json", import.meta.url), JSON.stringify(savedAgents, null, 2));
  console.log("\n  Keypairs saved to agents/roster-keypairs.json");

  // Save addresses for dashboard
  const addrList = agents.map(a => ({ name: a.name, address: a.address }));
  writeFileSync(new URL("./roster-addresses.json", import.meta.url), JSON.stringify(addrList, null, 2));
  console.log("  Addresses saved to agents/roster-addresses.json");

  console.log(`\n=== Demo Complete ===`);
  console.log(`\nVerify: https://sap-stellar-dashboard.purplesquirrelnetworks.workers.dev`);
}

main().catch(e => { console.error("Demo failed:", e); process.exit(1); });
