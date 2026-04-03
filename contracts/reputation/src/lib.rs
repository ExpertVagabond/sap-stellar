#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short, Address, Env, String, Vec,
};

const DAY_IN_LEDGERS: u32 = 17_280;
const BUMP_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
const LIFETIME_THRESHOLD: u32 = BUMP_AMOUNT - DAY_IN_LEDGERS;

/// Decay: 1% per week of inactivity (100 basis points).
const WEEKLY_DECAY_BPS: u64 = 100;
/// Seconds in a week.
const SECONDS_PER_WEEK: u64 = 604_800;
/// Max tracked specializations per agent.
const MAX_SPECIALIZATIONS: u32 = 8;

// ── Errors ─────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RepError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    SpecNameTooLong = 3,
    ReputationExists = 4,
    ReputationNotFound = 5,
    UnauthorizedCaller = 6,
}

// ── Storage ────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Reputation(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReputationData {
    pub agent: Address,
    pub total_tasks: u64,
    pub successful_tasks: u64,
    pub failed_tasks: u64,
    pub total_earned: i128,
    pub avg_completion_time: u64,
    pub specializations: Vec<SpecData>,
    pub last_active: u64,
    pub created_at: u64,
    pub composite_score: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SpecData {
    pub name: String,
    pub total: u64,
    pub successes: u64,
    pub score: u64,
}

// ── Contract ───────────────────────────────────────────────────────────

#[contract]
pub struct ReputationContract;

#[contractimpl]
impl ReputationContract {
    pub fn initialize(env: Env, admin: Address) -> Result<(), RepError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(RepError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .extend_ttl(LIFETIME_THRESHOLD, BUMP_AMOUNT);
        Ok(())
    }

    /// Create a reputation record for an agent. Called once after registration.
    pub fn init_reputation(
        env: Env,
        authority: Address,
        agent_addr: Address,
    ) -> Result<(), RepError> {
        authority.require_auth();

        let key = DataKey::Reputation(agent_addr.clone());
        if env.storage().persistent().has(&key) {
            return Err(RepError::ReputationExists);
        }

        let now = env.ledger().timestamp();
        let rep = ReputationData {
            agent: agent_addr,
            total_tasks: 0,
            successful_tasks: 0,
            failed_tasks: 0,
            total_earned: 0,
            avg_completion_time: 0,
            specializations: Vec::new(&env),
            last_active: now,
            created_at: now,
            composite_score: 0,
        };

        env.storage().persistent().set(&key, &rep);
        env.storage()
            .persistent()
            .extend_ttl(&key, LIFETIME_THRESHOLD, BUMP_AMOUNT);
        Ok(())
    }

    /// Record a successful task completion with metadata.
    pub fn record_success(
        env: Env,
        authority: Address,
        agent_addr: Address,
        earned: i128,
        completion_time: u64,
        specialization: String,
    ) -> Result<(), RepError> {
        authority.require_auth();

        if specialization.len() > 32 {
            return Err(RepError::SpecNameTooLong);
        }

        let key = DataKey::Reputation(agent_addr.clone());
        let mut rep: ReputationData = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(RepError::ReputationNotFound)?;

        rep.total_tasks += 1;
        rep.successful_tasks += 1;
        rep.total_earned += earned;
        rep.last_active = env.ledger().timestamp();

        // Rolling average completion time
        if rep.avg_completion_time == 0 {
            rep.avg_completion_time = completion_time;
        } else {
            rep.avg_completion_time = (rep.avg_completion_time * (rep.successful_tasks - 1)
                + completion_time)
                / rep.successful_tasks;
        }

        // Update specialization
        update_specialization(&env, &mut rep.specializations, &specialization, true);

        // Recompute composite
        rep.composite_score = compute_composite(&rep);

        env.storage().persistent().set(&key, &rep);
        env.storage()
            .persistent()
            .extend_ttl(&key, LIFETIME_THRESHOLD, BUMP_AMOUNT);

        env.events().publish(
            (symbol_short!("rep_up"), agent_addr),
            (rep.composite_score, rep.total_tasks),
        );
        Ok(())
    }

