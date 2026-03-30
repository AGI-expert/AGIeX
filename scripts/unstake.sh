#!/usr/bin/env bash
# unstake.sh — Request or withdraw unstaked $AGIEX tokens.
#
# Usage:
#   ./unstake.sh request <amount>   # Request unstake (starts 7-day cooldown)
#   ./unstake.sh withdraw           # Withdraw tokens after cooldown expires
#   ./unstake.sh status             # Check current stake & unstake status
#
# Environment:
#   NODE_SOLANA_KEYPAIR  Path to node wallet JSON (default: data/node-wallet.json)
#   AGI_MINT_ADDRESS     SPL token mint address
#   AGI_PROGRAM_ID       On-chain program ID
#   SOLANA_RPC_URL       RPC endpoint (default: devnet)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# Resolve wallet
NODE_WALLET="${NODE_SOLANA_KEYPAIR:-$SCRIPT_DIR/data/node-wallet.json}"
if [ ! -f "$NODE_WALLET" ]; then
  echo -e "${RED}✗  Node wallet not found at ${WHITE}${NODE_WALLET}${NC}"
  echo -e "   Run ${CYAN}./start.sh${NC} first to generate a wallet."
  exit 1
fi
export NODE_SOLANA_KEYPAIR="$NODE_WALLET"
export AGI_MINT_ADDRESS="${AGI_MINT_ADDRESS:-Dnw5R5Kn4WZZLkH62Ys48VsYeBR7PWz1dMb7QRfJKg47}"
export AGI_PROGRAM_ID="${AGI_PROGRAM_ID:-3gFo4GUwn3ayTgKKBAaMX8u9fZFdYXTyytPZShRfdVBp}"

CMD="${1:-}"

usage() {
  echo -e "${BOLD}Usage:${NC}"
  echo -e "  ./unstake.sh request <amount>   Request unstake (starts 7-day cooldown)"
  echo -e "  ./unstake.sh withdraw           Withdraw tokens after cooldown"
  echo -e "  ./unstake.sh status             Check stake & unstake status"
  exit 1
}

case "$CMD" in
  request)
    AMOUNT="${2:-}"
    if [ -z "$AMOUNT" ]; then
      echo -e "${RED}✗  Amount required.${NC} Usage: ./unstake.sh request <amount>"
      exit 1
    fi
    echo -e "${CYAN}  ▸${NC} ${BOLD}Requesting unstake of ${WHITE}${AMOUNT}${NC} ${BOLD}tokens...${NC}"
    echo -e "  ${DIM}This starts a 7-day cooldown. After that, run: ./unstake.sh withdraw${NC}"
    echo ""
    node -e "
      import { Keypair } from '@solana/web3.js';
      import { readFileSync } from 'fs';
      import { requestUnstake } from './tokens/client/submit-proof.js';

      const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.NODE_SOLANA_KEYPAIR, 'utf8'))));
      const decimals = 6;
      const amount = Math.floor(parseFloat('${AMOUNT}') * 10 ** decimals);
      const sig = await requestUnstake(kp, amount);
      console.log('  ${GREEN}✓  Unstake requested${NC}');
      console.log('  ${DIM}tx: ' + sig + '${NC}');
      console.log('');
      console.log('  ${YELLOW}⏳ 7-day cooldown started.${NC}');
      console.log('  ${DIM}Run ./unstake.sh withdraw after the cooldown expires.${NC}');
    " --input-type=module
    ;;

  withdraw)
    echo -e "${CYAN}  ▸${NC} ${BOLD}Withdrawing unstaked tokens...${NC}"
    node -e "
      import { Keypair, PublicKey } from '@solana/web3.js';
      import { readFileSync } from 'fs';
      import { withdrawUnstake, fetchNodeAccount } from './tokens/client/submit-proof.js';

      const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.NODE_SOLANA_KEYPAIR, 'utf8'))));
      const mint = new PublicKey(process.env.AGI_MINT_ADDRESS);

      const account = await fetchNodeAccount(kp.publicKey);
      if (!account || account.pendingUnstake === 0) {
        console.log('  ${YELLOW}⚠  No pending unstake request found.${NC}');
        process.exit(1);
      }

      const now = Math.floor(Date.now() / 1000);
      const cooldownEnd = account.unstakeRequestedAt + (7 * 24 * 3600);
      if (now < cooldownEnd) {
        const remaining = cooldownEnd - now;
        const days = Math.floor(remaining / 86400);
        const hours = Math.floor((remaining % 86400) / 3600);
        console.log('  ${YELLOW}⚠  Cooldown not expired yet.${NC}');
        console.log('  ${DIM}Time remaining: ' + days + 'd ' + hours + 'h${NC}');
        process.exit(1);
      }

      const sig = await withdrawUnstake(kp, mint);
      const decimals = 6;
      console.log('  ${GREEN}✓  Withdrawn ' + (account.pendingUnstake / 10 ** decimals) + ' tokens${NC}');
      console.log('  ${DIM}tx: ' + sig + '${NC}');
    " --input-type=module
    ;;

  status)
    echo -e "${CYAN}  ▸${NC} ${BOLD}Stake status${NC}"
    node -e "
      import { Keypair } from '@solana/web3.js';
      import { readFileSync } from 'fs';
      import { fetchNodeAccount } from './tokens/client/submit-proof.js';

      const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.NODE_SOLANA_KEYPAIR, 'utf8'))));
      const account = await fetchNodeAccount(kp.publicKey);

      if (!account) {
        console.log('  ${YELLOW}⚠  Node account not found on-chain.${NC}');
        process.exit(1);
      }

      const decimals = 6;
      const staked = (account.stakeAmount / 10 ** decimals).toFixed(2);
      const pending = (account.pendingUnstake / 10 ** decimals).toFixed(2);

      console.log('');
      console.log('  ${WHITE}Staked:${NC}           ' + staked + ' AGIEX');
      console.log('  ${WHITE}Pending unstake:${NC}  ' + pending + ' AGIEX');

      if (account.pendingUnstake > 0) {
        const now = Math.floor(Date.now() / 1000);
        const cooldownEnd = account.unstakeRequestedAt + (7 * 24 * 3600);
        if (now >= cooldownEnd) {
          console.log('  ${GREEN}✓  Cooldown expired — ready to withdraw${NC}');
          console.log('  ${DIM}Run: ./unstake.sh withdraw${NC}');
        } else {
          const remaining = cooldownEnd - now;
          const days = Math.floor(remaining / 86400);
          const hours = Math.floor((remaining % 86400) / 3600);
          console.log('  ${YELLOW}⏳ Cooldown: ' + days + 'd ' + hours + 'h remaining${NC}');
        }
      }
      console.log('');
    " --input-type=module
    ;;

  *)
    usage
    ;;
esac
