# STABILITY — GB10 hard resets (2026-09-24)

## What we see
`last -x` shows many sessions ending **`crash`** (unclean power-off / hard hang), boots every ~15–45 min while we were running the demo stack:

| Boot window (UTC) | Length |
|-------------------|--------|
| 20:41 → 21:15 | ~34m |
| 21:17 → 22:02 | ~45m |
| 22:05 → 22:19 | ~14m |
| 22:21 → 22:57 | ~36m |
| 22:59 → now | current |

Journals **stop mid-line** (tailscaled chatter) — no orderly shutdown. That is hang / power-cut / firmware trip, not `sudo reboot`.

## Not the cause
- **Not Linux OOM-killer** — no `oom-kill` / `Kill process` in journal.
- **Not thermal right now** — zones ~35–48°C, GPU 33°C / 3W idle after reboot.
- **Not disk** — 1.6T free.

## Likely cause
**NVIDIA unified-memory exhaustion** while Qwen (ZRT) + YOLO CUDA + desktop share one GB10 pool:

```
NVRM: Out of memory [NV_ERR_NO_MEMORY] ... _memdescAllocInternal
NVRM: ... kgrctxAllocMainCtxBuffer ...
```

Seen at 19:00, 19:18, 20:27 — shortly before unclean reboots.  
**SwapTotal = 0** — once unified memory is gone there is no soft landing; the box often hard-locks and comes back as `crash`.

## Safe operating rules (until stable)
1. **Do not** start ZRT + CUDA YOLO + multi-ffmpeg MJPEG all at once without watching `free -h` / `nvidia-smi`.
2. Prefer **Qwen `--gpu-memory-fraction 0.40`** (or 0.45) when YOLO also needs CUDA; leave headroom for desktop.
3. For A.1 / UI-only work: **no ZRT**, API can run with vision off or `CS_VISION_DEVICE=cpu`.
4. Cap concurrent MJPEG: officer wall opening 6 ffmpeg loops is heavy — test 1–2 panes first.
5. Add **swap** (needs sudo once): e.g. 32G file — soft landing when memory spikes.

## Add swap (run on ZGX once, needs your password)
```bash
sudo fallocate -l 32G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## Current box state (post-crash)
- Qwen / `services.api` **not** running (good — idle).
- Only light `http.server` processes.
- ~114 GiB MemAvailable — healthy until we reload models.
