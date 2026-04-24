# Drone Simulator Isolation & Realistic Path Deviation

**Date:** 2026-04-24
**Status:** Approved

## Goal

Replace the tightly-coupled demo mock (shared mutable state, cosmetic-only wind, frontend-embedded) with a standalone Python drone simulator that communicates over WebSocket using the same protocol the real backend will use. The frontend has zero demo-specific code — it treats sim telemetry identically to real drone telemetry.

The purpose is to stress-test the frontend's ability to display a drone that doesn't perfectly follow the planned path.

## Architecture

```
┌─────────────────────┐         WebSocket          ┌──────────────────────┐
│   Demo Sim (Python)  │◄──────────────────────────►│  Frontend (React)     │
│                      │    shared/schemas/*.json    │                      │
│  - Drone physics     │                            │  - Map + video UI     │
│  - Waypoint steering │  telemetry (30Hz) ──────►  │  - Path rendering     │
│  - Wind/turbulence   │  ◄────── commands          │  - POI management     │
│  - POI sequencing    │  connection_status ──────► │  - Telemetry display  │
│                      │                            │                      │
│  ws://localhost:5000  │                            │  VITE_WS_URL set     │
└─────────────────────┘                            └──────────────────────┘
```

- **Sim:** Python script in `simulation/drone_sim.py`, using `asyncio` + `websockets`
- **Frontend:** Connects via `VITE_WS_URL=ws://localhost:5000` — the same env var the real backend will use
- **Protocol:** JSON messages matching `shared/schemas/` exactly

## Drone Simulator

### State

| Field | Type | Description |
|-------|------|-------------|
| `lat`, `lon` | float | Actual position (affected by wind) |
| `alt_msl`, `alt_rel` | float | Altitude (fixed for now, mutable later) |
| `heading` | float | Current bearing 0-360° |
| `speed` | float | Ground speed m/s |
| `battery` | float | Drains over time |
| `armed` | bool | Starts false |
| `mode` | str | STABILIZE / AUTO / LOITER / RTL |
| `wind_angle` | float | Current wind direction (random walk) |
| `wind_speed` | float | Current wind magnitude (gusts) |
| `home_lat`, `home_lon` | float | Launch position for RTL |

### Waypoint Sequencing

1. Sim receives POI list via `send_mission` command
2. Maintains an ordered list of target POIs
3. In AUTO mode, steers direct-to-current-POI:
   - Compute bearing to target POI center
   - Turn toward that bearing, clamped by max turn rate
   - When within the loiter radius, switch to orbiting (fly a circle at loiter_radius)
   - After orbiting for `dwell_seconds`, advance to next POI
   - After last POI, switch to LOITER at current position

### Steering Model

Simple heading-based steering with turn radius enforcement:

- **Desired heading** = bearing from current position to target
- **Heading error** = shortest angular difference between current heading and desired
- **Max turn rate** = `speed / min_turn_radius` (rad/s), converted to deg/s
- **Heading change per tick** = clamp(heading_error, -max_turn_rate * dt, +max_turn_rate * dt)
- **Position update** = move `speed * dt` meters in the direction of current heading

For loiter orbiting: the target point moves around the POI center at the loiter radius, so the drone naturally traces a circle via the same pursuit logic.

### Deviation Sources

All deviations affect the drone's actual position and heading. The drone's steering must correct for them, creating realistic overshoot and S-curves.

- **Wind:** A persistent force vector applied each tick.
  - Wind angle: random walk (`+= (random() - 0.5) * 5` per tick, slow drift)
  - Wind speed: base value + gusts (`base + random() * gust_factor`)
  - Displacement: `wind_speed * dt` meters in wind direction, added to position
  - The drone does NOT know about wind — it just sees itself drifting off-target and corrects

- **Turbulence:** Small random heading perturbations each tick (`±1-2°`), simulating air disturbance

- **GPS noise:** Random jitter on the *emitted* position only (`±2-3m`), simulating sensor inaccuracy. This does NOT affect the drone's internal position — only what the frontend sees.

