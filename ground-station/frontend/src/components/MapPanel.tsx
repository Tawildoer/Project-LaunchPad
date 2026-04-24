import { useState, useCallback, useRef, useEffect } from 'react'
import Map, { Source, Layer, Marker, NavigationControl } from 'react-map-gl/maplibre'
import type { MapRef, MapMouseEvent } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useTelemetry } from '../store/TelemetryContext'
import { useMission } from '../store/MissionContext'
import { useSettings } from '../store/SettingsContext'
import { buildMissionPath } from '../lib/pathPlanning'

// Glen Iris, Melbourne, Australia
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
  const dx = (lon2 - lon1) * cosLat * 111320
  const dy = (lat2 - lat1) * 111320
  return Math.sqrt(dx * dx + dy * dy)
}

export default function MapPanel() {
  const { telemetry } = useTelemetry()
  const { pois, addPoi, removePoi, clearPois } = useMission()
  const { settings } = useSettings()
  const [tileLayer, setTileLayer] = useState<TileLayerType>('satellite')
  const [following, setFollowing] = useState(false)
  const mapRef = useRef<MapRef>(null)
  const followingRef = useRef(false)
  const droneRef = useRef<{ lat: number; lon: number } | null>(null)
  const animFrameRef = useRef<number | null>(null)
  const followTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const initialLat = telemetry?.position.lat ?? DEFAULT_LAT
  const initialLon = telemetry?.position.lon ?? DEFAULT_LON

  const onLoad = useCallback(() => {
    mapRef.current?.getMap().setProjection({ type: 'globe' })
  }, [])

  // Keep droneRef current so the rAF loop reads the latest position without stale closures
  useEffect(() => {
    if (telemetry) {
      droneRef.current = { lat: telemetry.position.lat, lon: telemetry.position.lon }
    }
  }, [telemetry?.position.lat, telemetry?.position.lon])

  // Tick off POIs as the drone enters their loiter radius
  useEffect(() => {
    if (!telemetry || pois.length === 0) return
    const { lat, lon } = telemetry.position
    for (const poi of pois) {
      if (distMeters(lat, lon, poi.lat, poi.lon) <= poi.loiter_radius) {
        removePoi(poi.id)
        return  // one at a time; next telemetry update handles any remaining
      }
    }
  }, [telemetry?.position.lat, telemetry?.position.lon, pois, removePoi])

  // Spring follow: rAF loop that softly pulls the camera toward the drone.
  // Dead zone: camera ignores drift up to 80px from centre.
  // Outside the dead zone the spring coefficient scales with how far out the drone is,
  // so small wanders feel soft and sudden jolts get smooth exponential pursuit.
  const followTick = useCallback(() => {
    if (!followingRef.current) {
      animFrameRef.current = null
      return
    }

    const map = mapRef.current?.getMap()
    const drone = droneRef.current

    if (map && drone) {
      const el = map.getContainer()
      const cx = el.clientWidth / 2
      const cy = el.clientHeight / 2
      const pt = map.project([drone.lon, drone.lat])
      const dist = Math.sqrt((pt.x - cx) ** 2 + (pt.y - cy) ** 2)
      const DEAD_ZONE = 80

      if (dist > DEAD_ZONE) {
        const center = map.getCenter()
        // Coefficient grows from 0 at the dead-zone edge to ~0.05 well outside it
        const t = 0.05 * (1 - DEAD_ZONE / dist)
        map.setCenter({
          lng: center.lng + (drone.lon - center.lng) * t,
          lat: center.lat + (drone.lat - center.lat) * t,
        })
      }
    }

    animFrameRef.current = requestAnimationFrame(followTick)
  }, [])

  // Start/stop the rAF loop in sync with React state
  useEffect(() => {
    followingRef.current = following
    if (following) {
      if (animFrameRef.current === null) {
        animFrameRef.current = requestAnimationFrame(followTick)
      }
    } else {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current)
        animFrameRef.current = null
      }
    }
  }, [following, followTick])

  useEffect(() => {
    return () => {
      if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current)
      if (followTimeoutRef.current !== null) clearTimeout(followTimeoutRef.current)
    }
  }, [])

  const handleClick = useCallback((e: MapMouseEvent) => {
    const id = `POI-${String(Date.now()).slice(-4)}`
    addPoi({ id, lat: e.lngLat.lat, lon: e.lngLat.lng, alt: 80, loiter_radius: settings.loiterRadius, dwell_seconds: 60 })
  }, [addPoi, settings.loiterRadius])

  const handleRecentre = useCallback(() => {
    if (!telemetry) return
    if (followTimeoutRef.current) clearTimeout(followTimeoutRef.current)
    setFollowing(false)
    mapRef.current?.getMap().flyTo({
      center: [telemetry.position.lon, telemetry.position.lat],
      zoom: 15,
      duration: 900,
    })
    followTimeoutRef.current = setTimeout(() => setFollowing(true), 950)
  }, [telemetry])

  const path = buildMissionPath(pois, settings.arcMode)

  const pathGeoJson = {
    type: 'FeatureCollection' as const,
    features: path.length > 1 ? [{
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: path.map(p => [p.lon, p.lat]) },
    }] : [],
  }

  const circlesGeoJson = {
    type: 'FeatureCollection' as const,
    features: pois.map(poi => ({
      type: 'Feature' as const,
      properties: { id: poi.id },
      geometry: { type: 'Polygon' as const, coordinates: [circlePolygon(poi.lat, poi.lon, poi.loiter_radius)] },
    })),
  }

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

        <Source id="path" type="geojson" data={pathGeoJson}>
          <Layer
            id="path-line"
            type="line"
            paint={{ 'line-color': '#e0e0e0', 'line-width': 2, 'line-opacity': 0.85 }}
          />
        </Source>

        <Source id="circles" type="geojson" data={circlesGeoJson}>
          <Layer
            id="circles-fill"
            type="fill"
            paint={{ 'fill-color': '#555', 'fill-opacity': 0.04 }}
          />
          <Layer
            id="circles-line"
            type="line"
            paint={{ 'line-color': '#555', 'line-width': 1, 'line-opacity': 0.7 }}
          />
        </Source>

        {pois.map((poi, idx) => (
          <Marker key={`m-${poi.id}`} latitude={poi.lat} longitude={poi.lon} anchor="center">
            <div style={{ position: 'relative', pointerEvents: 'none' }}>
              <div style={{
                width: 8, height: 8,
                background: '#666',
                border: '1px solid #c8c8c8',
                borderRadius: '50%',
              }} />
              <div style={{
                position: 'absolute',
                top: -13,
                left: '50%',
                transform: 'translateX(-50%)',
                fontSize: 9,
                lineHeight: 1,
                color: '#c8c8c8',
                fontFamily: 'monospace',
                whiteSpace: 'nowrap',
                letterSpacing: 0,
              }}>
                {idx + 1}
              </div>
            </div>
          </Marker>
        ))}

        {telemetry && (
          <Marker latitude={telemetry.position.lat} longitude={telemetry.position.lon} anchor="center">
            <div style={{
              width: 12, height: 12,
              background: '#c8c8c8',
              border: '2px solid #0d0f0e',
              borderRadius: '50%',
              boxShadow: '0 0 6px rgba(200,200,200,0.6)',
              pointerEvents: 'none',
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
    </div>
  )
}
