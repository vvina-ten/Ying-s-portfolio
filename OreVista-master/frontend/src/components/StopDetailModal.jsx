import { useEffect, useRef } from 'react'

// ─── Tier classification ────────────────────────────────────────────────────
function getTier(nsv) {
  if (nsv >= 5e6)  return { tier: 1, label: 'Tier 1',  color: '#f59e0b', desc: 'High-value target'  }
  if (nsv >= 1e6)  return { tier: 2, label: 'Tier 2',  color: '#10b981', desc: 'Solid economic stope' }
  if (nsv >  0)    return { tier: 3, label: 'Tier 3',  color: '#60a5fa', desc: 'Marginal — monitor'   }
  return               { tier: 0, label: 'Sub-econ', color: '#6b7280', desc: 'Below breakeven'       }
}

// ─── Percentile helper ───────────────────────────────────────────────────────
function pct(allStopes, key, value) {
  const vals = allStopes.map(s => s[key] ?? 0).sort((a, b) => a - b)
  const below = vals.filter(v => v < value).length
  return Math.round((below / vals.length) * 100)
}

// ─── Economic waterfall (canvas) ─────────────────────────────────────────────
function WaterfallChart({ stope }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr  = window.devicePixelRatio || 1
    const W = canvas.offsetWidth, H = canvas.offsetHeight
    canvas.width  = W * dpr
    canvas.height = H * dpr
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)

    const gross = stope.gross_revenue_usd || 0
    if (gross <= 0) { ctx.fillStyle = '#4b5563'; ctx.font = '11px Inter'; ctx.fillText('No revenue data', 10, H / 2); return }

    const steps = [
      { label: 'Gross Revenue',  value: gross,                          color: '#4ade80', deduction: false },
      { label: '− Royalty',      value: stope.royalty_usd || 0,         color: '#f87171', deduction: true  },
      { label: '− Mining',       value: stope.mining_cost_usd || 0,     color: '#fb923c', deduction: true  },
      { label: '− Processing',   value: stope.processing_cost_usd || 0, color: '#fbbf24', deduction: true  },
      { label: '− Refining',     value: stope.refining_cost_usd || 0,   color: '#a78bfa', deduction: true  },
      { label: '− G&A',          value: stope.ga_cost_usd || 0,         color: '#94a3b8', deduction: true  },
      { label: '− Sust. CapEx',  value: stope.sustaining_cost_usd || 0, color: '#64748b', deduction: true  },
      { label: 'Net NSR',        value: Math.max(0, stope.nsv_usd || 0),color: '#4ade80', deduction: false },
    ]

    const pad = { top: 10, bottom: 30, left: 90, right: 10 }
    const cw = W - pad.left - pad.right
    const ch = H - pad.top  - pad.bottom

    ctx.clearRect(0, 0, W, H)

    // Grid
    ctx.strokeStyle = '#1f2937'; ctx.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + ch * i / 4
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cw, y); ctx.stroke()
    }

    const barH   = Math.max(4, ch / steps.length - 4)
    const maxVal = gross
    const xScale = v => (v / maxVal) * cw

    // Axis labels (right side $ values)
    ctx.font = '9px JetBrains Mono, monospace'
    ctx.textAlign = 'right'

    steps.forEach((step, idx) => {
      const y = pad.top + idx * (ch / steps.length) + (ch / steps.length - barH) / 2

      // Row label
      ctx.fillStyle = step.deduction ? '#6b7280' : '#d1d5db'
      ctx.textAlign = 'right'
      ctx.fillText(step.label, pad.left - 5, y + barH / 2 + 3)

      // Bar
      const w = xScale(step.value)
      if (!step.deduction) {
        // Solid bar for revenue/NSR
        ctx.fillStyle = step.color + (step.label === 'Net NSR' ? 'cc' : '55')
        ctx.fillRect(pad.left, y, w, barH)
        ctx.strokeStyle = step.color
        ctx.lineWidth = 1.5
        ctx.strokeRect(pad.left, y, w, barH)
      } else {
        // Deduction: draw from left, filled
        ctx.fillStyle = step.color + '55'
        ctx.fillRect(pad.left, y, w, barH)
        ctx.strokeStyle = step.color + '88'
        ctx.lineWidth = 1
        ctx.strokeRect(pad.left, y, w, barH)
      }

      // Value label on bar
      ctx.fillStyle = '#d1d5db'
      ctx.textAlign = 'left'
      const label = step.value >= 1e6
        ? '$' + (step.value / 1e6).toFixed(1) + 'M'
        : '$' + (step.value / 1000).toFixed(0) + 'k'
      ctx.fillText(label, pad.left + w + 4, y + barH / 2 + 3)
    })
  }, [stope])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: 220, display: 'block' }}
    />
  )
}

