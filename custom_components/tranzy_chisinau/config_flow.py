"""Config flow for Tranzy Chișinău Transport."""
from __future__ import annotations

import logging
from typing import Any

import aiohttp
import voluptuous as vol

from homeassistant import config_entries
from homeassistant.helpers.aiohttp_client import async_get_clientsession
import homeassistant.helpers.config_validation as cv

from . import AGENCY_ID, BASE_URL, DOMAIN

_LOGGER = logging.getLogger(__name__)


async def _api_fetch(session: aiohttp.ClientSession, api_key: str, path: str) -> list | None:
    headers = {
        "X-API-KEY": api_key,
        "X-Agency-Id": str(AGENCY_ID),
        "Accept": "application/json",
    }
    try:
        async with session.get(f"{BASE_URL}{path}", headers=headers, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            if resp.status != 200:
                return None
            return await resp.json()
    except Exception:
        return None


async def _api_fetch_agencies(session: aiohttp.ClientSession, api_key: str) -> list | None:
    headers = {"X-API-KEY": api_key, "Accept": "application/json"}
    try:
        async with session.get(f"{BASE_URL}/agency", headers=headers, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            if resp.status != 200:
                return None
            return await resp.json()
    except Exception:
        return None


class TranzyConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    def __init__(self) -> None:
        self._api_key: str = ""
        self._stops_found: list = []
        self._stop_info: dict = {}
        self._routes_data: list = []

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
                    return await self.async_step_stop()

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({vol.Required("api_key"): str}),
            errors=errors,
        )

    async def async_step_stop(self, user_input: dict[str, Any] | None = None):
        errors: dict[str, str] = {}

        if user_input is not None:
            if "stop_id" in user_input:
                # User picked a stop from the dropdown
                stop_id = int(user_input["stop_id"])
                self._stop_info = next(
                    (s for s in self._stops_found if s["stop_id"] == stop_id), {}
                )
                return await self.async_step_routes()

            search = user_input.get("stop_search", "").strip()
            if search:
                session = async_get_clientsession(self.hass)
                stops = await _api_fetch(session, self._api_key, "/stops")
                if stops is None:
                    errors["base"] = "cannot_connect"
                else:
                    self._stops_found = [
                        s for s in stops
                        if search.lower() in (s.get("stop_name") or "").lower()
                    ]
                    if not self._stops_found:
                        errors["base"] = "stop_not_found"
                    else:
                        # Show dropdown with matching stops
                        options = {
                            str(s["stop_id"]): f"{s['stop_name']} (id={s['stop_id']})"
                            for s in self._stops_found[:20]
                        }
                        return self.async_show_form(
                            step_id="stop",
                            data_schema=vol.Schema({
                                vol.Required("stop_id"): vol.In(options),
                            }),
                            description_placeholders={
                                "count": str(len(self._stops_found)),
                                "search": search,
                            },
                        )

        return self.async_show_form(
            step_id="stop",
            data_schema=vol.Schema({vol.Required("stop_search"): str}),
            errors=errors,
        )

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
                title = f"{stop_name}"
                return self.async_create_entry(
                    title=title,
                    data={
                        "api_key": self._api_key,
                        "stop_id": self._stop_info["stop_id"],
                        "stop_name": stop_name,
                        "stop_lat": float(self._stop_info.get("stop_lat", 0)),
                        "stop_lon": float(self._stop_info.get("stop_lon", 0)),
                        "routes": selected_routes,
                    },
                )

        # Build route options sorted by route_short_name
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
