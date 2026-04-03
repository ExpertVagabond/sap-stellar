/**
 * SAP Stellar Payment Server
 *
 * Express server that:
 * 1. Exposes SAP protocol as REST API
 * 2. Gates agent results behind x402 paywalls on Stellar
 * 3. Supports MPP (Machine Payments Protocol) charge mode
 * 4. Handles payment verification and order lifecycle
 */

import express from "express";
import cors from "cors";
import { Keypair } from "@stellar/stellar-sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { Client as RegistryClient } from "sap-registry";
import { Client as WorkOrderClient } from "sap-work-order";
import { Client as ReputationClient } from "sap-reputation";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

const PORT = parseInt(process.env.PORT ?? "3402", 10);
const SECRET_KEY = process.env.STELLAR_SECRET_KEY ?? "";
const REGISTRY_CONTRACT =
  process.env.REGISTRY_CONTRACT ??
  "CDJ3GGEJFAP27RCE4MXDL336Q5Q3KBPWYJXDAJYNOUI3FMYKHZNU7DNF";
const WORK_ORDER_CONTRACT =
  process.env.WORK_ORDER_CONTRACT ??
  "CDRSD3BE3UNI4YGXQ6ND4UZ3KO2WT4H52AZHR6MHLP53JJ2Q3CTKWDVH";
const REPUTATION_CONTRACT =
  process.env.REPUTATION_CONTRACT ??
  "CBDHI2BZ36WA7ROUXYONZXMARTUMXYAHEPXPE7HKJMST6XBTKOHPNLFY";
const RPC_URL =
  process.env.STELLAR_RPC ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
const TREASURY =
  process.env.TREASURY ??
  "GDNVGOYZJIYLOBFZ2SKUUNW7TLSGAXIIGF3VNXVUTBYTWPV5JDDDUFOA";

// ── x402 Paywall Config ────────────────────────────────────────────────

const RESULT_PRICE = process.env.RESULT_PRICE ?? "$0.01";
const PAY_TO = process.env.PAY_TO ?? TREASURY;
const FACILITATOR_URL =
  process.env.FACILITATOR_URL ??
  "https://channels.openzeppelin.com/x402/testnet";
const FACILITATOR_API_KEY = process.env.FACILITATOR_API_KEY ?? "";

// ── Setup Clients ──────────────────────────────────────────────────────

function buildClients(secretKey: string) {
  const keypair = Keypair.fromSecret(secretKey);
  const { signTransaction, signAuthEntry } = basicNodeSigner(
    keypair,
    NETWORK_PASSPHRASE
  );
  const opts = {
    publicKey: keypair.publicKey(),
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    signTransaction,
    signAuthEntry,
  };

  return {
    keypair,
    registry: new RegistryClient({ ...opts, contractId: REGISTRY_CONTRACT }),
    workOrder: new WorkOrderClient({
      ...opts,
      contractId: WORK_ORDER_CONTRACT,
    }),
    reputation: new ReputationClient({
      ...opts,
      contractId: REPUTATION_CONTRACT,
    }),
  };
}

// ── Express App ────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    network: "stellar:testnet",
    contracts: {
      registry: REGISTRY_CONTRACT,
      workOrder: WORK_ORDER_CONTRACT,
      reputation: REPUTATION_CONTRACT,
    },
  });
});

// ── Agent Endpoints ────────────────────────────────────────────────────