### Telemetry Emission (30Hz)

Every tick (~33ms), emit a telemetry JSON message:

```json
{
  "type": "telemetry",
  "payload": {
    "timestamp": <epoch_ms>,
    "armed": <bool>,
    "mode": "<string>",
    "position": { "lat": <float>, "lon": <float>, "alt_msl": 150, "alt_rel": 80 },
    "attitude": { "roll": <float>, "pitch": 2.0, "yaw": <heading> },
    "velocity": { "ground_speed": <speed>, "air_speed": <speed + 4>, "climb_rate": 0.0 },
    "battery": { "voltage": 22.2, "current": 12.5, "remaining_pct": <int> },
    "gps": { "fix_type": 3, "satellites_visible": 12 }
  }
}
```

Roll is derived from turn rate (bank angle ≈ atan(v²/rg) simplified to a proportional value).

### Command Handling

The sim accepts commands from the frontend via WebSocket:

| Command | Behavior |
|---------|----------|
| `arm` | Set armed = true, mode = STABILIZE |
| `disarm` | Set armed = false |
| `send_mission` | Store POI list, switch to AUTO, begin sequencing |
| `set_mode` | Switch mode (LOITER, RTL, etc) |
| `return_home` | Set mode = RTL, target = home position |

Unknown commands are silently ignored.

### CLI Interface

```
python simulation/drone_sim.py [options]

Options:
  --port PORT        WebSocket port (default: 5000)
  --lat LAT          Starting latitude (default: -37.854)
  --lon LON          Starting longitude (default: 145.059)
  --speed SPEED      Initial speed m/s (default: 18)
  --wind WIND        Initial wind speed m/s (default: 3)
  --turn-radius R    Minimum turn radius meters (default: 80)
```

Designed for mutability — all physics parameters are instance variables on a DroneState class, easy to extend later with altitude dynamics, motor modeling, etc.

## Frontend Cleanup

### Files to Delete

- `src/mocks/mockTelemetry.ts`
- `src/mocks/demoState.ts`
- `src/components/DemoController.tsx`
- `src/components/DemoToolbar.tsx`

### Files to Modify

**`TelemetryContext.tsx`:**
- Remove mock telemetry fallback
- Always connect via WebSocket (`VITE_WS_URL`)
- Show disconnected state if no URL configured

**`MapPanel.tsx`:**
- Remove all `demoState` imports and reads
- Remove `DEMO_MODE` constant and all branches on it
- Path consumption: project telemetry position onto the rendered path using incremental segment advancement (freeze path on join, advance when projection t >= 1.0 per segment)

**`App.tsx`:**
- Remove DemoController rendering

**`StatusHeader.tsx`:**
- Remove DEMO label (connection status pill handles connected/disconnected)

### Path Consumption (Position-Based)

With no access to the sim's internal distance counter, path consumption works from the drone's reported position:

1. **Before joining:** Show full rendered path. The approach dashed line points from drone to path[0].
2. **Join trigger:** Drone comes within threshold (80m) of path[0]. Freeze the current path into a ref.
3. **After joining:** Each frame, project the drone's telemetry position onto the frozen path:
   - Start from the current progress segment
   - Compute projection parameter `t` on current segment
   - If `t >= 1.0`, advance to next segment (loop to handle fast movement)
   - Render from the projection point forward
4. **Reset:** When POIs change, reset progress and unfreeze.

This is the same algorithm we built earlier, but now it works because the drone genuinely follows the path (with realistic deviation). The drone is always near the current segment, so projection is stable. Wind deviation of 10-20m on a 200m loiter radius won't cause segment jumping.

## Dependencies

- Python 3.10+ (already assumed for the backend)
- `websockets` Python package
- No changes to `shared/schemas/` — the sim uses the existing message contracts

## What This Does NOT Cover

- Video streaming (WebRTC) — separate concern
- Claude copilot integration — needs the real backend
- Multi-drone support — future work
- Altitude dynamics — mutable later, flat for now
- Sim UI/dashboard — CLI only for now
