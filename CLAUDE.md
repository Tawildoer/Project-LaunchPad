# Project LaunchPad

Cellular drone with live WebRTC video, controlled via a web app over Tailscale. The core innovation is replacing the traditional range-limited RF radio link with a cellular connection — enabling beyond-line-of-sight operation from any internet-connected device.

**Full architecture spec:** `docs/superpowers/specs/2026-04-23-launchpad-architecture-design.md`
Read this before starting any significant work in this repo.

---

## Drone Hardware

- **Frame:** Fixed-wing VTOL (QuadPlane) — vertical takeoff/landing, fixed-wing cruise
- **Companion computer:** Orange Pi with cellular SIM
- **Flight controller:** TBD — code targets the MAVLink protocol only, not specific hardware
- **Gimbal:** 2-axis, front-mounted. Locks onto Points of Interest via `DO_SET_ROI`
- **Camera:** TBD

## Repo Structure

```
Project-LaunchPad/
├── drone-agent/              # Python — runs on Orange Pi, bridges FC to network
├── ground-station/
│   ├── backend/              # Python — ground server, WebSocket API, copilot
│   └── frontend/             # React + TypeScript — operator web app
├── packages/
│   ├── webrtc-sender/        # Python — portable video sender (no drone-specific logic)
│   ├── webrtc-receiver/      # TypeScript — portable browser receiver component
│   └── webrtc-signaling/     # Python — portable signaling server (transport-agnostic)
├── hardware/                 # CAD, BOM, wiring diagrams (future)
├── simulation/               # ArduPilot SITL + Gazebo test environment (future)
├── shared/                   # JSON Schema — message contracts between all modules
└── docs/superpowers/specs/   # Design documents
```

## Module Responsibilities

| Module | Runs on | Language | Responsibility |
|---|---|---|---|
| `drone-agent` | Orange Pi | Python | MAVLink bridge, camera pipeline, gimbal control, Tailscale health |
| `ground-station/backend` | Operator machine | Python | WebSocket server, WebRTC signaling, Claude copilot, mission queue |
| `ground-station/frontend` | Browser | React/TS | Split-view UI, map+video, path planning, command bar, copilot input |
| `packages/webrtc-sender` | Orange Pi | Python | HEVC encode + WebRTC send (portable) |
| `packages/webrtc-receiver` | Browser | TypeScript | WebRTC receive + render (portable) |
| `packages/webrtc-signaling` | Operator machine | Python | WebRTC handshake broker (portable) |
| `shared` | Both | JSON Schema | Telemetry, command, and WebSocket message definitions |

## Key Constraints

**Video latency is the primary optimisation target.** Every decision in the video pipeline — encoding settings, WebRTC tuning, jitter buffer size — should prioritise latency. Flag any choice that adds latency and prefer lower-latency alternatives.

**Design to MAVLink, not to specific hardware.** The flight controller is not yet chosen. Never write code that assumes a specific FC model. Use MAVLink message types only.

**`packages/` modules must have zero drone-specific logic.** `webrtc-sender`, `webrtc-receiver`, and `webrtc-signaling` are portable libraries. No MAVLink imports, no Project LaunchPad references. They accept configuration and do nothing else.

**Agree on `shared/` interfaces before parallel module work.** If two modules both touch a message contract, define it in `shared/` first, then build against it independently.

## Networking

Tailscale is the sole networking backbone — no custom cloud server. Both the drone (cellular) and ground station join the same Tailscale network. Bluetooth is reserved for future direct field troubleshooting only.

## Frontend Aesthetic

Dark terminal look: near-black background (`#0d0f0e`), phosphor green text (`#39ff14`), monospace font (JetBrains Mono or Fira Code), 1px green borders, terminal-style buttons `[ LIKE THIS ]`. No rounded corners, no drop shadows, no gradients.

## Claude Copilot

The ground station backend calls the Anthropic API to interpret natural language operator commands. Movement commands always require operator confirmation before execution. Informational queries auto-execute. See spec Section 6 for full details.
