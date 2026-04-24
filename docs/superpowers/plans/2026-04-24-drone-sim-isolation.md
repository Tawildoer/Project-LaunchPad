# Drone Simulator Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the embedded demo mock with a standalone Python drone simulator that communicates over WebSocket, and strip all demo-specific code from the frontend so it operates identically for sim and real drone.

**Architecture:** Two independent processes connected by WebSocket. The Python sim (`simulation/drone_sim.py`) runs a 30Hz physics loop with waypoint steering, wind, turbulence, and GPS noise. The frontend connects via `VITE_WS_URL` and renders telemetry — no demo-specific branches, no shared mutable state.

**Tech Stack:** Python 3.11 + `websockets` + `asyncio` for the sim. React/TypeScript frontend (unchanged stack, just removing demo code).

---

### Task 1: Python Drone Simulator — Core Physics

**Files:**
- Create: `simulation/drone_sim.py`
- Create: `simulation/requirements.txt`

This task builds the `DroneState` class with position updates, heading-based steering, turn radius enforcement, wind, turbulence, and GPS noise. No WebSocket yet — just the physics engine.

- [ ] **Step 1: Create requirements.txt**

```
websockets>=12.0
```

- [ ] **Step 2: Install dependencies**

Run: `pip3 install -r simulation/requirements.txt`

- [ ] **Step 3: Write DroneState class**

Create `simulation/drone_sim.py`:

```python
import math
import random
import time

DEG_TO_M = 111320.0


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    cos_lat = math.cos(math.radians(lat1))
    dx = (lon2 - lon1) * cos_lat * DEG_TO_M
    dy = (lat2 - lat1) * DEG_TO_M
    return math.degrees(math.atan2(dx, dy)) % 360


def dist_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    cos_lat = math.cos(math.radians(lat1))
    dx = (lon2 - lon1) * cos_lat * DEG_TO_M
    dy = (lat2 - lat1) * DEG_TO_M
    return math.sqrt(dx * dx + dy * dy)


def shortest_angle_diff(target: float, current: float) -> float:
    d = (target - current) % 360
    return d - 360 if d > 180 else d


class DroneState:
    def __init__(
        self,
        lat: float = -37.854,
        lon: float = 145.059,
        speed: float = 18.0,
        wind_speed: float = 3.0,
        min_turn_radius: float = 80.0,
    ):
        self.lat = lat
        self.lon = lon
        self.alt_msl = 150.0
        self.alt_rel = 80.0
        self.heading = 0.0
        self.speed = speed
        self.battery = 98.0
        self.armed = False
        self.mode = "STABILIZE"

        self.home_lat = lat
        self.home_lon = lon
        self.min_turn_radius = min_turn_radius

        # Wind state
        self.wind_base_speed = wind_speed
        self.wind_angle = random.uniform(0, 360)
        self.wind_gust = 0.0

        # Mission state
        self.pois: list[dict] = []
        self.current_poi_index = 0
        self.loiter_start: float | None = None
        self.loiter_target_angle = 0.0

    def tick(self, dt: float) -> None:
        self.battery = max(0.0, self.battery - 0.0003 * dt)

        # Wind: random walk on angle, gusts on magnitude
        self.wind_angle = (self.wind_angle + (random.random() - 0.5) * 5) % 360
        self.wind_gust = max(0.0, self.wind_gust + (random.random() - 0.5) * 2)
        self.wind_gust = min(self.wind_gust, self.wind_base_speed * 0.5)
        wind_speed = self.wind_base_speed + self.wind_gust

        if not self.armed:
            return

        # Steering
        if self.mode == "AUTO" and self.pois:
            self._steer_mission(dt)
        elif self.mode == "RTL":
            self._steer_toward(self.home_lat, self.home_lon, dt)
            if dist_m(self.lat, self.lon, self.home_lat, self.home_lon) < 10:
                self.mode = "LOITER"

        # Turbulence: small heading jitter
        self.heading = (self.heading + (random.random() - 0.5) * 3) % 360

        # Position update from drone's own thrust
        move_m = self.speed * dt
        rad = math.radians(self.heading)
        cos_lat = math.cos(math.radians(self.lat))
        self.lat += (move_m * math.cos(rad)) / DEG_TO_M
        self.lon += (move_m * math.sin(rad)) / (DEG_TO_M * cos_lat)

        # Wind displacement (drone doesn't know about this)
        wind_rad = math.radians(self.wind_angle)
        wind_m = wind_speed * dt
        self.lat += (wind_m * math.cos(wind_rad)) / DEG_TO_M
        self.lon += (wind_m * math.sin(wind_rad)) / (DEG_TO_M * cos_lat)

    def _steer_toward(self, target_lat: float, target_lon: float, dt: float) -> None:
        desired = bearing_deg(self.lat, self.lon, target_lat, target_lon)
        error = shortest_angle_diff(desired, self.heading)
        max_rate = math.degrees(self.speed / self.min_turn_radius) * dt
        clamped = max(-max_rate, min(max_rate, error))
        self.heading = (self.heading + clamped) % 360

    def _steer_mission(self, dt: float) -> None:
        if self.current_poi_index >= len(self.pois):
            self.mode = "LOITER"
            return

        poi = self.pois[self.current_poi_index]
        center_lat, center_lon = poi["lat"], poi["lon"]
        radius = poi["loiter_radius"]
        d = dist_m(self.lat, self.lon, center_lat, center_lon)

        if self.loiter_start is None:
            if d <= radius * 1.1:
                # Entered the loiter circle — start orbiting
                self.loiter_start = time.time()
                self.loiter_target_angle = bearing_deg(
                    center_lat, center_lon, self.lat, self.lon
                )
            else:
                # Steer toward the POI center
                self._steer_toward(center_lat, center_lon, dt)
        else:
            # Orbiting: advance the target point around the circle
            orbit_rate = math.degrees(self.speed / radius) * dt
            self.loiter_target_angle = (self.loiter_target_angle + orbit_rate) % 360
            target_rad = math.radians(self.loiter_target_angle)
            cos_c = math.cos(math.radians(center_lat))
            target_lat = center_lat + (radius * math.cos(target_rad)) / DEG_TO_M
            target_lon = center_lon + (radius * math.sin(target_rad)) / (
                DEG_TO_M * cos_c
            )
            self._steer_toward(target_lat, target_lon, dt)

            # Check dwell completion
            dwell = poi.get("dwell_seconds", 60)
            if time.time() - self.loiter_start >= dwell:
                self.loiter_start = None
                self.current_poi_index += 1
                if self.current_poi_index >= len(self.pois):
                    self.mode = "LOITER"

    def telemetry_dict(self) -> dict:
        # GPS noise on emitted position only
        gps_lat = self.lat + (random.random() - 0.5) * 2 * (1 / DEG_TO_M)
        gps_lon = self.lon + (random.random() - 0.5) * 2 * (
            1 / (DEG_TO_M * math.cos(math.radians(self.lat)))
        )

        # Roll derived from turn rate (simplified bank angle)
        turn_component = self.speed / max(self.min_turn_radius, 1)
        roll = turn_component * 3  # rough visual approximation

        return {
            "timestamp": int(time.time() * 1000),
            "armed": self.armed,
            "mode": self.mode,
            "position": {
                "lat": gps_lat,
                "lon": gps_lon,
                "alt_msl": self.alt_msl,
                "alt_rel": self.alt_rel,
            },
            "attitude": {"roll": roll, "pitch": 2.0, "yaw": self.heading},
            "velocity": {
                "ground_speed": self.speed,
                "air_speed": self.speed + 4,
                "climb_rate": 0.0,
            },
            "battery": {
                "voltage": 22.2,
                "current": 12.5,
                "remaining_pct": round(self.battery),
            },
            "gps": {"fix_type": 3, "satellites_visible": 12},
        }

    def handle_command(self, cmd: dict) -> None:
        cmd_type = cmd.get("type")
        if cmd_type == "arm":
            self.armed = True
            self.mode = "STABILIZE"
        elif cmd_type == "disarm":
            self.armed = False
        elif cmd_type == "send_mission":
            self.pois = cmd.get("pois", [])
            self.current_poi_index = 0
            self.loiter_start = None
            if self.armed and self.pois:
                self.mode = "AUTO"
        elif cmd_type == "set_mode":
            self.mode = cmd.get("mode", self.mode)
        elif cmd_type == "return_home":
            self.mode = "RTL"
            self.loiter_start = None
```

