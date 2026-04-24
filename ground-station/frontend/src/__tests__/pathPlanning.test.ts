import { describe, it, expect } from 'vitest'
import { catmullRomSpline, type LatLon } from '../lib/pathPlanning'

describe('catmullRomSpline', () => {
  it('returns empty array for fewer than 2 points', () => {
    expect(catmullRomSpline([{ lat: 0, lon: 0 }], 10)).toEqual([])
    expect(catmullRomSpline([], 10)).toEqual([])
  })

  it('interpolates through all input points', () => {
    const pts: LatLon[] = [
      { lat: 0, lon: 0 },
      { lat: 1, lon: 1 },
      { lat: 2, lon: 0 },
    ]
    const result = catmullRomSpline(pts, 20)
    const first = result[0]
    const last  = result[result.length - 1]
    expect(first.lat).toBeCloseTo(0, 1)
    expect(first.lon).toBeCloseTo(0, 1)
    expect(last.lat).toBeCloseTo(2, 1)
    expect(last.lon).toBeCloseTo(0, 1)
  })

  it('produces more points than input', () => {
    const pts: LatLon[] = [
      { lat: 0, lon: 0 },
      { lat: 1, lon: 1 },
      { lat: 2, lon: 0 },
    ]
    expect(catmullRomSpline(pts, 20).length).toBeGreaterThan(pts.length)
  })
})
