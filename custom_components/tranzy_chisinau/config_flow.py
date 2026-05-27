"""Config flow for Tranzy Chișinău Transport."""
from __future__ import annotations

import logging
import math
from typing import Any

import aiohttp
import voluptuous as vol

from homeassistant import config_entries
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import (
    LocationSelector,
    LocationSelectorConfig,
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
)
import homeassistant.helpers.config_validation as cv

from . import AGENCY_ID, BASE_URL, DOMAIN

_LOGGER = logging.getLogger(__name__)


def _haversine_km(lat1, lon1, lat2, lon2) -> float:
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


async def _api_fetch_agencies(session: aiohttp.ClientSession, api_key: str) -> list | None:
    headers = {"X-API-KEY": api_key, "Accept": "application/json"}
    try:
        async with session.get(
            f"{BASE_URL}/agency",
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=15),
        ) as resp:
            if resp.status != 200:
                return None
            return await resp.json()
    except Exception:
        return None


class TranzyConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    def __init__(self) -> None:
        self._api_key: str = ""
        self._all_stops: list = []
        self._nearby_stops: list = []
        self._stop_info: dict = {}
        self._routes_data: list = []

    # ------------------------------------------------------------------ #
    # Step 1 — API key                                                     #
    # ------------------------------------------------------------------ #
    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        errors: dict[str, str] = {}

        if user_input is not None:
            api_key = user_input["api_key"].strip()
            session = async_get_clientsession(self.hass)
            agencies = await _api_fetch_agencies(session, api_key)

            if agencies is None:
                errors["base"] = "cannot_connect"
            else:
                chisinau = next((a for a in agencies if a.get("agency_id") == AGENCY_ID), None)
                if chisinau is None:
                    errors["base"] = "cannot_connect"
                else:
                    self._api_key = api_key
                    # Pre-load stops so the map step is fast
                    session = async_get_clientsession(self.hass)
                    self._all_stops = await _api_fetch(session, api_key, "/stops") or []
                    return await self.async_step_location()

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({vol.Required("api_key"): str}),
            errors=errors,
        )

    # ------------------------------------------------------------------ #
    # Step 2 — Map: user picks a point                                     #
    # ------------------------------------------------------------------ #
    async def async_step_location(self, user_input: dict[str, Any] | None = None):
        errors: dict[str, str] = {}

        if user_input is not None:
            lat = user_input["location"]["latitude"]
            lon = user_input["location"]["longitude"]

            if not self._all_stops:
                errors["base"] = "cannot_connect"
            else:
                # Find 5 nearest stops to the picked point
                stops_with_dist = []
                for s in self._all_stops:
                    try:
                        slat = float(s.get("stop_lat") or 0)
                        slon = float(s.get("stop_lon") or 0)
                    except (TypeError, ValueError):
                        continue
                    if not slat or not slon:
                        continue
                    dist = _haversine_km(lat, lon, slat, slon)
                    stops_with_dist.append((dist, s))

                stops_with_dist.sort(key=lambda x: x[0])
                self._nearby_stops = [s for _, s in stops_with_dist[:5]]

                if not self._nearby_stops:
                    errors["base"] = "no_stops_nearby"
                else:
                    return await self.async_step_stop_select()

        # Default to Chișinău city center so the map opens in the right place
        return self.async_show_form(
            step_id="location",
            data_schema=vol.Schema({
                vol.Required(
                    "location",
                    default={"latitude": 47.0105, "longitude": 28.8638},
                ): LocationSelector(LocationSelectorConfig(radius=False)),
            }),
            errors=errors,
        )

    # ------------------------------------------------------------------ #
    # Step 3 — Pick one of the 5 nearest stops                            #
    # ------------------------------------------------------------------ #
    async def async_step_stop_select(self, user_input: dict[str, Any] | None = None):
        errors: dict[str, str] = {}

        if user_input is not None:
            stop_id = int(user_input["stop_id"])
            self._stop_info = next(
                (s for s in self._nearby_stops if s["stop_id"] == stop_id), {}
            )
            return await self.async_step_routes()

        options = [
            SelectOptionDict(
                value=str(s["stop_id"]),
                label=s.get("stop_name", f"Stop {s['stop_id']}"),
            )
            for s in self._nearby_stops
        ]

        return self.async_show_form(
            step_id="stop_select",
            data_schema=vol.Schema({
                vol.Required("stop_id"): SelectSelector(
                    SelectSelectorConfig(
                        options=options,
                        mode=SelectSelectorMode.LIST,
                    )
                ),
            }),
            errors=errors,
        )

    # ------------------------------------------------------------------ #
    # Step 4 — Select routes                                               #
    # ------------------------------------------------------------------ #
    async def async_step_routes(self, user_input: dict[str, Any] | None = None):
        errors: dict[str, str] = {}

        if not self._routes_data:
            session = async_get_clientsession(self.hass)
            self._routes_data = await _api_fetch(session, self._api_key, "/routes") or []

        if user_input is not None:
            selected_routes = user_input.get("routes", [])
            if not selected_routes:
                errors["base"] = "no_routes_selected"
            else:
                stop_name = self._stop_info.get("stop_name", f"Stop {self._stop_info.get('stop_id')}")
                return self.async_create_entry(
                    title=stop_name,
                    data={
                        "api_key": self._api_key,
                        "stop_id": self._stop_info["stop_id"],
                        "stop_name": stop_name,
                        "stop_lat": float(self._stop_info.get("stop_lat", 0)),
                        "stop_lon": float(self._stop_info.get("stop_lon", 0)),
                        "routes": selected_routes,
                    },
                )

        route_options = {
            str(r["route_id"]): f"{r.get('route_short_name', r['route_id'])} — {r.get('route_long_name', '')}"
            for r in sorted(
                self._routes_data,
                key=lambda x: str(x.get("route_short_name", "")).zfill(4),
            )
        }

        return self.async_show_form(
            step_id="routes",
            data_schema=vol.Schema({
                vol.Required("routes"): cv.multi_select(route_options),
            }),
            description_placeholders={
                "stop_name": self._stop_info.get("stop_name", ""),
            },
            errors=errors,
        )