- [ ] **Step 4: Verify the module imports without errors**

Run: `python3 -c "from simulation.drone_sim import DroneState; d = DroneState(); d.tick(0.033); print(d.telemetry_dict()['position'])"`

Expected: prints a position dict near `(-37.854, 145.059)`

- [ ] **Step 5: Commit**

```bash
git add simulation/drone_sim.py simulation/requirements.txt
git commit -m "feat(sim): add DroneState class with physics, steering, wind, and GPS noise"
```

---

### Task 2: Python Drone Simulator — WebSocket Server & CLI

**Files:**
- Modify: `simulation/drone_sim.py` (add server code and `__main__` block)

Add the async WebSocket server, telemetry broadcast loop, command handler, and CLI argument parsing.

- [ ] **Step 1: Add WebSocket server and main block to drone_sim.py**

Append to the end of `simulation/drone_sim.py`:

```python
import asyncio
import json
import argparse

try:
    import websockets
    from websockets.server import serve
except ImportError:
    print("Install websockets: pip install -r simulation/requirements.txt")
    raise


async def sim_server(
    host: str,
    port: int,
    drone: DroneState,
    tick_hz: float = 30.0,
) -> None:
    clients: set[websockets.WebSocketServerProtocol] = set()
    dt = 1.0 / tick_hz

    async def handler(ws: websockets.WebSocketServerProtocol) -> None:
        clients.add(ws)
        print(f"[sim] client connected ({len(clients)} total)")
        # Send connection status
        await ws.send(json.dumps({
            "type": "connection_status",
            "payload": {"drone_id": "SIM-001", "status": "connected"},
        }))
        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                    if msg.get("type") == "command":
                        drone.handle_command(msg.get("payload", {}))
                        print(f"[sim] command: {msg['payload'].get('type')}")
                except json.JSONDecodeError:
                    pass
        finally:
            clients.discard(ws)
            print(f"[sim] client disconnected ({len(clients)} total)")

    async def broadcast_loop() -> None:
        while True:
            drone.tick(dt)
            telem = json.dumps({"type": "telemetry", "payload": drone.telemetry_dict()})
            if clients:
                await asyncio.gather(
                    *(c.send(telem) for c in clients.copy()),
                    return_exceptions=True,
                )
            await asyncio.sleep(dt)

    async with serve(handler, host, port):
        print(f"[sim] drone simulator listening on ws://{host}:{port}")
        print(f"[sim] position: ({drone.lat:.4f}, {drone.lon:.4f})")
        print(f"[sim] speed={drone.speed}m/s  wind={drone.wind_base_speed}m/s  turn_radius={drone.min_turn_radius}m")
        await broadcast_loop()


def main() -> None:
    parser = argparse.ArgumentParser(description="LaunchPad drone simulator")
    parser.add_argument("--port", type=int, default=5000)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--lat", type=float, default=-37.854)
    parser.add_argument("--lon", type=float, default=145.059)
    parser.add_argument("--speed", type=float, default=18.0)
    parser.add_argument("--wind", type=float, default=3.0)
    parser.add_argument("--turn-radius", type=float, default=80.0)
    args = parser.parse_args()

    drone = DroneState(
        lat=args.lat,
        lon=args.lon,
        speed=args.speed,
        wind_speed=args.wind,
        min_turn_radius=args.turn_radius,
    )

    asyncio.run(sim_server(args.host, args.port, drone))


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Test that the server starts and accepts a connection**

Run in one terminal:
```bash
python3 simulation/drone_sim.py --port 5001
```

Expected output:
```
[sim] drone simulator listening on ws://0.0.0.0:5001
[sim] position: (-37.8540, 145.0590)
[sim] speed=18.0m/s  wind=3.0m/s  turn_radius=80.0m
```

Run in another terminal:
```bash
python3 -c "
import asyncio, websockets, json
async def test():
    async with websockets.connect('ws://localhost:5001') as ws:
        msg = json.loads(await ws.recv())
        assert msg['type'] == 'connection_status'
        print('connection_status OK')
        msg = json.loads(await ws.recv())
        assert msg['type'] == 'telemetry'
        print(f'telemetry OK: lat={msg[\"payload\"][\"position\"][\"lat\"]:.4f}')
