# context.md
Last updated: 2026-09-24 (ayush) — vision bridge: normalize boxes + GPU throttle

## HARD RULES (do not skip)
1. **Pull before push.** Always `git pull --rebase origin main` before every push. Work on **`main`**.
2. **Update this file after every finished piece**, same commit as the work.
3. Stay in ownership paths. Do not change `contracts/` without a group message.
4. Keep under ~150 lines.
5. Playbook is base plan; record deviations here.

## How to run (stable — do NOT overload the ZGX)
```bash
# ONE GPU consumer only. Never run run_seville.py at the same time as this.
CS_VISION_SEVILLE=1 CS_VISION_STEP_S=0.4 CS_VISION_COOLDOWN_S=12 \
  services/vision/.venv/bin/python -m services.api --host 0.0.0.0 --port 8080
# Mac: ssh -L 8080:127.0.0.1:8080 zgx-b505
# Mac: cd web && SOURCE=live API_BASE=http://127.0.0.1:8080 → http://127.0.0.1:8000/
```

## Done
- Seville full PASS earlier; vision merged to main
- Vision bridge: pixel→0..1 box normalize (dashboard was dropping pixel boxes)
- Throttle: step sleep, upsert cooldown, per-minute cap; rewind FileSource without reloading TRT

## Important
- **No WEAPON/FIRE class** in frozen contracts (FALL/FIGHT/THEFT/RUN/MEDICAL/BENIGN only). Seville footage has weapons; the stack will not say "weapon detected".
- Overloading GPU (full run_seville + live bridge + CLIP) has hung this box — keep one process.

## Ownership
Ayush: brain/api/compose · Pratham: vision/voice · Manav: web (leave alone) · Naman: data/bench

## Next
Demo carefully with throttled bridge; live ZRT frames; Naman ambient/thresholds
