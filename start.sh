#!/usr/bin/env bash
# start.sh — One-command launcher for the simplified agent network.
#
# What it does:
#   1. Detects your hardware (GPU, CPU, RAM, disk, public IP)
#   2. Auto-enables the right capabilities (all 9 if your machine qualifies)
#   3. Generates a node config with SPL token rewards
#   4. Installs dependencies
#   5. Initializes the SPL token mint (devnet by default)
#   6. Starts the node
#
# Usage:
#   ./start.sh                       # Auto-detect everything, devnet (auto-stake ON)
#   ./start.sh --no-auto-stake       # Disable auto-staking
#   SOLANA_RPC_URL=<rpc> ./start.sh  # Use a custom RPC (e.g., mainnet)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SETUP_DIR="$SCRIPT_DIR/setup"
TOKENS_DIR="$SCRIPT_DIR/tokens"
CONFIG_FILE="$SCRIPT_DIR/node-config.json"

# Parse arguments
AUTO_STAKE=1
NODE_ARGS=""
for arg in "$@"; do
  case "$arg" in
    --no-auto-stake) AUTO_STAKE=0 ;;
    *)               NODE_ARGS="$NODE_ARGS $arg" ;;
  esac
done

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

banner() {
  echo ""
  echo -e "${CYAN}        ___   ________ ___${NC}"
  echo -e "${CYAN}       /   | / ____/  /  /${NC}"
  echo -e "${CYAN}      / /| |/ / __/ / / /${NC}"
  echo -e "${CYAN}     / ___ / /_/ / / / /${NC}"
  echo -e "${CYAN}    /_/  |_\\____/_/_/_/${NC}  ${WHITE}${BOLD}expert${NC}"
  echo ""
  echo -e "    ${DIM}Decentralized Agent Network${NC}"
  echo -e "    ${DIM}One command. Auto-configured. On-chain rewards.${NC}"
  echo ""
}

step() { echo -e "\n${GREEN}  ▸${NC} ${BOLD}$1${NC} ${DIM}$(date +%H:%M:%S)${NC}"; }
info() { echo -e "    ${CYAN}$1${NC}"; }
warn() { echo -e "    ${YELLOW}⚠  $1${NC}"; }
fail() { echo -e "    ${RED}✗  $1${NC}"; exit 1; }

# ──────────────────────────────────────────────────────────────────────────
banner

# Step 0: Ensure Node.js is available
if ! command -v node &>/dev/null; then
  step "Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
  info "Node.js $(node -v) installed"
fi

# Step 1: Detect hardware
step "Scanning hardware..."
if [ ! -x "$SETUP_DIR/detect-hardware.sh" ]; then
  fail "Missing setup/detect-hardware.sh — are you in the repo root?"
fi

HW_PROFILE=$("$SETUP_DIR/detect-hardware.sh")
echo "$HW_PROFILE" | tee "$SCRIPT_DIR/hw-profile.json"

GPU_TYPE=$(echo "$HW_PROFILE" | grep -o '"gpu_type": *"[^"]*"' | head -1 | sed 's/.*: *"//;s/"//')
GPU_NAME=$(echo "$HW_PROFILE" | grep -o '"gpu_name": *"[^"]*"' | head -1 | sed 's/.*: *"//;s/"//')
VRAM=$(echo "$HW_PROFILE" | grep -o '"vram_mb": *[0-9]*' | head -1 | sed 's/.*: *//')
ENABLED=$(echo "$HW_PROFILE" | grep -o '"enabled_count": *[0-9]*' | head -1 | sed 's/.*: *//')
MODEL=$(echo "$HW_PROFILE" | grep -o '"recommended_model": *"[^"]*"' | head -1 | sed 's/.*: *"//;s/"//')

echo ""
info "GPU          ${WHITE}${GPU_NAME:-none}${CYAN} (${GPU_TYPE}, ${VRAM:-0} MB VRAM)"
info "Capabilities ${WHITE}${ENABLED}/9${CYAN} enabled"
info "Model        ${WHITE}${MODEL:-cpu-only}${NC}"

# Step 2: Generate node config from template + hardware profile
step "Generating node config..."
if command -v node &>/dev/null; then
  node -e "
    const fs = require('fs');
    const tpl = JSON.parse(fs.readFileSync('$SETUP_DIR/node-config.template.json', 'utf8'));
    const hw = JSON.parse(fs.readFileSync('$SCRIPT_DIR/hw-profile.json', 'utf8'));
    tpl.capabilities = hw.capabilities;
    tpl.inference.model = hw.recommended_model;
    if (process.env.SOLANA_RPC_URL) tpl.rewards.rpc_url = process.env.SOLANA_RPC_URL;
    fs.writeFileSync('$CONFIG_FILE', JSON.stringify(tpl, null, 2));
  "
  info "Config written to ${WHITE}node-config.json${NC}"
