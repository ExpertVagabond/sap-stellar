#!/usr/bin/env npx tsx
/**
 * Run dispute scenarios to create varied reputation scores.
 * Some agents submit bad work → disputed → reputation drops.
 */

import { Keypair } from "@stellar/stellar-sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { Client as RegistryClient } from "sap-registry";
import { Client as WorkOrderClient } from "sap-work-order";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const REGISTRY = "CDJ3GGEJFAP27RCE4MXDL336Q5Q3KBPWYJXDAJYNOUI3FMYKHZNU7DNF";
const WORK_ORDER = "CDRSD3BE3UNI4YGXQ6ND4UZ3KO2WT4H52AZHR6MHLP53JJ2Q3CTKWDVH";
const RPC = "https://soroban-testnet.stellar.org";
const PASSPHRASE = "Test SDF Network ; September 2015";

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

function unwrap(r: any): any { return r && typeof r === "object" && "unwrap" in r ? r.unwrap() : r; }
function txId(r: any): string { return r.getTransactionResponse?.txHash?.slice(0, 12) ?? "?"; }
async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const keysFile = join(homedir(), ".sap-stellar", "roster-keypairs.json");
  const agents: SavedAgent[] = JSON.parse(readFileSync(keysFile, "utf-8"));
  const keypairs = agents.map(a => Keypair.fromSecret(a.secret));

  console.log("\n=== Dispute Scenarios ===\n");

  // Nexus (0) posts orders, Bastion (4) and Luna (5) will get disputed
  // This drops their perfect 10000 score to show varied reputation

  const disputes = [
    { req: 0, agent: 4, desc: "Monitor validator uptime — but agent submitted incomplete data", reward: 3 },
    { req: 0, agent: 5, desc: "Index ledger events — but agent returned stale cached data", reward: 2 },
  ];

  const now = Math.floor(Date.now() / 1000);

  for (const d of disputes) {
    const reqC = makeClients(keypairs[d.req]);
    const agentC = makeClients(keypairs[d.agent]);
    const reqName = agents[d.req].name;
    const agentName = agents[d.agent].name;

    console.log(`  ${reqName} → ${agentName}: "${d.desc.slice(0, 50)}..."`);

    try {
      // Create order
      const cTx = await reqC.workOrder.create_order({
        requester: reqC.pub, description: d.desc,
        required_role: agents[d.agent].role,
        tags: ["dispute", "sap"],
        deadline: BigInt(now + 86400) as any,
        reward: BigInt(d.reward * 10_000_000) as any,
        arbiter: reqC.pub,
      });
      const cRes = await cTx.signAndSend();
      const orderId = Number(unwrap(cRes.result));
      process.stdout.write(`    create(#${orderId}) `);
      await sleep(500);

      // Claim
      const clTx = await agentC.workOrder.claim_order({ agent_authority: agentC.pub, order_id: BigInt(orderId) as any });
      await clTx.signAndSend();
      process.stdout.write("→ claim ");
      await sleep(500);

      // Submit (bad work)
      const hash = createHash("sha256").update("incomplete garbage data").digest();
      const sTx = await agentC.workOrder.submit_result({ agent_authority: agentC.pub, order_id: BigInt(orderId) as any, result_hash: Buffer.from(hash) });
      await sTx.signAndSend();
      process.stdout.write("→ submit ");
      await sleep(500);

      // Dispute!
      const dTx = await reqC.workOrder.dispute_order({ requester: reqC.pub, order_id: BigInt(orderId) as any });
      await dTx.signAndSend();
      console.log("→ DISPUTED ✗");
      await sleep(500);

    } catch (e: any) {
      console.log(`    FAILED: ${e.message?.slice(0, 60)}`);
    }
  }

  // Also give Nexus some more completions to vary the leaderboard
  // Nexus currently has 1 task. Let's have Nexus do 2 more tasks for other requesters.
  const extraOrders = [
    { req: 9, agent: 0, desc: "Coordinate the dispute resolution workflow for disputed agents", reward: 4 },
    { req: 10, agent: 0, desc: "Design agent onboarding pipeline for new Stellar builders", reward: 5 },
  ];

  console.log("\n  Extra orders for leaderboard variety...");
  for (const o of extraOrders) {
    const reqC = makeClients(keypairs[o.req]);
    const agentC = makeClients(keypairs[o.agent]);

    try {
      const cTx = await reqC.workOrder.create_order({
        requester: reqC.pub, description: o.desc,
        required_role: agents[o.agent].role,
        tags: ["protocol", "sap"],
        deadline: BigInt(now + 86400) as any,
        reward: BigInt(o.reward * 10_000_000) as any,
        arbiter: reqC.pub,
      });
      const cRes = await cTx.signAndSend();
      const orderId = Number(unwrap(cRes.result));
      await sleep(300);

      await (await agentC.workOrder.claim_order({ agent_authority: agentC.pub, order_id: BigInt(orderId) as any })).signAndSend();
      await sleep(300);

      const hash = createHash("sha256").update(JSON.stringify({ order: orderId, result: o.desc })).digest();
      await (await agentC.workOrder.submit_result({ agent_authority: agentC.pub, order_id: BigInt(orderId) as any, result_hash: Buffer.from(hash) })).signAndSend();
      await sleep(300);

      await (await reqC.workOrder.approve_result({ requester: reqC.pub, order_id: BigInt(orderId) as any })).signAndSend();
      console.log(`    ${agents[o.agent].name} completed #${orderId} (+${o.reward} XLM) ✓`);
      await sleep(300);
    } catch (e: any) {
      console.log(`    FAILED: ${e.message?.slice(0, 60)}`);
    }
  }

  // Print updated scoreboard
  console.log("\n=== Updated Scoreboard ===\n");
  for (let i = 0; i < agents.length; i++) {
    try {
      const c = makeClients(keypairs[i]);
      const aTx = await c.registry.get_agent({ authority: c.pub });
      const a = unwrap(aTx.result);
      const earned = (Number(a.total_earned ?? 0) / 10_000_000).toFixed(2);
      const rep = Number(a.reputation_score ?? 0);
      const tasks = Number(a.tasks_completed ?? 0);
      const failed = Number(a.tasks_failed ?? 0);
      const bar = "█".repeat(Math.round(rep / 1000)) + "░".repeat(10 - Math.round(rep / 1000));
      console.log(`  ${agents[i].name.padEnd(10)} [${bar}] ${String(rep).padStart(5)}/10000  ${tasks}W/${failed}L  ${earned.padStart(6)} XLM`);
    } catch {}
  }

  console.log("\n=== Done ===\n");
}

main().catch(e => { console.error("Failed:", e); process.exit(1); });
