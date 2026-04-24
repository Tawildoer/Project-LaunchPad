import { useState, useEffect, useCallback } from 'react'
import { MapContainer, TileLayer, Marker, Circle, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import { useTelemetry } from '../store/TelemetryContext'
import { useMission } from '../store/MissionContext'
import { catmullRomSpline } from '../lib/pathPlanning'

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const droneIcon = L.divIcon({
  className: '',
  html: `<div style="
    width:12px;height:12px;
    background:#39ff14;
    border:2px solid #0d0f0e;
    border-radius:50%;
    box-shadow:0 0 6px #39ff14;
  "></div>`,
  iconSize: [12, 12],
  iconAnchor: [6, 6],
})

const poiIcon = L.divIcon({
  className: '',
  html: `<div style="
    width:8px;height:8px;
    background:#4a9e5c;
    border:1px solid #39ff14;
    border-radius:50%;
  "></div>`,
  iconSize: [8, 8],
  iconAnchor: [4, 4],
})

const SATELLITE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const VECTOR_URL    = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
const ATTRIBUTION   = '© OpenStreetMap contributors © CARTO'

type TileLayerType = 'satellite' | 'vector'

function LiveDroneMarker() {
  const { telemetry } = useTelemetry()
  if (!telemetry) return null
  const { lat, lon } = telemetry.position
  return <Marker position={[lat, lon]} icon={droneIcon} />
}

function MapClickHandler({ onMapClick }: { onMapClick: (lat: number, lon: number) => void }) {
  const map = useMap()
  useEffect(() => {
    const handler = (e: L.LeafletMouseEvent) => onMapClick(e.latlng.lat, e.latlng.lng)
    map.on('click', handler)
    return () => { map.off('click', handler) }
  }, [map, onMapClick])
  return null
}

function MissionOverlay() {
  const { pois } = useMission()
  if (pois.length === 0) return null

  const spline = catmullRomSpline(
    pois.map((p) => ({ lat: p.lat, lon: p.lon })),
    20,
  )

  return (
    <>
      {spline.length > 1 && (
        <Polyline
          positions={spline.map((p) => [p.lat, p.lon] as [number, number])}
          pathOptions={{ color: '#39ff14', weight: 1.5, opacity: 0.7, dashArray: '4 4' }}
        />
      )}
      {pois.map((poi) => (
        <Circle
          key={poi.id}
          center={[poi.lat, poi.lon]}
          radius={poi.loiter_radius}
          pathOptions={{ color: '#4a9e5c', weight: 1, fillOpacity: 0.08 }}
        />
      ))}
      {pois.map((poi) => (
        <Marker key={`m-${poi.id}`} position={[poi.lat, poi.lon]} icon={poiIcon} />
      ))}
    </>
  )
}

export default function MapPanel() {
  const { telemetry } = useTelemetry()
  const { addPoi } = useMission()
  const [tileLayer, setTileLayer] = useState<TileLayerType>('satellite')

  const initialCenter: [number, number] = telemetry
    ? [telemetry.position.lat, telemetry.position.lon]
    : [51.505, -0.09]

  const handleMapClick = useCallback(
    (lat: number, lon: number) => {
      const id = `POI-${String(Date.now()).slice(-4)}`
      addPoi({ id, lat, lon, alt: 80, loiter_radius: 100, dwell_seconds: 60 })
    },
    [addPoi],
  )

  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <MapContainer
        center={initialCenter}
        zoom={14}
        style={{ height: '100%', width: '100%' }}
        zoomControl={true}
      >
        <TileLayer
          url={tileLayer === 'satellite' ? SATELLITE_URL : VECTOR_URL}
          attribution={ATTRIBUTION}
          maxZoom={19}
        />
        <LiveDroneMarker />
        <MissionOverlay />
        <MapClickHandler onMapClick={handleMapClick} />
      </MapContainer>

      <div className="tile-toggle">
        <button
          className={tileLayer === 'satellite' ? 'active' : ''}
          onClick={() => setTileLayer('satellite')}
        >
          SAT
        </button>
        <button
          className={tileLayer === 'vector' ? 'active' : ''}
          onClick={() => setTileLayer('vector')}
        >
          VEC
        </button>
      </div>
    </div>
  )
}
