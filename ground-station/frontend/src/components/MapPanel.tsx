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
  const trailSnapshotRef = useRef<{ lat: number; lon: number }[]>([])
  const trailCountRef   = useRef(0)
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
    trailCountRef.current++
    if (trailCountRef.current % 15 === 0) {
      trailSnapshotRef.current = [...trail]
    }
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

  useEffect(() => {
    pathProgressRef.current = 0
    pathJoinedRef.current = false
    consumptionPathRef.current = []
  }, [pois, effectiveArcMode])

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
            paint={{ 'line-color': '#666', 'line-width': 1.5, 'line-opacity': ['get', 'opacity'], 'line-dasharray': [2, 4] }} />
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
