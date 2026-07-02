import { useEffect, useState, useRef } from 'react'

/**
 * Grade-Tonnage Curve — shows how cutoff grade affects:
 *   - Total mineable tonnes (descending)
 *   - Average stope WAG (ascending)
 *   - Contained gold (descending)
 *
 * Vertical line shows currently selected cutoff.
 */
export default function GradeTonnageCurve({ cutoff = 10, currentStopes = 0 }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)
  const canvasRef = useRef(null)

  useEffect(() => {
    setLoading(true)
    fetch('/api/grade-tonnage?steps=40')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!data || !canvasRef.current) return
    draw(canvasRef.current, data.data, cutoff)
  }, [data, cutoff])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 16, gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#f3f4f6' }}>
            Grade–Tonnage Sensitivity
          </div>
          <div style={{ fontSize: '0.68rem', color: '#6b7280', marginTop: 2 }}>
            How cutoff grade selection affects resource size and grade
          </div>
        </div>
        {loading && <span className="spinner" style={{ width: 14, height: 14 }} />}
      </div>

      {data ? (
        <>
          <canvas
            ref={canvasRef}
            style={{ width: '100%', flex: 1, display: 'block' }}
          />
          <Legend cutoff={cutoff} data={data.data} />
        </>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4b5563', fontSize: '0.8rem' }}>
          {loading ? 'Loading…' : 'No data'}
        </div>
      )}
    </div>
  )
}

function Legend({ cutoff, data }) {
  // Find entry closest to current cutoff
  const entry = data?.reduce((best, d) =>
    Math.abs(d.cutoff - cutoff) < Math.abs(best.cutoff - cutoff) ? d : best
  , data[0])
  if (!entry) return null
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: '0.7rem' }}>
      {[
        { label: 'At cutoff',    value: `${cutoff} g/t`,                  color: '#f59e0b' },
        { label: 'Positions',    value: entry.positions?.toLocaleString(), color: '#9ca3af' },
        { label: 'Tonnes',       value: `${entry.tonnes_mt} Mt`,           color: '#10b981' },
        { label: 'Gold',         value: `${(entry.gold_moz * 1000).toFixed(0)} koz`, color: '#f59e0b' },
        { label: 'Avg WAG',      value: `${entry.avg_grade} g/t`,          color: '#60a5fa' },
      ].map(({ label, value, color }) => (
        <div key={label} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
          <span style={{ color: '#6b7280' }}>{label}:</span>
          <span style={{ color, fontFamily: 'monospace', fontWeight: 600 }}>{value}</span>
        </div>
      ))}
    </div>
  )
}

function draw(canvas, data, cutoff) {
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  canvas.width  = rect.width  * dpr
  canvas.height = rect.height * dpr
  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)

  const W = rect.width, H = rect.height
  const pad = { top: 16, right: 60, bottom: 36, left: 56 }
  const cw = W - pad.left - pad.right
  const ch = H - pad.top  - pad.bottom

  ctx.clearRect(0, 0, W, H)

  // ── data range ──────────────────────────────────────────
  const maxT  = Math.max(...data.map(d => d.tonnes_mt))
  const maxG  = Math.max(...data.map(d => d.avg_grade))
  const maxCo = data[data.length - 1].cutoff
  const minCo = data[0].cutoff

  const xScale  = v => pad.left + ((v - minCo) / (maxCo - minCo || 1)) * cw
  const yLeft   = v => pad.top  + ch - (v / maxT) * ch        // tonnes axis (green)
  const yRight  = v => pad.top  + ch - (v / maxG) * ch        // grade axis  (blue)

  // ── grid ───────────────────────────────────────────────
  ctx.strokeStyle = '#1f2937'
  ctx.lineWidth = 1
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (ch / 4) * i
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cw, y); ctx.stroke()
  }
  for (let i = 0; i <= 5; i++) {
    const x = pad.left + (cw / 5) * i
    ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + ch); ctx.stroke()
  }

  // ── tonnes line (green) ─────────────────────────────────
  ctx.beginPath()
  ctx.strokeStyle = '#10b981'
  ctx.lineWidth = 2
  data.forEach((d, i) => {
    const x = xScale(d.cutoff), y = yLeft(d.tonnes_mt)
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  })
  ctx.stroke()

  // ── avg grade line (blue) ───────────────────────────────
  ctx.beginPath()
  ctx.strokeStyle = '#60a5fa'
  ctx.lineWidth = 2
  data.forEach((d, i) => {
    const x = xScale(d.cutoff), y = yRight(d.avg_grade)
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  })
  ctx.stroke()

  // ── cutoff vertical line ────────────────────────────────
  const cx = xScale(cutoff)
  ctx.beginPath()
  ctx.strokeStyle = '#f59e0b'
  ctx.lineWidth = 1.5
  ctx.setLineDash([4, 3])
  ctx.moveTo(cx, pad.top); ctx.lineTo(cx, pad.top + ch)
  ctx.stroke()
  ctx.setLineDash([])

  // ── axes labels ─────────────────────────────────────────
  ctx.font = '10px JetBrains Mono, monospace'
  ctx.fillStyle = '#6b7280'
  ctx.textAlign = 'center'

  // X axis ticks
  for (let i = 0; i <= 5; i++) {
    const v = minCo + (maxCo - minCo) * i / 5
    const x = pad.left + cw * i / 5
    ctx.fillText(v.toFixed(1), x, pad.top + ch + 14)
  }
  ctx.fillStyle = '#4b5563'
  ctx.fillText('Cutoff Grade (g/t)', pad.left + cw / 2, H - 4)

  // Left Y axis (tonnes)
  ctx.fillStyle = '#10b981'
  ctx.textAlign = 'right'
  for (let i = 0; i <= 4; i++) {
    const v = maxT * (1 - i / 4)
    const y = pad.top + ch * i / 4
    ctx.fillText(v.toFixed(0) + ' Mt', pad.left - 5, y + 4)
  }

  // Right Y axis (grade)
  ctx.fillStyle = '#60a5fa'
  ctx.textAlign = 'left'
  for (let i = 0; i <= 4; i++) {
    const v = maxG * (1 - i / 4)
    const y = pad.top + ch * i / 4
    ctx.fillText(v.toFixed(1) + ' g/t', pad.left + cw + 5, y + 4)
  }

  // Legend labels
  ctx.font = '9px JetBrains Mono, monospace'
  ctx.fillStyle = '#10b981'; ctx.textAlign = 'left'
  ctx.fillText('── Tonnes', pad.left + 6, pad.top + 12)
  ctx.fillStyle = '#60a5fa'
  ctx.fillText('── Avg WAG', pad.left + 80, pad.top + 12)
  ctx.fillStyle = '#f59e0b'
  ctx.fillText(`┆ Cutoff=${cutoff}`, pad.left + 165, pad.top + 12)
}
