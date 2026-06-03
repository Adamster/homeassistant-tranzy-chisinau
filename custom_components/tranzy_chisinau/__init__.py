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


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Register the Lovelace card JS as a frontend module."""
    try:
        from homeassistant.components.frontend import add_extra_js_url
        from homeassistant.components.http import StaticPathConfig

        www = Path(__file__).parent / "www"
        if www.is_dir():
            await hass.http.async_register_static_paths([
                StaticPathConfig(f"/{DOMAIN}", str(www), cache_headers=False)
            ])
            add_extra_js_url(hass, f"/{DOMAIN}/tranzy-chisinau-card.js")
            _LOGGER.info("Tranzy card JS registered successfully")
        else:
            _LOGGER.warning("Tranzy www directory not found at %s", www)
    except Exception as err:
        _LOGGER.error("Failed to register Tranzy card JS: %s", err)

    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.data.setdefault(DOMAIN, {})
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
