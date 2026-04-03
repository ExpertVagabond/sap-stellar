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
    contractId: "CBDHI2BZ36WA7ROUXYONZXMARTUMXYAHEPXPE7HKJMST6XBTKOHPNLFY",
  }
} as const

export type DataKey = {tag: "Admin", values: void} | {tag: "Reputation", values: readonly [string]};

export const RepError = {
  1: {message:"AlreadyInitialized"},
  2: {message:"NotInitialized"},
  3: {message:"SpecNameTooLong"},
  4: {message:"ReputationExists"},
  5: {message:"ReputationNotFound"},
  6: {message:"UnauthorizedCaller"}
}


export interface SpecData {
  name: string;
  score: u64;
  successes: u64;
  total: u64;
}


export interface ReputationData {
  agent: string;
  avg_completion_time: u64;
  composite_score: u64;
  created_at: u64;
  failed_tasks: u64;
  last_active: u64;
  specializations: Array<SpecData>;
  successful_tasks: u64;
  total_earned: i128;
  total_tasks: u64;
}

export interface Client {
  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  initialize: ({admin}: {admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a apply_decay transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Permissionless: apply time-based decay to inactive agents.
   */
  apply_decay: ({agent_addr}: {agent_addr: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_reputation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_reputation: ({agent_addr}: {agent_addr: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<ReputationData>>>

  /**
   * Construct and simulate a record_failure transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Record a failed task.
   */
  record_failure: ({authority, agent_addr, specialization}: {authority: string, agent_addr: string, specialization: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a record_success transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Record a successful task completion with metadata.
   */
  record_success: ({authority, agent_addr, earned, completion_time, specialization}: {authority: string, agent_addr: string, earned: i128, completion_time: u64, specialization: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a init_reputation transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Create a reputation record for an agent. Called once after registration.
   */
  init_reputation: ({authority, agent_addr}: {authority: string, agent_addr: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

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
      new ContractSpec([ "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAAAgAAAAAAAAAAAAAABUFkbWluAAAAAAAAAQAAAAAAAAAKUmVwdXRhdGlvbgAAAAAAAQAAABM=",
        "AAAAAAAAAAAAAAAKaW5pdGlhbGl6ZQAAAAAAAQAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAAIUmVwRXJyb3I=",
        "AAAABAAAAAAAAAAAAAAACFJlcEVycm9yAAAABgAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAAPU3BlY05hbWVUb29Mb25nAAAAAAMAAAAAAAAAEFJlcHV0YXRpb25FeGlzdHMAAAAEAAAAAAAAABJSZXB1dGF0aW9uTm90Rm91bmQAAAAAAAUAAAAAAAAAElVuYXV0aG9yaXplZENhbGxlcgAAAAAABg==",
        "AAAAAQAAAAAAAAAAAAAACFNwZWNEYXRhAAAABAAAAAAAAAAEbmFtZQAAABAAAAAAAAAABXNjb3JlAAAAAAAABgAAAAAAAAAJc3VjY2Vzc2VzAAAAAAAABgAAAAAAAAAFdG90YWwAAAAAAAAG",
        "AAAAAAAAADpQZXJtaXNzaW9ubGVzczogYXBwbHkgdGltZS1iYXNlZCBkZWNheSB0byBpbmFjdGl2ZSBhZ2VudHMuAAAAAAALYXBwbHlfZGVjYXkAAAAAAQAAAAAAAAAKYWdlbnRfYWRkcgAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAACFJlcEVycm9y",
        "AAAAAAAAAAAAAAAOZ2V0X3JlcHV0YXRpb24AAAAAAAEAAAAAAAAACmFnZW50X2FkZHIAAAAAABMAAAABAAAD6QAAB9AAAAAOUmVwdXRhdGlvbkRhdGEAAAAAB9AAAAAIUmVwRXJyb3I=",
        "AAAAAAAAABVSZWNvcmQgYSBmYWlsZWQgdGFzay4AAAAAAAAOcmVjb3JkX2ZhaWx1cmUAAAAAAAMAAAAAAAAACWF1dGhvcml0eQAAAAAAABMAAAAAAAAACmFnZW50X2FkZHIAAAAAABMAAAAAAAAADnNwZWNpYWxpemF0aW9uAAAAAAAQAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAAIUmVwRXJyb3I=",
        "AAAAAAAAADJSZWNvcmQgYSBzdWNjZXNzZnVsIHRhc2sgY29tcGxldGlvbiB3aXRoIG1ldGFkYXRhLgAAAAAADnJlY29yZF9zdWNjZXNzAAAAAAAFAAAAAAAAAAlhdXRob3JpdHkAAAAAAAATAAAAAAAAAAphZ2VudF9hZGRyAAAAAAATAAAAAAAAAAZlYXJuZWQAAAAAAAsAAAAAAAAAD2NvbXBsZXRpb25fdGltZQAAAAAGAAAAAAAAAA5zcGVjaWFsaXphdGlvbgAAAAAAEAAAAAEAAAPpAAAD7QAAAAAAAAfQAAAACFJlcEVycm9y",
        "AAAAAAAAAEhDcmVhdGUgYSByZXB1dGF0aW9uIHJlY29yZCBmb3IgYW4gYWdlbnQuIENhbGxlZCBvbmNlIGFmdGVyIHJlZ2lzdHJhdGlvbi4AAAAPaW5pdF9yZXB1dGF0aW9uAAAAAAIAAAAAAAAACWF1dGhvcml0eQAAAAAAABMAAAAAAAAACmFnZW50X2FkZHIAAAAAABMAAAABAAAD6QAAA+0AAAAAAAAH0AAAAAhSZXBFcnJvcg==",
        "AAAAAQAAAAAAAAAAAAAADlJlcHV0YXRpb25EYXRhAAAAAAAKAAAAAAAAAAVhZ2VudAAAAAAAABMAAAAAAAAAE2F2Z19jb21wbGV0aW9uX3RpbWUAAAAABgAAAAAAAAAPY29tcG9zaXRlX3Njb3JlAAAAAAYAAAAAAAAACmNyZWF0ZWRfYXQAAAAAAAYAAAAAAAAADGZhaWxlZF90YXNrcwAAAAYAAAAAAAAAC2xhc3RfYWN0aXZlAAAAAAYAAAAAAAAAD3NwZWNpYWxpemF0aW9ucwAAAAPqAAAH0AAAAAhTcGVjRGF0YQAAAAAAAAAQc3VjY2Vzc2Z1bF90YXNrcwAAAAYAAAAAAAAADHRvdGFsX2Vhcm5lZAAAAAsAAAAAAAAAC3RvdGFsX3Rhc2tzAAAAAAY=" ]),
      options
    )
  }
  public readonly fromJSON = {
    initialize: this.txFromJSON<Result<void>>,
        apply_decay: this.txFromJSON<Result<void>>,
        get_reputation: this.txFromJSON<Result<ReputationData>>,
        record_failure: this.txFromJSON<Result<void>>,
        record_success: this.txFromJSON<Result<void>>,
        init_reputation: this.txFromJSON<Result<void>>
  }
}