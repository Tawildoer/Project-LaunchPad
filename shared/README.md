# shared

Language-agnostic JSON Schema definitions for all message contracts in Project LaunchPad.

Every module that sends or receives data across a module boundary should validate against these schemas. Changing a schema here is a breaking change — coordinate with all affected modules before merging.

## Schemas

| File | Description |
|---|---|
| `schemas/telemetry.json` | MAVLink state broadcast from backend → browser (~10Hz) |
| `schemas/commands.json` | Commands from browser/copilot → backend → drone |
| `schemas/websocket.json` | WebSocket message envelope wrapping all of the above |
