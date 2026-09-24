#!/usr/bin/env bash
# Preflight before starting ZRT / vision API on GB10.
# Exit 1 if the box looks unsafe to load models.
set -euo pipefail

avail_kb=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
avail_gb=$((avail_kb / 1024 / 1024))
swap_kb=$(awk '/SwapTotal:/ {print $2}' /proc/meminfo)

echo "MemAvailable: ${avail_gb} GiB"
echo "SwapTotal:    $((swap_kb / 1024 / 1024)) GiB"

if [[ "$swap_kb" -eq 0 ]]; then
  echo "WARN: no swap — unified-memory spikes can hard-lock this machine (see docs/STABILITY.md)"
fi

# Keep ~40 GiB free before loading Qwen FP8
if [[ "$avail_gb" -lt 40 ]]; then
  echo "FAIL: need >=40 GiB MemAvailable before zrt serve (have ${avail_gb})"
  exit 1
fi

if pgrep -af 'vllm serve|zrt serve' | grep -v grep >/dev/null; then
  echo "NOTE: ZRT/vLLM already running"
fi

echo "preflight OK — prefer: zrt ... --gpu-memory-fraction 0.40"
echo "  vision coexistence: CS_VISION_DEVICE=cuda:0 only after ZRT is up at <=0.45"
exit 0
