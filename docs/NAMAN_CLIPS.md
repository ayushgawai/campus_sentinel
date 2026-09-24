# Naman — clip pack (3 + 3 only)

**No 12-clip wall.** Demo media is:

| Cams | Content | Incidents? |
|------|---------|------------|
| **cam-01..03** | Locked Seville chase (`seville_option1_3cam_locked`) | **Yes — WEAPON hero only here** |
| **cam-04..06** | Natural ambient fillers (parking / basement / road or similar) | **No — never escalate** |

## Deliver (outside git)
Path on ZGX:
`~/Documents/campus_sentinel_media/feeds/ambient_3cam/`

Suggested files (names already in `data/camera_map.json`):
- `CAM04_parking_east_ambient_60s.mp4` — parking garage / lot, people walking OK, **no fight/weapon**
- `CAM05_basement_ambient_60s.mp4` — basement / service corridor, quiet
- `CAM06_road_ambient_60s.mp4` — campus road / ground / sports path, normal traffic

Specs: ~60–120 s loop, 960×540 or 1080p, h264, boring and natural.  
Until real files land, `make ambient` keeps solid-color placeholders so MJPEG never 404s.

## Do not
- Scatter timing in Python — edit `data/scenario.json` only.
- Put gun/fight content on cam-04..06.
