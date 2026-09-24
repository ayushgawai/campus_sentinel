# Naman — clip pack (3 + 3)

**No 12-clip wall.** Demo media is:

| Cams | Content | Incidents? |
|------|---------|------------|
| **cam-01..03** | Locked Seville chase (`seville_option1_3cam_locked`) | **Yes — WEAPON hero only here** |
| **cam-04..06** | Naman ambient from `feeds/naman/demo_clips` (VLM-assigned) | **No — never escalate** |

## Assigned (2026-09-24, Qwen VLM)

| Cam | File | VLM scene | Wall name |
|-----|------|-----------|-----------|
| cam-04 | `ufpark_parking_lot_traffic_01_5min.mp4` | parking_lot | Parking East lot |
| cam-05 | `qut_campus_entrance_01_5min.mp4` | lobby entrance | Campus lobby entrance |
| cam-06 | `tocada_campus_walkway_cctv_01_5min.mp4` | lot walkway | Lot walkway |

Manifest: `data/naman_ambient_assign.json`  
All three: `ambient_ok=true`, `has_weapon_or_fight=false`.

Path on ZGX: `~/Documents/campus_sentinel_media/feeds/naman/demo_clips/`

Vision bridge still only runs Seville cam-01..03. Ambient is MJPEG wall filler only.

## Do not
- Scatter timing in Python — edit `data/scenario.json` only.
- Put gun/fight content on cam-04..06.
