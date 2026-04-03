#!/usr/bin/env node
/**
 * SAP Stellar MCP Server
 *
 * 8 tools for AI agents to interact with the Stellar Agent Protocol:
 *   sap_register_agent  — Register as an agent on the protocol
 *   sap_post_order      — Create a work order with reward escrow
 *   sap_claim_order     — Claim an open work order
 *   sap_submit_result   — Submit result hash for a claimed order
 *   sap_approve_result  — Approve and release payment
 *   sap_get_agent       — Fetch agent profile and reputation
 *   sap_list_orders     — List orders by status
 *   sap_get_reputation  — Fetch detailed reputation data
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Keypair } from "@stellar/stellar-sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { Client as RegistryClient } from "sap-registry";
import { Client as WorkOrderClient } from "sap-work-order";
import { Client as ReputationClient } from "sap-reputation";
import { createHash } from "crypto";

// ── Config ─────────────────────────────────────────────────────────────

const SECRET_KEY = process.env.STELLAR_SECRET_KEY ?? "";
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
const PASSPHRASE =
  process.env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";

// ── Helpers ────────────────────────────────────────────────────────────

function getClients() {
  if (!SECRET_KEY) throw new Error("STELLAR_SECRET_KEY not set");
  const keypair = Keypair.fromSecret(SECRET_KEY);
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

function unwrap(result: any): any {
  if (result && typeof result === "object" && "unwrap" in result) {
    return result.unwrap();
  }
  return result;
}

function txHash(sent: any): string {
  return sent.getTransactionResponse?.txHash ?? sent.getTransactionResponse?.hash ?? "unknown";
}

const STATUS_NAMES: Record<number, string> = {
  0: "Open",
  1: "Claimed",
  2: "Submitted",
  3: "Approved",
  4: "Disputed",
  5: "Cancelled",
  6: "Resolved",
};

// ── MCP Server ─────────────────────────────────────────────────────────

const server = new McpServer({
  name: "sap-stellar",
  version: "0.1.0",
});

// Tool 1: Register Agent
server.tool(
  "sap_register_agent",
  "Register as an AI agent on the Stellar Agent Protocol. Requires a bond deposit.",
  {
    role: z.string().describe("Agent specialization (e.g. 'protocol-engineer', 'onchain-analyst')"),
    tools: z.array(z.string()).describe("MCP tool names this agent can use"),
    metadata_uri: z.string().describe("URL to agent metadata (IPFS/HTTP)"),
  },
  async ({ role, tools, metadata_uri }) => {
    const c = getClients();
    const tx = await c.registry.register_agent({
      authority: c.publicKey,
      role,
      tools,
      coldstar_vault: undefined,
      metadata_uri,
    });
    const result = await tx.signAndSend();
    return {
      content: [
        {
          type: "text" as const,
          text: `Agent registered on Stellar testnet.\nAddress: ${c.publicKey}\nRole: ${role}\nTools: ${tools.join(", ")}\nTx: ${txHash(result)}`,
        },
      ],
    };
  }
);

// Tool 2: Post Order
server.tool(
  "sap_post_order",
  "Create a work order on SAP. Escrows reward tokens (XLM on testnet) in the contract.",
  {
    description: z.string().describe("Task description (max 256 chars)"),
    reward_stroops: z.number().describe("Reward in stroops (1 XLM = 10,000,000 stroops)"),
    required_role: z.string().optional().describe("Required agent role"),
    tags: z.array(z.string()).optional().describe("Tags for categorization"),
    deadline_hours: z.number().optional().describe("Hours until deadline (default 24)"),
  },
  async ({ description, reward_stroops, required_role, tags, deadline_hours }) => {
    const c = getClients();
    const deadlineSec = (deadline_hours ?? 24) * 3600;
    const now = Math.floor(Date.now() / 1000);

    const tx = await c.workOrder.create_order({
      requester: c.publicKey,
      description,
      required_role,
      tags: tags ?? [],
      deadline: BigInt(now + deadlineSec) as any,
      reward: BigInt(reward_stroops) as any,
      arbiter: c.publicKey, // self-arbiter for demo
    });
    const result = await tx.signAndSend();
    const orderId = unwrap(result.result);

    return {
      content: [
        {
          type: "text" as const,
          text: `Work order created.\nOrder ID: ${orderId}\nReward: ${reward_stroops} stroops\nDeadline: ${deadline_hours ?? 24}h\nTx: ${txHash(result)}`,
        },
      ],
    };
  }
);

// Tool 3: Claim Order
server.tool(
  "sap_claim_order",
  "Claim an open work order. Your agent must be registered and match the required role.",
  {
    order_id: z.number().describe("Order ID to claim"),
  },
  async ({ order_id }) => {
    const c = getClients();
    const tx = await c.workOrder.claim_order({
      agent_authority: c.publicKey,
      order_id: BigInt(order_id) as any,
    });
    const result = await tx.signAndSend();
    return {
      content: [
        {
          type: "text" as const,
          text: `Order #${order_id} claimed by ${c.publicKey}\nTx: ${txHash(result)}`,
        },
      ],
    };
  }
);

// Tool 4: Submit Result
server.tool(
  "sap_submit_result",
  "Submit the result of a claimed work order. The result data is hashed (SHA-256) and stored on-chain.",
  {
    order_id: z.number().describe("Order ID"),
    result_data: z.string().describe("Result content (will be SHA-256 hashed on-chain)"),
  },
  async ({ order_id, result_data }) => {
    const c = getClients();
    const hash = createHash("sha256").update(result_data).digest();

    const tx = await c.workOrder.submit_result({
      agent_authority: c.publicKey,
      order_id: BigInt(order_id) as any,
      result_hash: Buffer.from(hash),
    });
    const result = await tx.signAndSend();
    return {
      content: [
        {
          type: "text" as const,
          text: `Result submitted for order #${order_id}\nHash: ${hash.toString("hex")}\nTx: ${txHash(result)}`,
        },
      ],
    };
  }
);

// Tool 5: Approve Result
server.tool(
  "sap_approve_result",
  "Approve a submitted result. Releases escrowed reward to the agent minus protocol fee.",
  {
    order_id: z.number().describe("Order ID to approve"),
  },
  async ({ order_id }) => {
    const c = getClients();
    const tx = await c.workOrder.approve_result({
      requester: c.publicKey,
      order_id: BigInt(order_id) as any,
    });
    const result = await tx.signAndSend();
    return {
      content: [
        {
          type: "text" as const,
          text: `Order #${order_id} approved. Payment released.\nTx: ${txHash(result)}`,
        },
      ],
    };
  }
);

// Tool 6: Get Agent
server.tool(
  "sap_get_agent",
  "Fetch an agent's profile, reputation score, and task history from the registry.",
  {
    address: z.string().optional().describe("Agent address (default: your own)"),
  },
  async ({ address }) => {
    const c = getClients();
    const addr = address ?? c.publicKey;
    const tx = await c.registry.get_agent({ authority: addr });
    const agent = unwrap(tx.result);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              address: addr,
              role: agent.role,
              tools: agent.tools,
              reputation_score: Number(agent.reputation_score),
              tasks_completed: Number(agent.tasks_completed),
              tasks_failed: Number(agent.tasks_failed),
              total_earned: agent.total_earned.toString(),
              is_active: agent.is_active,
              registered_at: Number(agent.registered_at),
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Tool 7: List Orders
server.tool(
  "sap_list_orders",
  "List work orders. Can filter by status. Returns order details.",
  {
    status: z
      .enum(["open", "claimed", "submitted", "approved", "all"])
      .optional()
      .describe("Filter by status (default: all)"),
    limit: z.number().optional().describe("Max orders to return (default: 10)"),
  },
  async ({ status, limit }) => {
    const c = getClients();
    const maxOrders = limit ?? 10;
    const countTx = await c.workOrder.get_order_count();
    const total = Number(countTx.result);

    const statusFilter =
      status === "open" ? 0
      : status === "claimed" ? 1
      : status === "submitted" ? 2
      : status === "approved" ? 3
      : undefined;

    const orders: any[] = [];
    const start = Math.max(0, total - 50); // scan last 50 orders max
    for (let i = total - 1; i >= start && orders.length < maxOrders; i--) {
      try {
        const tx = await c.workOrder.get_order({
          order_id: BigInt(i) as any,
        });
        const order = unwrap(tx.result);
        if (statusFilter === undefined || order.status === statusFilter) {
          orders.push({
            order_id: i,
            description: order.description,
            status: STATUS_NAMES[order.status] ?? order.status,
            reward: order.reward.toString(),
            requester: order.requester,
            assigned_agent: order.assigned_agent ?? null,
          });
        }
      } catch {
        // Order may not exist
      }
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ total_orders: total, showing: orders.length, orders }, null, 2),
        },
      ],
    };
  }
);

// Tool 8: Get Reputation
server.tool(
  "sap_get_reputation",
  "Fetch detailed reputation data for an agent including specializations and composite score.",
  {
    address: z.string().optional().describe("Agent address (default: your own)"),
  },
  async ({ address }) => {
    const c = getClients();
    const addr = address ?? c.publicKey;
    const tx = await c.reputation.get_reputation({ agent_addr: addr });
    const rep = unwrap(tx.result);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              agent: addr,
              composite_score: Number(rep.composite_score),
              total_tasks: Number(rep.total_tasks),
              successful_tasks: Number(rep.successful_tasks),
              failed_tasks: Number(rep.failed_tasks),
              total_earned: rep.total_earned.toString(),
              avg_completion_time: Number(rep.avg_completion_time),
              specializations: rep.specializations.map((s: any) => ({
                name: s.name,
                total: Number(s.total),
                successes: Number(s.successes),
                score: Number(s.score),
              })),
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ── Start ──────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP server error:", err);
  process.exit(1);
});
