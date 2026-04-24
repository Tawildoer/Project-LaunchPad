export interface Telemetry {
  timestamp: number
  armed: boolean
  mode: string
  position: {
    lat: number
    lon: number
    alt_msl: number
    alt_rel: number
  }
  attitude: {
    roll: number
    pitch: number
    yaw: number
  }
  velocity: {
    ground_speed: number
    air_speed: number
    climb_rate: number
  }
  battery: {
    voltage: number
    current: number
    remaining_pct: number
  }
  gps: {
    fix_type: number
    satellites_visible: number
  }
  mission?: {
    current_item: number
    total_items: number
    active_poi_id: string | null
  }
}

export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected'

export type IdleMode = 'LOITER' | 'QLOITER'

export interface POI {
  id: string
  lat: number
  lon: number
  alt: number
  loiter_radius: number
  dwell_seconds: number
  arc_mode: 'cw' | 'ccw' | 'short' | 'long'
}

export interface WsMessage<T = unknown> {
  type:
    | 'telemetry'
    | 'command'
    | 'mission_update'
    | 'connection_status'
    | 'video_signal'
    | 'copilot_request'
    | 'copilot_response'
  payload: T
}

export interface CopilotResponse {
  response_type: 'answer' | 'clarification' | 'confirmation_required' | 'executed'
  text: string
  pending_command?: unknown
}

export interface ConnectionStatusPayload {
  drone_id: string
  status: ConnectionStatus
}
