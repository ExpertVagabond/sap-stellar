/**
 * SAP Stellar SDK Client
 *
 * Unified client wrapping all three Soroban contracts:
 * - Agent Registry (registration, bonds, activation)
 * - Work Order (task lifecycle, USDC escrow)
 * - Reputation (composite scoring, decay)
 */

import { Keypair } from "@stellar/stellar-sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { Client as RegistryClient } from "sap-registry";
import type { AgentData } from "sap-registry";
import { Client as WorkOrderClient } from "sap-work-order";
import type { WorkOrderData, ProtocolConfig } from "sap-work-order";
import { Client as ReputationClient } from "sap-reputation";
import type { ReputationData } from "sap-reputation";
import { type SapConfig, TESTNET_CONFIG } from "./types.js";

/** Extract tx hash from a SentTransaction result */
function txHash(result: any): string {
  const resp = result.getTransactionResponse;
  return resp?.txHash ?? resp?.hash ?? "unknown";
}

export class SapStellarClient {
  readonly config: SapConfig;
  readonly keypair: Keypair;
  readonly registry: RegistryClient;
  readonly workOrder: WorkOrderClient;
  readonly reputation: ReputationClient;

  constructor(secretKey: string, config: SapConfig = TESTNET_CONFIG) {
    this.config = config;
    this.keypair = Keypair.fromSecret(secretKey);

    const { signTransaction, signAuthEntry } = basicNodeSigner(
      this.keypair,
      config.networkPassphrase
    );

    const clientOpts = {
      publicKey: this.keypair.publicKey(),
      rpcUrl: config.rpcUrl,
      networkPassphrase: config.networkPassphrase,
      signTransaction,
      signAuthEntry,
    };

    this.registry = new RegistryClient({
      ...clientOpts,
      contractId: config.registryContract,
    });

    this.workOrder = new WorkOrderClient({
      ...clientOpts,
      contractId: config.workOrderContract,
    });

    this.reputation = new ReputationClient({
      ...clientOpts,
      contractId: config.reputationContract,
    });
  }

  get publicKey(): string {
    return this.keypair.publicKey();
  }

  // ── Agent Registry ──────────────────────────────────────────────────

  async registerAgent(
    role: string,
    tools: string[],
    metadataUri: string,
    coldstarVault?: string
  ): Promise<string> {
    const tx = await this.registry.register_agent({
      authority: this.publicKey,
      role,
      tools,
      coldstar_vault: coldstarVault,
      metadata_uri: metadataUri,
    });
    const result = await tx.signAndSend();
    return txHash(result);
  }

  async updateAgent(
    tools?: string[],
    coldstarVault?: string,
    metadataUri?: string
  ): Promise<string> {
    const tx = await this.registry.update_agent({
      authority: this.publicKey,
      tools,
      coldstar_vault: coldstarVault,
      metadata_uri: metadataUri,
    });
    const result = await tx.signAndSend();
    return txHash(result);
  }

  async deactivateAgent(): Promise<string> {
    const tx = await this.registry.deactivate_agent({
      authority: this.publicKey,
    });
    const result = await tx.signAndSend();
    return txHash(result);
  }

  async reactivateAgent(): Promise<string> {
    const tx = await this.registry.reactivate_agent({
      authority: this.publicKey,
    });
    const result = await tx.signAndSend();
    return txHash(result);
  }

  async withdrawBond(): Promise<string> {
    const tx = await this.registry.withdraw_bond({
      authority: this.publicKey,
    });
    const result = await tx.signAndSend();
    return txHash(result);
  }

  async getAgent(authority?: string): Promise<AgentData> {
    const tx = await this.registry.get_agent({
      authority: authority ?? this.publicKey,
    });
    const result = tx.result;
    if ("unwrap" in result) return (result as any).unwrap();
    return result as unknown as AgentData;
  }

  async getAgentCount(): Promise<number> {
    const tx = await this.registry.get_agent_count();
    return tx.result as unknown as number;
  }

  // ── Work Orders ─────────────────────────────────────────────────────

