#!/usr/bin/env npx tsx
/**
 * SAP-on-Stellar Demo Runner
 *
 * Demonstrates the full agent coordination lifecycle on Stellar testnet:
 *   1. Register 3 agents (Inference Agent, Auditor, Coordinator)
 *   2. Coordinator posts an inference analysis order
 *   3. Inference Agent claims, executes, submits result
 *   4. Coordinator approves (XLM flows via SAC, 2.5% to treasury)
 *   5. Print final state: agents, reputation, treasury balance
 */

import { Keypair } from "@stellar/stellar-sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { Client as RegistryClient } from "sap-registry";
import { Client as WorkOrderClient } from "sap-work-order";
import { Client as ReputationClient } from "sap-reputation";
import { createHash } from "crypto";

// ── Config ─────────────────────────────────────────────────────────────

const REGISTRY =
  process.env.SAP_REGISTRY_CONTRACT ??
  "CDJ3GGEJFAP27RCE4MXDL336Q5Q3KBPWYJXDAJYNOUI3FMYKHZNU7DNF";
const WORK_ORDER =
  process.env.SAP_WORK_ORDER_CONTRACT ??
  "CDRSD3BE3UNI4YGXQ6ND4UZ3KO2WT4H52AZHR6MHLP53JJ2Q3CTKWDVH";
const REPUTATION =
  process.env.SAP_REPUTATION_CONTRACT ??
  "CBDHI2BZ36WA7ROUXYONZXMARTUMXYAHEPXPE7HKJMST6XBTKOHPNLFY";
const RPC = process.env.STELLAR_RPC ?? "https://soroban-testnet.stellar.org";
const PASSPHRASE = "Test SDF Network ; September 2015";

// ── Helpers ────────────────────────────────────────────────────────────

function makeClients(keypair: Keypair) {
  const { signTransaction, signAuthEntry } = basicNodeSigner(
    keypair,
    PASSPHRASE
  );
  const opts = {
    publicKey: keypair.publicKey(),
    rpcUrl: RPC,
    networkPassphrase: PASSPHRASE,
    signTransaction,
    signAuthEntry,
  };
  return {
    publicKey: keypair.publicKey(),
    registry: new RegistryClient({ ...opts, contractId: REGISTRY }),
    workOrder: new WorkOrderClient({ ...opts, contractId: WORK_ORDER }),
    reputation: new ReputationClient({ ...opts, contractId: REPUTATION }),
  };
}

function unwrap(r: any): any {
  return r && typeof r === "object" && "unwrap" in r ? r.unwrap() : r;
}

function txId(r: any): string {
  return r.getTransactionResponse?.txHash ?? r.getTransactionResponse?.hash ?? "?";
}

function log(step: string, msg: string) {
  console.log(`  [${step}] ${msg}`);
}

async function fundAccount(publicKey: string) {
  const resp = await fetch(
    `https://friendbot.stellar.org?addr=${publicKey}`
  );
  if (!resp.ok) {
    const text = await resp.text();
    // Already funded is fine
    if (!text.includes("createAccountAlreadyExist")) {
      throw new Error(`Friendbot failed: ${text}`);
    }
  }
}

// ── Main Demo ──────────────────────────────────────────────────────────

