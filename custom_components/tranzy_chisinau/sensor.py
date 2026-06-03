"""Tranzy Chișinău — sensor platform."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import aiohttp

from homeassistant.components.sensor import SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from . import AGENCY_ID, BASE_URL, DOMAIN, SCAN_INTERVAL, STALE_DATA_MINUTES, haversine_km

_LOGGER = logging.getLogger(__name__)

AVG_SPEED_KMH = 18


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    api_key = entry.data["api_key"]
    stop_id = entry.data["stop_id"]
    stop_name = entry.data["stop_name"]
    stop_lat = entry.data["stop_lat"]
    stop_lon = entry.data["stop_lon"]
    route_ids = entry.data["routes"]  # list of route_id strings

    session = async_get_clientsession(hass)

    # Fetch route metadata once to get short names for display
    routes_data = await _fetch(session, api_key, "/routes") or []
    route_meta = {str(r["route_id"]): r for r in routes_data}

    coordinator = TranzyCoordinator(hass, session, api_key)
    await coordinator.async_config_entry_first_refresh()

    entities: list[SensorEntity] = []
    for route_id in route_ids:
        meta = route_meta.get(str(route_id), {})
        entities.append(
            TranzyArrivalSensor(
                coordinator=coordinator,
                stop_id=stop_id,
                stop_name=stop_name,
                stop_lat=stop_lat,
                stop_lon=stop_lon,
                route_id=str(route_id),
                route_short=meta.get("route_short_name", str(route_id)),
                route_long=meta.get("route_long_name", ""),
            )
        )

    entities.append(
        TranzyNextAnySensor(
            coordinator=coordinator,
            stop_id=stop_id,
            stop_name=stop_name,
            stop_lat=stop_lat,
            stop_lon=stop_lon,
            route_ids=[str(r) for r in route_ids],
            route_meta=route_meta,
        )
    )

    async_add_entities(entities)


async def _fetch(session: aiohttp.ClientSession, api_key: str, path: str) -> list | None:
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
            resp.raise_for_status()
            return await resp.json()
    except Exception as err:
        _LOGGER.error("Tranzy API error (%s): %s", path, err)
        return None


def _eta_minutes(stop_lat, stop_lon, vehicle) -> float | None:
    """Calculate ETA in minutes. Returns None if data is stale or coords missing."""
    try:
        vlat = float(vehicle.get("latitude") or 0)
        vlon = float(vehicle.get("longitude") or 0)
    except (TypeError, ValueError):
        return None
    if not vlat or not vlon:
        return None

    # Filter stale GPS data
    ts_raw = vehicle.get("timestamp", "")
    if ts_raw:
        try:
            ts = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
            age_min = (datetime.now(timezone.utc) - ts).total_seconds() / 60
            if age_min > STALE_DATA_MINUTES:
                return None
        except ValueError:
            pass

    dist_km = haversine_km(stop_lat, stop_lon, vlat, vlon)
    return (dist_km / AVG_SPEED_KMH) * 60


class TranzyCoordinator(DataUpdateCoordinator):
    """Fetches vehicles data once and shares it across all sensors."""

    def __init__(self, hass: HomeAssistant, session: aiohttp.ClientSession, api_key: str) -> None:
        super().__init__(hass, _LOGGER, name=DOMAIN, update_interval=SCAN_INTERVAL)
        self._session = session
        self._api_key = api_key

    async def _async_update_data(self) -> list:
        data = await _fetch(self._session, self._api_key, "/vehicles")
        if data is None:
            raise UpdateFailed("Failed to fetch vehicles from Tranzy API")
        return data


class TranzyArrivalSensor(SensorEntity):
    """Minutes until the next vehicle of a specific route arrives at the stop."""

    _attr_native_unit_of_measurement = "min"
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_icon = "mdi:bus-clock"
    _attr_should_poll = False

    def __init__(self, coordinator, stop_id, stop_name, stop_lat, stop_lon,
                 route_id, route_short, route_long):
        self._coordinator = coordinator
        self._stop_id = stop_id
        self._stop_name = stop_name
        self._stop_lat = stop_lat
        self._stop_lon = stop_lon
        self._route_id = route_id
        self._route_short = route_short
        self._route_long = route_long

        # Use last segment of long name as terminus (e.g. "A - B" → "B")
        terminus = route_long.split(" - ")[-1].strip() if route_long else ""
        direction = f" → {terminus}" if terminus else ""
        self._attr_name = f"Route {route_short}{direction} | {stop_name}"
        self._attr_unique_id = f"tranzy_{stop_id}_route_{route_id}"
        self._extra: dict[str, Any] = {}

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return self._extra

    @property
    def native_value(self):
        return self._attr_native_value

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            self._coordinator.async_add_listener(self._handle_update)
        )

    def _handle_update(self) -> None:
        vehicles = self._coordinator.data or []
        matching = [v for v in vehicles if str(v.get("route_id")) == self._route_id]

        best_eta = None
        best_dist = None
        best_vehicle = None

        for v in matching:
            eta = _eta_minutes(self._stop_lat, self._stop_lon, v)
            if eta is None:
                continue
            dist = haversine_km(
                self._stop_lat, self._stop_lon,
                float(v["latitude"]), float(v["longitude"])
            )
            if best_eta is None or eta < best_eta:
                best_eta = eta
                best_dist = dist
                best_vehicle = v

        if best_eta is not None:
            self._attr_native_value = round(best_eta, 1)
            self._extra = {
                "tranzy_sensor": "route",
                "route": self._route_short,
                "route_long_name": self._route_long,
                "stop_name": self._stop_name,
                "stop_lat": self._stop_lat,
                "stop_lon": self._stop_lon,
                "distance_km": round(best_dist, 2),
                "vehicle_label": best_vehicle.get("label", ""),
                "speed_kmh": best_vehicle.get("speed", 0),
                "status": "arriving" if best_eta < 3 else "on the way",
            }
        else:
            self._attr_native_value = None
            self._extra = {
                "tranzy_sensor": "route",
                "route": self._route_short,
                "stop_name": self._stop_name,
                "stop_lat": self._stop_lat,
                "stop_lon": self._stop_lon,
                "status": "no data",
            }

        self.async_write_ha_state()


class TranzyNextAnySensor(SensorEntity):
    """Minutes until the closest vehicle from any tracked route arrives."""

    _attr_native_unit_of_measurement = "min"
    _attr_icon = "mdi:bus-multiple"
    _attr_should_poll = False

    def __init__(self, coordinator, stop_id, stop_name, stop_lat, stop_lon,
                 route_ids, route_meta):
        self._coordinator = coordinator
        self._stop_id = stop_id
        self._stop_name = stop_name
        self._stop_lat = stop_lat
        self._stop_lon = stop_lon
        self._route_ids = set(route_ids)
        self._route_meta = route_meta

        self._attr_name = f"Next transport → {stop_name}"
        self._attr_unique_id = f"tranzy_{stop_id}_next_any"
        self._extra: dict[str, Any] = {}

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return self._extra

    @property
    def native_value(self):
        return self._attr_native_value

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            self._coordinator.async_add_listener(self._handle_update)
        )

    def _handle_update(self) -> None:
        vehicles = self._coordinator.data or []
        arrivals = []

        for v in vehicles:
            if str(v.get("route_id")) not in self._route_ids:
                continue
            eta = _eta_minutes(self._stop_lat, self._stop_lon, v)
            if eta is None:
                continue
            rid = str(v.get("route_id"))
            short = self._route_meta.get(rid, {}).get("route_short_name", rid)
            arrivals.append({"route": short, "eta_min": round(eta, 1)})

        if arrivals:
            arrivals.sort(key=lambda x: x["eta_min"])
            self._attr_native_value = arrivals[0]["eta_min"]
            self._extra = {
                "next_route": arrivals[0]["route"],
                "all_arrivals": arrivals[:6],
                "stop_name": self._stop_name,
            }
        else:
            self._attr_native_value = None
            self._extra = {"status": "no data"}

        self.async_write_ha_state()
