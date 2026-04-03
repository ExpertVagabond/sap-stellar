import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CDRSD3BE3UNI4YGXQ6ND4UZ3KO2WT4H52AZHR6MHLP53JJ2Q3CTKWDVH",
  }
} as const

export type DataKey = {tag: "Config", values: void} | {tag: "OrderCount", values: void} | {tag: "Order", values: readonly [u64]} | {tag: "Pair", values: readonly [string, string]};


export interface PairData {
  last_approved: u64;
  total_completions: u64;
}


/**
 * Mirror of AgentData from the registry contract.
 * Must match field names and types exactly for cross-contract deserialization.
 */
export interface AgentInfo {
  authority: string;
  coldstar_vault: Option<string>;
  is_active: boolean;
  metadata_uri: string;
  registered_at: u64;
  reputation_score: u64;
  role: string;
  tasks_completed: u64;
  tasks_failed: u64;
  tools: Array<string>;
  total_earned: i128;
}


export interface WorkOrderData {
  arbiter: string;
  assigned_agent: Option<string>;
  completed_at: u64;
  created_at: u64;
  deadline: u64;
  description: string;
  order_id: u64;
  requester: string;
  required_role: Option<string>;
  result_hash: Option<Buffer>;
  reward: i128;
  status: u32;
  tags: Array<string>;
}


export interface ProtocolConfig {
  admin: string;
  dispute_bond: i128;
  dispute_window: u64;
  fee_bps: u64;
  min_fee: i128;
  min_reward: i128;
  registry_contract: string;
  treasury: string;
  usdc_token: string;
  wash_cooldown: u64;
  wash_fee_bps: u64;
}

export const WorkOrderError = {
  1: {message:"AlreadyInitialized"},
  2: {message:"NotInitialized"},
  3: {message:"DescriptionTooLong"},
  4: {message:"TooManyTags"},
  5: {message:"TagTooLong"},
  6: {message:"DeadlinePassed"},
  7: {message:"RewardTooLow"},
  8: {message:"NotOpen"},
  9: {message:"AgentInactive"},
  10: {message:"RoleMismatch"},
  11: {message:"NotClaimed"},
  12: {message:"NotAssignedAgent"},
  13: {message:"NotSubmitted"},
  14: {message:"DisputeWindowClosed"},
  15: {message:"NotDisputed"},
  16: {message:"Overflow"},
  17: {message:"UnauthorizedArbiter"},
  18: {message:"AgentNotFound"},
  19: {message:"OrderNotFound"}
}