// List all agents (read-only, no auth needed)
app.get("/api/agents", async (_req, res) => {
  try {
    const clients = buildClients(SECRET_KEY);
    const countTx = await clients.registry.get_agent_count();
    const count = Number(countTx.result);
    res.json({ count, network: "stellar:testnet" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get agent by address
app.get("/api/agents/:addr", async (req, res) => {
  try {
    const clients = buildClients(SECRET_KEY);
    const tx = await clients.registry.get_agent({ authority: req.params.addr });
    const result = tx.result as any;
    const agent = result.unwrap ? result.unwrap() : result;
    res.json(agent);
  } catch (err: any) {
    res.status(404).json({ error: "Agent not found", details: err.message });
  }
});

// ── Order Endpoints ────────────────────────────────────────────────────

// Get order count
app.get("/api/orders/count", async (_req, res) => {
  try {
    const clients = buildClients(SECRET_KEY);
    const tx = await clients.workOrder.get_order_count();
    res.json({ count: Number(tx.result) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get order by ID
app.get("/api/orders/:id", async (req, res) => {
  try {
    const clients = buildClients(SECRET_KEY);
    const orderId = parseInt(req.params.id, 10);
    const tx = await clients.workOrder.get_order({
      order_id: BigInt(orderId) as any,
    });
    const result = tx.result as any;
    const order = result.unwrap ? result.unwrap() : result;
    res.json(order);
  } catch (err: any) {
    res.status(404).json({ error: "Order not found", details: err.message });
  }
});

// Get protocol config
app.get("/api/config", async (_req, res) => {
  try {
    const clients = buildClients(SECRET_KEY);
    const tx = await clients.workOrder.get_config();
    const result = tx.result as any;
    const config = result.unwrap ? result.unwrap() : result;
    res.json(config);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Reputation Endpoints ───────────────────────────────────────────────

app.get("/api/reputation/:addr", async (req, res) => {
  try {
    const clients = buildClients(SECRET_KEY);
    const tx = await clients.reputation.get_reputation({
      agent_addr: req.params.addr,
    });
    const result = tx.result as any;
    const rep = result.unwrap ? result.unwrap() : result;
    res.json(rep);
  } catch (err: any) {
    res
      .status(404)
      .json({ error: "Reputation not found", details: err.message });
  }
});

// ── x402 Paywall Endpoint ──────────────────────────────────────────────

// Build x402 facilitator client + resource server
const facilitatorClient = new HTTPFacilitatorClient({
  url: FACILITATOR_URL,
  createAuthHeaders: FACILITATOR_API_KEY
    ? async () => {
        const h = { Authorization: `Bearer ${FACILITATOR_API_KEY}` };
        return { verify: h, settle: h, supported: h };
      }
    : undefined,
});

const x402Server = new x402ResourceServer(facilitatorClient).register(
  "stellar:testnet",
  new ExactStellarScheme()
);

// Gate agent results behind real x402 micropayments on Stellar
app.use(
  paymentMiddleware(
    {
      "GET /api/results/:orderId": {
        accepts: [
          {
            scheme: "exact",
            price: RESULT_PRICE,
            network: "stellar:testnet",
            payTo: PAY_TO,
          },
        ],
        description: "Agent task result — paid via x402 on Stellar",
        mimeType: "application/json",
      },
    },
    x402Server
  )
);

// This only executes after x402 payment is verified + settled
app.get("/api/results/:orderId", (req, res) => {
  res.json({
    orderId: req.params.orderId,
    result: "Agent task result data",
    paid: true,
    network: "stellar:testnet",
    settlement: "x402 via OpenZeppelin facilitator",
  });
});

// ── MPP (Machine Payments Protocol) Endpoint ───────────────────────────

// MPP charge mode: alternative to x402 for Stripe-compatible flows.
// Client sends GET, gets 402 with WWW-Authenticate: Payment header,
// signs credential, retries with Authorization: Payment header.
app.get("/api/mpp/results/:orderId", (req, res) => {
  const authHeader = req.headers["authorization"];

  if (!authHeader?.startsWith("Payment ")) {
    // Return 402 with MPP challenge
    res.status(402);
    res.setHeader(
      "WWW-Authenticate",
      `Payment realm="sap-stellar" ` +
      `amount="${RESULT_PRICE}" ` +
      `currency="USDC" ` +
      `network="stellar:testnet" ` +
      `recipient="${PAY_TO}" ` +
      `description="SAP order #${req.params.orderId} result"`
    );
    res.json({
      error: "Payment required",
      protocol: "MPP",
      message: `Pay ${RESULT_PRICE} via MPP to access this result`,
    });
    return;
  }

  // Payment credential received — in production, verify via MPP settlement
  res.setHeader("Payment-Receipt", `stellar:testnet:${Date.now()}`);
  res.json({
    orderId: req.params.orderId,
    result: "Agent task result data",
    paid: true,
    protocol: "MPP",
    network: "stellar:testnet",
    settlement: "MPP charge mode via Stellar",
  });
});

// ── Payment Discovery ──────────────────────────────────────────────────

// Standard x402 discovery endpoint
app.get("/.well-known/x402", (_req, res) => {
  res.json({
    version: "2.0",
    resources: [
      {
        path: "/api/results/:orderId",
        method: "GET",
        accepts: [{
          scheme: "exact",
          price: RESULT_PRICE,
          network: "stellar:testnet",
          payTo: PAY_TO,
        }],
        description: "Agent task results — paid via x402 on Stellar",
      },
    ],
  });
});

// MPP discovery
app.get("/.well-known/mpp", (_req, res) => {
  res.json({
    version: "1.0",
    provider: "sap-stellar",
    resources: [
      {
        path: "/api/mpp/results/:orderId",
        method: "GET",
        amount: RESULT_PRICE,
        currency: "USDC",
        network: "stellar:testnet",
        recipient: PAY_TO,
        description: "Agent task results — paid via MPP on Stellar",
      },
    ],
  });
});

// ── Protocol Stats ─────────────────────────────────────────────────────

app.get("/api/stats", async (_req, res) => {
  try {
    const clients = buildClients(SECRET_KEY);

    const [agentCountTx, orderCountTx] = await Promise.all([
      clients.registry.get_agent_count(),
      clients.workOrder.get_order_count(),
    ]);

    res.json({
      network: "stellar:testnet",
      agents: Number(agentCountTx.result),
      orders: Number(orderCountTx.result),
      contracts: {
        registry: REGISTRY_CONTRACT,
        workOrder: WORK_ORDER_CONTRACT,
        reputation: REPUTATION_CONTRACT,
      },
      treasury: TREASURY,
      payments: {
        x402: {
          resultPrice: RESULT_PRICE,
          payTo: PAY_TO,
          facilitator: "https://channels.openzeppelin.com/x402/testnet",
          discovery: "/.well-known/x402",
        },
        mpp: {
          resultPrice: RESULT_PRICE,
          payTo: PAY_TO,
          discovery: "/.well-known/mpp",
        },
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start ──────────────────────────────────────────────────────────────

if (SECRET_KEY) {
  app.listen(PORT, () => {
    console.log(`SAP Stellar Server running on :${PORT}`);
    console.log(`  Network:  stellar:testnet`);
    console.log(`  Registry: ${REGISTRY_CONTRACT}`);
    console.log(`  Orders:   ${WORK_ORDER_CONTRACT}`);
    console.log(`  Rep:      ${REPUTATION_CONTRACT}`);
    console.log(`  x402:     ${RESULT_PRICE} per result`);
  });
} else {
  console.log("SAP Stellar Server (read-only mode — no STELLAR_SECRET_KEY)");
  app.listen(PORT, () => {
    console.log(`Listening on :${PORT}`);
  });
}

export default app;
