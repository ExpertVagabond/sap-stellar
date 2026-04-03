#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short, token, Address, BytesN, Env,
    IntoVal, String, Symbol, Val, Vec,
};

const DAY_IN_LEDGERS: u32 = 17_280;
const BUMP_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
const LIFETIME_THRESHOLD: u32 = BUMP_AMOUNT - DAY_IN_LEDGERS;

// ── Order Status Constants ─────────────────────────────────────────────

pub const STATUS_OPEN: u32 = 0;
pub const STATUS_CLAIMED: u32 = 1;
pub const STATUS_SUBMITTED: u32 = 2;
pub const STATUS_APPROVED: u32 = 3;
pub const STATUS_DISPUTED: u32 = 4;
pub const STATUS_CANCELLED: u32 = 5;
pub const STATUS_RESOLVED: u32 = 6;

// ── Errors ─────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum WorkOrderError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    DescriptionTooLong = 3,
    TooManyTags = 4,
    TagTooLong = 5,
    DeadlinePassed = 6,
    RewardTooLow = 7,
    NotOpen = 8,
    AgentInactive = 9,
    RoleMismatch = 10,
    NotClaimed = 11,
    NotAssignedAgent = 12,
    NotSubmitted = 13,
    DisputeWindowClosed = 14,
    NotDisputed = 15,
    Overflow = 16,
    UnauthorizedArbiter = 17,
    AgentNotFound = 18,
    OrderNotFound = 19,
}