export interface Client {
  /**
   * Construct and simulate a get_order transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_order: ({order_id}: {order_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<WorkOrderData>>>

  /**
   * Construct and simulate a get_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_config: (options?: MethodOptions) => Promise<AssembledTransaction<Result<ProtocolConfig>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Initialize with a full config struct (Soroban max 10 params per function).
   */
  initialize: ({config}: {config: ProtocolConfig}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a claim_order transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Agent claims an open work order. Validates role match and deadline.
   */
  claim_order: ({agent_authority, order_id}: {agent_authority: string, order_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a cancel_order transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Requester cancels an open (unclaimed) order. Escrow returned.
   */
  cancel_order: ({requester, order_id}: {requester: string, order_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a create_order transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Post a new work order. USDC reward is escrowed in this contract.
   */
  create_order: ({requester, description, required_role, tags, deadline, reward, arbiter}: {requester: string, description: string, required_role: Option<string>, tags: Array<string>, deadline: u64, reward: i128, arbiter: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a dispute_order transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Requester disputes a submitted result. Requires dispute bond deposit.
   */
  dispute_order: ({requester, order_id}: {requester: string, order_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a submit_result transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Agent submits SHA-256 hash of the off-chain result.
   */
  submit_result: ({agent_authority, order_id, result_hash}: {agent_authority: string, order_id: u64, result_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a approve_result transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Requester approves — releases escrow minus fee. CPI updates registry.
   */
  approve_result: ({requester, order_id}: {requester: string, order_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_order_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_order_count: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a resolve_dispute transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Arbiter resolves a dispute. Winner gets reward + dispute bond.
   */
  resolve_dispute: ({arbiter, order_id, in_favor_of_requester}: {arbiter: string, order_id: u64, in_favor_of_requester: boolean}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAAAAAAAAJZ2V0X29yZGVyAAAAAAAAAQAAAAAAAAAIb3JkZXJfaWQAAAAGAAAAAQAAA+kAAAfQAAAADVdvcmtPcmRlckRhdGEAAAAAAAfQAAAADldvcmtPcmRlckVycm9yAAA=",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABAAAAAAAAAAAAAAABkNvbmZpZwAAAAAAAAAAAAAAAAAKT3JkZXJDb3VudAAAAAAAAQAAAAAAAAAFT3JkZXIAAAAAAAABAAAABgAAAAEAAAAAAAAABFBhaXIAAAACAAAAEwAAABM=",
        "AAAAAAAAAAAAAAAKZ2V0X2NvbmZpZwAAAAAAAAAAAAEAAAPpAAAH0AAAAA5Qcm90b2NvbENvbmZpZwAAAAAH0AAAAA5Xb3JrT3JkZXJFcnJvcgAA",
        "AAAAAAAAAEpJbml0aWFsaXplIHdpdGggYSBmdWxsIGNvbmZpZyBzdHJ1Y3QgKFNvcm9iYW4gbWF4IDEwIHBhcmFtcyBwZXIgZnVuY3Rpb24pLgAAAAAACmluaXRpYWxpemUAAAAAAAEAAAAAAAAABmNvbmZpZwAAAAAH0AAAAA5Qcm90b2NvbENvbmZpZwAAAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAAOV29ya09yZGVyRXJyb3IAAA==",
        "AAAAAQAAAAAAAAAAAAAACFBhaXJEYXRhAAAAAgAAAAAAAAANbGFzdF9hcHByb3ZlZAAAAAAAAAYAAAAAAAAAEXRvdGFsX2NvbXBsZXRpb25zAAAAAAAABg==",
        "AAAAAAAAAENBZ2VudCBjbGFpbXMgYW4gb3BlbiB3b3JrIG9yZGVyLiBWYWxpZGF0ZXMgcm9sZSBtYXRjaCBhbmQgZGVhZGxpbmUuAAAAAAtjbGFpbV9vcmRlcgAAAAACAAAAAAAAAA9hZ2VudF9hdXRob3JpdHkAAAAAEwAAAAAAAAAIb3JkZXJfaWQAAAAGAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAAOV29ya09yZGVyRXJyb3IAAA==",
        "AAAAAQAAAHxNaXJyb3Igb2YgQWdlbnREYXRhIGZyb20gdGhlIHJlZ2lzdHJ5IGNvbnRyYWN0LgpNdXN0IG1hdGNoIGZpZWxkIG5hbWVzIGFuZCB0eXBlcyBleGFjdGx5IGZvciBjcm9zcy1jb250cmFjdCBkZXNlcmlhbGl6YXRpb24uAAAAAAAAAAlBZ2VudEluZm8AAAAAAAALAAAAAAAAAAlhdXRob3JpdHkAAAAAAAATAAAAAAAAAA5jb2xkc3Rhcl92YXVsdAAAAAAD6AAAABMAAAAAAAAACWlzX2FjdGl2ZQAAAAAAAAEAAAAAAAAADG1ldGFkYXRhX3VyaQAAABAAAAAAAAAADXJlZ2lzdGVyZWRfYXQAAAAAAAAGAAAAAAAAABByZXB1dGF0aW9uX3Njb3JlAAAABgAAAAAAAAAEcm9sZQAAABAAAAAAAAAAD3Rhc2tzX2NvbXBsZXRlZAAAAAAGAAAAAAAAAAx0YXNrc19mYWlsZWQAAAAGAAAAAAAAAAV0b29scwAAAAAAA+oAAAAQAAAAAAAAAAx0b3RhbF9lYXJuZWQAAAAL",
        "AAAAAAAAAD1SZXF1ZXN0ZXIgY2FuY2VscyBhbiBvcGVuICh1bmNsYWltZWQpIG9yZGVyLiBFc2Nyb3cgcmV0dXJuZWQuAAAAAAAADGNhbmNlbF9vcmRlcgAAAAIAAAAAAAAACXJlcXVlc3RlcgAAAAAAABMAAAAAAAAACG9yZGVyX2lkAAAABgAAAAEAAAPpAAAD7QAAAAAAAAfQAAAADldvcmtPcmRlckVycm9yAAA=",
        "AAAAAAAAAEBQb3N0IGEgbmV3IHdvcmsgb3JkZXIuIFVTREMgcmV3YXJkIGlzIGVzY3Jvd2VkIGluIHRoaXMgY29udHJhY3QuAAAADGNyZWF0ZV9vcmRlcgAAAAcAAAAAAAAACXJlcXVlc3RlcgAAAAAAABMAAAAAAAAAC2Rlc2NyaXB0aW9uAAAAABAAAAAAAAAADXJlcXVpcmVkX3JvbGUAAAAAAAPoAAAAEAAAAAAAAAAEdGFncwAAA+oAAAAQAAAAAAAAAAhkZWFkbGluZQAAAAYAAAAAAAAABnJld2FyZAAAAAAACwAAAAAAAAAHYXJiaXRlcgAAAAATAAAAAQAAA+kAAAAGAAAH0AAAAA5Xb3JrT3JkZXJFcnJvcgAA",
        "AAAAAAAAAEVSZXF1ZXN0ZXIgZGlzcHV0ZXMgYSBzdWJtaXR0ZWQgcmVzdWx0LiBSZXF1aXJlcyBkaXNwdXRlIGJvbmQgZGVwb3NpdC4AAAAAAAANZGlzcHV0ZV9vcmRlcgAAAAAAAAIAAAAAAAAACXJlcXVlc3RlcgAAAAAAABMAAAAAAAAACG9yZGVyX2lkAAAABgAAAAEAAAPpAAAD7QAAAAAAAAfQAAAADldvcmtPcmRlckVycm9yAAA=",
        "AAAAAAAAADNBZ2VudCBzdWJtaXRzIFNIQS0yNTYgaGFzaCBvZiB0aGUgb2ZmLWNoYWluIHJlc3VsdC4AAAAADXN1Ym1pdF9yZXN1bHQAAAAAAAADAAAAAAAAAA9hZ2VudF9hdXRob3JpdHkAAAAAEwAAAAAAAAAIb3JkZXJfaWQAAAAGAAAAAAAAAAtyZXN1bHRfaGFzaAAAAAPuAAAAIAAAAAEAAAPpAAAD7QAAAAAAAAfQAAAADldvcmtPcmRlckVycm9yAAA=",
        "AAAAAAAAAEdSZXF1ZXN0ZXIgYXBwcm92ZXMg4oCUIHJlbGVhc2VzIGVzY3JvdyBtaW51cyBmZWUuIENQSSB1cGRhdGVzIHJlZ2lzdHJ5LgAAAAAOYXBwcm92ZV9yZXN1bHQAAAAAAAIAAAAAAAAACXJlcXVlc3RlcgAAAAAAABMAAAAAAAAACG9yZGVyX2lkAAAABgAAAAEAAAPpAAAD7QAAAAAAAAfQAAAADldvcmtPcmRlckVycm9yAAA=",
        "AAAAAAAAAAAAAAAPZ2V0X29yZGVyX2NvdW50AAAAAAAAAAABAAAABg==",
        "AAAAAAAAAD5BcmJpdGVyIHJlc29sdmVzIGEgZGlzcHV0ZS4gV2lubmVyIGdldHMgcmV3YXJkICsgZGlzcHV0ZSBib25kLgAAAAAAD3Jlc29sdmVfZGlzcHV0ZQAAAAADAAAAAAAAAAdhcmJpdGVyAAAAABMAAAAAAAAACG9yZGVyX2lkAAAABgAAAAAAAAAVaW5fZmF2b3Jfb2ZfcmVxdWVzdGVyAAAAAAAAAQAAAAEAAAPpAAAD7QAAAAAAAAfQAAAADldvcmtPcmRlckVycm9yAAA=",
        "AAAAAQAAAAAAAAAAAAAADVdvcmtPcmRlckRhdGEAAAAAAAANAAAAAAAAAAdhcmJpdGVyAAAAABMAAAAAAAAADmFzc2lnbmVkX2FnZW50AAAAAAPoAAAAEwAAAAAAAAAMY29tcGxldGVkX2F0AAAABgAAAAAAAAAKY3JlYXRlZF9hdAAAAAAABgAAAAAAAAAIZGVhZGxpbmUAAAAGAAAAAAAAAAtkZXNjcmlwdGlvbgAAAAAQAAAAAAAAAAhvcmRlcl9pZAAAAAYAAAAAAAAACXJlcXVlc3RlcgAAAAAAABMAAAAAAAAADXJlcXVpcmVkX3JvbGUAAAAAAAPoAAAAEAAAAAAAAAALcmVzdWx0X2hhc2gAAAAD6AAAA+4AAAAgAAAAAAAAAAZyZXdhcmQAAAAAAAsAAAAAAAAABnN0YXR1cwAAAAAABAAAAAAAAAAEdGFncwAAA+oAAAAQ",
        "AAAAAQAAAAAAAAAAAAAADlByb3RvY29sQ29uZmlnAAAAAAALAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAADGRpc3B1dGVfYm9uZAAAAAsAAAAAAAAADmRpc3B1dGVfd2luZG93AAAAAAAGAAAAAAAAAAdmZWVfYnBzAAAAAAYAAAAAAAAAB21pbl9mZWUAAAAACwAAAAAAAAAKbWluX3Jld2FyZAAAAAAACwAAAAAAAAARcmVnaXN0cnlfY29udHJhY3QAAAAAAAATAAAAAAAAAAh0cmVhc3VyeQAAABMAAAAAAAAACnVzZGNfdG9rZW4AAAAAABMAAAAAAAAADXdhc2hfY29vbGRvd24AAAAAAAAGAAAAAAAAAAx3YXNoX2ZlZV9icHMAAAAG",
        "AAAABAAAAAAAAAAAAAAADldvcmtPcmRlckVycm9yAAAAAAATAAAAAAAAABJBbHJlYWR5SW5pdGlhbGl6ZWQAAAAAAAEAAAAAAAAADk5vdEluaXRpYWxpemVkAAAAAAACAAAAAAAAABJEZXNjcmlwdGlvblRvb0xvbmcAAAAAAAMAAAAAAAAAC1Rvb01hbnlUYWdzAAAAAAQAAAAAAAAAClRhZ1Rvb0xvbmcAAAAAAAUAAAAAAAAADkRlYWRsaW5lUGFzc2VkAAAAAAAGAAAAAAAAAAxSZXdhcmRUb29Mb3cAAAAHAAAAAAAAAAdOb3RPcGVuAAAAAAgAAAAAAAAADUFnZW50SW5hY3RpdmUAAAAAAAAJAAAAAAAAAAxSb2xlTWlzbWF0Y2gAAAAKAAAAAAAAAApOb3RDbGFpbWVkAAAAAAALAAAAAAAAABBOb3RBc3NpZ25lZEFnZW50AAAADAAAAAAAAAAMTm90U3VibWl0dGVkAAAADQAAAAAAAAATRGlzcHV0ZVdpbmRvd0Nsb3NlZAAAAAAOAAAAAAAAAAtOb3REaXNwdXRlZAAAAAAPAAAAAAAAAAhPdmVyZmxvdwAAABAAAAAAAAAAE1VuYXV0aG9yaXplZEFyYml0ZXIAAAAAEQAAAAAAAAANQWdlbnROb3RGb3VuZAAAAAAAABIAAAAAAAAADU9yZGVyTm90Rm91bmQAAAAAAAAT" ]),
      options
    )
  }
  public readonly fromJSON = {
    get_order: this.txFromJSON<Result<WorkOrderData>>,
        get_config: this.txFromJSON<Result<ProtocolConfig>>,
        initialize: this.txFromJSON<Result<void>>,
        claim_order: this.txFromJSON<Result<void>>,
        cancel_order: this.txFromJSON<Result<void>>,
        create_order: this.txFromJSON<Result<u64>>,
        dispute_order: this.txFromJSON<Result<void>>,
        submit_result: this.txFromJSON<Result<void>>,
        approve_result: this.txFromJSON<Result<void>>,
        get_order_count: this.txFromJSON<u64>,
        resolve_dispute: this.txFromJSON<Result<void>>
  }
}