asyncio.run(test())
"
```

Expected:
```
connection_status OK
telemetry OK: lat=-37.8540
```

Stop the server with Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git add simulation/drone_sim.py
git commit -m "feat(sim): add WebSocket server and CLI for drone simulator"
```

---

### Task 3: Frontend Cleanup — Remove All Demo Code

**Files:**
- Delete: `ground-station/frontend/src/mocks/mockTelemetry.ts`
- Delete: `ground-station/frontend/src/mocks/demoState.ts`
- Delete: `ground-station/frontend/src/components/DemoController.tsx`
- Delete: `ground-station/frontend/src/components/DemoToolbar.tsx`
- Modify: `ground-station/frontend/src/App.tsx`
- Modify: `ground-station/frontend/src/store/TelemetryContext.tsx`
- Modify: `ground-station/frontend/src/components/StatusHeader.tsx`

- [ ] **Step 1: Delete demo files**

```bash
rm ground-station/frontend/src/mocks/mockTelemetry.ts
rm ground-station/frontend/src/mocks/demoState.ts
rm ground-station/frontend/src/components/DemoController.tsx
rm ground-station/frontend/src/components/DemoToolbar.tsx
```

- [ ] **Step 2: Update TelemetryContext.tsx — remove mock fallback**

Replace the entire file with:

```typescript
import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react'
import { useWebSocket } from '../hooks/useWebSocket'
import type { Telemetry, ConnectionStatus, WsMessage } from '../types'

interface TelemetryState {
  telemetry: Telemetry | null
  connectionStatus: ConnectionStatus
  send: (msg: WsMessage) => void
}

const TelemetryContext = createContext<TelemetryState | null>(null)

const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) ?? null

export function TelemetryProvider({ children }: { children: ReactNode }) {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null)
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>(WS_URL ? 'reconnecting' : 'disconnected')

  const handleMessage = useCallback((msg: WsMessage) => {
    if (msg.type === 'telemetry') {
      setTelemetry(msg.payload as Telemetry)
    }
    if (msg.type === 'connection_status') {
      const p = msg.payload as { status: ConnectionStatus }
      setConnectionStatus(p.status)
    }
  }, [])

  useWebSocket(WS_URL, handleMessage)

  const send = useCallback((msg: WsMessage) => {
    // useWebSocket handles send internally; we need the returned send fn
  }, [])

  return (
    <TelemetryContext.Provider value={{ telemetry, connectionStatus, send }}>
      {children}
    </TelemetryContext.Provider>
  )
}

export function useTelemetry(): TelemetryState {
  const ctx = useContext(TelemetryContext)
  if (!ctx) throw new Error('useTelemetry must be used within TelemetryProvider')
  return ctx
}
```