// ─── Recovery chain ───────────────────────────────────────────────────────────
function RecoveryChain({ stope }) {
  const gold    = stope.contained_oz ?? stope.gold_oz ?? 0
  const rec     = stope.recovered_oz ?? 0
  const dilPct  = stope.dilution_pct ?? 0

  // Approximate chain (exact values not stored per-stope, so derive from totals)
  const afterDil  = gold * (1 - dilPct / 100)
  const steps = [
    { label: 'In-situ',          oz: gold,     pct: 100,                          color: '#f59e0b' },
    { label: 'After dilution',   oz: afterDil, pct: Math.round(100 - dilPct),     color: '#fbbf24' },
    { label: 'Recovered (mill)', oz: rec,      pct: Math.round(rec / gold * 100), color: '#4ade80' },
  ]

  const maxOz = gold

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {steps.map(({ label, oz, pct: p, color }) => (
        <div key={label}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ fontSize: '0.68rem', color: '#9ca3af' }}>{label}</span>
            <span style={{ fontSize: '0.68rem', fontFamily: 'var(--mono)', color }}>
              {oz.toLocaleString(undefined, { maximumFractionDigits: 0 })} oz &nbsp;
              <span style={{ color: '#4b5563' }}>({p}%)</span>
            </span>
          </div>
          <div style={{ background: '#1f2937', borderRadius: 3, height: 7 }}>
            <div style={{
              width: `${(oz / maxOz) * 100}%`, height: '100%',
              background: color, borderRadius: 3, transition: 'width 0.4s ease',
            }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Main Modal ──────────────────────────────────────────────────────────────
export default function StopDetailModal({ stope, allStopes, onClose }) {
  if (!stope) return null

  const tier     = getTier(stope.nsv_usd ?? 0)
  const gradeRank   = pct(allStopes, 'head_grade',   stope.head_grade   ?? stope.avg_grade ?? 0)
  const nsrRank     = pct(allStopes, 'nsv_usd',      stope.nsv_usd      ?? 0)
  const goldRank    = pct(allStopes, 'contained_oz', stope.contained_oz ?? stope.gold_oz ?? 0)

  const W = 20, H = 30, D = 5  // stope dims for schematic

  return (
    <div
      onPointerUp={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div style={{
        background: '#111827', border: '1px solid #1f2937',
        borderRadius: 10, width: '100%', maxWidth: 720,
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
      }}>

        {/* ── Header ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: '1px solid #1f2937',
          background: '#0d1117', borderRadius: '10px 10px 0 0',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: '1rem', fontWeight: 700, color: '#f3f4f6', fontFamily: 'var(--mono)' }}>
              {stope.stope_id}
            </span>
            <span style={{
              background: tier.color + '22', border: `1px solid ${tier.color}`,
              borderRadius: 5, padding: '2px 9px',
              fontSize: '0.72rem', fontWeight: 700, color: tier.color,
            }}>
              {tier.label}
            </span>
            <span style={{ fontSize: '0.72rem', color: '#4b5563' }}>{tier.desc}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '0.72rem', color: '#6b7280', fontFamily: 'var(--mono)' }}>
              {stope.level_name ?? `${stope.level_z} m`}
            </span>
            <button
              onPointerUp={onClose}
              style={{
                background: 'none', border: '1px solid #374151', borderRadius: 5,
                color: '#6b7280', cursor: 'pointer', fontSize: '0.8rem',
                padding: '3px 9px', lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>
        </div>

        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* ── Row 1: Location + Geometry ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

            {/* Location */}
            <div style={{ background: '#0d1117', border: '1px solid #1f2937', borderRadius: 7, padding: '10px 12px' }}>
              <div style={{ fontSize: '0.6rem', color: '#4b5563', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
                World Coordinates (centroid)
              </div>
              {[
                { l: 'Easting',   v: stope.easting,  u: 'm E' },
                { l: 'Northing',  v: stope.northing, u: 'm N' },
                { l: 'RL',        v: stope.rl,       u: 'm RL' },
              ].map(({ l, v, u }) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontSize: '0.7rem', color: '#6b7280' }}>{l}</span>
                  <span style={{ fontSize: '0.7rem', fontFamily: 'var(--mono)', color: '#60a5fa' }}>
                    {v?.toFixed(1) ?? '—'} <span style={{ color: '#374151' }}>{u}</span>
                  </span>
                </div>
              ))}
              <div style={{ borderTop: '1px solid #1f2937', marginTop: 6, paddingTop: 6 }}>
                <div style={{ fontSize: '0.6rem', color: '#374151' }}>
                  Bounds: E {stope.x_min?.toFixed(0)}–{stope.x_max?.toFixed(0)} ·
                  N {stope.y_min?.toFixed(0)}–{stope.y_max?.toFixed(0)} ·
                  RL {stope.z_min?.toFixed(0)}–{stope.z_max?.toFixed(0)}
                </div>
              </div>
            </div>

            {/* Geometry schematic */}
            <div style={{ background: '#0d1117', border: '1px solid #1f2937', borderRadius: 7, padding: '10px 12px' }}>
              <div style={{ fontSize: '0.6rem', color: '#4b5563', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
                Stope Geometry
              </div>
              {/* Simple isometric SVG schematic */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <svg viewBox="0 0 100 80" style={{ width: 90, flexShrink: 0 }}>
                  {/* Isometric box */}
                  <polygon points="10,40 50,20 90,40 50,60" fill="#1f2937" stroke="#374151" strokeWidth="1"/>
                  <polygon points="50,20 90,40 90,60 50,40" fill="#111827" stroke="#374151" strokeWidth="1"/>
                  <polygon points="10,40 50,60 50,75 10,55" fill="#0d1117" stroke="#374151" strokeWidth="1"/>
                  {/* Gold accent */}
                  <polygon points="10,40 50,20 90,40 50,60" fill="#f59e0b" fillOpacity="0.08" stroke="#f59e0b" strokeWidth="0.8"/>
                  {/* Dimension labels */}
                  <text x="50" y="13" textAnchor="middle" fill="#6b7280" fontSize="7" fontFamily="monospace">20 m</text>
                  <text x="96" y="50" fill="#6b7280" fontSize="7" fontFamily="monospace">5 m</text>
                  <text x="3" y="50" fill="#6b7280" fontSize="7" fontFamily="monospace">30</text>
                  <text x="3" y="58" fill="#6b7280" fontSize="7" fontFamily="monospace">m</text>
                </svg>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.68rem' }}>
                  {[
                    { l: 'Strike',  v: `${W} m`, c: '#f59e0b' },
                    { l: 'Height',  v: `${H} m`, c: '#60a5fa' },
                    { l: 'Width',   v: `${D} m`,  c: '#10b981' },
                    { l: 'Volume',  v: `${stope.volume?.toLocaleString() ?? 3000} m³`, c: '#9ca3af' },
                    { l: 'Density', v: `${stope.avg_density?.toFixed(2) ?? '—'} t/m³`, c: '#6b7280' },
                  ].map(({ l, v, c }) => (
                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <span style={{ color: '#4b5563' }}>{l}</span>
                      <span style={{ color: c, fontFamily: 'var(--mono)', fontWeight: 600 }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── Row 2: Tonnage + Grade/Metal ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

            {/* Tonnage breakdown */}
            <div style={{ background: '#0d1117', border: '1px solid #1f2937', borderRadius: 7, padding: '10px 12px' }}>
              <div style={{ fontSize: '0.6rem', color: '#4b5563', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
                Tonnage Breakdown
              </div>
              {/* Stacked bar */}
              {(() => {
                const total = stope.tonnes ?? 1
                const ore   = stope.ore_tonnes ?? 0
                const waste = stope.waste_tonnes ?? 0
                const orePct  = ore   / total * 100
                const wastePct = waste / total * 100
                return (
                  <>
                    <div style={{ display: 'flex', height: 18, borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
                      <div style={{ width: `${orePct}%`,   background: '#10b981', transition: 'width 0.4s' }} title={`Ore: ${orePct.toFixed(1)}%`} />
                      <div style={{ width: `${wastePct}%`, background: '#f59e0b', transition: 'width 0.4s' }} title={`Waste: ${wastePct.toFixed(1)}%`} />
                    </div>
                    <div style={{ display: 'flex', gap: 14, fontSize: '0.68rem', marginBottom: 8 }}>
                      <span><span style={{ color: '#10b981' }}>■</span> <span style={{ color: '#6b7280' }}>Ore</span></span>
                      <span><span style={{ color: '#f59e0b' }}>■</span> <span style={{ color: '#6b7280' }}>Waste/Dilution</span></span>
                    </div>
                    {[
                      { l: 'Total Mined',   v: total.toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' t', c: '#9ca3af' },
                      { l: 'Ore Tonnes',    v: ore.toLocaleString(undefined,   { maximumFractionDigits: 0 }) + ' t', c: '#10b981' },
                      { l: 'Dilution Waste',v: waste.toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' t', c: '#f59e0b' },
                      { l: 'Dilution %',    v: (stope.dilution_pct ?? 0).toFixed(1) + '%',                           c: '#f59e0b' },
                    ].map(({ l, v, c }) => (
                      <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: '0.68rem', color: '#6b7280' }}>{l}</span>
                        <span style={{ fontSize: '0.68rem', fontFamily: 'var(--mono)', fontWeight: 600, color: c }}>{v}</span>
                      </div>
                    ))}
                  </>
                )
              })()}
            </div>

            {/* Grade & metal */}
            <div style={{ background: '#0d1117', border: '1px solid #1f2937', borderRadius: 7, padding: '10px 12px' }}>
              <div style={{ fontSize: '0.6rem', color: '#4b5563', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
                Grade &amp; Metal Recovery Chain
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                  <span style={{ fontSize: '0.7rem', color: '#6b7280' }}>Head Grade</span>
                  <span style={{ fontSize: '1rem', fontFamily: 'var(--mono)', fontWeight: 700, color: '#f59e0b' }}>
                    {(stope.head_grade ?? stope.avg_grade ?? 0).toFixed(2)} g/t Au
                  </span>
                </div>
              </div>
              <RecoveryChain stope={stope} />
            </div>
          </div>

          {/* ── Row 3: Economic Waterfall ── */}
          <div style={{ background: '#0d1117', border: '1px solid #1f2937', borderRadius: 7, padding: '10px 12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <div style={{ fontSize: '0.6rem', color: '#4b5563', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                Economic Waterfall (NSR Decomposition)
              </div>
              <span style={{ fontSize: '0.72rem', color: stope.nsv_usd >= 0 ? '#4ade80' : '#f87171', fontFamily: 'var(--mono)', fontWeight: 700 }}>
                Net NSR: {stope.nsv_usd != null ? '$' + (stope.nsv_usd / 1e6).toFixed(2) + 'M' : '—'}
              </span>
            </div>
            {stope.gross_revenue_usd
              ? <WaterfallChart stope={stope} />
              : <div style={{ fontSize: '0.72rem', color: '#4b5563', padding: '20px 0', textAlign: 'center' }}>
                  Run with NSR mode enabled to see economic breakdown
                </div>
            }
          </div>

          {/* ── Row 4: Fleet Rankings ── */}
          <div style={{ background: '#0d1117', border: '1px solid #1f2937', borderRadius: 7, padding: '10px 12px' }}>
            <div style={{ fontSize: '0.6rem', color: '#4b5563', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
              Fleet Ranking (vs {allStopes.length.toLocaleString()} stopes)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {[
                { label: 'Head Grade',   rank: gradeRank, value: (stope.head_grade ?? stope.avg_grade ?? 0).toFixed(2) + ' g/t', color: '#f59e0b' },
                { label: 'Total NSR',    rank: nsrRank,   value: stope.nsv_usd != null ? '$' + (stope.nsv_usd / 1e6).toFixed(2) + 'M' : '—', color: '#4ade80' },
                { label: 'Contained Au', rank: goldRank,  value: (stope.contained_oz ?? stope.gold_oz ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' oz', color: '#f59e0b' },
              ].map(({ label, rank, value, color }) => {
                const rankColor = rank >= 80 ? '#4ade80' : rank >= 50 ? '#f59e0b' : '#9ca3af'
                return (
                  <div key={label} style={{
                    background: '#111827', border: '1px solid #1f2937', borderRadius: 6,
                    padding: '8px 10px', textAlign: 'center',
                  }}>
                    <div style={{ fontSize: '0.6rem', color: '#4b5563', marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: '0.88rem', fontFamily: 'var(--mono)', fontWeight: 700, color, marginBottom: 6 }}>{value}</div>
                    {/* Rank bar */}
                    <div style={{ background: '#1f2937', borderRadius: 2, height: 4, marginBottom: 4 }}>
                      <div style={{ width: `${rank}%`, height: '100%', background: rankColor, borderRadius: 2 }} />
                    </div>
                    <div style={{ fontSize: '0.62rem', color: rankColor }}>
                      Top {100 - rank}% · P{rank}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
