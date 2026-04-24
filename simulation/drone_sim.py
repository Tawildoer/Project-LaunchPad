import math
import random
import time
import asyncio
import json
import argparse

try:
    import websockets
except ImportError:
    print("Install websockets: pip install -r simulation/requirements.txt")
    raise

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
        speed: float = 80.0,
        wind_speed: float = 2.0,
        min_turn_radius: float = 30.0,
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

        self.wind_base_speed = wind_speed
        self.wind_angle = random.uniform(0, 360)
        self.wind_gust = 0.0

        self.pois: list[dict] = []
        self.mission_path: list[dict] = []
        self.path_index = 0

    def tick(self, dt: float) -> None:
        self.battery = max(0.0, self.battery - 0.0003 * dt)

        self.wind_angle = (self.wind_angle + (random.random() - 0.5) * 5) % 360
        self.wind_gust = max(0.0, self.wind_gust + (random.random() - 0.5) * 2)
        self.wind_gust = min(self.wind_gust, self.wind_base_speed * 0.5)
        wind_speed = self.wind_base_speed + self.wind_gust

        if not self.armed:
            return

        if self.mode == "AUTO" and self.mission_path:
            self._follow_path(dt)
        elif self.mode == "RTL":
            self._steer_toward(self.home_lat, self.home_lon, dt)
            if dist_m(self.lat, self.lon, self.home_lat, self.home_lon) < 10:
                self.mode = "LOITER"

        self.heading = (self.heading + (random.random() - 0.5) * 0.5) % 360

        move_m = self.speed * dt
        rad = math.radians(self.heading)
        cos_lat = math.cos(math.radians(self.lat))
        self.lat += (move_m * math.cos(rad)) / DEG_TO_M
        self.lon += (move_m * math.sin(rad)) / (DEG_TO_M * cos_lat)

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

    def _follow_path(self, dt: float) -> None:
        if self.path_index >= len(self.mission_path):
            self.mode = "LOITER"
            return

        # Advance past points the drone has passed
        steps = 0
        cos_lat = math.cos(math.radians(self.lat))
        while self.path_index < len(self.mission_path) - 1 and steps < 5:
            curr = self.mission_path[self.path_index]
            nxt = self.mission_path[self.path_index + 1]
            d_curr = dist_m(self.lat, self.lon, curr["lat"], curr["lon"])
            d_next = dist_m(self.lat, self.lon, nxt["lat"], nxt["lon"])
            # Advance if closer to next point, OR if projection past segment end
            if d_next < d_curr:
                self.path_index += 1
                steps += 1
            else:
                ax = (nxt["lon"] - curr["lon"]) * cos_lat * DEG_TO_M
                ay = (nxt["lat"] - curr["lat"]) * DEG_TO_M
                bx = (self.lon - curr["lon"]) * cos_lat * DEG_TO_M
                by = (self.lat - curr["lat"]) * DEG_TO_M
                seg_len_sq = ax * ax + ay * ay
                if seg_len_sq > 0 and (ax * bx + ay * by) / seg_len_sq >= 1.0:
                    self.path_index += 1
                    steps += 1
                else:
                    break

        if self.path_index >= len(self.mission_path):
            self.mode = "LOITER"
            return

        # Project drone onto current segment to find where we are on the path
        curr = self.mission_path[self.path_index]
        nxt_idx = min(self.path_index + 1, len(self.mission_path) - 1)
        nxt = self.mission_path[nxt_idx]
        ax = (nxt["lon"] - curr["lon"]) * cos_lat * DEG_TO_M
        ay = (nxt["lat"] - curr["lat"]) * DEG_TO_M
        bx = (self.lon - curr["lon"]) * cos_lat * DEG_TO_M
        by = (self.lat - curr["lat"]) * DEG_TO_M
        seg_len_sq = ax * ax + ay * ay
        seg_len = math.sqrt(seg_len_sq) if seg_len_sq > 0 else 0.0
        t = max(0.0, min(1.0, (ax * bx + ay * by) / seg_len_sq)) if seg_len_sq > 0 else 0.0

        # Walk lookahead forward from the drone's projection, not segment start
        d_to_target = dist_m(self.lat, self.lon, curr["lat"], curr["lon"])
        lookahead_m = max(self.speed * 1.0, d_to_target * 0.5)
        remaining_on_seg = seg_len * (1.0 - t)
        dist_left = lookahead_m

        if remaining_on_seg >= dist_left:
            frac = t + dist_left / seg_len if seg_len > 0 else 1.0
            target_lat = curr["lat"] + frac * (nxt["lat"] - curr["lat"])
            target_lon = curr["lon"] + frac * (nxt["lon"] - curr["lon"])
        else:
            dist_left -= remaining_on_seg
            walk = self.path_index + 1
            target_lat = nxt["lat"]
            target_lon = nxt["lon"]
            while walk < len(self.mission_path) - 1:
                p0 = self.mission_path[walk]
                p1 = self.mission_path[walk + 1]
                sl = dist_m(p0["lat"], p0["lon"], p1["lat"], p1["lon"])
                if sl >= dist_left:
                    frac = dist_left / sl if sl > 0 else 0.0
                    target_lat = p0["lat"] + frac * (p1["lat"] - p0["lat"])
                    target_lon = p0["lon"] + frac * (p1["lon"] - p0["lon"])
                    break
                dist_left -= sl
                walk += 1
            else:
                last = self.mission_path[-1]
                target_lat = last["lat"]
                target_lon = last["lon"]

        self._steer_toward(target_lat, target_lon, dt)

    def telemetry_dict(self) -> dict:
        noise = 2.0 if self.armed else 0.3
        gps_lat = self.lat + (random.random() - 0.5) * noise * (1 / DEG_TO_M)
        gps_lon = self.lon + (random.random() - 0.5) * noise * (
            1 / (DEG_TO_M * math.cos(math.radians(self.lat)))
        )

        turn_component = self.speed / max(self.min_turn_radius, 1)
        roll = turn_component * 3

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
            self.mode = "AUTO" if self.mission_path else "STABILIZE"
        elif cmd_type == "disarm":
            self.armed = False
        elif cmd_type == "send_mission":
            new_path = cmd.get("path", [])
            was_flying = self.mode == "AUTO" and len(self.mission_path) > 0
            old_len = len(self.mission_path)
            self.mission_path = new_path
            self.pois = cmd.get("pois", [])
            if was_flying and new_path:
                # Search for drone's position in the new path, but only
                # within the old path's range (so appended POIs don't
                # pull the drone forward)
                search_end = min(old_len, len(new_path))
                best_i = 0
                best_d = float("inf")
                for i in range(search_end):
                    d = dist_m(self.lat, self.lon, new_path[i]["lat"], new_path[i]["lon"])
                    if d < best_d:
                        best_d = d
                        best_i = i
                self.path_index = best_i
            else:
                self.path_index = 0
            if self.armed and self.mission_path:
                self.mode = "AUTO"
        elif cmd_type == "set_mode":
            self.mode = cmd.get("mode", self.mode)
        elif cmd_type == "return_home":
            self.mode = "RTL"
        elif cmd_type == "reset":
            self.lat = self.home_lat
            self.lon = self.home_lon
            self.heading = 0.0
            self.battery = 98.0
            self.armed = True
            self.mode = "STABILIZE"
            self.pois = []
            self.mission_path = []
            self.path_index = 0
            self.loiter_start = None


async def sim_server(
    host: str,
    port: int,
    drone: DroneState,
    tick_hz: float = 30.0,
) -> None:
    clients: set = set()
    dt = 1.0 / tick_hz

    async def handler(ws) -> None:
        clients.add(ws)
        print(f"[sim] client connected ({len(clients)} total)")
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

    async with websockets.serve(handler, host, port):
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
    parser.add_argument("--speed", type=float, default=80.0)
    parser.add_argument("--wind", type=float, default=2.0)
    parser.add_argument("--turn-radius", type=float, default=30.0)
    parser.add_argument("--armed", action="store_true", help="Start drone pre-armed")
    args = parser.parse_args()

    drone = DroneState(
        lat=args.lat,
        lon=args.lon,
        speed=args.speed,
        wind_speed=args.wind,
        min_turn_radius=args.turn_radius,
    )

    if args.armed:
        drone.armed = True

    asyncio.run(sim_server(args.host, args.port, drone))


if __name__ == "__main__":
    main()
