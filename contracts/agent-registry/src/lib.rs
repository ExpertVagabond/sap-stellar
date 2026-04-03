#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short, token, Address, Env, String,
    Vec,
};

const DAY_IN_LEDGERS: u32 = 17_280;
const BUMP_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
const LIFETIME_THRESHOLD: u32 = BUMP_AMOUNT - DAY_IN_LEDGERS;

// ── Errors ─────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum SapError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    RoleTooLong = 3,
    TooManyTools = 4,
    ToolNameTooLong = 5,
    UriTooLong = 6,
    AgentExists = 7,
    AgentNotFound = 8,
    AgentStillActive = 9,
    UnauthorizedCaller = 10,
    Overflow = 11,
}

// ── Storage Keys ───────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    AgentCount,
    Agent(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub work_order_contract: Address,
    pub bond_token: Address,
    pub bond_amount: i128,
}

// ── Agent State ────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentData {
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
pub struct AgentRegistryContract;

#[contractimpl]
impl AgentRegistryContract {
    /// One-time initialization. Deploy both contracts first, then initialize each
    /// with the other's address.
    pub fn initialize(
        env: Env,
        admin: Address,
        work_order_contract: Address,
        bond_token: Address,
        bond_amount: i128,
    ) -> Result<(), SapError> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(SapError::AlreadyInitialized);
        }
        admin.require_auth();

        let config = Config {
            admin,
            work_order_contract,
            bond_token,
            bond_amount,
        };
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().set(&DataKey::AgentCount, &0u32);
        env.storage()
            .instance()
            .extend_ttl(LIFETIME_THRESHOLD, BUMP_AMOUNT);
        Ok(())
    }

    /// Register a new AI agent. Transfers bond from authority to contract.
    pub fn register_agent(
        env: Env,
        authority: Address,
        role: String,
        tools: Vec<String>,
        coldstar_vault: Option<Address>,
        metadata_uri: String,
    ) -> Result<(), SapError> {
        authority.require_auth();

        if role.len() > 32 {
            return Err(SapError::RoleTooLong);
        }
        if tools.len() > 16 {
            return Err(SapError::TooManyTools);
        }
        if metadata_uri.len() > 128 {
            return Err(SapError::UriTooLong);
        }
        for i in 0..tools.len() {
            if tools.get(i).unwrap().len() > 48 {
                return Err(SapError::ToolNameTooLong);
            }
        }

        let key = DataKey::Agent(authority.clone());
        if env.storage().persistent().has(&key) {
            return Err(SapError::AgentExists);
        }

        // Transfer anti-Sybil bond
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(SapError::NotInitialized)?;
        if config.bond_amount > 0 {
            let tkn = token::Client::new(&env, &config.bond_token);
            tkn.transfer(
                &authority,
                &env.current_contract_address(),
                &config.bond_amount,
            );
        }

        let agent = AgentData {
            authority: authority.clone(),
            role: role.clone(),
            tools,
            coldstar_vault,
            metadata_uri,
            reputation_score: 0,
            tasks_completed: 0,
            tasks_failed: 0,
            total_earned: 0,
            registered_at: env.ledger().timestamp(),
            is_active: true,
        };

        env.storage().persistent().set(&key, &agent);
        env.storage()
            .persistent()
            .extend_ttl(&key, LIFETIME_THRESHOLD, BUMP_AMOUNT);

        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::AgentCount)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::AgentCount, &(count + 1));
        env.storage()
            .instance()
            .extend_ttl(LIFETIME_THRESHOLD, BUMP_AMOUNT);

        env.events()
            .publish((symbol_short!("register"), authority), role);
        Ok(())
    }

    /// Update agent profile fields. Only authority can call.
    pub fn update_agent(
        env: Env,
        authority: Address,
        tools: Option<Vec<String>>,
        coldstar_vault: Option<Address>,
        metadata_uri: Option<String>,
    ) -> Result<(), SapError> {
        authority.require_auth();

        let key = DataKey::Agent(authority.clone());
        let mut agent: AgentData = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(SapError::AgentNotFound)?;

        if let Some(t) = tools {
            if t.len() > 16 {
                return Err(SapError::TooManyTools);
            }
            for i in 0..t.len() {
                if t.get(i).unwrap().len() > 48 {
                    return Err(SapError::ToolNameTooLong);
                }
            }
            agent.tools = t;
        }
        if let Some(vault) = coldstar_vault {
            agent.coldstar_vault = Some(vault);
        }
        if let Some(uri) = metadata_uri {
            if uri.len() > 128 {
                return Err(SapError::UriTooLong);
            }
            agent.metadata_uri = uri;
        }

        env.storage().persistent().set(&key, &agent);
        env.storage()
            .persistent()
            .extend_ttl(&key, LIFETIME_THRESHOLD, BUMP_AMOUNT);
        Ok(())
    }

    /// Stop accepting work. Bond remains locked until withdraw.
    pub fn deactivate_agent(env: Env, authority: Address) -> Result<(), SapError> {
        authority.require_auth();
        let key = DataKey::Agent(authority.clone());
        let mut agent: AgentData = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(SapError::AgentNotFound)?;
        agent.is_active = false;
        env.storage().persistent().set(&key, &agent);
        env.events()
            .publish((symbol_short!("deactiv"), authority), ());
        Ok(())
    }

    /// Resume accepting work.
    pub fn reactivate_agent(env: Env, authority: Address) -> Result<(), SapError> {
        authority.require_auth();
        let key = DataKey::Agent(authority.clone());
        let mut agent: AgentData = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(SapError::AgentNotFound)?;
        agent.is_active = true;
        env.storage().persistent().set(&key, &agent);
        Ok(())
    }

    /// Withdraw bond and remove agent. Must be deactivated first.
    pub fn withdraw_bond(env: Env, authority: Address) -> Result<(), SapError> {
        authority.require_auth();
        let key = DataKey::Agent(authority.clone());
        let agent: AgentData = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(SapError::AgentNotFound)?;

        if agent.is_active {
            return Err(SapError::AgentStillActive);
        }

        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(SapError::NotInitialized)?;
        if config.bond_amount > 0 {
            let tkn = token::Client::new(&env, &config.bond_token);
            tkn.transfer(
                &env.current_contract_address(),
                &authority,
                &config.bond_amount,
            );
        }

        env.storage().persistent().remove(&key);
        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::AgentCount)
            .unwrap_or(1);
        env.storage()
            .instance()
            .set(&DataKey::AgentCount, &count.saturating_sub(1));
        Ok(())
    }

    /// Called by the work-order contract when a task is approved.
    /// The work-order contract address is verified via require_auth + config check.
    pub fn record_completion(
        env: Env,
        caller_contract: Address,
        agent_addr: Address,
        earned: i128,
    ) -> Result<(), SapError> {
        caller_contract.require_auth();
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(SapError::NotInitialized)?;
        if caller_contract != config.work_order_contract {
            return Err(SapError::UnauthorizedCaller);
        }

        let key = DataKey::Agent(agent_addr);
        let mut agent: AgentData = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(SapError::AgentNotFound)?;

        agent.tasks_completed = agent
            .tasks_completed
            .checked_add(1)
            .ok_or(SapError::Overflow)?;
        agent.total_earned = agent
            .total_earned
            .checked_add(earned)
            .ok_or(SapError::Overflow)?;

        let total = agent.tasks_completed + agent.tasks_failed;
        if total > 0 {
            agent.reputation_score =
                ((agent.tasks_completed as u128 * 10000) / total as u128) as u64;
        }

        env.storage().persistent().set(&key, &agent);
        env.storage()
            .persistent()
            .extend_ttl(&key, LIFETIME_THRESHOLD, BUMP_AMOUNT);
        Ok(())
    }

    /// Called by the work-order contract on dispute/failure.
    pub fn record_failure(
        env: Env,
        caller_contract: Address,
        agent_addr: Address,
    ) -> Result<(), SapError> {
        caller_contract.require_auth();
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(SapError::NotInitialized)?;
        if caller_contract != config.work_order_contract {
            return Err(SapError::UnauthorizedCaller);
        }

        let key = DataKey::Agent(agent_addr);
        let mut agent: AgentData = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(SapError::AgentNotFound)?;

        agent.tasks_failed = agent
            .tasks_failed
            .checked_add(1)
            .ok_or(SapError::Overflow)?;

        let total = agent.tasks_completed + agent.tasks_failed;
        if total > 0 {
            agent.reputation_score =
                ((agent.tasks_completed as u128 * 10000) / total as u128) as u64;
        }

        env.storage().persistent().set(&key, &agent);
        env.storage()
            .persistent()
            .extend_ttl(&key, LIFETIME_THRESHOLD, BUMP_AMOUNT);
        Ok(())
    }

    // ── View Functions ─────────────────────────────────────────────────

    pub fn get_agent(env: Env, authority: Address) -> Result<AgentData, SapError> {
        env.storage()
            .persistent()
            .get(&DataKey::Agent(authority))
            .ok_or(SapError::AgentNotFound)
    }

    pub fn get_agent_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::AgentCount)
            .unwrap_or(0)
    }

    pub fn get_config(env: Env) -> Result<Config, SapError> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(SapError::NotInitialized)
    }
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, vec, Env, String};

    fn setup_env() -> (Env, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AgentRegistryContract, ());
        let client = AgentRegistryContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let bond_token = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let work_order = Address::generate(&env);

        // Mint bond tokens to test accounts
        let sac = token::StellarAssetClient::new(&env, &bond_token);
        sac.mint(&admin, &10_000_0000000);

        client.initialize(&admin, &work_order, &bond_token, &1_000_0000000);

        (env, contract_id, bond_token)
    }

    #[test]
    fn test_register_agent() {
        let (env, contract_id, bond_token) = setup_env();
        let client = AgentRegistryContractClient::new(&env, &contract_id);

        let authority = Address::generate(&env);
        // Fund authority with bond tokens
        let sac = token::StellarAssetClient::new(&env, &bond_token);
        sac.mint(&authority, &2_000_0000000);

        client.register_agent(
            &authority,
            &String::from_str(&env, "protocol-engineer"),
            &vec![&env, String::from_str(&env, "sap_post_order")],
            &None::<Address>,
            &String::from_str(&env, "https://example.com/agent1"),
        );

        let agent = client.get_agent(&authority);
        assert_eq!(agent.is_active, true);
        assert_eq!(agent.tasks_completed, 0);
        assert_eq!(client.get_agent_count(), 1);

        // Bond should have been transferred
        let tkn = token::Client::new(&env, &bond_token);
        assert_eq!(tkn.balance(&authority), 1_000_0000000); // 2000 - 1000 bond
    }

    #[test]
    fn test_update_agent() {
        let (env, contract_id, bond_token) = setup_env();
        let client = AgentRegistryContractClient::new(&env, &contract_id);

        let authority = Address::generate(&env);
        let sac = token::StellarAssetClient::new(&env, &bond_token);
        sac.mint(&authority, &2_000_0000000);

        client.register_agent(
            &authority,
            &String::from_str(&env, "analyst"),
            &vec![&env],
            &None::<Address>,
            &String::from_str(&env, "https://example.com"),
        );

        let new_tools = vec![
            &env,
            String::from_str(&env, "tool_a"),
            String::from_str(&env, "tool_b"),
        ];
        client.update_agent(
            &authority,
            &Some(new_tools),
            &None::<Address>,
            &Some(String::from_str(&env, "https://new-uri.com")),
        );

        let agent = client.get_agent(&authority);
        assert_eq!(agent.tools.len(), 2);
    }

    #[test]
    fn test_deactivate_reactivate() {
        let (env, contract_id, bond_token) = setup_env();
        let client = AgentRegistryContractClient::new(&env, &contract_id);

        let authority = Address::generate(&env);
        let sac = token::StellarAssetClient::new(&env, &bond_token);
        sac.mint(&authority, &2_000_0000000);

        client.register_agent(
            &authority,
            &String::from_str(&env, "auditor"),
            &vec![&env],
            &None::<Address>,
            &String::from_str(&env, "https://example.com"),
        );

        client.deactivate_agent(&authority);
        assert_eq!(client.get_agent(&authority).is_active, false);

        client.reactivate_agent(&authority);
        assert_eq!(client.get_agent(&authority).is_active, true);
    }

    #[test]
    fn test_withdraw_bond() {
        let (env, contract_id, bond_token) = setup_env();
        let client = AgentRegistryContractClient::new(&env, &contract_id);

        let authority = Address::generate(&env);
        let sac = token::StellarAssetClient::new(&env, &bond_token);
        sac.mint(&authority, &2_000_0000000);

        client.register_agent(
            &authority,
            &String::from_str(&env, "dev"),
            &vec![&env],
            &None::<Address>,
            &String::from_str(&env, "https://example.com"),
        );

        client.deactivate_agent(&authority);
        client.withdraw_bond(&authority);

        let tkn = token::Client::new(&env, &bond_token);
        assert_eq!(tkn.balance(&authority), 2_000_0000000); // Full balance restored
        assert_eq!(client.get_agent_count(), 0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #7)")]
    fn test_register_duplicate_fails() {
        let (env, contract_id, bond_token) = setup_env();
        let client = AgentRegistryContractClient::new(&env, &contract_id);

        let authority = Address::generate(&env);
        let sac = token::StellarAssetClient::new(&env, &bond_token);
        sac.mint(&authority, &5_000_0000000);

        let role = String::from_str(&env, "dev");
        let uri = String::from_str(&env, "https://example.com");
        client.register_agent(&authority, &role, &vec![&env], &None::<Address>, &uri);
        client.register_agent(&authority, &role, &vec![&env], &None::<Address>, &uri);
    }

    #[test]
    fn test_record_completion() {
        let (env, contract_id, bond_token) = setup_env();
        let client = AgentRegistryContractClient::new(&env, &contract_id);

        let config = client.get_config();
        let authority = Address::generate(&env);
        let sac = token::StellarAssetClient::new(&env, &bond_token);
        sac.mint(&authority, &2_000_0000000);

        client.register_agent(
            &authority,
            &String::from_str(&env, "dev"),
            &vec![&env],
            &None::<Address>,
            &String::from_str(&env, "https://example.com"),
        );

        client.record_completion(&config.work_order_contract, &authority, &500_0000000);

        let agent = client.get_agent(&authority);
        assert_eq!(agent.tasks_completed, 1);
        assert_eq!(agent.total_earned, 500_0000000);
        assert_eq!(agent.reputation_score, 10000); // 100% success
    }
}
