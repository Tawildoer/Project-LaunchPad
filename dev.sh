#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"

cleanup() {
  kill $SIM_PID $VITE_PID 2>/dev/null
  wait $SIM_PID $VITE_PID 2>/dev/null
}
trap cleanup EXIT

echo "[dev] starting drone sim..."
python3 "$DIR/simulation/drone_sim.py" --armed "$@" &
SIM_PID=$!
sleep 1

echo "[dev] starting frontend..."
cd "$DIR/ground-station/frontend" && npx vite --host &
VITE_PID=$!

echo ""
echo "[dev] sim: ws://localhost:5000  |  frontend: http://localhost:5173"
echo "[dev] Ctrl+C to stop both"
echo ""

wait