else
  # Fallback: just copy capabilities from hw-profile into template using sed
  cp "$SETUP_DIR/node-config.template.json" "$CONFIG_FILE"
  warn "Node.js not found — config generated with default capabilities. Install Node.js for full auto-config."
fi

# Step 3: Install all dependencies (root + tokens)
step "Installing dependencies..."
if command -v node &>/dev/null && command -v npm &>/dev/null; then
  cd "$SCRIPT_DIR"
  npm install --silent 2>&1 | tail -3
  cd "$TOKENS_DIR"
  npm install --silent 2>&1 | tail -1
  cd "$SCRIPT_DIR"
  info "All dependencies installed"
else
  fail "Node.js >= 18 is required. Install it first:
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs"
fi

# Step 4: Initialize SPL token mint
step "Initializing SPL token mint..."
if [ -f "$TOKENS_DIR/node_modules/@solana/web3.js/package.json" ]; then
  cd "$TOKENS_DIR"
  if ! node rewards.js init; then
    warn "Mint initialization failed — the node will start without rewards."
    warn "Fix the issue above and run: cd tokens && node rewards.js init"
  fi
  cd "$SCRIPT_DIR"
else
  warn "Skipping mint init — dependencies not installed."
fi

# Step 5: Set up node wallet + on-chain env vars
step "Setting up node wallet..."

# Default wallet path — use env var only if file exists, otherwise data/node-wallet.json
NODE_WALLET="$SCRIPT_DIR/data/node-wallet.json"
if [ -n "${NODE_SOLANA_KEYPAIR:-}" ] && [ -f "$NODE_SOLANA_KEYPAIR" ]; then
  NODE_WALLET="$NODE_SOLANA_KEYPAIR"
fi
mkdir -p "$SCRIPT_DIR/data"
if [ ! -f "$NODE_WALLET" ]; then
  node -e "
    const { Keypair } = require('@solana/web3.js');
    const fs = require('fs');
    const kp = Keypair.generate();
    fs.writeFileSync('$NODE_WALLET', JSON.stringify(Array.from(kp.secretKey)));
    console.log('  Generated new node wallet: ' + kp.publicKey.toBase58());
  "
fi

export NODE_SOLANA_KEYPAIR="$NODE_WALLET"
export AGI_MINT_ADDRESS="${AGI_MINT_ADDRESS:-Dnw5R5Kn4WZZLkH62Ys48VsYeBR7PWz1dMb7QRfJKg47}"
export AGI_PROGRAM_ID="${AGI_PROGRAM_ID:-3gFo4GUwn3ayTgKKBAaMX8u9fZFdYXTyytPZShRfdVBp}"

# Print wallet public key
WALLET_PUBKEY=$(node -e "
  const { Keypair } = require('@solana/web3.js');
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(require('fs').readFileSync('$NODE_WALLET','utf8'))));
  console.log(kp.publicKey.toBase58());
")
info "Wallet   ${WHITE}${WALLET_PUBKEY}${NC}"
info "Mint     ${WHITE}${AGI_MINT_ADDRESS}${NC}"
info "Program  ${WHITE}${AGI_PROGRAM_ID}${NC}"

# Check SOL balance on devnet and print funding instructions if needed
RPC="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
if echo "$RPC" | grep -q "devnet"; then
  WALLET_BALANCE=$(node -e "
    const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
    new Connection('$RPC').getBalance(new PublicKey('$WALLET_PUBKEY')).then(b => console.log(b / LAMPORTS_PER_SOL));
  " 2>/dev/null || echo "0")
  info "Balance  ${WHITE}${WALLET_BALANCE} SOL${NC}"
  if [ "$(echo "$WALLET_BALANCE < 0.1" | node -e "process.stdout.write(String(eval(require('fs').readFileSync('/dev/stdin','utf8'))))")" = "true" ]; then
    info "${YELLOW}Low balance — fund this wallet with devnet SOL:${NC}"
    info "  ${WHITE}${WALLET_PUBKEY}${NC}"
    info "  Run: ${CYAN}solana airdrop 2 ${WALLET_PUBKEY} --url devnet${NC}"
    info "  Or visit: ${CYAN}https://faucet.solana.com${NC}"
  fi
fi

# Step 6: Create models + data directories
step "Creating data directories..."
mkdir -p "$SCRIPT_DIR/models" "$SCRIPT_DIR/data"
info "Created ${WHITE}models/${CYAN} and ${WHITE}data/${NC}"

# Step 7: Launch the node
step "Launching node..."
if [ "$AUTO_STAKE" -eq 1 ]; then
  info "Auto-stake ${GREEN}enabled${CYAN} (stake when balance >= 100 tokens)"
else
  info "Auto-stake ${YELLOW}disabled${CYAN} (use default to enable)"
fi
echo ""
if [ "$AUTO_STAKE" -eq 0 ]; then
  exec node src/main.js --config "$CONFIG_FILE" --no-auto-stake$NODE_ARGS
else
  exec node src/main.js --config "$CONFIG_FILE"$NODE_ARGS
fi
