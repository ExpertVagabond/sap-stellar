/**
 * SAP ↔ x402 Bridge for Stellar
 *
 * Connects SAP on-chain work orders with x402 HTTP payments on Stellar.
 * Agents can serve results behind x402 paywalls, and requesters can
 * auto-pay + auto-approve via the bridge.
 *
 * Flow:
 *   1. Requester creates SAP order with x402 endpoint metadata
 *   2. Agent claims, executes, hosts result at x402 endpoint
 *   3. Requester probes endpoint, gets 402, pays via Stellar x402
 *   4. Bridge hashes content and submits as SAP result_hash
 *   5. Requester approves, funds flow via SAC
 */

import { createHash } from "crypto";
import type { SapStellarClient } from "./client.js";

export interface X402OrderParams {
  description: string;
  requiredRole?: string;
  tags: string[];
  deadlineSeconds: number;
  x402Endpoint: string;
  reward: bigint;
  arbiter: string;
}

export interface X402CompletionResult {
  paymentSignature: string;
  content: string;
  contentType: string;
  contentHash: string;
  sapApproved: boolean;
  orderId: number;
}

/**
 * Bridge between SAP on-chain orders and x402 HTTP payments on Stellar.
 */
export class SapX402Bridge {
  private client: SapStellarClient;

  constructor(client: SapStellarClient) {
    this.client = client;
  }

  /**
   * Create a SAP order with embedded x402 metadata.
   */
  async createX402Order(params: X402OrderParams): Promise<{
    orderId: number;
    txHash: string;
  }> {
    const enrichedDescription = `${params.description} [x402:${params.x402Endpoint}|${params.reward}|${this.client.publicKey}]`;

    return this.client.createOrder({
      description: enrichedDescription,
      requiredRole: params.requiredRole,
      tags: [...params.tags, "x402"],
      deadlineSeconds: params.deadlineSeconds,
      reward: params.reward,
      arbiter: params.arbiter,
    });
  }

  /**
   * Parse x402 metadata from a SAP order description.
   */
  static parseX402Metadata(description: string): {
    baseDescription: string;
    endpoint: string;
    amount: string;
    recipient: string;
  } | null {
    const match = description.match(/\[x402:(.+?)\|(\d+)\|(.+?)\]$/);
    if (!match) return null;
    return {
      baseDescription: description.replace(match[0], "").trim(),
      endpoint: match[1],
      amount: match[2],
      recipient: match[3],
    };
  }

  /**
   * Fetch result from x402 endpoint and auto-approve SAP order.
   *
   * Uses native fetch + x402 payment headers. The payment is handled
   * by the x402 client middleware (wrapping fetch with @x402/fetch).
   */
  async fetchAndApprove(
    orderId: number,
    x402Endpoint: string,
    x402Fetch: typeof fetch
  ): Promise<X402CompletionResult> {
    // Fetch via x402 — the wrapped fetch handles 402 → pay → retry
    const response = await x402Fetch(x402Endpoint);
    const content = await response.text();
    const contentType =
      response.headers.get("Content-Type") ?? "text/plain";
    const contentHash = createHash("sha256").update(content).digest("hex");
    const resultHash = createHash("sha256").update(content).digest();

    // Submit result hash to SAP
    await this.client.submitResult(orderId, Buffer.from(resultHash));

    // Auto-approve the order
    let sapApproved = false;
    try {
      await this.client.approveResult(orderId);
      sapApproved = true;
    } catch {
      // May already be approved or caller isn't the requester
    }

    const paymentSig =
      response.headers.get("PAYMENT-RESPONSE") ?? "direct";

    return {
      paymentSignature: paymentSig,
      content,
      contentType,
      contentHash,
      sapApproved,
      orderId,
    };
  }

  /**
   * Build x402 paywall headers for serving a task result on Stellar.
   */
  static buildPaywallHeaders(
    amount: string,
    payTo: string,
    network: string = "stellar:testnet"
  ): {
    scheme: string;
    price: string;
    network: string;
    payTo: string;
  } {
    return {
      scheme: "exact",
      price: amount,
      network,
      payTo,
    };
  }
}

/**
 * Agent-side helper for serving results behind x402 paywalls.
 */
export class SapX402Agent {
  readonly role: string;
  readonly tools: string[];
  readonly paymentAddress: string;
  readonly baseUrl: string;

  constructor(params: {
    role: string;
    tools: string[];
    paymentAddress: string;
    baseUrl: string;
  }) {
    this.role = params.role;
    this.tools = params.tools;
    this.paymentAddress = params.paymentAddress;
    this.baseUrl = params.baseUrl;
  }

  /**
   * Build 402 response for a paid result endpoint.
   */
  buildPaywallResponse(amount: string, orderId: number): {
    status: 402;
    headers: Record<string, string>;
  } {
    return {
      status: 402,
      headers: {
        "PAYMENT-REQUIRED": JSON.stringify({
          accepts: [
            {
              scheme: "exact",
              price: amount,
              network: "stellar:testnet",
              payTo: this.paymentAddress,
            },
          ],
          description: `SAP order #${orderId} result`,
          mimeType: "application/json",
        }),
      },
    };
  }
}