    /// Record a failed task.
    pub fn record_failure(
        env: Env,
        authority: Address,
        agent_addr: Address,
        specialization: String,
    ) -> Result<(), RepError> {
        authority.require_auth();

        if specialization.len() > 32 {
            return Err(RepError::SpecNameTooLong);
        }

        let key = DataKey::Reputation(agent_addr.clone());
        let mut rep: ReputationData = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(RepError::ReputationNotFound)?;

        rep.total_tasks += 1;
        rep.failed_tasks += 1;
        rep.last_active = env.ledger().timestamp();

        update_specialization(&env, &mut rep.specializations, &specialization, false);
        rep.composite_score = compute_composite(&rep);

        env.storage().persistent().set(&key, &rep);
        env.storage()
            .persistent()
            .extend_ttl(&key, LIFETIME_THRESHOLD, BUMP_AMOUNT);
        Ok(())
    }

    /// Permissionless: apply time-based decay to inactive agents.
    pub fn apply_decay(env: Env, agent_addr: Address) -> Result<(), RepError> {
        let key = DataKey::Reputation(agent_addr);
        let mut rep: ReputationData = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(RepError::ReputationNotFound)?;

        let now = env.ledger().timestamp();
        if now > rep.last_active {
            let weeks_inactive = (now - rep.last_active) / SECONDS_PER_WEEK;
            if weeks_inactive > 0 {
                let decay = weeks_inactive * WEEKLY_DECAY_BPS;
                let decay_factor = 10000u64.saturating_sub(decay).max(1000); // Floor at 10%
                rep.composite_score = (rep.composite_score * decay_factor) / 10000;
            }
        }

        env.storage().persistent().set(&key, &rep);
        env.storage()
            .persistent()
            .extend_ttl(&key, LIFETIME_THRESHOLD, BUMP_AMOUNT);
        Ok(())
    }

    // ── View Functions ─────────────────────────────────────────────────

    pub fn get_reputation(env: Env, agent_addr: Address) -> Result<ReputationData, RepError> {
        env.storage()
            .persistent()
            .get(&DataKey::Reputation(agent_addr))
            .ok_or(RepError::ReputationNotFound)
    }
}

// ── Helpers ────────────────────────────────────────────────────────────

fn update_specialization(
    _env: &Env,
    specs: &mut Vec<SpecData>,
    name: &String,
    success: bool,
) {
    // Find existing specialization
    for i in 0..specs.len() {
        let mut spec = specs.get(i).unwrap();
        if spec.name == *name {
            spec.total += 1;
            if success {
                spec.successes += 1;
            }
            spec.score = ((spec.successes as u128 * 10000) / spec.total as u128) as u64;
            specs.set(i, spec);
            return;
        }
    }

    // Add new specialization if under limit
    if specs.len() < MAX_SPECIALIZATIONS {
        specs.push_back(SpecData {
            name: name.clone(),
            total: 1,
            successes: if success { 1 } else { 0 },
            score: if success { 10000 } else { 0 },
        });
    }
}

/// Integer log2 approximation. Returns floor(log2(n)) * 500, capped at 2500.
fn integer_volume_bonus(tasks: u64) -> u128 {
    if tasks <= 1 {
        return 0;
    }
    let log2_floor = 63u32.saturating_sub(tasks.leading_zeros());
    ((log2_floor as u128) * 500).min(2500)
}

