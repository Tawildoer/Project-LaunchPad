import { useState } from 'react'
import { demoState } from '../mocks/demoState'

export default function DemoToolbar() {
  const [speed, setSpeed] = useState(demoState.speedMs)
  const [wind, setWind]   = useState(demoState.windStrength)

  const onSpeed = (v: number) => { setSpeed(v); demoState.speedMs = v }
  const onWind  = (v: number) => { setWind(v);  demoState.windStrength = v }

  return (
    <div className="demo-toolbar">
      <span className="demo-tag">DEMO</span>
      <div className="demo-control">
        <span>SPD</span>
        <input
          type="range" min={2} max={100} step={1} value={speed}
          onChange={e => onSpeed(Number(e.target.value))}
        />
        <span className="demo-value">{speed}m/s</span>
      </div>
      <div className="demo-control">
        <span>WIND</span>
        <input
          type="range" min={0} max={20} step={1} value={wind}
          onChange={e => onWind(Number(e.target.value))}
        />
        <span className="demo-value">{wind > 0 ? `${wind}m/s` : 'OFF'}</span>
      </div>
    </div>
  )
}