Wait — looking at the current code, `useWebSocket` returns `{ send }`. We need to preserve that. Let me fix:

Replace the entire file with:

```typescript
import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react'
import { useWebSocket } from '../hooks/useWebSocket'
import type { Telemetry, ConnectionStatus, WsMessage } from '../types'

interface TelemetryState {
  telemetry: Telemetry | null
  connectionStatus: ConnectionStatus
  send: (msg: WsMessage) => void
}

const TelemetryContext = createContext<TelemetryState | null>(null)

const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) ?? null

export function TelemetryProvider({ children }: { children: ReactNode }) {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null)
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>(WS_URL ? 'reconnecting' : 'disconnected')

  const handleMessage = useCallback((msg: WsMessage) => {
    if (msg.type === 'telemetry') {
      setTelemetry(msg.payload as Telemetry)
    }
    if (msg.type === 'connection_status') {
      const p = msg.payload as { status: ConnectionStatus }
      setConnectionStatus(p.status)
    }
  }, [])

  const { send } = useWebSocket(WS_URL, handleMessage)

  return (
    <TelemetryContext.Provider value={{ telemetry, connectionStatus, send }}>
      {children}
    </TelemetryContext.Provider>
  )
}

export function useTelemetry(): TelemetryState {
  const ctx = useContext(TelemetryContext)
  if (!ctx) throw new Error('useTelemetry must be used within TelemetryProvider')
  return ctx
}
```

- [ ] **Step 3: Update App.tsx — remove DemoController**

Replace the entire file with:

```typescript
import { useState } from 'react'
import StatusHeader from './components/StatusHeader'
import CommandBar from './components/CommandBar'
import MapPanel from './components/MapPanel'
import VideoPanel from './components/VideoPanel'
import CopilotBar from './components/CopilotBar'
import SettingsPanel from './components/SettingsPanel'

type PipPanel = 'map' | 'video'

export default function App() {
  const [pip, setPip] = useState<PipPanel>('video')
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div className="app">
      <StatusHeader onSettingsToggle={() => setSettingsOpen(v => !v)} />
      <SettingsPanel open={settingsOpen} />

      <div className="panels">
        <div className={pip === 'map' ? 'panel-pip' : 'panel-main'}>
          {pip === 'map' && (
            <div className="panel-pip-overlay" onClick={() => setPip('video')} />
          )}
          <MapPanel isPip={pip === 'map'} />
        </div>

        <div className={pip === 'video' ? 'panel-pip' : 'panel-main'}>
          {pip === 'video' && (
            <div className="panel-pip-overlay" onClick={() => setPip('map')} />
          )}
          <VideoPanel />
        </div>
      </div>

      <CommandBar />
      <CopilotBar />
    </div>
  )
}
```

- [ ] **Step 4: Update StatusHeader.tsx — remove DEMO label**

Replace the entire file with:

```typescript
import { useEffect, useState } from 'react'
import { useTelemetry } from '../store/TelemetryContext'
import type { ConnectionStatus } from '../types'

const STATUS_COLOURS: Record<ConnectionStatus, string> = {
  connected:    'var(--fg)',
  reconnecting: 'var(--amber)',
  disconnected: 'var(--red)',
}

function Clock() {
  const [time, setTime] = useState(() => new Date().toTimeString().slice(0, 8))
  useEffect(() => {
    const id = setInterval(() => setTime(new Date().toTimeString().slice(0, 8)), 1000)
    return () => clearInterval(id)
  }, [])
  return <span>{time}</span>
}

interface Props {
  onSettingsToggle?: () => void
}

export default function StatusHeader({ onSettingsToggle }: Props) {
  const { connectionStatus } = useTelemetry()

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 12px',
      borderBottom: '1px solid var(--border)',
      height: '100%',
      fontSize: 'var(--text-sm)',
      letterSpacing: '0.1em',
      gap: 12,
    }}>
      <span style={{ flex: 1 }}>▌ <span>PROJECT LAUNCHPAD</span></span>
      <span style={{ color: STATUS_COLOURS[connectionStatus] }}>
        ● <span>{connectionStatus.toUpperCase()}</span>
      </span>
      <Clock />
      <button onClick={onSettingsToggle} style={{ letterSpacing: '0.08em' }}>⚙ SETTINGS</button>
    </div>
  )
}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd ground-station/frontend && npx tsc --noEmit`

Expected: errors from MapPanel.tsx (still imports demoState) — we fix that in Task 4.

- [ ] **Step 6: Commit deletions and non-MapPanel changes**

