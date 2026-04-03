// Re-export generated types from contract bindings
export type { AgentData, Config as RegistryConfig } from "sap-registry";
export type {
  WorkOrderData,
  ProtocolConfig,
  PairData,
} from "sap-work-order";
export type { ReputationData, SpecData } from "sap-reputation";

// Status constants matching the Soroban contracts
export const OrderStatus = {
  Open: 0,
  Claimed: 1,
  Submitted: 2,
  Approved: 3,
  Disputed: 4,
  Cancelled: 5,
  Resolved: 6,
} as const;

export type OrderStatusName = keyof typeof OrderStatus;

export function statusName(status: number): OrderStatusName {
  const entries = Object.entries(OrderStatus) as [OrderStatusName, number][];
  return entries.find(([, v]) => v === status)?.[0] ?? ("Unknown" as any);
}

// Agent roles
export enum AgentRole {
  ProtocolEngineer = "protocol-engineer",
  VaultArchitect = "vault-architect",
  RpcInfraEngineer = "rpc-infra-engineer",
  LowLatencySystems = "low-latency-systems",
  SvmEngineBuilder = "svm-engine-builder",
  ConsensusEngineer = "consensus-engineer",
  BlockchainGeneralist = "blockchain-generalist",
  CryptoEngineer = "crypto-engineer",
  FullStackDegen = "full-stack-degen",
  DefiProtocolBuilder = "defi-protocol-builder",
  PaymentsInfra = "payments-infra",
  NetworkEngineer = "network-engineer",
  SmartContractAuditor = "smart-contract-auditor",
  SecurityScanner = "security-scanner",
  OnchainAnalyst = "onchain-analyst",
  IndexerEngineer = "indexer-engineer",
  LiquidationMonitor = "liquidation-monitor",
  TwitterAnalyst = "twitter-analyst",
  TokenomicsDesigner = "tokenomics-designer",
  MarketMakerBot = "market-maker-bot",
  GovernanceAnalyst = "governance-analyst",
  DocumentationWriter = "documentation-writer",
  GrantWriter = "grant-writer",
  FrontendReviewer = "frontend-reviewer",
}

export interface SapConfig {
  registryContract: string;
  workOrderContract: string;
  reputationContract: string;
  rpcUrl: string;
  networkPassphrase: string;
}

export const TESTNET_CONFIG: SapConfig = {
  registryContract: "CDJ3GGEJFAP27RCE4MXDL336Q5Q3KBPWYJXDAJYNOUI3FMYKHZNU7DNF",
  workOrderContract: "CDRSD3BE3UNI4YGXQ6ND4UZ3KO2WT4H52AZHR6MHLP53JJ2Q3CTKWDVH",
  reputationContract: "CBDHI2BZ36WA7ROUXYONZXMARTUMXYAHEPXPE7HKJMST6XBTKOHPNLFY",
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
};
