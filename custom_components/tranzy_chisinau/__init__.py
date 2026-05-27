"""Tranzy Chișinău Transport integration for Home Assistant."""
from __future__ import annotations

import logging
import math
from datetime import timedelta

from homeassistant.components.persistent_notification import async_create as notify_create
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import async_call_later

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


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.data.setdefault(DOMAIN, {})
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Show card YAML as a notification only on first setup
    if not entry.options.get("card_notified"):
        @callback
        def _schedule(_now=None):
            hass.async_create_task(_notify_card(hass, entry))

        async_call_later(hass, 3, _schedule)
        hass.config_entries.async_update_entry(
            entry, options={**entry.options, "card_notified": True}
        )

    return True


async def _notify_card(hass: HomeAssistant, entry: ConfigEntry) -> None:
    reg = er.async_get(hass)

    all_ids = [
        e.entity_id
        for e in reg.entities.values()
        if e.config_entry_id == entry.entry_id
    ]
    route_ids = sorted(e for e in all_ids if "next" not in e)
    summary_ids = [e for e in all_ids if "next" in e]
    entity_ids = route_ids + summary_ids

    stop_name = entry.data.get("stop_name", "My Stop")
    entity_list = "\n".join(f"  - {eid}" for eid in entity_ids)

    card_yaml = (
        f"type: entities\n"
        f"title: Transport — {stop_name}\n"
        f"entities:\n"
        f"{entity_list}"
    )

    notify_create(
        hass,
        (
            f"Your Tranzy card for **{stop_name}** is ready.\n\n"
            f"Go to **Dashboard → Edit → Add Card → Manual** and paste:\n\n"
            f"```yaml\n{card_yaml}\n```"
        ),
        title="Tranzy — Dashboard card ready",
        notification_id=f"tranzy_card_{entry.entry_id}",
    )


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