```bash
git add -u
git commit -m "refactor(frontend): remove all demo-specific code (mocks, DemoController, DemoToolbar)"
```

---

### Task 4: Frontend — Rework MapPanel Path Consumption

**Files:**
- Modify: `ground-station/frontend/src/components/MapPanel.tsx`

Remove all `demoState` imports and `DEMO_MODE` checks. Replace distance-based consumption with position-projection consumption that works identically for sim and real drone.

- [ ] **Step 1: Rewrite MapPanel.tsx**

Replace the entire file with:

```typescript
import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import Map, { Source, Layer, Marker, NavigationControl } from 'react-map-gl/maplibre'
import type { MapRef, MapMouseEvent } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useTelemetry } from '../store/TelemetryContext'
import { useMission } from '../store/MissionContext'
import { useSettings } from '../store/SettingsContext'
import { buildMissionPath, approachEntryAngle } from '../lib/pathPlanning'

const DEFAULT_LAT = -37.854
const DEFAULT_LON = 145.059

const SATELLITE_STYLE = {
  version: 8 as const,
  sources: {
    satellite: {
      type: 'raster' as const,
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256 as const,
      attribution: '© ESRI',
      maxzoom: 19,
    },
  },
  layers: [
    { id: 'background', type: 'background' as const, paint: { 'background-color': '#0a0a0a' } as const },
    { id: 'satellite', type: 'raster' as const, source: 'satellite' },
  ],
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
}

const DARK_STYLE = {
  version: 8 as const,
  sources: {
    dark: {
      type: 'raster' as const,
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
      ],
      tileSize: 256 as const,
      attribution: '© OpenStreetMap contributors © CARTO',
      maxzoom: 19,
    },
  },
  layers: [
    { id: 'background', type: 'background' as const, paint: { 'background-color': '#0d0f0e' } as const },
    { id: 'dark', type: 'raster' as const, source: 'dark' },
  ],
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
}

type TileLayerType = 'satellite' | 'vector'

function circlePolygon(lat: number, lon: number, radiusMeters: number, points = 64): [number, number][] {
  const rlat = radiusMeters / 111320
  const rlon = radiusMeters / (111320 * Math.cos(lat * Math.PI / 180))
  const coords: [number, number][] = []
  for (let i = 0; i <= points; i++) {
    const a = (2 * Math.PI * i) / points
    coords.push([lon + rlon * Math.cos(a), lat + rlat * Math.sin(a)])
  }
  return coords
}

function distMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const cosLat = Math.cos(lat1 * Math.PI / 180)
  return Math.sqrt(
    ((lon2 - lon1) * cosLat * 111320) ** 2 +
    ((lat2 - lat1) * 111320) ** 2,
  )
}


export default function MapPanel({ isPip = false }: { isPip?: boolean }) {
  const { telemetry } = useTelemetry()
  const { pois, addPoi, removePoi, clearPois } = useMission()
  const { settings } = useSettings()
  const [tileLayer, setTileLayer] = useState<TileLayerType>('vector')
  const [following, setFollowing] = useState(false)
  const mapRef          = useRef<MapRef>(null)
  const followingRef    = useRef(false)
  const droneRef        = useRef<{ lat: number; lon: number } | null>(null)
  const animFrameRef    = useRef<number | null>(null)
  const followTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const poiEntryRef     = useRef<Record<string, number>>({})
  const trailRef        = useRef<{ lat: number; lon: number }[]>([])
  // Path consumption state
  const pathProgressRef = useRef(0)
  const pathJoinedRef   = useRef(false)
  const consumptionPathRef = useRef<{ lat: number; lon: number }[]>([])

  const initialLat = telemetry?.position.lat ?? DEFAULT_LAT
  const initialLon = telemetry?.position.lon ?? DEFAULT_LON

  const onLoad = useCallback(() => {
    mapRef.current?.getMap().setProjection({ type: 'globe' })
  }, [])

  useEffect(() => {
    if (telemetry) droneRef.current = { lat: telemetry.position.lat, lon: telemetry.position.lon }
  }, [telemetry?.position.lat, telemetry?.position.lon])

  useEffect(() => {
    if (!telemetry) return
    const { lat, lon } = telemetry.position
    const trail = trailRef.current
    trail.push({ lat, lon })
    if (trail.length > 10000) trail.splice(0, trail.length - 10000)
  }, [telemetry?.position.lat, telemetry?.position.lon])

  useEffect(() => {
    if (!telemetry || pois.length === 0) return
    const { lat, lon } = telemetry.position
    const speed   = Math.max(telemetry.velocity.ground_speed, 1)
    const now     = Date.now()
    const entries = poiEntryRef.current

    for (const poi of pois) {
      const d       = distMeters(lat, lon, poi.lat, poi.lon)
      const inside  = d <= poi.loiter_radius * 1.15
      const nearby  = d <= poi.loiter_radius * 1.35

      if (entries[poi.id] !== undefined) {
        if (entries[poi.id] === -1) {
          if (!nearby) {
            delete entries[poi.id]
            removePoi(poi.id)
            return
          }
        } else if (!nearby) {
          delete entries[poi.id]
        } else {
          const dwellNeeded = (Math.PI * poi.loiter_radius / speed) * 1000
          if (now - entries[poi.id] >= dwellNeeded) {
            entries[poi.id] = -1
          }
        }
      } else if (inside) {
        entries[poi.id] = now
      }
    }
  }, [telemetry?.position.lat, telemetry?.position.lon, pois, removePoi])

  const followTick = useCallback(() => {
    if (!followingRef.current) { animFrameRef.current = null; return }
    const map   = mapRef.current?.getMap()
    const drone = droneRef.current
    if (map && drone) {
      const el   = map.getContainer()
      const cx   = el.clientWidth / 2
      const cy   = el.clientHeight / 2
      const pt   = map.project([drone.lon, drone.lat])
      const dist = Math.sqrt((pt.x - cx) ** 2 + (pt.y - cy) ** 2)
      if (dist > 80) {
        const center = map.getCenter()
        const t = 0.05 * (1 - 80 / dist)
        map.setCenter({ lng: center.lng + (drone.lon - center.lng) * t, lat: center.lat + (drone.lat - center.lat) * t })
      }
    }
    animFrameRef.current = requestAnimationFrame(followTick)
  }, [])

  useEffect(() => {
    followingRef.current = following
    if (following) {
      if (animFrameRef.current === null) animFrameRef.current = requestAnimationFrame(followTick)
    } else {
      if (animFrameRef.current !== null) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null }
    }
  }, [following, followTick])

  useEffect(() => () => {
    if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current)
    if (followTimeoutRef.current !== null) clearTimeout(followTimeoutRef.current)
  }, [])

  const handleClearPath = useCallback(() => {
    clearPois()
    trailRef.current = []
  }, [clearPois])

  const handleClick = useCallback((e: MapMouseEvent) => {
    const id = `POI-${String(Date.now()).slice(-4)}`
    addPoi({ id, lat: e.lngLat.lat, lon: e.lngLat.lng, alt: 80, loiter_radius: settings.loiterRadius, dwell_seconds: 60, arc_mode: settings.arcMode })
  }, [addPoi, settings.loiterRadius, settings.arcMode])

  const handleRecentre = useCallback(() => {
    if (!telemetry) return
    if (followTimeoutRef.current) clearTimeout(followTimeoutRef.current)
    setFollowing(false)
    mapRef.current?.getMap().flyTo({ center: [telemetry.position.lon, telemetry.position.lat], zoom: 15, duration: 900 })
    followTimeoutRef.current = setTimeout(() => setFollowing(true), 950)
  }, [telemetry])

  const effectiveArcMode = pois.length > 0 ? pois[0].arc_mode : settings.arcMode

  const entryAngle = useMemo(() => {
    if (!telemetry || pois.length < 1) return undefined
    return approachEntryAngle(
      { lat: telemetry.position.lat, lon: telemetry.position.lon },
      { lat: pois[0].lat, lon: pois[0].lon },
      pois[0].loiter_radius,
      effectiveArcMode,
    )
  }, [telemetry?.position.lat, telemetry?.position.lon, pois, effectiveArcMode])

  const path = useMemo(
    () => buildMissionPath(pois, effectiveArcMode, entryAngle),
    [pois, effectiveArcMode, entryAngle],
  )

  // Reset consumption when POIs change
  useEffect(() => {
    pathProgressRef.current = 0
    pathJoinedRef.current = false
    consumptionPathRef.current = []
  }, [pois, effectiveArcMode])

  // Position-based path consumption: project drone onto the frozen path
  const remainingPath = useMemo(() => {
    if (!telemetry || path.length < 2) return path
    const { lat, lon } = telemetry.position

    if (!pathJoinedRef.current) {
      if (distMeters(lat, lon, path[0].lat, path[0].lon) <= 80) {
        pathJoinedRef.current = true
        consumptionPathRef.current = [...path]
        pathProgressRef.current = 0
      }
    }

    if (!pathJoinedRef.current) return path

    const cPath = consumptionPathRef.current
    if (cPath.length < 2) return path

    if (pathProgressRef.current >= cPath.length - 1) {
      return cPath.slice(cPath.length - 1)
    }

    // Advance one segment at a time
    let seg = pathProgressRef.current
    let lastT = 0

    while (seg < cPath.length - 1) {
      const p0 = cPath[seg], p1 = cPath[seg + 1]
      const cosLat = Math.cos(lat * Math.PI / 180)
      const ex = (p1.lon - p0.lon) * cosLat * 111320
      const ey = (p1.lat - p0.lat) * 111320
      const segLen2 = ex * ex + ey * ey
      if (segLen2 < 0.01) { seg++; continue }
      const fx = (lon - p0.lon) * cosLat * 111320
      const fy = (lat - p0.lat) * 111320
      lastT = (fx * ex + fy * ey) / segLen2
      if (lastT >= 1.0) {
        seg++
      } else {
        break
      }
    }

    pathProgressRef.current = seg

    if (seg >= cPath.length - 1) {
      return cPath.slice(cPath.length - 1)
    }

    const tClamped = Math.max(0, Math.min(1, lastT))
    const p0 = cPath[seg], p1 = cPath[seg + 1]
    const proj = {
      lat: p0.lat + tClamped * (p1.lat - p0.lat),
      lon: p0.lon + tClamped * (p1.lon - p0.lon),
    }
    return [proj, ...cPath.slice(seg + 1)]
  }, [telemetry?.position.lat, telemetry?.position.lon, path, pois])

  const pathGeoJson = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: remainingPath.length > 1 ? [{
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: remainingPath.map(p => [p.lon, p.lat]) },
    }] : [],
  }), [remainingPath])

  const trailGeoJson = useMemo(() => {
    const trail = trailRef.current
    if (trail.length < 2) return { type: 'FeatureCollection' as const, features: [] }
    return {
      type: 'FeatureCollection' as const,
      features: [{
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'LineString' as const, coordinates: trail.map(p => [p.lon, p.lat]) },
      }],
    }
  }, [telemetry?.position.lat, telemetry?.position.lon])

  const approachGeoJson = useMemo(() => {
    if (!telemetry || pois.length < 1 || path.length < 1 || pathJoinedRef.current)
      return { type: 'FeatureCollection' as const, features: [] }
    const drone = telemetry.position
    return {
      type: 'FeatureCollection' as const,
      features: [{
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'LineString' as const,
          coordinates: [[drone.lon, drone.lat], [path[0].lon, path[0].lat]],
        },
      }],
    }
  }, [telemetry?.position.lat, telemetry?.position.lon, path, pois])

  const circlesGeoJson = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: pois.map(poi => ({
      type: 'Feature' as const,
      properties: { id: poi.id },
      geometry: { type: 'Polygon' as const, coordinates: [circlePolygon(poi.lat, poi.lon, poi.loiter_radius)] },
    })),
  }), [pois])

  return (
    <div style={{ position: 'relative', height: '100%', background: '#0d0f0e' }}>
      <Map
        ref={mapRef}
        initialViewState={{ latitude: initialLat, longitude: initialLon, zoom: 13 }}
        mapStyle={tileLayer === 'satellite' ? SATELLITE_STYLE : DARK_STYLE}
        style={{ width: '100%', height: '100%' }}
        onClick={handleClick}
        onLoad={onLoad}
        onDragStart={() => setFollowing(false)}
        cursor="crosshair"
      >
        <NavigationControl position="bottom-left" showCompass={false} />

        <Source id="trail" type="geojson" data={trailGeoJson}>
          <Layer id="trail-line" type="line"
            paint={{ 'line-color': '#666', 'line-width': 1.5, 'line-opacity': 0.55, 'line-dasharray': [2, 4] }} />
        </Source>

        <Source id="approach" type="geojson" data={approachGeoJson}>
          <Layer id="approach-line" type="line"
            paint={{ 'line-color': '#555', 'line-width': 1.5, 'line-opacity': 0.7, 'line-dasharray': [4, 4] }} />
        </Source>

        <Source id="path" type="geojson" data={pathGeoJson}>
          <Layer id="path-line" type="line"
            paint={{ 'line-color': '#e0e0e0', 'line-width': 2, 'line-opacity': 0.85 }} />
        </Source>

        <Source id="circles" type="geojson" data={circlesGeoJson}>
          <Layer id="circles-fill" type="fill"
            paint={{ 'fill-color': '#555', 'fill-opacity': 0.04 }} />
          <Layer id="circles-line" type="line"
            paint={{ 'line-color': '#555', 'line-width': 1, 'line-opacity': 0.7 }} />
        </Source>

        {pois.map((poi, idx) => (
          <Marker key={`m-${poi.id}`} latitude={poi.lat} longitude={poi.lon} anchor="center">
            <div style={{ position: 'relative', pointerEvents: 'none' }}>
              <div style={{ width: 8, height: 8, background: '#666', border: '1px solid #c8c8c8', borderRadius: '50%' }} />
              <div style={{
                position: 'absolute', top: -13, left: '50%', transform: 'translateX(-50%)',
                fontSize: 9, lineHeight: 1, color: '#c8c8c8', fontFamily: 'monospace',
                whiteSpace: 'nowrap', letterSpacing: 0,
              }}>
                {idx + 1}
              </div>
            </div>
          </Marker>
        ))}

        {telemetry && (
          <Marker latitude={telemetry.position.lat} longitude={telemetry.position.lon} anchor="center">
            <div style={{
              width: 12, height: 12, background: '#c8c8c8', border: '2px solid #0d0f0e',
              borderRadius: '50%', boxShadow: '0 0 6px rgba(200,200,200,0.6)', pointerEvents: 'none',
            }} />
          </Marker>
        )}
      </Map>

      {!isPip && (telemetry || pois.length > 0) && (
        <div className="map-controls">
          {telemetry && (
            <button onClick={handleRecentre} className={following ? 'active' : ''}>
              {following ? 'FOLLOWING' : 'RECENTRE'}
            </button>
          )}
          {pois.length > 0 && <button onClick={handleClearPath}>CLEAR PATH</button>}
        </div>
      )}

      <div className="tile-toggle">
        <button className={tileLayer === 'satellite' ? 'active' : ''} onClick={() => setTileLayer('satellite')}>SAT</button>
        <button className={tileLayer === 'vector' ? 'active' : ''} onClick={() => setTileLayer('vector')}>VEC</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles clean**

Run: `cd ground-station/frontend && npx tsc --noEmit`

Expected: no errors

- [ ] **Step 3: Run tests**

Run: `cd ground-station/frontend && npx vitest run`

Expected: all tests pass (some tests that reference mock telemetry may need updating — if so, remove or update those test files)

- [ ] **Step 4: Clean up any orphaned test files**

If `src/__tests__/TelemetryContext.test.tsx` references `createMockTelemetryEmitter`, update it to test the WebSocket-only provider:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TelemetryProvider, useTelemetry } from '../store/TelemetryContext'

function StatusDisplay() {
  const { connectionStatus } = useTelemetry()
  return <span data-testid="status">{connectionStatus}</span>
}

describe('TelemetryContext', () => {
  it('provides disconnected status when no WS_URL', () => {
    render(
      <TelemetryProvider>
        <StatusDisplay />
      </TelemetryProvider>,
    )
    expect(screen.getByTestId('status').textContent).toBe('disconnected')
  })
})
```

