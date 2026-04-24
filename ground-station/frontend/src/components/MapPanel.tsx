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
  const { telemetry, send } = useTelemetry()
  const { pois, addPoi, removePoi, clearPois } = useMission()
  const { settings } = useSettings()
  const [tileLayer, setTileLayer] = useState<TileLayerType>('vector')
  const [following, setFollowing] = useState(false)
  const mapRef          = useRef<MapRef>(null)
  const followingRef    = useRef(false)
  const droneRef        = useRef<{ lat: number; lon: number } | null>(null)
  const animFrameRef    = useRef<number | null>(null)
  const followTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastPoiIdRef    = useRef<string | null>(null)
  const prevPoiCountRef = useRef(0)
  const trailRef        = useRef<{ lat: number; lon: number }[]>([])
  const trailSnapshotRef = useRef<{ lat: number; lon: number }[]>([])
  const trailCountRef   = useRef(0)
  const pathProgressRef = useRef(0)
  const pathJoinedRef   = useRef(false)
  const frozenPathRef   = useRef<{ lat: number; lon: number; poiId?: string | null }[]>([])

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
    trailCountRef.current++
    if (trailCountRef.current % 15 === 0) {
      trailSnapshotRef.current = [...trail]
    }
  }, [telemetry?.position.lat, telemetry?.position.lon])

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
    trailSnapshotRef.current = []
  }, [clearPois])

  const handleTestPath = useCallback(() => {
    clearPois()
    trailRef.current = []
    trailSnapshotRef.current = []
    const base = telemetry
      ? { lat: telemetry.position.lat, lon: telemetry.position.lon }
      : { lat: DEFAULT_LAT, lon: DEFAULT_LON }
    const r = settings.loiterRadius
    const am = settings.arcMode
    const offsets = [
      { dlat:  0.004, dlon:  0.003 },
      { dlat:  0.007, dlon: -0.004 },
      { dlat:  0.002, dlon: -0.009 },
    ]
    offsets.forEach((o, i) => {
      addPoi({
        id: `TEST-${i + 1}`,
        lat: base.lat + o.dlat,
        lon: base.lon + o.dlon,
        alt: 80,
        loiter_radius: r,
        dwell_seconds: 30,
        arc_mode: am,
      })
    })
  }, [clearPois, addPoi, telemetry, settings.loiterRadius, settings.arcMode])

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

  const pathRef = useRef(path)
  pathRef.current = path

  // Send mission to backend/sim when POIs are added
  const prevSendCountRef = useRef(0)
  useEffect(() => {
    if (pois.length === 0 || pois.length <= prevSendCountRef.current) {
      prevSendCountRef.current = pois.length
      return
    }
    prevSendCountRef.current = pois.length
    send({
      type: 'command',
      payload: {
        type: 'send_mission',
        pois: pois.map(p => ({
          id: p.id, lat: p.lat, lon: p.lon, alt: p.alt,
          loiter_radius: p.loiter_radius, dwell_seconds: p.dwell_seconds,
        })),
        path: pathRef.current.map(p => ({ lat: p.lat, lon: p.lon })),
      },
    })
  }, [pois, effectiveArcMode, send])

  // Reset consumption: clear always resets. Addition only resets if the
  // drone hasn't joined the path yet (pre-flight). Mid-flight additions
  // are ignored — drone finishes its current path first.
  useEffect(() => {
    if (pois.length === 0) {
      pathProgressRef.current = 0
      pathJoinedRef.current = false
      frozenPathRef.current = []
      lastPoiIdRef.current = null
    } else if (pois.length > prevPoiCountRef.current && !pathJoinedRef.current) {
      pathProgressRef.current = 0
      frozenPathRef.current = []
      lastPoiIdRef.current = null
    }
    prevPoiCountRef.current = pois.length
  }, [pois])

  // Path consumption: freeze the path at join time, then consume with
  // strict sequential advancement (t >= 1.0 per segment). No searching
  // ahead — segments are all short (10-15m) so this works reliably.
  const remainingPath = useMemo(() => {
    if (!telemetry || path.length < 2) return path
    const { lat, lon } = telemetry.position

    // Before joining: show the live path
    if (!pathJoinedRef.current) {
      if (distMeters(lat, lon, path[0].lat, path[0].lon) <= 80) {
        pathJoinedRef.current = true
        frozenPathRef.current = [...path]
        pathProgressRef.current = 0
      } else {
        return path
      }
    }

    const fp = frozenPathRef.current
    if (fp.length < 2) return path

    // Strict sequential advancement: only advance when the drone has
    // passed the END of the current segment (t >= 1.0). Up to 5 per
    // tick for high-speed flight. Never skips ahead.
    let seg = pathProgressRef.current
    const cosLat = Math.cos(lat * Math.PI / 180)
    let lastT = 0
    let steps = 0

    while (seg < fp.length - 1 && steps < 5) {
      const p0 = fp[seg], p1 = fp[seg + 1]
      const ex = (p1.lon - p0.lon) * cosLat * 111320
      const ey = (p1.lat - p0.lat) * 111320
      const fx = (lon - p0.lon) * cosLat * 111320
      const fy = (lat - p0.lat) * 111320
      const segLen2 = ex * ex + ey * ey
      if (segLen2 < 0.01) { seg++; steps++; continue }
      lastT = (fx * ex + fy * ey) / segLen2
      if (lastT >= 1.0) { seg++; steps++ }
      else break
    }

    pathProgressRef.current = seg

    if (seg >= fp.length - 1) return fp.slice(-1)

    const tClamped = Math.max(0, Math.min(1, lastT))
    const p0 = fp[seg], p1 = fp[seg + 1]
    const proj = {
      lat: p0.lat + tClamped * (p1.lat - p0.lat),
      lon: p0.lon + tClamped * (p1.lon - p0.lon),
    }

    // Render from the LIVE path (includes new POIs) by finding the
    // closest point on it to the consumption position
    let liveSeg = 0
    let liveMinD = Infinity
    for (let i = 0; i < path.length - 1; i++) {
      const d = distMeters(proj.lat, proj.lon, path[i].lat, path[i].lon)
      if (d < liveMinD) { liveMinD = d; liveSeg = i }
    }
    return [proj, ...path.slice(liveSeg + 1)]
  }, [telemetry?.position.lat, telemetry?.position.lon, path])

  // Remove POI when progress moves past its arc onto tangent/next POI
  useEffect(() => {
    const fp = frozenPathRef.current
    if (fp.length === 0) return
    const seg = Math.min(pathProgressRef.current, fp.length - 1)
    const currentPoiId = fp[seg].poiId ?? null
    const prevPoiId = lastPoiIdRef.current
    if (prevPoiId && currentPoiId !== prevPoiId) {
      removePoi(prevPoiId)
    }
    lastPoiIdRef.current = currentPoiId
  }, [telemetry?.position.lat, telemetry?.position.lon, path, removePoi])

  const pathGeoJson = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: remainingPath.length > 1 ? [{
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: remainingPath.map(p => [p.lon, p.lat]) },
    }] : [],
  }), [remainingPath])

  const trailGeoJson = useMemo(() => {
    const empty = { type: 'FeatureCollection' as const, features: [] as { type: 'Feature'; properties: Record<string, number>; geometry: { type: 'LineString'; coordinates: [number, number][] } }[] }
    if (settings.trailMode === 'off') return empty
    const trail = trailSnapshotRef.current
    if (trail.length < 2) return empty

    const makeFeat = (pts: { lat: number; lon: number }[], opacity: number) => ({
      type: 'Feature' as const,
      properties: { opacity },
      geometry: { type: 'LineString' as const, coordinates: pts.map(p => [p.lon, p.lat] as [number, number]) },
    })

    if (settings.trailMode === 'solid') {
      return { type: 'FeatureCollection' as const, features: [makeFeat(trail, 0.55)] }
    }

    const BANDS = 8
    const bandSize = Math.max(1, Math.floor(trail.length / BANDS))
    const features = [] as typeof empty.features
    for (let b = 0; b < BANDS; b++) {
      const start = b * bandSize
      const end = b === BANDS - 1 ? trail.length : (b + 1) * bandSize + 1
      if (end - start < 2) continue
      features.push(makeFeat(trail.slice(start, end), 0.07 + 0.55 * (b / (BANDS - 1))))
    }
    return { type: 'FeatureCollection' as const, features }
  }, [telemetry?.position.lat, telemetry?.position.lon, settings.trailMode])

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
            paint={{ 'line-color': '#ff3b3b', 'line-width': 2, 'line-opacity': ['get', 'opacity'] }} />
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

      {!isPip && (
        <div className="map-controls">
          {telemetry && (
            <button onClick={handleRecentre} className={following ? 'active' : ''}>
              {following ? 'FOLLOWING' : 'RECENTRE'}
            </button>
          )}
          {pois.length > 0 && <button onClick={handleClearPath}>CLEAR PATH</button>}
          <button onClick={handleTestPath}>TEST PATH</button>
          <button onClick={() => { clearPois(); trailRef.current = []; trailSnapshotRef.current = []; send({ type: 'command', payload: { type: 'reset' } }) }}>RESET SIM</button>
        </div>
      )}

      <div className="tile-toggle">
        <button className={tileLayer === 'satellite' ? 'active' : ''} onClick={() => setTileLayer('satellite')}>SAT</button>
        <button className={tileLayer === 'vector' ? 'active' : ''} onClick={() => setTileLayer('vector')}>VEC</button>
      </div>
    </div>
  )
}
