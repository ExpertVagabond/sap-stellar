#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$PROJECT_DIR/.env.testnet"

echo "=== Initializing SAP Contracts ==="
echo "Registry:   $REGISTRY_CONTRACT"
echo "Work Order: $WORK_ORDER_CONTRACT"
echo "Reputation: $REPUTATION_CONTRACT"
echo "Treasury:   $TREASURY"
echo "Deployer:   $DEPLOYER"

# Get native XLM SAC address for registration bond
XLM_TOKEN=$(stellar contract id asset --network testnet --asset native)
echo "XLM SAC:    $XLM_TOKEN"

echo ""
echo "Initializing agent-registry..."
stellar contract invoke \
  --id "$REGISTRY_CONTRACT" \
  --source sap-deployer \
  --network testnet \
  -- \
  initialize \
  --admin "$DEPLOYER" \
  --work_order_contract "$WORK_ORDER_CONTRACT" \
  --bond_token "$XLM_TOKEN" \
  --bond_amount 1000000000

echo "Agent registry initialized (bond: 100 XLM)"

echo ""
echo "Initializing work-order..."
# Build the config JSON for the struct parameter
stellar contract invoke \
  --id "$WORK_ORDER_CONTRACT" \
  --source sap-deployer \
  --network testnet \
  -- \
  initialize \
  --config "{\"admin\":\"$DEPLOYER\",\"registry_contract\":\"$REGISTRY_CONTRACT\",\"treasury\":\"$TREASURY\",\"usdc_token\":\"$XLM_TOKEN\",\"fee_bps\":\"250\",\"wash_fee_bps\":\"500\",\"min_fee\":\"10000\",\"min_reward\":\"1000000\",\"dispute_bond\":\"50000000\",\"dispute_window\":\"259200\",\"wash_cooldown\":\"86400\"}"

echo "Work order initialized (2.5% fee, XLM for rewards on testnet)"

echo ""
echo "Initializing reputation..."
stellar contract invoke \
  --id "$REPUTATION_CONTRACT" \
  --source sap-deployer \
  --network testnet \
  -- \
  initialize \
  --admin "$DEPLOYER"

echo "Reputation initialized"

echo ""
echo "=== All contracts initialized ==="
echo ""
echo "Verify on Stellar Expert:"
echo "  Registry:   https://stellar.expert/explorer/testnet/contract/$REGISTRY_CONTRACT"
echo "  Work Order: https://stellar.expert/explorer/testnet/contract/$WORK_ORDER_CONTRACT"
echo "  Reputation: https://stellar.expert/explorer/testnet/contract/$REPUTATION_CONTRACT"
