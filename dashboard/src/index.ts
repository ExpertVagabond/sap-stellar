/**
 * SAP-on-Stellar Dashboard
 *
 * Cloudflare Worker that reads protocol state from Soroban RPC
 * and renders an HTML dashboard showing agents, orders, and stats.
 */

interface Env {
  STELLAR_RPC: string;
  REGISTRY_CONTRACT: string;
  WORK_ORDER_CONTRACT: string;
  REPUTATION_CONTRACT: string;
  NETWORK_PASSPHRASE: string;
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

const STATUS_COLORS: Record<number, string> = {
  0: "#22c55e",
  1: "#eab308",
  2: "#3b82f6",
  3: "#10b981",
  4: "#ef4444",
  5: "#6b7280",
  6: "#8b5cf6",
};

// ── Soroban RPC Helpers ────────────────────────────────────────────────

async function sorobanCall(
  rpc: string,
  contractId: string,
  method: string,
  args: any[] = [],
  passphrase: string
): Promise<any> {
  // Use simulateTransaction to call read-only contract methods
  const { Keypair, TransactionBuilder, Networks, Operation, Account, xdr, Address } = await import("@stellar/stellar-sdk");
  const { Server } = await import("@stellar/stellar-sdk/rpc");
  const server = new Server(rpc);

  // Use a throwaway source account for simulation
  const source = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const account = new Account(source, "0");

  const contract = new Address(contractId);
  const tx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: passphrase,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: contractId,
        function: method,
        args: args.map((a) => a),
      })
    )
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if ("error" in sim) throw new Error(`Simulation failed: ${(sim as any).error}`);
  if (!("result" in sim) || !sim.result) throw new Error("No simulation result");

  return sim.result;
}

// ── Dashboard HTML ─────────────────────────────────────────────────────

