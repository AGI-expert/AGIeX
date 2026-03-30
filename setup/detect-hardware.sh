#!/usr/bin/env bash
# detect-hardware.sh — Scan local hardware and auto-assign network capabilities.
# Outputs a JSON capability profile to stdout.
set -euo pipefail

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
has_cmd() { command -v "$1" &>/dev/null; }
bytes_to_gb() { echo "scale=1; $1 / 1073741824" | bc 2>/dev/null || echo "0"; }

# ---------------------------------------------------------------------------
# GPU detection
# ---------------------------------------------------------------------------
GPU_TYPE="none"
GPU_NAME=""
VRAM_MB=0

if has_cmd nvidia-smi; then
  GPU_TYPE="cuda"
  GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1 | xargs)
  VRAM_MB=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -1 | xargs)
elif [ -d /sys/class/drm ] && ls /sys/class/drm/card*/device/vendor 2>/dev/null | head -1 | xargs cat 2>/dev/null | grep -q "0x1002"; then
  GPU_TYPE="rocm"
  GPU_NAME="AMD GPU"
  if has_cmd rocm-smi; then
    VRAM_MB=$(rocm-smi --showmeminfo vram 2>/dev/null | grep "Total" | awk '{print int($3/1048576)}' || echo "0")
  fi
elif system_profiler SPDisplaysDataType 2>/dev/null | grep -q "Metal"; then
  GPU_TYPE="metal"
  GPU_NAME=$(system_profiler SPDisplaysDataType 2>/dev/null | grep "Chipset Model" | head -1 | sed 's/.*: //')
  # macOS unified memory — use total RAM as approximate VRAM
  VRAM_MB=$(sysctl -n hw.memsize 2>/dev/null | awk '{print int($1/1048576)}' || echo "0")
fi

# ---------------------------------------------------------------------------
# CPU / RAM / Disk
# ---------------------------------------------------------------------------
CPU_CORES=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 1)

if [ -f /proc/meminfo ]; then
  RAM_MB=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)
else
  RAM_MB=$(sysctl -n hw.memsize 2>/dev/null | awk '{print int($1/1048576)}' || echo "0")
fi

DISK_FREE_MB=$(df -m / 2>/dev/null | tail -1 | awk '{print $4}')
: "${DISK_FREE_MB:=0}"