/// Composite score: 60% success rate + 25% volume bonus + 15% earnings tier.
fn compute_composite(rep: &ReputationData) -> u64 {
    if rep.total_tasks == 0 {
        return 0;
    }

    let success_rate = (rep.successful_tasks as u128 * 10000) / rep.total_tasks as u128;
    let volume_bonus = integer_volume_bonus(rep.total_tasks);

    // Earnings tier: per USDC earned (7 decimals). 1 USDC = 10_000_000 base units.
    let usdc_earned = rep.total_earned / 10_000_000;
    let earnings_score = ((usdc_earned as u128) * 100).min(1500);

    let composite = (success_rate * 60 + volume_bonus * 25 + earnings_score * 15) / 100;
    composite.min(10000) as u64
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, Env, String};

    fn setup() -> (Env, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(ReputationContract, ());
        let client = ReputationContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        (env, contract_id)
    }

    #[test]
    fn test_init_reputation() {
        let (env, contract_id) = setup();
        let client = ReputationContractClient::new(&env, &contract_id);
        let agent = Address::generate(&env);
        let authority = Address::generate(&env);

        client.init_reputation(&authority, &agent);

        let rep = client.get_reputation(&agent);
        assert_eq!(rep.total_tasks, 0);
        assert_eq!(rep.composite_score, 0);
    }

    #[test]
    fn test_record_success() {
        let (env, contract_id) = setup();
        let client = ReputationContractClient::new(&env, &contract_id);
        let agent = Address::generate(&env);
        let authority = Address::generate(&env);

        client.init_reputation(&authority, &agent);
        client.record_success(
            &authority,
            &agent,
            &10_000_000,
            &300,
            &String::from_str(&env, "climate-analysis"),
        );

        let rep = client.get_reputation(&agent);
        assert_eq!(rep.total_tasks, 1);
        assert_eq!(rep.successful_tasks, 1);
        assert_eq!(rep.total_earned, 10_000_000);
        assert!(rep.composite_score > 0);
    }

    #[test]
    fn test_record_failure() {
        let (env, contract_id) = setup();
        let client = ReputationContractClient::new(&env, &contract_id);
        let agent = Address::generate(&env);
        let authority = Address::generate(&env);

        client.init_reputation(&authority, &agent);

        // 2 successes + 1 failure
        client.record_success(
            &authority,
            &agent,
            &5_000_000,
            &200,
            &String::from_str(&env, "audit"),
        );
        client.record_success(
            &authority,
            &agent,
            &5_000_000,
            &250,
            &String::from_str(&env, "audit"),
        );
        client.record_failure(
            &authority,
            &agent,
            &String::from_str(&env, "audit"),
        );

        let rep = client.get_reputation(&agent);
        assert_eq!(rep.total_tasks, 3);
        assert_eq!(rep.successful_tasks, 2);
        assert_eq!(rep.failed_tasks, 1);
        // Success rate: 66.67%
        // Score should be less than a perfect record
        assert!(rep.composite_score < 10000);
    }

    #[test]
    fn test_specialization_tracking() {
        let (env, contract_id) = setup();
        let client = ReputationContractClient::new(&env, &contract_id);
        let agent = Address::generate(&env);
        let authority = Address::generate(&env);

        client.init_reputation(&authority, &agent);
        client.record_success(
            &authority,
            &agent,
            &1_000_000,
            &100,
            &String::from_str(&env, "climate"),
        );
        client.record_success(
            &authority,
            &agent,
            &2_000_000,
            &200,
            &String::from_str(&env, "security"),
        );

        let rep = client.get_reputation(&agent);
        assert_eq!(rep.specializations.len(), 2);
    }

    #[test]
    fn test_decay() {
        let (env, contract_id) = setup();
        let client = ReputationContractClient::new(&env, &contract_id);
        let agent = Address::generate(&env);
        let authority = Address::generate(&env);

        client.init_reputation(&authority, &agent);
        client.record_success(
            &authority,
            &agent,
            &10_000_000,
            &100,
            &String::from_str(&env, "dev"),
        );

        let before = client.get_reputation(&agent).composite_score;

        // Advance ledger by 2 weeks
        env.ledger().set_timestamp(env.ledger().timestamp() + 2 * SECONDS_PER_WEEK);

        client.apply_decay(&agent);

        let after = client.get_reputation(&agent).composite_score;
        assert!(after < before, "decay should reduce score");
    }
}
