# Project LaunchPad — Architecture Design

**Date:** 2026-04-23
**Status:** Approved
**Author:** Tom (with Claude)

---

## 1. Project Overview

Project LaunchPad is a personal cellular drone project. The core innovation is replacing the traditional range-limited RF radio link (e.g. DJI controller) with a cellular connection, enabling beyond-line-of-sight operation from any internet-connected device.

The drone is a **fixed-wing VTOL (QuadPlane)** — it takes off and lands vertically in multirotor mode, then transitions to fixed-wing for efficient cruise flight.

**Short-term goal:** Real-time remote control over cellular with live video feed.
**Long-term goal:** Autonomous operation — operator assigns high-level tasks (points of interest, surveillance routes), drone executes them independently.

---

## 2. System Architecture

### 2.1 Physical Actors

Three physical actors make up the system:

```
┌─────────────────────────────────────────────────────────┐
│                    TAILSCALE NETWORK                     │
│                                                          │
│  ┌──────────────┐              ┌──────────────────────┐  │
│  │    DRONE     │◄────────────►│   GROUND STATION     │  │
│  │              │  MAVLink +   │                      │  │
│  │  FC (TBD)    │  WebRTC      │  Browser (web app)   │  │
│  │  MAVLink ↕   │              │         ↕            │  │
│  │  Orange Pi   │              │  Backend (Python)    │  │
│  │  (cellular)  │              │  (operator machine)  │  │
│  └──────────────┘              └──────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 2.2 Connectivity

**Tailscale** is the sole networking backbone. Both the drone (via cellular SIM) and the ground station machine join the same Tailscale network. This gives:

- Stable private IP for the drone regardless of which cellular tower it connects to
- Encrypted WireGuard tunnel, direct P2P where possible
- Automatic reconnection after dropped cellular links
- No custom cloud server to maintain

**Bluetooth** is deferred — reserved as a future direct field troubleshooting tool for when the drone is on the ground nearby.

### 2.3 Drone Hardware

| Component | Detail |
|---|---|
| Flight controller | TBD — design targets the MAVLink protocol, not specific hardware. QuadPlane-capable FC required (Pixhawk-class). |
| Companion computer | Orange Pi with cellular SIM |
| Camera | TBD |
| Gimbal | 2-axis, front-mounted. Locks onto point of interest via `DO_SET_ROI`. |
| Frame | Fixed-wing VTOL (QuadPlane). Hardware design files in `hardware/`. |

---

## 3. Data Flows

### 3.1 Control & Telemetry (MAVLink)

```
FC (serial/USB)
    ↓
drone-agent  ──Tailscale──►  backend  ──WebSocket──►  browser
    ↑                            ↑
  commands                  commands from operator / copilot
```

- FC outputs MAVLink at ~10Hz over serial/USB
- `drone-agent` reads the serial port and forwards over a TCP socket on the Tailscale network
- Backend unpacks and pushes telemetry to the browser via WebSocket
- Commands flow the reverse path
- This path prioritises reliability over latency

### 3.2 Video (WebRTC)

```
Camera → Orange Pi (HEVC encode) → WebRTC sender (webrtc-sender package)
                                           ↓
                               Tailscale (signaling only, via backend)
                                           ↓
                               browser ← WebRTC P2P stream (webrtc-receiver package)
```

- Camera frames are HEVC (H.265) encoded on the Orange Pi — chosen for low bitrate at high quality on constrained cellular links
- The signaling handshake is brokered by the backend over Tailscale
- Once connected, video flows **directly P2P** — the backend carries no video data
- **Video latency is the primary optimisation target.** Every decision in this path should consider latency impact.

**Latency levers (priority order):**
1. Hardware HEVC encode on Orange Pi SoC (avoid software encode)
2. WebRTC jitter buffer tuning (smaller = lower latency, higher packet-loss sensitivity)
3. Cellular link quality (LTE preferred, antenna placement on frame matters)
4. Browser hardware-accelerated decode

---

## 4. Module Breakdown

### 4.1 Repo Structure

```
Project-LaunchPad/
├── drone-agent/              # Orange Pi orchestration (Python)
├── ground-station/
│   ├── backend/              # master_controller — ground server (Python)
│   └── frontend/             # operator web app (React + TypeScript)
├── packages/
│   ├── webrtc-sender/        # portable Python video sender
│   ├── webrtc-receiver/      # portable TypeScript browser receiver component
│   └── webrtc-signaling/     # portable Python signaling server (transport-agnostic)
├── hardware/                 # CAD, BOM, wiring diagrams (future)
├── shared/                   # MAVLink schemas, WebSocket message contracts
└── docs/
    └── superpowers/specs/
