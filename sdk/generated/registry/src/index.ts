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
    contractId: "CDJ3GGEJFAP27RCE4MXDL336Q5Q3KBPWYJXDAJYNOUI3FMYKHZNU7DNF",
  }
} as const


export interface Config {
  admin: string;
  bond_amount: i128;
  bond_token: string;
  work_order_contract: string;
}

export type DataKey = {tag: "Config", values: void} | {tag: "AgentCount", values: void} | {tag: "Agent", values: readonly [string]};

export const SapError = {
  1: {message:"AlreadyInitialized"},
  2: {message:"NotInitialized"},
  3: {message:"RoleTooLong"},
  4: {message:"TooManyTools"},
  5: {message:"ToolNameTooLong"},
  6: {message:"UriTooLong"},
  7: {message:"AgentExists"},
  8: {message:"AgentNotFound"},
  9: {message:"AgentStillActive"},
  10: {message:"UnauthorizedCaller"},
  11: {message:"Overflow"}
}


export interface AgentData {
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

export interface Client {
  /**
   * Construct and simulate a get_agent transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_agent: ({authority}: {authority: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<AgentData>>>

  /**
   * Construct and simulate a get_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_config: (options?: MethodOptions) => Promise<AssembledTransaction<Result<Config>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * One-time initialization. Deploy both contracts first, then initialize each
   * with the other's address.
   */
  initialize: ({admin, work_order_contract, bond_token, bond_amount}: {admin: string, work_order_contract: string, bond_token: string, bond_amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a update_agent transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Update agent profile fields. Only authority can call.
   */
  update_agent: ({authority, tools, coldstar_vault, metadata_uri}: {authority: string, tools: Option<Array<string>>, coldstar_vault: Option<string>, metadata_uri: Option<string>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a withdraw_bond transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Withdraw bond and remove agent. Must be deactivated first.
   */
  withdraw_bond: ({authority}: {authority: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a record_failure transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Called by the work-order contract on dispute/failure.
   */
  record_failure: ({caller_contract, agent_addr}: {caller_contract: string, agent_addr: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a register_agent transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Register a new AI agent. Transfers bond from authority to contract.
   */
  register_agent: ({authority, role, tools, coldstar_vault, metadata_uri}: {authority: string, role: string, tools: Array<string>, coldstar_vault: Option<string>, metadata_uri: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_agent_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_agent_count: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a deactivate_agent transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Stop accepting work. Bond remains locked until withdraw.
   */
  deactivate_agent: ({authority}: {authority: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a reactivate_agent transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Resume accepting work.
   */
  reactivate_agent: ({authority}: {authority: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a record_completion transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Called by the work-order contract when a task is approved.
   * The work-order contract address is verified via require_auth + config check.
   */
  record_completion: ({caller_contract, agent_addr, earned}: {caller_contract: string, agent_addr: string, earned: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

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
      new ContractSpec([ "AAAAAQAAAAAAAAAAAAAABkNvbmZpZwAAAAAABAAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAtib25kX2Ftb3VudAAAAAALAAAAAAAAAApib25kX3Rva2VuAAAAAAATAAAAAAAAABN3b3JrX29yZGVyX2NvbnRyYWN0AAAAABM=",
        "AAAAAAAAAAAAAAAJZ2V0X2FnZW50AAAAAAAAAQAAAAAAAAAJYXV0aG9yaXR5AAAAAAAAEwAAAAEAAAPpAAAH0AAAAAlBZ2VudERhdGEAAAAAAAfQAAAACFNhcEVycm9y",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAAAwAAAAAAAAAAAAAABkNvbmZpZwAAAAAAAAAAAAAAAAAKQWdlbnRDb3VudAAAAAAAAQAAAAAAAAAFQWdlbnQAAAAAAAABAAAAEw==",
        "AAAAAAAAAAAAAAAKZ2V0X2NvbmZpZwAAAAAAAAAAAAEAAAPpAAAH0AAAAAZDb25maWcAAAAAB9AAAAAIU2FwRXJyb3I=",
        "AAAAAAAAAGRPbmUtdGltZSBpbml0aWFsaXphdGlvbi4gRGVwbG95IGJvdGggY29udHJhY3RzIGZpcnN0LCB0aGVuIGluaXRpYWxpemUgZWFjaAp3aXRoIHRoZSBvdGhlcidzIGFkZHJlc3MuAAAACmluaXRpYWxpemUAAAAAAAQAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAATd29ya19vcmRlcl9jb250cmFjdAAAAAATAAAAAAAAAApib25kX3Rva2VuAAAAAAATAAAAAAAAAAtib25kX2Ftb3VudAAAAAALAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAAIU2FwRXJyb3I=",
        "AAAABAAAAAAAAAAAAAAACFNhcEVycm9yAAAACwAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAALUm9sZVRvb0xvbmcAAAAAAwAAAAAAAAAMVG9vTWFueVRvb2xzAAAABAAAAAAAAAAPVG9vbE5hbWVUb29Mb25nAAAAAAUAAAAAAAAAClVyaVRvb0xvbmcAAAAAAAYAAAAAAAAAC0FnZW50RXhpc3RzAAAAAAcAAAAAAAAADUFnZW50Tm90Rm91bmQAAAAAAAAIAAAAAAAAABBBZ2VudFN0aWxsQWN0aXZlAAAACQAAAAAAAAASVW5hdXRob3JpemVkQ2FsbGVyAAAAAAAKAAAAAAAAAAhPdmVyZmxvdwAAAAs=",
        "AAAAAQAAAAAAAAAAAAAACUFnZW50RGF0YQAAAAAAAAsAAAAAAAAACWF1dGhvcml0eQAAAAAAABMAAAAAAAAADmNvbGRzdGFyX3ZhdWx0AAAAAAPoAAAAEwAAAAAAAAAJaXNfYWN0aXZlAAAAAAAAAQAAAAAAAAAMbWV0YWRhdGFfdXJpAAAAEAAAAAAAAAANcmVnaXN0ZXJlZF9hdAAAAAAAAAYAAAAAAAAAEHJlcHV0YXRpb25fc2NvcmUAAAAGAAAAAAAAAARyb2xlAAAAEAAAAAAAAAAPdGFza3NfY29tcGxldGVkAAAAAAYAAAAAAAAADHRhc2tzX2ZhaWxlZAAAAAYAAAAAAAAABXRvb2xzAAAAAAAD6gAAABAAAAAAAAAADHRvdGFsX2Vhcm5lZAAAAAs=",
        "AAAAAAAAADVVcGRhdGUgYWdlbnQgcHJvZmlsZSBmaWVsZHMuIE9ubHkgYXV0aG9yaXR5IGNhbiBjYWxsLgAAAAAAAAx1cGRhdGVfYWdlbnQAAAAEAAAAAAAAAAlhdXRob3JpdHkAAAAAAAATAAAAAAAAAAV0b29scwAAAAAAA+gAAAPqAAAAEAAAAAAAAAAOY29sZHN0YXJfdmF1bHQAAAAAA+gAAAATAAAAAAAAAAxtZXRhZGF0YV91cmkAAAPoAAAAEAAAAAEAAAPpAAAD7QAAAAAAAAfQAAAACFNhcEVycm9y",
        "AAAAAAAAADpXaXRoZHJhdyBib25kIGFuZCByZW1vdmUgYWdlbnQuIE11c3QgYmUgZGVhY3RpdmF0ZWQgZmlyc3QuAAAAAAANd2l0aGRyYXdfYm9uZAAAAAAAAAEAAAAAAAAACWF1dGhvcml0eQAAAAAAABMAAAABAAAD6QAAA+0AAAAAAAAH0AAAAAhTYXBFcnJvcg==",
        "AAAAAAAAADVDYWxsZWQgYnkgdGhlIHdvcmstb3JkZXIgY29udHJhY3Qgb24gZGlzcHV0ZS9mYWlsdXJlLgAAAAAAAA5yZWNvcmRfZmFpbHVyZQAAAAAAAgAAAAAAAAAPY2FsbGVyX2NvbnRyYWN0AAAAABMAAAAAAAAACmFnZW50X2FkZHIAAAAAABMAAAABAAAD6QAAA+0AAAAAAAAH0AAAAAhTYXBFcnJvcg==",
        "AAAAAAAAAENSZWdpc3RlciBhIG5ldyBBSSBhZ2VudC4gVHJhbnNmZXJzIGJvbmQgZnJvbSBhdXRob3JpdHkgdG8gY29udHJhY3QuAAAAAA5yZWdpc3Rlcl9hZ2VudAAAAAAABQAAAAAAAAAJYXV0aG9yaXR5AAAAAAAAEwAAAAAAAAAEcm9sZQAAABAAAAAAAAAABXRvb2xzAAAAAAAD6gAAABAAAAAAAAAADmNvbGRzdGFyX3ZhdWx0AAAAAAPoAAAAEwAAAAAAAAAMbWV0YWRhdGFfdXJpAAAAEAAAAAEAAAPpAAAD7QAAAAAAAAfQAAAACFNhcEVycm9y",
        "AAAAAAAAAAAAAAAPZ2V0X2FnZW50X2NvdW50AAAAAAAAAAABAAAABA==",
        "AAAAAAAAADhTdG9wIGFjY2VwdGluZyB3b3JrLiBCb25kIHJlbWFpbnMgbG9ja2VkIHVudGlsIHdpdGhkcmF3LgAAABBkZWFjdGl2YXRlX2FnZW50AAAAAQAAAAAAAAAJYXV0aG9yaXR5AAAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAACFNhcEVycm9y",
        "AAAAAAAAABZSZXN1bWUgYWNjZXB0aW5nIHdvcmsuAAAAAAAQcmVhY3RpdmF0ZV9hZ2VudAAAAAEAAAAAAAAACWF1dGhvcml0eQAAAAAAABMAAAABAAAD6QAAA+0AAAAAAAAH0AAAAAhTYXBFcnJvcg==",
        "AAAAAAAAAIdDYWxsZWQgYnkgdGhlIHdvcmstb3JkZXIgY29udHJhY3Qgd2hlbiBhIHRhc2sgaXMgYXBwcm92ZWQuClRoZSB3b3JrLW9yZGVyIGNvbnRyYWN0IGFkZHJlc3MgaXMgdmVyaWZpZWQgdmlhIHJlcXVpcmVfYXV0aCArIGNvbmZpZyBjaGVjay4AAAAAEXJlY29yZF9jb21wbGV0aW9uAAAAAAAAAwAAAAAAAAAPY2FsbGVyX2NvbnRyYWN0AAAAABMAAAAAAAAACmFnZW50X2FkZHIAAAAAABMAAAAAAAAABmVhcm5lZAAAAAAACwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAACFNhcEVycm9y" ]),
      options
    )
  }
  public readonly fromJSON = {
    get_agent: this.txFromJSON<Result<AgentData>>,
        get_config: this.txFromJSON<Result<Config>>,
        initialize: this.txFromJSON<Result<void>>,
        update_agent: this.txFromJSON<Result<void>>,
        withdraw_bond: this.txFromJSON<Result<void>>,
        record_failure: this.txFromJSON<Result<void>>,
        register_agent: this.txFromJSON<Result<void>>,
        get_agent_count: this.txFromJSON<u32>,
        deactivate_agent: this.txFromJSON<Result<void>>,
        reactivate_agent: this.txFromJSON<Result<void>>,
        record_completion: this.txFromJSON<Result<void>>
  }
}