async function main() {
  console.log("\n=== SAP-on-Stellar Demo ===\n");

  // Generate 3 agent keypairs
  const oracleKp = Keypair.random();
  const auditorKp = Keypair.random();
  const coordinatorKp = Keypair.random();

  console.log("Agent addresses:");
  console.log(`  Inference:   ${oracleKp.publicKey()}`);
  console.log(`  Auditor:     ${auditorKp.publicKey()}`);
  console.log(`  Coordinator: ${coordinatorKp.publicKey()}`);
  console.log("");

  // Fund all accounts via Friendbot
  console.log("[1/8] Funding accounts via Friendbot...");
  await Promise.all([
    fundAccount(oracleKp.publicKey()),
    fundAccount(auditorKp.publicKey()),
    fundAccount(coordinatorKp.publicKey()),
  ]);
  log("1/8", "All 3 accounts funded with 10,000 XLM each");

  const oracle = makeClients(oracleKp);
  const auditor = makeClients(auditorKp);
  const coordinator = makeClients(coordinatorKp);

  // Step 2: Register agents
  console.log("\n[2/8] Registering Inference Agent...");
  const regOracle = await oracle.registry.register_agent({
    authority: oracle.publicKey,
    role: "onchain-analyst",
    tools: ["nvidia_research", "nvidia_rag", "nvidia_multimodal"],
    coldstar_vault: undefined,
    metadata_uri: "https://sap-stellar-dashboard.purplesquirrelnetworks.workers.dev",
  });
  const regOracleResult = await regOracle.signAndSend();
  log("2/8", `Inference Agent registered (tx: ${txId(regOracleResult)})`);

  console.log("[3/8] Registering Auditor Agent...");
  const regAuditor = await auditor.registry.register_agent({
    authority: auditor.publicKey,
    role: "smart-contract-auditor",
    tools: ["sap_get_agent", "sap_list_orders"],
    coldstar_vault: undefined,
    metadata_uri: "https://sap-stellar-dashboard.purplesquirrelnetworks.workers.dev",
  });
  const regAuditorResult = await regAuditor.signAndSend();
  log("3/8", `Auditor Agent registered (tx: ${txId(regAuditorResult)})`);

  console.log("[4/8] Registering Coordinator Agent...");
  const regCoord = await coordinator.registry.register_agent({
    authority: coordinator.publicKey,
    role: "protocol-engineer",
    tools: ["sap_post_order", "sap_approve_result", "sap_list_orders"],
    coldstar_vault: undefined,
    metadata_uri: "https://sap-stellar-dashboard.purplesquirrelnetworks.workers.dev",
  });
  const regCoordResult = await regCoord.signAndSend();
  log("4/8", `Coordinator registered (tx: ${txId(regCoordResult)})`);

  // Step 3: Coordinator posts an inference order
  console.log("\n[5/8] Coordinator posts 'Run inference analysis' order...");
  const now = Math.floor(Date.now() / 1000);
  const createTx = await coordinator.workOrder.create_order({
    requester: coordinator.publicKey,
    description: "Analyze Stellar DeFi liquidity pools — TVL, yield, risk scoring via NIM inference",
    required_role: "onchain-analyst",
    tags: ["defi", "inference", "stellar"],
    deadline: BigInt(now + 86400) as any,
    reward: BigInt(50_000_000) as any, // 5 XLM
    arbiter: coordinator.publicKey,
  });
  const createResult = await createTx.signAndSend();
  const orderId1 = Number(unwrap(createResult.result));
  log("5/8", `Order #${orderId1} created — 5 XLM reward (tx: ${txId(createResult)})`);

  // Step 4: Inference Agent claims + executes + submits
  console.log("\n[6/8] Inference Agent claims, executes, and submits...");

  const claimTx = await oracle.workOrder.claim_order({
    agent_authority: oracle.publicKey,
    order_id: BigInt(orderId1) as any,
  });
  const claimResult = await claimTx.signAndSend();
  log("6/8", `Claimed (tx: ${txId(claimResult)})`);

  // Simulate agent work: generate inference report
  const inferenceReport = JSON.stringify({
    protocol: "Stellar DeFi",
    pools_analyzed: 12,
    total_tvl: "$48.2M",
    top_pool: { name: "XLM/USDC", tvl: "$18.4M", apy: "4.2%", risk: "low" },
    model: "NIM inference (nvidia_research)",
    timestamp: new Date().toISOString(),
    analysis: "Stellar DeFi TVL growing 12% MoM. XLM/USDC pool offers best risk-adjusted yield.",
  });

  const hash = createHash("sha256").update(inferenceReport).digest();
  const submitTx = await oracle.workOrder.submit_result({
    agent_authority: oracle.publicKey,
    order_id: BigInt(orderId1) as any,
    result_hash: Buffer.from(hash),
  });
  const submitResult = await submitTx.signAndSend();
  log("6/8", `Result submitted — hash: ${hash.toString("hex").slice(0, 16)}... (tx: ${txId(submitResult)})`);

  // Step 5: Coordinator approves
  console.log("\n[7/8] Coordinator approves — XLM flows to inference agent...");
  const approveTx = await coordinator.workOrder.approve_result({
    requester: coordinator.publicKey,
    order_id: BigInt(orderId1) as any,
  });
  const approveResult = await approveTx.signAndSend();
  log("7/8", `Approved (tx: ${txId(approveResult)})`);

  // Step 6: Print final state
  console.log("\n[8/8] Final state:");
  const agentCount = await coordinator.registry.get_agent_count();
  const orderCount = await coordinator.workOrder.get_order_count();

  const oracleAgent = unwrap(
    (await coordinator.registry.get_agent({ authority: oracle.publicKey })).result
  );
  const auditorAgent = unwrap(
    (await coordinator.registry.get_agent({ authority: auditor.publicKey })).result
  );
  const coordAgent = unwrap(
    (await coordinator.registry.get_agent({ authority: coordinator.publicKey })).result
  );

  console.log(`\n  Agents: ${agentCount.result}`);
  console.log(`  Orders: ${orderCount.result}`);
  console.log("");
  console.log("  Agent Scores:");
  console.log(
    `    Inference Agent: ${oracleAgent.reputation_score}/10000 (${oracleAgent.tasks_completed} completed, earned ${oracleAgent.total_earned} stroops)`
  );
  console.log(
    `    Auditor Agent:   ${auditorAgent.reputation_score}/10000 (${auditorAgent.tasks_completed} completed)`
  );
  console.log(
    `    Coordinator:     ${coordAgent.reputation_score}/10000 (${coordAgent.tasks_completed} completed)`
  );

  const order = unwrap(
    (await coordinator.workOrder.get_order({ order_id: BigInt(orderId1) as any })).result
  );
  const statusNames: Record<number, string> = {
    0: "Open", 1: "Claimed", 2: "Submitted", 3: "Approved",
    4: "Disputed", 5: "Cancelled", 6: "Resolved",
  };
  console.log(`\n  Order #${orderId1}: ${statusNames[order.status] ?? order.status}`);
  console.log(`    Reward: ${order.reward} stroops`);
  console.log(`    Agent: ${order.assigned_agent}`);

  console.log("\n=== Demo Complete ===");
  console.log("\nVerify on Stellar Expert:");
  console.log(`  Registry: https://stellar.expert/explorer/testnet/contract/${REGISTRY}`);
  console.log(`  Orders:   https://stellar.expert/explorer/testnet/contract/${WORK_ORDER}`);
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
