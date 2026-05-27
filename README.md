# Tranzy Chișinău Transport — Home Assistant Integration

Real-time public transport tracking for Chișinău (Moldova) using the [Tranzy API](https://tranzy.ai/opendata/).

## Features

- **Real-time ETA** — minutes until the next vehicle arrives at your stop
- **Per-route sensors** — one sensor per tracked route
- **Summary sensor** — shows the closest vehicle from all tracked routes
- **UI setup** — configured entirely through the Home Assistant interface (no YAML needed)
- **Smart filtering** — ignores GPS data older than 10 minutes
- **Push notifications** — use HA automations to alert you when a bus is X minutes away

## Installation via HACS

1. Go to **HACS → Integrations → ⋮ → Custom repositories**
2. Add this repository URL and select category **Integration**
3. Click **Download**
4. Restart Home Assistant

## Manual Installation

Copy the `custom_components/tranzy_chisinau/` folder into your HA config directory under `custom_components/`, then restart.

## Setup

1. Go to **Settings → Devices & Services → Add Integration**
2. Search for **Tranzy Chișinău**
3. Enter your API key from [apps.tranzy.ai/accounts](https://apps.tranzy.ai/accounts)
4. Search for your stop by name (e.g. `Bogdan-Voievod`)
5. Select your stop from the results
6. Pick the routes you want to track

## Sensors created

For each configured stop, the integration creates:

| Sensor | Description |
|--------|-------------|
| `sensor.route_<N>_<stop>` | Minutes until route N arrives at the stop |
| `sensor.next_transport_<stop>` | Minutes until the nearest vehicle from any tracked route |

### Attributes

Each sensor exposes additional attributes:
- `route` — route short name
- `distance_km` — current distance of the nearest vehicle
- `vehicle_label` — vehicle board number
- `speed_kmh` — current speed
- `status` — `arriving` (< 3 min) or `on the way`
- `all_arrivals` — list of all upcoming vehicles (summary sensor only)

## Notification Example

```yaml
automation:
  - alias: "Bus arriving soon"
    trigger:
      - platform: numeric_state
        entity_id: sensor.route_26_bogdan_voievod
        below: 7
    condition:
      - condition: time
        after: "07:00:00"
        before: "09:30:00"
    action:
      - service: notify.mobile_app
        data:
          message: "Route 26 arrives in {{ states('sensor.route_26_bogdan_voievod') }} min!"
```

## API Key

Register at [apps.tranzy.ai/accounts](https://apps.tranzy.ai/accounts) to get a free API key.
Remove any **web restrictions** from the key settings to allow Home Assistant to connect.

## Supported agencies

This integration is configured for **RTEC & PUA Chișinău** (agency_id = 4).
Coverage includes buses and trolleybuses in Chișinău, Moldova.