  async createOrder(params: {
    description: string;
    requiredRole?: string;
    tags: string[];
    deadlineSeconds: number;
    reward: bigint;
    arbiter: string;
  }): Promise<{ orderId: number; txHash: string }> {
    const now = Math.floor(Date.now() / 1000);
    const deadline = now + params.deadlineSeconds;

    const tx = await this.workOrder.create_order({
      requester: this.publicKey,
      description: params.description,
      required_role: params.requiredRole,
      tags: params.tags,
      deadline: BigInt(deadline) as any,
      reward: params.reward as any,
      arbiter: params.arbiter,
    });

    const result = await tx.signAndSend();
    const orderId = result.result;
    return {
      orderId: Number(orderId),
      txHash: txHash(result),
    };
  }

  async claimOrder(orderId: number): Promise<string> {
    const tx = await this.workOrder.claim_order({
      agent_authority: this.publicKey,
      order_id: BigInt(orderId) as any,
    });
    const result = await tx.signAndSend();
    return txHash(result);
  }

  async submitResult(orderId: number, resultHash: Buffer): Promise<string> {
    const tx = await this.workOrder.submit_result({
      agent_authority: this.publicKey,
      order_id: BigInt(orderId) as any,
      result_hash: resultHash,
    });
    const result = await tx.signAndSend();
    return txHash(result);
  }

  async approveResult(orderId: number): Promise<string> {
    const tx = await this.workOrder.approve_result({
      requester: this.publicKey,
      order_id: BigInt(orderId) as any,
    });
    const result = await tx.signAndSend();
    return txHash(result);
  }

  async cancelOrder(orderId: number): Promise<string> {
    const tx = await this.workOrder.cancel_order({
      requester: this.publicKey,
      order_id: BigInt(orderId) as any,
    });
    const result = await tx.signAndSend();
    return txHash(result);
  }

  async disputeOrder(orderId: number): Promise<string> {
    const tx = await this.workOrder.dispute_order({
      requester: this.publicKey,
      order_id: BigInt(orderId) as any,
    });
    const result = await tx.signAndSend();
    return txHash(result);
  }

  async resolveDispute(
    orderId: number,
    inFavorOfRequester: boolean
  ): Promise<string> {
    const tx = await this.workOrder.resolve_dispute({
      arbiter: this.publicKey,
      order_id: BigInt(orderId) as any,
      in_favor_of_requester: inFavorOfRequester,
    });
    const result = await tx.signAndSend();
    return txHash(result);
  }

  async getOrder(orderId: number): Promise<WorkOrderData> {
    const tx = await this.workOrder.get_order({
      order_id: BigInt(orderId) as any,
    });
    const result = tx.result;
    if ("unwrap" in result) return (result as any).unwrap();
    return result as unknown as WorkOrderData;
  }

  async getOrderCount(): Promise<number> {
    const tx = await this.workOrder.get_order_count();
    return Number(tx.result);
  }

  async getProtocolConfig(): Promise<ProtocolConfig> {
    const tx = await this.workOrder.get_config();
    const result = tx.result;
    if ("unwrap" in result) return (result as any).unwrap();
    return result as unknown as ProtocolConfig;
  }

  // ── Reputation ──────────────────────────────────────────────────────

  async initReputation(agentAddr: string): Promise<string> {
    const tx = await this.reputation.init_reputation({
      authority: this.publicKey,
      agent_addr: agentAddr,
    });
    const result = await tx.signAndSend();
    return txHash(result);
  }

  async recordSuccess(
    agentAddr: string,
    earned: bigint,
    completionTime: number,
    specialization: string
  ): Promise<string> {
    const tx = await this.reputation.record_success({
      authority: this.publicKey,
      agent_addr: agentAddr,
      earned: earned as any,
      completion_time: BigInt(completionTime) as any,
      specialization,
    });
    const result = await tx.signAndSend();
    return txHash(result);
  }

  async recordFailure(
    agentAddr: string,
    specialization: string
  ): Promise<string> {
    const tx = await this.reputation.record_failure({
      authority: this.publicKey,
      agent_addr: agentAddr,
      specialization,
    });
    const result = await tx.signAndSend();
    return txHash(result);
  }

  async applyDecay(agentAddr: string): Promise<string> {
    const tx = await this.reputation.apply_decay({
      agent_addr: agentAddr,
    });
    const result = await tx.signAndSend();
    return txHash(result);
  }

  async getReputation(agentAddr: string): Promise<ReputationData> {
    const tx = await this.reputation.get_reputation({
      agent_addr: agentAddr,
    });
    const result = tx.result;
    if ("unwrap" in result) return (result as any).unwrap();
    return result as unknown as ReputationData;
  }
}