- [ ] **Step 5: Delete empty mocks directory if no files remain**

```bash
rmdir ground-station/frontend/src/mocks 2>/dev/null || true
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(frontend): position-based path consumption, remove all demo coupling"
```

---

### Task 5: Integration Test — Sim + Frontend End-to-End

**Files:**
- Create: `ground-station/frontend/.env.development` (if not exists)

Verify the sim and frontend work together.

- [ ] **Step 1: Create .env.development for the frontend**

```bash
echo "VITE_WS_URL=ws://localhost:5000" > ground-station/frontend/.env.development
```

- [ ] **Step 2: Start the sim in one terminal**

```bash
python3 simulation/drone_sim.py
```

Expected: `[sim] drone simulator listening on ws://0.0.0.0:5000`

- [ ] **Step 3: Start the frontend in another terminal**

```bash
cd ground-station/frontend && npm run dev
```

- [ ] **Step 4: Open browser and verify**

Open `http://localhost:5173`. Verify:
1. Status header shows `● CONNECTED` (not DISCONNECTED or DEMO)
2. No drone dot visible (drone is not armed)
3. Click ARM in the command bar — drone dot appears, begins drifting with wind
4. Click map to place POIs — flight path renders
5. The drone does NOT follow POIs yet (no send_mission wired from command bar — that's existing `sendMission` in MissionContext which sends the command over WebSocket)
6. If `sendMission` is triggered (via copilot or by wiring a UI button), the sim drone steers to the POIs

- [ ] **Step 5: Verify path consumption works**

With the sim running and drone armed + mission sent:
1. Drone approaches first POI — dashed approach line visible
2. Drone enters first arc — approach line disappears, path consumed progressively
3. Drone traverses tangent to next POI — tangent line consumed as drone moves
4. POI circles disappear after drone dwells and leaves

- [ ] **Step 6: Commit the env file**

```bash
git add ground-station/frontend/.env.development
git commit -m "chore: add dev env pointing frontend at local sim"
```

---

### Task 6: Wire Send Mission from Frontend

**Files:**
- Modify: `ground-station/frontend/src/components/MapPanel.tsx`
- Modify: `ground-station/frontend/src/store/MissionContext.tsx`

Currently `sendMission` exists but is only called manually. Add auto-send: when POIs change and the drone is connected + armed, send the mission automatically.

- [ ] **Step 1: Update MissionContext to auto-send on POI change**

In `ground-station/frontend/src/store/MissionContext.tsx`, add an effect that sends the mission whenever pois change and there are pois to send:

Add after the `sendMission` callback definition:

```typescript
  useEffect(() => {
    if (pois.length > 0) {
      send({
        type: 'command',
        payload: { type: 'send_mission', pois: pois.map(p => ({
          id: p.id, lat: p.lat, lon: p.lon, alt: p.alt,
          loiter_radius: p.loiter_radius, dwell_seconds: p.dwell_seconds,
        })) },
      })
    }
  }, [pois, send])
```

- [ ] **Step 2: Verify the sim receives the mission**

With sim running: open frontend, ARM, click map to place a POI. Check sim terminal for:
```
[sim] command: arm
[sim] command: send_mission
```

The drone should begin steering toward the POI.

- [ ] **Step 3: Commit**

```bash
git add ground-station/frontend/src/store/MissionContext.tsx
git commit -m "feat(frontend): auto-send mission to backend when POIs change"
```
