#!/bin/bash
set -euo pipefail

# Fix PATH: use rustup's toolchain instead of Homebrew's rustc
TOOLCHAIN="$RUSTUP_HOME/toolchains/stable-aarch64-apple-darwin"
export PATH="$TOOLCHAIN/bin:$PATH"

NETWORK="testnet"
SOURCE="sap-deployer"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cd "$PROJECT_DIR"

echo "=== SAP-on-Stellar Deployment ==="
echo "Building contracts..."
stellar contract build

echo ""
echo "Deploying agent-registry..."
REGISTRY_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/sap_agent_registry.wasm \
  --source "$SOURCE" --network "$NETWORK")
echo "Registry: $REGISTRY_ID"

echo ""
echo "Deploying work-order..."
WORK_ORDER_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/sap_work_order.wasm \
  --source "$SOURCE" --network "$NETWORK")
echo "Work Order: $WORK_ORDER_ID"

echo ""
echo "Deploying reputation..."
REPUTATION_ID=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/sap_reputation.wasm \
  --source "$SOURCE" --network "$NETWORK")
echo "Reputation: $REPUTATION_ID"

DEPLOYER_ADDR=$(stellar keys address sap-deployer)
TREASURY_ADDR=$(stellar keys address sap-treasury)

cat > "$PROJECT_DIR/.env.testnet" << EOF
REGISTRY_CONTRACT=$REGISTRY_ID
WORK_ORDER_CONTRACT=$WORK_ORDER_ID
REPUTATION_CONTRACT=$REPUTATION_ID
TREASURY=$TREASURY_ADDR
DEPLOYER=$DEPLOYER_ADDR
NETWORK=testnet
STELLAR_RPC=https://soroban-testnet.stellar.org
EOF

echo ""
echo "=== Contract IDs saved to .env.testnet ==="
cat "$PROJECT_DIR/.env.testnet"
echo ""
echo "=== Deployment complete ==="