# ---------------------------------------------------------------------------
# Network — check if we have a public IP (for proxy/relay capabilities)
# ---------------------------------------------------------------------------
HAS_PUBLIC_IP="false"
if has_cmd curl; then
  PUB_IP=$(curl -s --max-time 3 https://ifconfig.me 2>/dev/null || true)
  if [[ -n "$PUB_IP" && "$PUB_IP" != "127."* && "$PUB_IP" != "10."* && "$PUB_IP" != "192.168."* && "$PUB_IP" != "172."* ]]; then
    HAS_PUBLIC_IP="true"
  fi
fi

# ---------------------------------------------------------------------------
# Capability assignment rules
# ---------------------------------------------------------------------------
# Each capability maps to a hardware requirement. The script enables
# everything the machine can handle — zero user configuration needed.
#
#   Capability     Requirement
#   ----------     -----------
#   inference      GPU with >= 4 GB VRAM
#   research       GPU with >= 6 GB VRAM  OR  CPU >= 4 cores + 8 GB RAM
#   proxy          Public IP address
#   storage        >= 50 GB free disk
#   embedding      CPU >= 2 cores + 4 GB RAM  (always lightweight)
#   memory         >= 8 GB RAM + 20 GB free disk
#   orchestration  CPU >= 4 cores + 8 GB RAM
#   validation     CPU >= 2 cores  (always lightweight)
#   relay          Public IP address

cap_inference="false"
cap_research="false"
cap_proxy="false"
cap_storage="false"
cap_embedding="false"
cap_memory="false"
cap_orchestration="false"
cap_validation="false"
cap_relay="false"

# Inference: need a real GPU with >= 4 GB VRAM
if [[ "$GPU_TYPE" != "none" && "$VRAM_MB" -ge 4000 ]]; then
  cap_inference="true"
fi

# Research: GPU >= 6 GB  OR  beefy CPU
if [[ "$GPU_TYPE" != "none" && "$VRAM_MB" -ge 6000 ]]; then
  cap_research="true"
elif [[ "$CPU_CORES" -ge 4 && "$RAM_MB" -ge 8000 ]]; then
  cap_research="true"
fi

# Proxy & Relay: need public IP
if [[ "$HAS_PUBLIC_IP" == "true" ]]; then
  cap_proxy="true"
  cap_relay="true"
fi

# Storage: need 50 GB+ free disk
if [[ "$DISK_FREE_MB" -ge 51200 ]]; then
  cap_storage="true"
fi

# Embedding: lightweight, almost any machine
if [[ "$CPU_CORES" -ge 2 && "$RAM_MB" -ge 4000 ]]; then
  cap_embedding="true"
fi

# Memory: 8 GB RAM + 20 GB disk
if [[ "$RAM_MB" -ge 8000 && "$DISK_FREE_MB" -ge 20480 ]]; then
  cap_memory="true"
fi

# Orchestration: 4 cores + 8 GB
if [[ "$CPU_CORES" -ge 4 && "$RAM_MB" -ge 8000 ]]; then
  cap_orchestration="true"
fi

# Validation: very lightweight
if [[ "$CPU_CORES" -ge 2 ]]; then
  cap_validation="true"
fi

# ---------------------------------------------------------------------------
# Model recommendation (matches upstream VRAM table)
# ---------------------------------------------------------------------------
RECOMMENDED_MODEL="none"
if [[ "$VRAM_MB" -ge 80000 ]]; then RECOMMENDED_MODEL="qwen2.5-coder-32b";
elif [[ "$VRAM_MB" -ge 48000 ]]; then RECOMMENDED_MODEL="gemma-3-27b";
elif [[ "$VRAM_MB" -ge 24000 ]]; then RECOMMENDED_MODEL="gpt-oss-20b";
elif [[ "$VRAM_MB" -ge 16000 ]]; then RECOMMENDED_MODEL="gemma-3-12b";
elif [[ "$VRAM_MB" -ge 12000 ]]; then RECOMMENDED_MODEL="glm-4-9b";
elif [[ "$VRAM_MB" -ge 8000 ]]; then  RECOMMENDED_MODEL="gemma-3-4b";
elif [[ "$VRAM_MB" -ge 6000 ]]; then  RECOMMENDED_MODEL="gemma-3-4b";
elif [[ "$VRAM_MB" -ge 4000 ]]; then  RECOMMENDED_MODEL="gemma-3-1b";
fi

# ---------------------------------------------------------------------------
# Count enabled capabilities
# ---------------------------------------------------------------------------
ENABLED=0
for c in $cap_inference $cap_research $cap_proxy $cap_storage $cap_embedding $cap_memory $cap_orchestration $cap_validation $cap_relay; do
  [[ "$c" == "true" ]] && ENABLED=$((ENABLED + 1))
done

# ---------------------------------------------------------------------------
# Output JSON profile
# ---------------------------------------------------------------------------
cat <<EOF
{
  "hardware": {
    "gpu_type": "$GPU_TYPE",
    "gpu_name": "$GPU_NAME",
    "vram_mb": $VRAM_MB,
    "cpu_cores": $CPU_CORES,
    "ram_mb": $RAM_MB,
    "disk_free_mb": $DISK_FREE_MB,
    "has_public_ip": $HAS_PUBLIC_IP
  },
  "capabilities": {
    "inference":     $cap_inference,
    "research":      $cap_research,
    "proxy":         $cap_proxy,
    "storage":       $cap_storage,
    "embedding":     $cap_embedding,
    "memory":        $cap_memory,
    "orchestration": $cap_orchestration,
    "validation":    $cap_validation,
    "relay":         $cap_relay
  },
  "enabled_count": $ENABLED,
  "recommended_model": "$RECOMMENDED_MODEL"
}
EOF