```

### 4.2 Module Descriptions

**`drone-agent/`** *(Python, runs on Orange Pi)*
Responsible for everything above the flight controller on the drone. Bridges MAVLink from the FC serial port onto the Tailscale network. Manages the camera pipeline — captures frames and feeds them into `webrtc-sender`. Issues gimbal `DO_SET_ROI` commands when entering a loiter. Monitors Tailscale connection health and handles reconnection. When the mission queue empties, sends the configured idle mode command to the FC (fixed-wing LOITER or QLOITER, based on ground station setting).

**`ground-station/backend/`** *(Python — existing `master_controller`)*
Receives MAVLink from the drone over Tailscale and forwards telemetry to the browser via WebSocket. Brokers the WebRTC signaling handshake. Serves the frontend as static files. Hosts the Claude copilot endpoint — receives natural language input from the browser, calls the Anthropic API with drone context and tool definitions, and returns interpreted commands or clarifying questions. Monitors the mission queue and triggers idle mode on the drone when it empties.

**`ground-station/frontend/`** *(React + TypeScript)*
The operator web app. Dark terminal aesthetic (monospace font, phosphor green on near-black). Connects to the backend via WebSocket for telemetry and commands. Currently served on a local socket; designed to be hosted publicly later with no code changes.

**`packages/webrtc-sender/`** *(Python — portable)*
Captures video, HEVC-encodes it, and streams via WebRTC. Zero drone-specific logic. Configurable: resolution, codec bitrate, STUN URLs, signaling transport. Consumed by `drone-agent` as a library.

**`packages/webrtc-receiver/`** *(TypeScript — portable)*
React component that receives and renders a WebRTC stream. Zero drone-specific logic. Configurable: signaling transport, video element dimensions, fallback UI. Consumed by `ground-station/frontend`.

**`packages/webrtc-signaling/`** *(Python — portable)*
Brokers the WebRTC signaling handshake between sender and receiver. Transport-agnostic — works over WebSocket, Tailscale, or any future mechanism. Consumed by `ground-station/backend`.

**`shared/`**
MAVLink message definitions, command enums, and the WebSocket message schema that backend and frontend share. Language-agnostic (JSON Schema). Ensures any future client (mobile app, second ground station) speaks the same contract.

**`hardware/`** *(future)*
Physical drone design files — CAD models, wiring diagrams, BOM. Dormant until physical design phase begins.

---

## 5. Frontend Design

### 5.1 Layout

```
┌─────────────────────────────────────────────────────────┐
│  ▌PROJECT LAUNCHPAD          DRONE-01 ● CONNECTED  14:23│
├───────────────────────────┬─────────────────────────────┤
│                           │                             │
│         MAP PANEL         │        VIDEO PANEL          │
│                           │                             │
│  [SAT / VEC toggle]       │  WebRTC stream              │
│                           │  or [ NO SIGNAL ] state     │
│  drone position marker    │                             │
│  drawn spline path        │  LOCKED: POI-02             │
│  loiter radius circles    │                             │
│  gimbal cone indicator    │                             │
│                           │                             │
├───────────────────────────┴─────────────────────────────┤
│  > ARM   DISARM   RTL   │  ALT: 0m  SPD: 0m/s  BAT: 98%│
├─────────────────────────────────────────────────────────┤
│  ▌ copilot> fly to the reservoir at 80m_               │
└─────────────────────────────────────────────────────────┘
```

Panels are resizable — operator drags the divider to favour map or video.

### 5.2 Aesthetic

| Property | Value |
|---|---|
| Background | `#0d0f0e` (near-black) |
| Primary text | `#39ff14` (phosphor green) |
| Secondary text | `#4a9e5c` (dim green) |
| Borders | 1px, low-opacity green |
| Font | JetBrains Mono or Fira Code (monospace, free) |
| Buttons | Terminal-style `[ ARM ]`, `[ DISARM ]` — no rounded corners |

### 5.3 Key Components

| Component | Responsibility |
|---|---|
| `MapPanel` | Leaflet.js map, drone marker, spline path, loiter circles, gimbal cone, tile toggle |
| `VideoPanel` | WebRTC video element, signal strength, `NO SIGNAL` fallback, active POI label |
| `CommandBar` | Arm/Disarm/RTL buttons, live telemetry readout |
| `StatusHeader` | Drone ID, connection state, system clock |
| `CopilotBar` | Natural language input, Claude response display, confirmation prompts |
| `SettingsPanel` | Idle behaviour toggle (LOITER vs QLOITER), minimum turn radius (metres), other operator preferences |
| `TelemetryStore` | React context — single source of truth for all MAVLink state |

