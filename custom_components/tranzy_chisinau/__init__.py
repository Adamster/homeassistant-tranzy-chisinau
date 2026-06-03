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
    """Copy card JS to config/www/ and register as Lovelace resource."""
    import shutil
    from homeassistant.components.frontend import add_extra_js_url

    src = Path(__file__).parent / "www" / "tranzy-chisinau-card.js"
    dst_dir = Path(hass.config.config_dir) / "www"
    dst = dst_dir / "tranzy-chisinau-card.js"

    if src.exists():
        try:
            dst_dir.mkdir(exist_ok=True)
            shutil.copy2(src, dst)
            add_extra_js_url(hass, "/local/tranzy-chisinau-card.js")
            _LOGGER.info("Tranzy card JS copied to %s", dst)
        except Exception as err:
            _LOGGER.error("Failed to copy Tranzy card JS: %s", err)
    else:
        _LOGGER.warning("Tranzy card JS source not found at %s", src)

    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.data.setdefault(DOMAIN, {})
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