// ── Storage ────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    OrderCount,
    Order(u64),
    Pair(Address, Address), // (requester, agent) → PairData
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProtocolConfig {
    pub admin: Address,
    pub registry_contract: Address,
    pub treasury: Address,
    pub usdc_token: Address,
    pub fee_bps: u64,
    pub wash_fee_bps: u64,
    pub min_fee: i128,
    pub min_reward: i128,
    pub dispute_bond: i128,
    pub dispute_window: u64,
    pub wash_cooldown: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkOrderData {
    pub requester: Address,
    pub arbiter: Address,
    pub description: String,
    pub required_role: Option<String>,
    pub tags: Vec<String>,
    pub reward: i128,
    pub deadline: u64,
    pub status: u32,
    pub assigned_agent: Option<Address>,
    pub result_hash: Option<BytesN<32>>,
    pub created_at: u64,
    pub completed_at: u64,
    pub order_id: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PairData {
    pub last_approved: u64,
    pub total_completions: u64,
}

/// Mirror of AgentData from the registry contract.
/// Must match field names and types exactly for cross-contract deserialization.
#[contracttype]
#[derive(Clone, Debug)]
pub struct AgentInfo {
    pub authority: Address,
    pub role: String,
    pub tools: Vec<String>,
    pub coldstar_vault: Option<Address>,
    pub metadata_uri: String,
    pub reputation_score: u64,
    pub tasks_completed: u64,
    pub tasks_failed: u64,
    pub total_earned: i128,
    pub registered_at: u64,
    pub is_active: bool,
}

// ── Contract ───────────────────────────────────────────────────────────

#[contract]
pub struct WorkOrderContract;

#[contractimpl]
impl WorkOrderContract {
    /// Initialize with a full config struct (Soroban max 10 params per function).
    pub fn initialize(env: Env, config: ProtocolConfig) -> Result<(), WorkOrderError> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(WorkOrderError::AlreadyInitialized);
        }
        config.admin.require_auth();
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().set(&DataKey::OrderCount, &0u64);
        env.storage()
            .instance()
            .extend_ttl(LIFETIME_THRESHOLD, BUMP_AMOUNT);
        Ok(())
    }

    /// Post a new work order. USDC reward is escrowed in this contract.
    pub fn create_order(
        env: Env,
        requester: Address,
        description: String,
        required_role: Option<String>,
        tags: Vec<String>,
        deadline: u64,
        reward: i128,
        arbiter: Address,
    ) -> Result<u64, WorkOrderError> {
        requester.require_auth();

        if description.len() > 256 {
            return Err(WorkOrderError::DescriptionTooLong);
        }
        if tags.len() > 8 {
            return Err(WorkOrderError::TooManyTags);
        }
        for i in 0..tags.len() {
            if tags.get(i).unwrap().len() > 32 {
                return Err(WorkOrderError::TagTooLong);
            }
        }

        let config: ProtocolConfig = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(WorkOrderError::NotInitialized)?;

        let now = env.ledger().timestamp();
        if deadline <= now {
            return Err(WorkOrderError::DeadlinePassed);
        }
        if reward < config.min_reward {
            return Err(WorkOrderError::RewardTooLow);
        }

        // Escrow USDC from requester
        let usdc = token::Client::new(&env, &config.usdc_token);
        usdc.transfer(&requester, &env.current_contract_address(), &reward);

        // Assign order ID
        let order_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::OrderCount)
            .unwrap_or(0);

        let order = WorkOrderData {
            requester: requester.clone(),
            arbiter,
            description,
            required_role,
            tags,
            reward,
            deadline,
            status: STATUS_OPEN,
            assigned_agent: None,
            result_hash: None,
            created_at: now,
            completed_at: 0,
            order_id,
        };

        let key = DataKey::Order(order_id);
        env.storage().persistent().set(&key, &order);
        env.storage()
            .persistent()
            .extend_ttl(&key, LIFETIME_THRESHOLD, BUMP_AMOUNT);
        env.storage()
            .instance()
            .set(&DataKey::OrderCount, &(order_id + 1));
        env.storage()
            .instance()
            .extend_ttl(LIFETIME_THRESHOLD, BUMP_AMOUNT);

        env.events().publish(
            (symbol_short!("create"), requester),
            (order_id, reward),
        );
        Ok(order_id)
    }

    /// Agent claims an open work order. Validates role match and deadline.
    pub fn claim_order(
        env: Env,
        agent_authority: Address,
        order_id: u64,
    ) -> Result<(), WorkOrderError> {
        agent_authority.require_auth();

        let config: ProtocolConfig = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(WorkOrderError::NotInitialized)?;

        let key = DataKey::Order(order_id);
        let mut order: WorkOrderData = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(WorkOrderError::OrderNotFound)?;

        if order.status != STATUS_OPEN {
            return Err(WorkOrderError::NotOpen);
        }

        let now = env.ledger().timestamp();
        if now >= order.deadline {
            return Err(WorkOrderError::DeadlinePassed);
        }

        // Cross-contract: fetch agent from registry to validate
        let agent: AgentInfo = env.invoke_contract(
            &config.registry_contract,
            &Symbol::new(&env, "get_agent"),
            soroban_sdk::vec![&env, agent_authority.clone().into_val(&env)],
        );

        if !agent.is_active {
            return Err(WorkOrderError::AgentInactive);
        }

        if let Some(ref required) = order.required_role {
            if agent.role != *required {
                return Err(WorkOrderError::RoleMismatch);
            }
        }

        order.assigned_agent = Some(agent_authority.clone());
        order.status = STATUS_CLAIMED;

        env.storage().persistent().set(&key, &order);
        env.storage()
            .persistent()
            .extend_ttl(&key, LIFETIME_THRESHOLD, BUMP_AMOUNT);

        env.events().publish(
            (symbol_short!("claim"), agent_authority),
            order_id,
        );
        Ok(())
    }

    /// Agent submits SHA-256 hash of the off-chain result.
    pub fn submit_result(
        env: Env,
        agent_authority: Address,
        order_id: u64,
        result_hash: BytesN<32>,
    ) -> Result<(), WorkOrderError> {
        agent_authority.require_auth();

        let key = DataKey::Order(order_id);
        let mut order: WorkOrderData = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(WorkOrderError::OrderNotFound)?;

        if order.status != STATUS_CLAIMED {
            return Err(WorkOrderError::NotClaimed);
        }
        if order.assigned_agent != Some(agent_authority.clone()) {
            return Err(WorkOrderError::NotAssignedAgent);
        }

        order.result_hash = Some(result_hash);
        order.status = STATUS_SUBMITTED;
        order.completed_at = env.ledger().timestamp();

        env.storage().persistent().set(&key, &order);
        env.storage()
            .persistent()
            .extend_ttl(&key, LIFETIME_THRESHOLD, BUMP_AMOUNT);

        env.events().publish(
            (symbol_short!("submit"), agent_authority),
            order_id,
        );
        Ok(())
    }

    /// Requester approves — releases escrow minus fee. CPI updates registry.
    pub fn approve_result(
        env: Env,
        requester: Address,
        order_id: u64,
    ) -> Result<(), WorkOrderError> {
        requester.require_auth();

        let config: ProtocolConfig = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(WorkOrderError::NotInitialized)?;

        let key = DataKey::Order(order_id);
        let mut order: WorkOrderData = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(WorkOrderError::OrderNotFound)?;

        if order.status != STATUS_SUBMITTED {
            return Err(WorkOrderError::NotSubmitted);
        }
        // Verify caller is the requester
        assert!(order.requester == requester);

        let agent_addr = order.assigned_agent.clone().unwrap();

        // Wash-trade detection
        let now = env.ledger().timestamp();
        let pair_key = DataKey::Pair(requester.clone(), agent_addr.clone());
        let is_wash = if let Some(pair) = env
            .storage()
            .persistent()
            .get::<DataKey, PairData>(&pair_key)
        {
            pair.last_approved > 0 && (now - pair.last_approved) < config.wash_cooldown
        } else {
            false
        };

        // Fee calculation
        let fee_bps = if is_wash {
            config.wash_fee_bps
        } else {
            config.fee_bps
        };
        let calculated_fee = (order.reward * fee_bps as i128) / 10_000;
        let fee = if calculated_fee < config.min_fee {
            config.min_fee
        } else {
            calculated_fee
        };
        let agent_payout = order
            .reward
            .checked_sub(fee)
            .ok_or(WorkOrderError::Overflow)?;

        // Transfer USDC: agent gets reward minus fee, treasury gets fee
        let usdc = token::Client::new(&env, &config.usdc_token);
        usdc.transfer(&env.current_contract_address(), &agent_addr, &agent_payout);
        usdc.transfer(&env.current_contract_address(), &config.treasury, &fee);

        // Cross-contract: record completion in registry
        let _: Val = env.invoke_contract(
            &config.registry_contract,
            &Symbol::new(&env, "record_completion"),
            soroban_sdk::vec![
                &env,
                env.current_contract_address().into_val(&env),
                agent_addr.clone().into_val(&env),
                agent_payout.into_val(&env),
            ],
        );

        // Update pair tracker
        let pair = PairData {
            last_approved: now,
            total_completions: if let Some(p) = env.storage().persistent().get::<DataKey, PairData>(&pair_key) {
                p.total_completions + 1
            } else {
                1
            },
        };
        env.storage().persistent().set(&pair_key, &pair);

        order.status = STATUS_APPROVED;
        env.storage().persistent().set(&key, &order);
        env.storage()
            .persistent()
            .extend_ttl(&key, LIFETIME_THRESHOLD, BUMP_AMOUNT);

        env.events().publish(
            (symbol_short!("approve"), agent_addr.clone()),
            (order_id, agent_payout, fee),
        );
        Ok(())
    }

    /// Requester disputes a submitted result. Requires dispute bond deposit.
    pub fn dispute_order(
        env: Env,
        requester: Address,
        order_id: u64,
    ) -> Result<(), WorkOrderError> {
        requester.require_auth();

        let config: ProtocolConfig = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(WorkOrderError::NotInitialized)?;

        let key = DataKey::Order(order_id);
        let mut order: WorkOrderData = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(WorkOrderError::OrderNotFound)?;

        if order.status != STATUS_SUBMITTED {
            return Err(WorkOrderError::NotSubmitted);
        }
        assert!(order.requester == requester);

        // Check dispute window
        let now = env.ledger().timestamp();
        if order.completed_at > 0 && (now - order.completed_at) > config.dispute_window {
            return Err(WorkOrderError::DisputeWindowClosed);
        }

        // Deposit dispute bond
        let usdc = token::Client::new(&env, &config.usdc_token);
        usdc.transfer(
            &requester,
            &env.current_contract_address(),
            &config.dispute_bond,
        );

        let agent_addr = order.assigned_agent.clone().unwrap();

        // Cross-contract: record failure in registry
        let _: Val = env.invoke_contract(
            &config.registry_contract,
            &Symbol::new(&env, "record_failure"),
            soroban_sdk::vec![
                &env,
                env.current_contract_address().into_val(&env),
                agent_addr.clone().into_val(&env),
            ],
        );

        order.status = STATUS_DISPUTED;
        env.storage().persistent().set(&key, &order);
        env.storage()
            .persistent()
            .extend_ttl(&key, LIFETIME_THRESHOLD, BUMP_AMOUNT);

        env.events()
            .publish((symbol_short!("dispute"), agent_addr), order_id);
        Ok(())
    }

    /// Requester cancels an open (unclaimed) order. Escrow returned.
    pub fn cancel_order(
        env: Env,
        requester: Address,
        order_id: u64,
    ) -> Result<(), WorkOrderError> {
        requester.require_auth();

        let config: ProtocolConfig = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(WorkOrderError::NotInitialized)?;

        let key = DataKey::Order(order_id);
        let mut order: WorkOrderData = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(WorkOrderError::OrderNotFound)?;

        if order.status != STATUS_OPEN {
            return Err(WorkOrderError::NotOpen);
        }
        assert!(order.requester == requester);

        // Return escrow
        let usdc = token::Client::new(&env, &config.usdc_token);
        usdc.transfer(
            &env.current_contract_address(),
            &requester,
            &order.reward,
        );

        order.status = STATUS_CANCELLED;
        env.storage().persistent().set(&key, &order);

        env.events()
            .publish((symbol_short!("cancel"),), order_id);
        Ok(())
    }

    /// Arbiter resolves a dispute. Winner gets reward + dispute bond.
    pub fn resolve_dispute(
        env: Env,
        arbiter: Address,
        order_id: u64,
        in_favor_of_requester: bool,
    ) -> Result<(), WorkOrderError> {
        arbiter.require_auth();

        let config: ProtocolConfig = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(WorkOrderError::NotInitialized)?;

        let key = DataKey::Order(order_id);
        let mut order: WorkOrderData = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(WorkOrderError::OrderNotFound)?;

        if order.status != STATUS_DISPUTED {
            return Err(WorkOrderError::NotDisputed);
        }
        if order.arbiter != arbiter {
            return Err(WorkOrderError::UnauthorizedArbiter);
        }

        let total_payout = order
            .reward
            .checked_add(config.dispute_bond)
            .ok_or(WorkOrderError::Overflow)?;

        let usdc = token::Client::new(&env, &config.usdc_token);
        if in_favor_of_requester {
            usdc.transfer(
                &env.current_contract_address(),
                &order.requester,
                &total_payout,
            );
        } else {
            let agent = order.assigned_agent.clone().unwrap();
            usdc.transfer(&env.current_contract_address(), &agent, &total_payout);
        }

        order.status = STATUS_RESOLVED;
        env.storage().persistent().set(&key, &order);
        env.storage()
            .persistent()
            .extend_ttl(&key, LIFETIME_THRESHOLD, BUMP_AMOUNT);

        env.events()
            .publish((symbol_short!("resolve"),), (order_id, in_favor_of_requester));
        Ok(())
    }

    // ── View Functions ─────────────────────────────────────────────────

    pub fn get_order(env: Env, order_id: u64) -> Result<WorkOrderData, WorkOrderError> {
        env.storage()
            .persistent()
            .get(&DataKey::Order(order_id))
            .ok_or(WorkOrderError::OrderNotFound)
    }

    pub fn get_order_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::OrderCount)
            .unwrap_or(0)
    }

    pub fn get_config(env: Env) -> Result<ProtocolConfig, WorkOrderError> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(WorkOrderError::NotInitialized)
    }
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, vec, Env, String};

    fn setup() -> (Env, Address, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        // Deploy registry
        let registry_id =
            env.register(sap_agent_registry::AgentRegistryContract, ());
        let registry_client =
            sap_agent_registry::AgentRegistryContractClient::new(&env, &registry_id);

        // Deploy work-order
        let work_order_id = env.register(WorkOrderContract, ());
        let wo_client = WorkOrderContractClient::new(&env, &work_order_id);

        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);

        // Create USDC and XLM test tokens
        let usdc_token = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let xlm_token = env.register_stellar_asset_contract_v2(admin.clone()).address();

        let _usdc_sac = token::StellarAssetClient::new(&env, &usdc_token);
        let _xlm_sac = token::StellarAssetClient::new(&env, &xlm_token);

        // Initialize registry (with XLM bond)
        registry_client.initialize(&admin, &work_order_id, &xlm_token, &1_000_0000000);

        // Initialize work-order
        wo_client.initialize(&ProtocolConfig {
            admin: admin.clone(),
            registry_contract: registry_id.clone(),
            treasury: treasury.clone(),
            usdc_token: usdc_token.clone(),
            fee_bps: 250,           // 2.5%
            wash_fee_bps: 500,      // 5%
            min_fee: 10_000,
            min_reward: 100_000,
            dispute_bond: 5_000_000,
            dispute_window: 259_200, // 3 days
            wash_cooldown: 86_400,   // 24h
        });

        (env, work_order_id, registry_id, usdc_token, xlm_token, treasury)
    }

    fn register_agent(
        env: &Env,
        registry_id: &Address,
        xlm_token: &Address,
        authority: &Address,
        role: &str,
    ) {
        let registry =
            sap_agent_registry::AgentRegistryContractClient::new(env, registry_id);
        let xlm_sac = token::StellarAssetClient::new(env, xlm_token);
        xlm_sac.mint(authority, &2_000_0000000);
        registry.register_agent(
            authority,
            &String::from_str(env, role),
            &vec![env],
            &None::<Address>,
            &String::from_str(env, "https://example.com"),
        );
    }

    #[test]
    fn test_create_order() {
        let (env, wo_id, _, usdc_token, _, _) = setup();
        let client = WorkOrderContractClient::new(&env, &wo_id);
        let requester = Address::generate(&env);

        let usdc_sac = token::StellarAssetClient::new(&env, &usdc_token);
        usdc_sac.mint(&requester, &100_000_000);

        let order_id = client.create_order(
            &requester,
            &String::from_str(&env, "Analyze climate data"),
            &None::<String>,
            &vec![&env, String::from_str(&env, "climate")],
            &(env.ledger().timestamp() + 86400),
            &10_000_000,
            &Address::generate(&env),
        );
        assert_eq!(order_id, 0);

        let order = client.get_order(&0);
        assert_eq!(order.status, STATUS_OPEN);
        assert_eq!(order.reward, 10_000_000);
        assert_eq!(client.get_order_count(), 1);
    }

    #[test]
    fn test_full_lifecycle() {
        let (env, wo_id, registry_id, usdc_token, xlm_token, treasury) = setup();
        let client = WorkOrderContractClient::new(&env, &wo_id);

        let requester = Address::generate(&env);
        let agent = Address::generate(&env);
        let arbiter = Address::generate(&env);

        // Fund accounts
        let usdc_sac = token::StellarAssetClient::new(&env, &usdc_token);
        usdc_sac.mint(&requester, &100_000_000);

        // Register agent
        register_agent(&env, &registry_id, &xlm_token, &agent, "analyst");

        // Create order
        let order_id = client.create_order(
            &requester,
            &String::from_str(&env, "Analyze climate data for Miami"),
            &Some(String::from_str(&env, "analyst")),
            &vec![&env, String::from_str(&env, "climate")],
            &(env.ledger().timestamp() + 86400),
            &10_000_000,
            &arbiter,
        );

        // Claim
        client.claim_order(&agent, &order_id);
        let order = client.get_order(&order_id);
        assert_eq!(order.status, STATUS_CLAIMED);

        // Submit result
        let hash = BytesN::from_array(&env, &[1u8; 32]);
        client.submit_result(&agent, &order_id, &hash);
        let order = client.get_order(&order_id);
        assert_eq!(order.status, STATUS_SUBMITTED);

        // Approve — agent gets 97.5%, treasury gets 2.5%
        client.approve_result(&requester, &order_id);
        let order = client.get_order(&order_id);
        assert_eq!(order.status, STATUS_APPROVED);

        // Verify payouts
        let usdc = token::Client::new(&env, &usdc_token);
        let agent_balance = usdc.balance(&agent);
        let treasury_balance = usdc.balance(&treasury);
        // 10_000_000 * 2.5% = 250_000 fee, agent gets 9_750_000
        assert_eq!(agent_balance, 9_750_000);
        assert_eq!(treasury_balance, 250_000);

        // Verify registry updated
        let registry =
            sap_agent_registry::AgentRegistryContractClient::new(&env, &registry_id);
        let agent_data = registry.get_agent(&agent);
        assert_eq!(agent_data.tasks_completed, 1);
        assert_eq!(agent_data.total_earned, 9_750_000);
    }

    #[test]
    fn test_cancel_order() {
        let (env, wo_id, _, usdc_token, _, _) = setup();
        let client = WorkOrderContractClient::new(&env, &wo_id);
        let requester = Address::generate(&env);

        let usdc_sac = token::StellarAssetClient::new(&env, &usdc_token);
        usdc_sac.mint(&requester, &100_000_000);

        let order_id = client.create_order(
            &requester,
            &String::from_str(&env, "Test order"),
            &None::<String>,
            &vec![&env],
            &(env.ledger().timestamp() + 86400),
            &1_000_000,
            &Address::generate(&env),
        );

        client.cancel_order(&requester, &order_id);

        let usdc = token::Client::new(&env, &usdc_token);
        assert_eq!(usdc.balance(&requester), 100_000_000); // Full refund
    }
}