### 5.4 Map Tiles

Two tile layers, switchable via toggle in `MapPanel`:
- **Satellite** — aerial imagery. Default. Operationally useful for surveillance missions.
- **Dark vector** — stylised dark road/terrain map. Matches terminal aesthetic.

### 5.5 Path Planning

1. Operator clicks map to place **Point of Interest (POI)** markers
2. Each POI has a configurable **loiter radius** and **dwell time** (right-click menu)
3. Frontend calculates a **Catmull-Rom spline** connecting POIs, respecting the aircraft's minimum turn radius — no segment may have a corner tighter than the aircraft can fly
4. The departure and arrival angles at each loiter circle are tangent — smooth entry and exit
5. Operator hits `[ SEND MISSION ]` — frontend converts the path to MAVLink waypoints plus `DO_SET_ROI` commands and sends to backend
6. **Mission flow:** VTOL takeoff → fixed-wing transition → fly spline → loiter + gimbal lock at each POI (for configured dwell time) → return home

### 5.6 Idle Behaviour

When the mission queue empties, the backend sends an idle mode command to the FC:

| Mode | ArduPilot Command | Behaviour |
|---|---|---|
| Glide circles | `LOITER` | Fixed-wing loiter, minimal throttle. Energy efficient. |
| Hold position | `QLOITER` | Transitions to multirotor, hovers in place. Precise but battery-intensive. |

Operator toggles between modes in `SettingsPanel`. Setting persists across sessions.

---

## 6. Claude Copilot

### 6.1 Overview

A natural language input bar in the ground station UI. The operator types plain English commands — the backend interprets them via the Claude API, asks clarifying questions if needed, then executes or presents them for confirmation.

### 6.2 Architecture

```
browser (CopilotBar)
    ↓ natural language text
backend (copilot module)
    ↓ Anthropic API call with drone context + tool definitions
Claude
    ↓ tool calls or clarifying question
backend
    ↓ WebSocket
browser — shows response or confirmation prompt
    ↓ operator confirms (if required)
backend — executes MAVLink command / mission
```

### 6.3 Tools Available to Claude

| Tool | Description |
|---|---|
| `get_drone_status()` | Returns current position, altitude, battery, mode, mission queue |
| `geocode(place_name)` | Resolves a place name to GPS coordinates (OpenStreetMap Nominatim — free) |
| `fly_to(lat, lon, alt)` | Commands drone to fly to a coordinate at given altitude |
| `add_poi(lat, lon, radius, dwell_seconds)` | Adds a POI to the mission queue |
| `send_mission()` | Transmits the current mission queue to the drone |
| `set_mode(mode)` | Changes flight mode (LOITER, QLOITER, RTL, etc.) |
| `return_home()` | Commands RTL |

### 6.4 Execution Policy (Risk-Based)

| Command type | Behaviour |
|---|---|
| Informational (`get_drone_status`, `geocode`) | Auto-executes, response shown immediately |
| Non-movement (`set_mode` to non-flight modes) | Auto-executes |
| Movement / mission (`fly_to`, `add_poi`, `send_mission`) | Shows confirmation: "I'm going to: [description]. `[ EXECUTE ]` `[ CANCEL ]`" |
| `return_home` | Always requires confirmation |

Claude maintains conversation history within a browser session (cleared on page reload) so follow-up questions have context.

---

## 7. Error Handling

| Scenario | Behaviour |
|---|---|
| Tailscale connection lost | Backend retries connection. UI shows `DRONE-01 ● RECONNECTING`. Mission continues onboard. |
| Video stream drops | `VideoPanel` shows `NO SIGNAL`. MAVLink control unaffected. WebRTC renegotiates automatically. |
| Mission queue empties mid-flight | Backend sends configured idle mode command (LOITER or QLOITER). |
| Claude API unavailable | Copilot bar shows `COPILOT OFFLINE`. All manual controls remain functional. |
| FC serial connection lost | `drone-agent` logs error, attempts reconnect. Ground station shows telemetry freeze. |

---

## 8. Future Work (Out of Scope for v1)

- Bluetooth direct-connect for field troubleshooting
- Public hosting of the ground station web app
- Multi-drone support (architecture is designed for it — each drone joins Tailscale and registers with the backend)
- Physical drone design (`hardware/` module)
- Headscale (self-hosted Tailscale coordination server) for full independence from third-party services
- Autonomous path replanning based on sensor data
