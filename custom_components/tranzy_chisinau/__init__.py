"""Tranzy Chișinău Transport integration for Home Assistant."""
from __future__ import annotations

import logging
import math
from datetime import timedelta
from pathlib import Path

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

DOMAIN = "tranzy_chisinau"
AGENCY_ID = 4
BASE_URL = "https://api.tranzy.ai/v1/opendata"
SCAN_INTERVAL = timedelta(seconds=30)
STALE_DATA_MINUTES = 10

PLATFORMS = ["sensor"]


def haversine_km(lat1, lon1, lat2, lon2) -> float:
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1))
         * math.cos(math.radians(lat2))
         * math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


async def _api_fetch(session, api_key: str, path: str) -> list | None:
    import aiohttp
    headers = {
        "X-API-KEY": api_key,
        "X-Agency-Id": str(AGENCY_ID),
        "Accept": "application/json",
    }
    try:
        async with session.get(
            f"{BASE_URL}{path}",
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=15),
        ) as resp:
            if resp.status != 200:
                return None
            return await resp.json()
    except Exception:
        return None


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Copy card JS to config/www/ and register WebSocket commands."""
    import shutil

    # ── 1. Copy card JS to /local/ (always reliable) ─────────────
    src = Path(__file__).parent / "www" / "tranzy-chisinau-card.js"
    dst_dir = Path(hass.config.config_dir) / "www" / "community" / "tranzy-chisinau-card"
    dst = dst_dir / "tranzy-chisinau-card.js"

    if src.exists():
        try:
            dst_dir.mkdir(exist_ok=True)
            shutil.copy2(src, dst)
            from homeassistant.components.frontend import add_extra_js_url
            add_extra_js_url(hass, "/local/community/tranzy-chisinau-card/tranzy-chisinau-card.js")
            _LOGGER.info("Tranzy card JS installed to %s", dst)
        except Exception as err:
            _LOGGER.error("Failed to install Tranzy card JS: %s", err)

    # ── 2. Register WebSocket commands (all imports are lazy here) ─
    try:
        import voluptuous as vol
        from homeassistant.components import websocket_api
        from homeassistant.helpers.aiohttp_client import async_get_clientsession

        # ── Handler: find nearby stops ────────────────────────────
        async def _find_stops(hass, connection, msg):
            entries = hass.config_entries.async_entries(DOMAIN)
            if not entries:
                connection.send_error(msg["id"], "no_config", "No Tranzy configured")
                return
            api_key = entries[0].data["api_key"]
            session = async_get_clientsession(hass)
            stops_data = await _api_fetch(session, api_key, "/stops")
            routes_data = await _api_fetch(session, api_key, "/routes")
            if stops_data is None:
                connection.send_error(msg["id"], "api_error", "Tranzy API unavailable")
                return
            lat, lon = msg["lat"], msg["lon"]
            with_dist = []
            for s in stops_data:
                try:
                    slat = float(s.get("stop_lat") or 0)
                    slon = float(s.get("stop_lon") or 0)
                except (TypeError, ValueError):
                    continue
                if not slat or not slon:
                    continue
                with_dist.append((haversine_km(lat, lon, slat, slon), s, slat, slon))
            with_dist.sort(key=lambda x: x[0])
            nearby = [
                {
                    "stop_id": s["stop_id"],
                    "stop_name": s.get("stop_name") or f"Stop {s['stop_id']}",
                    "stop_lat": slat,
                    "stop_lon": slon,
                    "distance_m": round(dist * 1000),
                }
                for dist, s, slat, slon in with_dist[:5]
            ]
            connection.send_result(msg["id"], {
                "stops": nearby,
                "routes": routes_data or [],
            })

        # ── Handler: create new stop entry ────────────────────────
        async def _add_stop(hass, connection, msg):
            entries = hass.config_entries.async_entries(DOMAIN)
            if not entries:
                connection.send_error(msg["id"], "no_config", "No Tranzy configured")
                return
            api_key = entries[0].data["api_key"]
            result = await hass.config_entries.flow.async_init(
                DOMAIN,
                context={"source": "import"},
                data={
                    "api_key": api_key,
                    "stop_id": msg["stop_id"],
                    "stop_name": msg["stop_name"],
                    "stop_lat": msg["stop_lat"],
                    "stop_lon": msg["stop_lon"],
                    "routes": msg["routes"],
                },
            )
            if result.get("type") == "create_entry":
                connection.send_result(msg["id"], {"success": True})
            else:
                connection.send_error(msg["id"], "flow_error", str(result.get("type")))

        # Apply decorators programmatically (no module-level imports needed)
        find_stops_cmd = websocket_api.async_response(
            websocket_api.websocket_command({
                vol.Required("type"): "tranzy_chisinau/find_stops",
                vol.Required("lat"): float,
                vol.Required("lon"): float,
            })(_find_stops)
        )
        add_stop_cmd = websocket_api.async_response(
            websocket_api.websocket_command({
                vol.Required("type"): "tranzy_chisinau/add_stop",
                vol.Required("stop_id"): int,
                vol.Required("stop_name"): str,
                vol.Required("stop_lat"): float,
                vol.Required("stop_lon"): float,
                vol.Required("routes"): [str],
            })(_add_stop)
        )
        websocket_api.async_register_command(hass, find_stops_cmd)
        websocket_api.async_register_command(hass, add_stop_cmd)
        _LOGGER.debug("Tranzy WebSocket commands registered")

    except Exception as err:
        _LOGGER.warning("Tranzy WebSocket commands unavailable: %s", err)

    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.data.setdefault(DOMAIN, {})
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