function renderDashboard(data: {
  agentCount: number;
  orderCount: number;
  contracts: { registry: string; workOrder: string; reputation: string };
  orders: any[];
}): string {
  const ordersHtml = data.orders
    .map(
      (o) => `
      <tr>
        <td>#${o.id}</td>
        <td>${escHtml(o.description?.slice(0, 60) ?? "—")}${(o.description?.length ?? 0) > 60 ? "…" : ""}</td>
        <td><span class="badge" style="background:${STATUS_COLORS[o.status] ?? "#6b7280"}">${STATUS_NAMES[o.status] ?? o.status}</span></td>
        <td>${formatStroops(o.reward)} XLM</td>
        <td>${truncAddr(o.requester)}</td>
        <td>${o.assigned_agent ? truncAddr(o.assigned_agent) : "—"}</td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SAP on Stellar — Dashboard</title>
<style>
  :root { --bg: #0a0a0a; --card: #141414; --border: #262626; --text: #e5e5e5; --muted: #737373; --accent: #f59e0b; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: "SF Mono", "Fira Code", "JetBrains Mono", monospace; background: var(--bg); color: var(--text); padding: 2rem; max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  .sub { color: var(--muted); font-size: 0.85rem; margin-bottom: 2rem; }
  .sub a { color: var(--accent); text-decoration: none; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .stat { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 1.25rem; }
  .stat .label { color: var(--muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .stat .value { font-size: 1.75rem; font-weight: 700; margin-top: 0.25rem; color: var(--accent); }
  .section { margin-bottom: 2rem; }
  .section h2 { font-size: 1rem; margin-bottom: 1rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
  table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid var(--border); font-size: 0.85rem; }
  th { color: var(--muted); font-weight: 500; text-transform: uppercase; font-size: 0.7rem; letter-spacing: 0.05em; }
  tr:last-child td { border-bottom: none; }
  .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.7rem; font-weight: 600; color: #000; }
  .contracts { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; font-size: 0.8rem; }
  .contracts a { color: var(--accent); text-decoration: none; word-break: break-all; }
  .contracts .row { display: flex; justify-content: space-between; padding: 0.35rem 0; border-bottom: 1px solid var(--border); }
  .contracts .row:last-child { border: none; }
  .contracts .key { color: var(--muted); }
  .empty { text-align: center; padding: 2rem; color: var(--muted); }
  footer { margin-top: 3rem; text-align: center; color: var(--muted); font-size: 0.75rem; }
  footer a { color: var(--accent); text-decoration: none; }
</style>
</head>
<body>
  <h1>SAP on Stellar</h1>
  <p class="sub">Agent coordination protocol on Stellar/Soroban — <a href="https://dorahacks.io/hackathon/stellar-agents-x402-stripe-mpp/detail">Stellar Hacks</a></p>

  <div class="stats">
    <div class="stat"><div class="label">Registered Agents</div><div class="value">${data.agentCount}</div></div>
    <div class="stat"><div class="label">Work Orders</div><div class="value">${data.orderCount}</div></div>
    <div class="stat"><div class="label">Network</div><div class="value" style="font-size:1rem">Stellar Testnet</div></div>
    <div class="stat"><div class="label">Protocol Fee</div><div class="value" style="font-size:1rem">2.5%</div></div>
  </div>

  <div class="section">
    <h2>Recent Orders</h2>
    ${
      data.orders.length > 0
        ? `<table>
      <thead><tr><th>ID</th><th>Description</th><th>Status</th><th>Reward</th><th>Requester</th><th>Agent</th></tr></thead>
      <tbody>${ordersHtml}</tbody>
    </table>`
        : '<div class="empty">No orders yet. Run the demo: <code>cd agents && npx tsx demo-runner.ts</code></div>'
    }
  </div>

  <div class="section">
    <h2>Contracts</h2>
    <div class="contracts">
      <div class="row"><span class="key">Registry</span><a href="https://testnet.stellar.expert/explorer/testnet/contract/${data.contracts.registry}" target="_blank">${data.contracts.registry}</a></div>
      <div class="row"><span class="key">Work Order</span><a href="https://testnet.stellar.expert/explorer/testnet/contract/${data.contracts.workOrder}" target="_blank">${data.contracts.workOrder}</a></div>
      <div class="row"><span class="key">Reputation</span><a href="https://testnet.stellar.expert/explorer/testnet/contract/${data.contracts.reputation}" target="_blank">${data.contracts.reputation}</a></div>
    </div>
  </div>

  <footer>
    Built by <a href="https://github.com/ExpertVagabond">Purple Squirrel Media</a> · <a href="https://github.com/ExpertVagabond/sap-stellar">GitHub</a> · Powered by Soroban + x402
  </footer>
</body>
</html>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr ?? "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatStroops(stroops: string | number | bigint): string {
  const n = Number(stroops) / 10_000_000;
  return n.toFixed(2);
}

// ── Worker Handler ─────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // JSON API endpoints
    if (url.pathname === "/api/stats") {
      try {
        const stats = await getStats(env);
        return Response.json(stats);
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500 });
      }
    }

    if (url.pathname === "/api/orders") {
      try {
        const orders = await getOrders(env);
        return Response.json({ orders });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500 });
      }
    }

    // Main dashboard
    if (url.pathname === "/" || url.pathname === "") {
      try {
        const [stats, orders] = await Promise.all([
          getStats(env),
          getOrders(env),
        ]);

        const html = renderDashboard({
          agentCount: stats.agents,
          orderCount: stats.orders,
          contracts: {
            registry: env.REGISTRY_CONTRACT,
            workOrder: env.WORK_ORDER_CONTRACT,
            reputation: env.REPUTATION_CONTRACT,
          },
          orders,
        });

        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      } catch (e: any) {
        return new Response(`Dashboard error: ${e.message}`, { status: 500 });
      }
    }

    return new Response("Not found", { status: 404 });
  },
};

// ── Data Fetching ──────────────────────────────────────────────────────

async function getStats(env: Env) {
  // Use the Express server API as a proxy to avoid Soroban SDK in the Worker
  // For now, call Soroban RPC directly
  const { Server } = await import("@stellar/stellar-sdk/rpc");
  const { Address, xdr, scValToNative, Keypair, TransactionBuilder, Account, Operation, nativeToScVal } = await import("@stellar/stellar-sdk");

  const server = new Server(env.STELLAR_RPC);

  async function callContract(contractId: string, method: string): Promise<any> {
    const source = Keypair.random().publicKey();
    const account = new Account(source, "0");

    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: env.NETWORK_PASSPHRASE,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: contractId,
          function: method,
          args: [],
        })
      )
      .setTimeout(30)
      .build();

    const sim = await server.simulateTransaction(tx);
    if ("error" in sim) return null;
    if (!("result" in sim) || !sim.result) return null;

    const retval = sim.result.retval;
    return scValToNative(retval);
  }

  const [agentCount, orderCount] = await Promise.all([
    callContract(env.REGISTRY_CONTRACT, "get_agent_count"),
    callContract(env.WORK_ORDER_CONTRACT, "get_order_count"),
  ]);

  return {
    agents: Number(agentCount ?? 0),
    orders: Number(orderCount ?? 0),
    network: "stellar:testnet",
  };
}

async function getOrders(env: Env): Promise<any[]> {
  const { Server } = await import("@stellar/stellar-sdk/rpc");
  const { Address, xdr, scValToNative, Keypair, TransactionBuilder, Account, Operation, nativeToScVal } = await import("@stellar/stellar-sdk");

  const server = new Server(env.STELLAR_RPC);

  async function callContract(contractId: string, method: string, args: any[] = []): Promise<any> {
    const source = Keypair.random().publicKey();
    const account = new Account(source, "0");

    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: env.NETWORK_PASSPHRASE,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: contractId,
          function: method,
          args,
        })
      )
      .setTimeout(30)
      .build();

    const sim = await server.simulateTransaction(tx);
    if ("error" in sim) return null;
    if (!("result" in sim) || !sim.result) return null;

    return scValToNative(sim.result.retval);
  }

  // Get order count
  const count = Number(await callContract(env.WORK_ORDER_CONTRACT, "get_order_count") ?? 0);

  const orders: any[] = [];
  const start = Math.max(0, count - 20);
  for (let i = count - 1; i >= start; i--) {
    try {
      const arg = nativeToScVal(BigInt(i), { type: "u64" });
      const order = await callContract(env.WORK_ORDER_CONTRACT, "get_order", [arg]);
      if (order) {
        orders.push({ id: i, ...order });
      }
    } catch {
      // Skip missing orders
    }
  }

  return orders;
}
