# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Home Assistant custom integration (`tranzy_chisinau`) for real-time public transport tracking in Chișinău, Moldova via the [Tranzy API](https://tranzy.ai/opendata/). Distributed through HACS.

## Testing & development tools

There is no automated test suite. Manual API testing uses the scripts in `tools/`:

```bash
# Test API connectivity and compute ETAs without Home Assistant
python tools/test_local.py --key YOUR_KEY --stop "Bogdan-Voievod" --routes 26 32

# Search for stop IDs or list all routes
python tools/find_stop_id.py --key YOUR_KEY --search "Calea"
python tools/find_stop_id.py --key YOUR_KEY --routes
```

Both scripts require `pip install requests`.

To test the integration end-to-end, install it into a running Home Assistant instance (copy `custom_components/tranzy_chisinau/` to the HA config directory and restart).

## Architecture

All integration logic lives in `custom_components/tranzy_chisinau/`:

- **`__init__.py`** — entry setup/teardown, `haversine_km` utility, one-time card YAML notification via `async_call_later`.
- **`config_flow.py`** — 4-step UI flow: API key → map picker (LocationSelector centered on Chișinău) → nearest 5 stops selector → multi-select routes. Fetches `/agency`, `/stops`, `/routes` from the Tranzy API during setup.
- **`sensor.py`** — defines `TranzyCoordinator` (polls `/vehicles` every 30 s via `DataUpdateCoordinator`) and two sensor types:
  - `TranzyArrivalSensor` — one per tracked route; state = ETA in minutes to the stop.
  - `TranzyNextAnySensor` — one per config entry; state = ETA of the nearest vehicle across all tracked routes.

## Key constants

| Constant | Value | Purpose |
|---|---|---|
| `AGENCY_ID` | `4` | RTEC & PUA Chișinău — hardcoded, not configurable |
| `SCAN_INTERVAL` | 30 s | How often vehicles are polled |
| `STALE_DATA_MINUTES` | 10 | GPS data older than this is ignored |
| `AVG_SPEED_KMH` | 18 | Used to convert distance → ETA |

## ETA calculation

ETA is distance-based only: `(haversine_km / AVG_SPEED_KMH) * 60`. There is no GTFS schedule or trip-matching. Vehicles with stale GPS timestamps (> 10 min old) or missing coordinates are silently skipped.

## API details

All calls use headers `X-API-KEY` and `X-Agency-Id: 4`. The `/agency` endpoint is called *without* `X-Agency-Id` for key validation. All endpoints return JSON arrays.

## Versioning & distribution

- Version is in `manifest.json` (bumped manually).
- `hacs.json` has `"render_readme": true` — the README is the HACS store page; keep it accurate.
- Translations live in `custom_components/tranzy_chisinau/translations/en.json` (mirrors `strings.json`).
