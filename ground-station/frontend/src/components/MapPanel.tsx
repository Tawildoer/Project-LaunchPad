import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import Map, { Source, Layer, Marker, NavigationControl } from 'react-map-gl/maplibre'
import type { MapRef, MapMouseEvent } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useTelemetry } from '../store/TelemetryContext'
import { useMission } from '../store/MissionContext'
import { useSettings } from '../store/SettingsContext'
import { buildMissionPath } from '../lib/pathPlanning'
import DemoToolbar from './DemoToolbar'

const DEMO_MODE = !import.meta.env.VITE_WS_URL

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

// Returns index of closest point on path to (lat, lon), searching forward from fromIdx
function closestPathIdx(
  path: { lat: number; lon: number }[],
  lat: number,
  lon: number,
  fromIdx: number,
): number {
  const WINDOW = 40
  let minD = Infinity
  let idx   = fromIdx
  const end = Math.min(fromIdx + WINDOW, path.length)
  for (let i = fromIdx; i < end; i++) {
    const d = distMeters(lat, lon, path[i].lat, path[i].lon)
    if (d < minD) { minD = d; idx = i }
  }
  return idx
}

export default function MapPanel() {
  const { telemetry } = useTelemetry()
  const { pois, addPoi, removePoi, clearPois } = useMission()
  const { settings } = useSettings()
  const [tileLayer, setTileLayer] = useState<TileLayerType>('satellite')
  const [following, setFollowing] = useState(false)
  const mapRef          = useRef<MapRef>(null)
  const followingRef    = useRef(false)
  const droneRef        = useRef<{ lat: number; lon: number } | null>(null)
  const animFrameRef    = useRef<number | null>(null)
  const followTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // POI dwell tracking — records timestamp when drone first entered each loiter circle
  const poiEntryRef     = useRef<Record<string, number>>({})
  // Path progress — monotonically advancing index so consumed path never reappears
  const pathProgressRef = useRef(0)

  const initialLat = telemetry?.position.lat ?? DEFAULT_LAT
  const initialLon = telemetry?.position.lon ?? DEFAULT_LON

  const onLoad = useCallback(() => {
    mapRef.current?.getMap().setProjection({ type: 'globe' })
  }, [])

  // Keep droneRef current for the rAF loop
  useEffect(() => {
    if (telemetry) droneRef.current = { lat: telemetry.position.lat, lon: telemetry.position.lon }
  }, [telemetry?.position.lat, telemetry?.position.lon])

  // POI completion: remove a POI only after the drone has dwelt inside its loiter
  // radius for roughly half a loiter orbit (π·r / speed). This prevents the "dot
  // touches circle edge → POI vanishes" problem while still feeling responsive.
  useEffect(() => {
    if (!telemetry || pois.length === 0) return
    const { lat, lon } = telemetry.position
    const speed = Math.max(telemetry.velocity.ground_speed, 1)
    const now   = Date.now()
    const entries = poiEntryRef.current

    for (const poi of pois) {
      const d = distMeters(lat, lon, poi.lat, poi.lon)
      if (d <= poi.loiter_radius) {
        if (entries[poi.id] === undefined) entries[poi.id] = now
        const dwellNeeded = (Math.PI * poi.loiter_radius / speed) * 1000
        if (now - entries[poi.id] >= dwellNeeded) {
          delete entries[poi.id]
          removePoi(poi.id)
          return
        }
      } else {
        delete entries[poi.id]
      }
    }
  }, [telemetry?.position.lat, telemetry?.position.lon, pois, removePoi])

  // Spring follow rAF loop
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

  const handleClick = useCallback((e: MapMouseEvent) => {
    const id = `POI-${String(Date.now()).slice(-4)}`
    addPoi({ id, lat: e.lngLat.lat, lon: e.lngLat.lng, alt: 80, loiter_radius: settings.loiterRadius, dwell_seconds: 60 })
  }, [addPoi, settings.loiterRadius])

  const handleRecentre = useCallback(() => {
    if (!telemetry) return
    if (followTimeoutRef.current) clearTimeout(followTimeoutRef.current)
    setFollowing(false)
    mapRef.current?.getMap().flyTo({ center: [telemetry.position.lon, telemetry.position.lat], zoom: 15, duration: 900 })
    followTimeoutRef.current = setTimeout(() => setFollowing(true), 950)
  }, [telemetry])

  const path = useMemo(
    () => buildMissionPath(pois, settings.arcMode),
    [pois, settings.arcMode],
  )

  // Reset path progress when the path changes (new POIs or mode switch)
  useEffect(() => { pathProgressRef.current = 0 }, [path])

  // Loading-bar path: only show the portion of path ahead of the drone.
  // We advance a monotonic index so already-flown segments stay consumed.
  const remainingPath = useMemo(() => {
    if (!telemetry || path.length < 2) return path
    const { lat, lon } = telemetry.position
    const newIdx = closestPathIdx(path, lat, lon, pathProgressRef.current)
    pathProgressRef.current = newIdx
    return path.slice(newIdx)
  }, [telemetry?.position.lat, telemetry?.position.lon, path])

  const pathGeoJson = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: remainingPath.length > 1 ? [{
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: remainingPath.map(p => [p.lon, p.lat]) },
    }] : [],
  }), [remainingPath])

  // Dashed line from drone to the first path point (approach segment)
  const approachGeoJson = useMemo(() => {
    if (!telemetry || path.length < 1) return { type: 'FeatureCollection' as const, features: [] }
    const drone = telemetry.position
    const target = path[0]
    const d = distMeters(drone.lat, drone.lon, target.lat, target.lon)
    // Only show when drone is not yet on the path (more than one loiter-radius away from first point)
    if (d < 80) return { type: 'FeatureCollection' as const, features: [] }
    return {
      type: 'FeatureCollection' as const,
      features: [{
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'LineString' as const,
          coordinates: [[drone.lon, drone.lat], [target.lon, target.lat]],
        },
      }],
    }
  }, [telemetry?.position.lat, telemetry?.position.lon, path])

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

        {/* Dashed approach line: drone → first path point */}
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

      {(telemetry || pois.length > 0) && (
        <div className="map-controls">
          {telemetry && (
            <button onClick={handleRecentre} className={following ? 'active' : ''}>
              {following ? 'FOLLOWING' : 'RECENTRE'}
            </button>
          )}
          {pois.length > 0 && <button onClick={clearPois}>CLEAR PATH</button>}
        </div>
      )}

      <div className="tile-toggle">
        <button className={tileLayer === 'satellite' ? 'active' : ''} onClick={() => setTileLayer('satellite')}>SAT</button>
        <button className={tileLayer === 'vector' ? 'active' : ''} onClick={() => setTileLayer('vector')}>VEC</button>
      </div>

      {DEMO_MODE && <DemoToolbar />}
    </div>
  )
}
