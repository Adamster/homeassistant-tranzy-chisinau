"""Tranzy Chișinău Transport integration for Home Assistant."""
from __future__ import annotations

import logging
import math
from datetime import timedelta
from pathlib import Path

import aiohttp
import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

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


async def _api_fetch(session: aiohttp.ClientSession, api_key: str, path: str) -> list | None:
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
    """Register card JS and WebSocket API commands."""
    from homeassistant.components.frontend import add_extra_js_url
    from homeassistant.components.http import StaticPathConfig

    www = Path(__file__).parent / "www"
    _LOGGER.debug("Tranzy www path: %s (exists: %s)", www, www.is_dir())
    if www.is_dir():
        try:
            await hass.http.async_register_static_paths([
                StaticPathConfig(f"/{DOMAIN}", str(www), cache_headers=False)
            ])
            add_extra_js_url(hass, f"/{DOMAIN}/tranzy-chisinau-card.js")
            _LOGGER.debug("Tranzy card JS registered at /%s/tranzy-chisinau-card.js", DOMAIN)
        except Exception as err:  # noqa: BLE001
            _LOGGER.error("Failed to register Tranzy card JS: %s", err)

    try:
        websocket_api.async_register_command(hass, ws_find_stops)
        websocket_api.async_register_command(hass, ws_add_stop)
        _LOGGER.debug("Tranzy WebSocket commands registered")
    except Exception as err:  # noqa: BLE001
        _LOGGER.warning("Could not register Tranzy WebSocket commands: %s", err)

    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.data.setdefault(DOMAIN, {})
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


# ── WebSocket: find nearby stops ──────────────────────────────────

@websocket_api.websocket_command({
    vol.Required("type"): "tranzy_chisinau/find_stops",
    vol.Required("lat"): float,
    vol.Required("lon"): float,
})
@websocket_api.async_response
async def ws_find_stops(hass: HomeAssistant, connection, msg: dict) -> None:
    """Return 5 nearest stops + all routes for the given coordinates."""
    entries = hass.config_entries.async_entries(DOMAIN)
    if not entries:
        connection.send_error(msg["id"], "no_config", "No Tranzy integration configured")
        return

    api_key = entries[0].data["api_key"]
    session = async_get_clientsession(hass)

    stops_data, routes_data = (
        await _api_fetch(session, api_key, "/stops"),
        await _api_fetch(session, api_key, "/routes"),
    )

    if stops_data is None:
        connection.send_error(msg["id"], "api_error", "Failed to fetch from Tranzy API")
        return

    lat, lon = msg["lat"], msg["lon"]
    with_dist: list[tuple[float, dict, float, float]] = []
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


# ── WebSocket: create new config entry for a stop ─────────────────

@websocket_api.websocket_command({
    vol.Required("type"): "tranzy_chisinau/add_stop",
    vol.Required("stop_id"): int,
    vol.Required("stop_name"): str,
    vol.Required("stop_lat"): float,
    vol.Required("stop_lon"): float,
    vol.Required("routes"): [str],
})
@websocket_api.async_response
async def ws_add_stop(hass: HomeAssistant, connection, msg: dict) -> None:
    """Programmatically create a new Tranzy config entry."""
    entries = hass.config_entries.async_entries(DOMAIN)
    if not entries:
        connection.send_error(msg["id"], "no_config", "No Tranzy integration configured")
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

    if result.get("type") == "abort":
        connection.send_error(msg["id"], "abort", result.get("reason", "aborted"))
    elif result.get("type") == "create_entry":
        connection.send_result(msg["id"], {"success": True})
    else:
        connection.send_error(msg["id"], "flow_error", str(result.get("type")))
