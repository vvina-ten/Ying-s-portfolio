import React, { useState, useEffect, useRef } from 'react'

const NSV_SLIDER_MAX = 20  // $M — dragging max thumb to 20 means "no cap"

function DualRangeSlider({ valueMin, valueMax, onChangeMin, onChangeMax }) {
  const trackRef = useRef(null)
  // valueMax = 0 means "no cap" — display as NSV_SLIDER_MAX
  const dispMax = valueMax === 0 ? NSV_SLIDER_MAX : Math.min(valueMax, NSV_SLIDER_MAX)
  const pctMin  = (valueMin / NSV_SLIDER_MAX) * 100
  const pctMax  = (dispMax  / NSV_SLIDER_MAX) * 100
  const noLimit = valueMax === 0

  const snap = v => Math.round(v * 10) / 10  // 0.1 step

  const clientToValue = clientX => {
    const rect = trackRef.current.getBoundingClientRect()
    const pct  = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return snap(pct * NSV_SLIDER_MAX)
  }

  const startDrag = which => e => {
    e.preventDefault()
    const move = ev => {
      const cx = ev.touches ? ev.touches[0].clientX : ev.clientX
      const v  = clientToValue(cx)
      if (which === 'min') {
        onChangeMin(Math.max(0, Math.min(v, dispMax - 0.1)))
      } else {
        const clamped = Math.max(v, valueMin + 0.1)
        // At the far right → "no cap"
        onChangeMax(clamped >= NSV_SLIDER_MAX - 0.05 ? 0 : clamped)
      }
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup',  up)
      window.removeEventListener('touchmove', move)
      window.removeEventListener('touchend',  up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup',  up)
    window.addEventListener('touchmove', move)
    window.addEventListener('touchend',  up)
  }

  const color = '#4ade80'
  const TICKS = [0, 5, 10, 15, 20]

  return (
    <div style={{ padding: '4px 2px' }}>
      {/* Track area */}
      <div ref={trackRef} style={{ position: 'relative', height: 30, userSelect: 'none', cursor: 'default' }}>
        {/* Base track */}
        <div style={{
          position: 'absolute', top: '50%', left: 0, right: 0,
          transform: 'translateY(-50%)', height: 4,
          background: '#1f2937', borderRadius: 2,
        }} />
        {/* Active fill */}
        <div style={{
          position: 'absolute', top: '50%',
          left: `${pctMin}%`, width: `${pctMax - pctMin}%`,
          transform: 'translateY(-50%)', height: 4,
          background: color, borderRadius: 2,
          opacity: noLimit ? 0.45 : 1,
          transition: 'opacity 0.15s',
        }} />
        {/* Tick marks */}
        {TICKS.map(t => (
          <div key={t} style={{
            position: 'absolute', top: 'calc(50% + 6px)',
            left: `${(t / NSV_SLIDER_MAX) * 100}%`,
            transform: 'translateX(-50%)',
            width: 1, height: 4, background: '#2d3748',
          }} />
        ))}
        {/* Min thumb */}
        <div onMouseDown={startDrag('min')} onTouchStart={startDrag('min')}
          style={{
            position: 'absolute', top: '50%', left: `${pctMin}%`,
            transform: 'translate(-50%, -50%)',
            width: 16, height: 16, borderRadius: '50%',
            background: color, border: '2px solid #0a0e1a',
            cursor: 'grab', zIndex: 3,
            boxShadow: `0 0 0 3px ${color}33`,
          }}
        />
        {/* Max thumb */}
        <div onMouseDown={startDrag('max')} onTouchStart={startDrag('max')}
          style={{
            position: 'absolute', top: '50%', left: `${pctMax}%`,
            transform: 'translate(-50%, -50%)',
            width: 16, height: 16, borderRadius: '50%',
            background: noLimit ? '#374151' : color, border: '2px solid #0a0e1a',
            cursor: 'grab', zIndex: 3,
            boxShadow: noLimit ? 'none' : `0 0 0 3px ${color}33`,
          }}
        />
      </div>

      {/* Tick labels */}
      <div style={{ position: 'relative', height: 14, marginTop: 2 }}>
        {TICKS.map(t => (
          <span key={t} style={{
            position: 'absolute', left: `${(t / NSV_SLIDER_MAX) * 100}%`,
            transform: 'translateX(-50%)',
            fontSize: '0.55rem', color: '#374151', fontFamily: 'var(--mono)',
          }}>
            {t === 20 ? '20M+' : `$${t}M`}
          </span>
        ))}
      </div>

      {/* Current value readout */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
          <span style={{ fontSize: '0.58rem', color: '#4b5563' }}>MIN</span>
          <span style={{ fontSize: '0.82rem', color, fontFamily: 'var(--mono)', fontWeight: 700 }}>
            ${valueMin.toFixed(1)}M
          </span>
        </div>
        <div style={{ fontSize: '0.62rem', color: '#374151' }}>— NSV range —</div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
          <span style={{ fontSize: '0.58rem', color: '#4b5563' }}>MAX</span>
          <span style={{ fontSize: '0.82rem', fontFamily: 'var(--mono)', fontWeight: 700, color: noLimit ? '#4b5563' : color }}>
            {noLimit ? '∞' : `$${dispMax.toFixed(1)}M`}
          </span>
        </div>
      </div>
    </div>
  )
}

const DEFAULT_CUTOFF = 10.0

const PILLAR_OPTIONS = [
  { value: 0, label: 'None (0 m)'   },
  { value: 1, label: '5 m (1 block)'  },
  { value: 2, label: '10 m (2 blocks)' },
  { value: 3, label: '15 m (3 blocks)' },
]

const DEFAULT_ECON = {
  gold_price_usd:           5200.0,
  mining_cost_per_t:          50.0,
  processing_cost_per_t:      18.0,
  refining_cost_per_oz:       20.0,
  metallurgical_recovery:     92.0,
  royalty_pct:                 3.0,
  dilution_factor_pct:        15.0,
  mining_recovery_pct:        90.0,
  payable_pct:                99.5,
  ga_cost_per_t:               5.0,
  sustaining_capex_per_t:      5.0,
  use_nsv_filter:            false,
  nsv_min_musd:              0.0,   // $M — 0 means any profitable stope
  nsv_max_musd:              0.0,   // $M — 0 means no upper limit
}

function NumField({ label, unit, value, onChange, min, max, step, hint }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: '0.65rem', color: '#4b5563', fontFamily: 'var(--mono)' }}>{unit}</span>
      </div>
      <input
        type="number"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        style={{
          background: '#0a0e1a', border: '1px solid #1f2937', borderRadius: 5,
          color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: '0.78rem',
          padding: '5px 8px', width: '100%',
        }}
      />
      {hint && (
        <div style={{ fontSize: '0.6rem', color: '#374151', marginTop: 1 }}>{hint}</div>
      )}
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0 4px' }}>
      <div style={{ flex: 1, height: 1, background: '#1f2937' }} />
      <span style={{ fontSize: '0.6rem', color: '#374151', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {children}
      </span>
      <div style={{ flex: 1, height: 1, background: '#1f2937' }} />
    </div>
  )
}

export default function ParameterPanel({ onRun, loading, summary, loadTime, goldPrice = 3200 }) {
  const [cutoff, setCutoff] = useState(DEFAULT_CUTOFF)
  const [pillar, setPillar] = useState(0)
  const [zStart, setZStart] = useState('auto')
  const [econ,   setEcon]   = useState({ ...DEFAULT_ECON, gold_price_usd: goldPrice })

  const userChangedGoldPrice = React.useRef(false)

  const setField = (key, val) => {
    if (key === 'gold_price_usd') userChangedGoldPrice.current = true
    setEcon(prev => ({ ...prev, [key]: val }))
  }

  useEffect(() => {
    if (!userChangedGoldPrice.current) {
      setEcon(prev => ({ ...prev, gold_price_usd: goldPrice }))
    }
  }, [goldPrice])

  const useNSV = econ.use_nsv_filter

  const switchMode = (nsv) => {
    const n = { ...econ, use_nsv_filter: nsv }
    setEcon(n)
    if (summary) triggerRun(n)
  }

  // Lane's three cutoff grades — computed from shared econ params
  const cutoffGrades = (() => {
    const rec     = econ.metallurgical_recovery / 100
    const dil     = econ.dilution_factor_pct    / 100
    const mineRec = econ.mining_recovery_pct    / 100
    const payable = econ.payable_pct            / 100
    const royalty = econ.royalty_pct            / 100
    const effFactor   = (1 - dil) * mineRec * rec * payable
    const netRevPerOz = econ.gold_price_usd * (1 - royalty) * effFactor
                        - econ.refining_cost_per_oz * effFactor
    const netRevPerG  = netRevPerOz / 31.1035
    if (netRevPerG <= 0) return { breakeven: '—', marginal: '—', incremental: '—' }
    const calc = costs => {
      const v = costs / netRevPerG
      return isFinite(v) && v > 0 ? v.toFixed(2) : '—'
    }
    const mine = econ.mining_cost_per_t * mineRec
    const proc = econ.processing_cost_per_t * mineRec
    const ga   = econ.ga_cost_per_t * mineRec
    const sust = econ.sustaining_capex_per_t * mineRec
    return {
      breakeven:   calc(mine + proc + ga + sust),
      incremental: calc(mine + proc),
      marginal:    calc(proc),
    }
  })()

  const triggerRun = (econOverride = econ) => {
    const effectiveCutoff = econOverride.use_nsv_filter ? 0 : cutoff
    onRun(
      effectiveCutoff,
      pillar,
      zStart === 'auto' ? null : parseInt(zStart),
      {
        gold_price_usd:          econOverride.gold_price_usd,
        mining_cost_per_t:       econOverride.mining_cost_per_t,
        processing_cost_per_t:   econOverride.processing_cost_per_t,
        refining_cost_per_oz:    econOverride.refining_cost_per_oz,
        metallurgical_recovery:  econOverride.metallurgical_recovery / 100,
        royalty_pct:             econOverride.royalty_pct / 100,
        dilution_factor:         econOverride.dilution_factor_pct / 100,
        mining_recovery:         econOverride.mining_recovery_pct / 100,
        payable_pct:             econOverride.payable_pct / 100,
        ga_cost_per_t:           econOverride.ga_cost_per_t,
        sustaining_capex_per_t:  econOverride.sustaining_capex_per_t,
        use_nsv_filter:          econOverride.use_nsv_filter,
        nsv_min_usd:             econOverride.nsv_min_musd * 1e6,
        nsv_max_usd:             econOverride.nsv_max_musd * 1e6,
      }
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Fixed Stope Geometry */}
      <div className="card">
        <div className="card-title">Fixed Stope Geometry</div>
        <div className="dim-info">
          Length (X)    20 m  →  4 blocks<br />
          Thickness (Y)  5 m  →  1 block<br />
          Height (Z)    30 m  →  6 blocks<br />
          Volume      3 000 m³
        </div>
      </div>

      {/* Main form */}
      <div className="card">
        <form onSubmit={e => { e.preventDefault(); triggerRun() }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* ── 1. Cutoff Method toggle ── */}
          <div>
            <div style={{ fontSize: '0.68rem', color: '#4b5563', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
              Cutoff Method
            </div>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr',
              background: '#0a0e1a', border: '1px solid #1f2937',
              borderRadius: 8, padding: 3, gap: 3,
            }}>
              <button
                type="button"
                onClick={() => switchMode(false)}
                style={{
                  background: !useNSV ? '#f59e0b' : 'transparent',
                  border: 'none', borderRadius: 6,
                  color: !useNSV ? '#0a0e1a' : '#6b7280',
                  fontSize: '0.75rem', fontWeight: !useNSV ? 700 : 500,
                  padding: '7px 4px', cursor: 'pointer', fontFamily: 'Inter',
                  transition: 'all 0.15s',
                }}
              >
                WAG Mode
              </button>
              <button
                type="button"
                onClick={() => switchMode(true)}
                style={{
                  background: useNSV ? '#16a34a' : 'transparent',
                  border: 'none', borderRadius: 6,
                  color: useNSV ? '#ffffff' : '#6b7280',
                  fontSize: '0.75rem', fontWeight: useNSV ? 700 : 500,
                  padding: '7px 4px', cursor: 'pointer', fontFamily: 'Inter',
                  transition: 'all 0.15s',
                }}
              >
                NSV Filter
              </button>
            </div>

            {/* Mode-specific description + WAG cutoff slider */}
            {!useNSV ? (
              <div style={{
                background: '#130f00', border: '1px solid #78350f',
                borderRadius: '0 0 8px 8px', borderTop: 'none',
                padding: '12px 12px 10px', marginTop: -3,
              }}>
                <div style={{ fontSize: '0.65rem', color: '#92400e', marginBottom: 8 }}>
                  Include stopes whose weighted avg grade ≥ cutoff
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <input
                    type="range" min={0.5} max={20} step={0.5}
                    value={cutoff}
                    onChange={e => setCutoff(parseFloat(e.target.value))}
                    style={{ flex: 1, accentColor: '#f59e0b' }}
                  />
                  <span style={{
                    fontFamily: 'var(--mono)', fontWeight: 700, fontSize: '1rem',
                    color: '#f59e0b', minWidth: 48, textAlign: 'right',
                  }}>
                    {cutoff.toFixed(1)}
                  </span>
                  <span style={{ fontSize: '0.7rem', color: '#92400e' }}>g/t</span>
                </div>
                <input
                  type="number" min={0.1} max={30} step={0.1}
                  value={cutoff}
                  onChange={e => setCutoff(parseFloat(e.target.value) || DEFAULT_CUTOFF)}
                  style={{
                    background: '#0a0e1a', border: '1px solid #78350f',
                    borderRadius: 5, color: '#f59e0b', fontFamily: 'var(--mono)',
                    fontSize: '0.78rem', padding: '5px 8px', width: '100%',
                  }}
                />
              </div>
            ) : (
              <div style={{
                background: '#031a0e', border: '1px solid #14532d',
                borderRadius: '0 0 8px 8px', borderTop: 'none',
                padding: '10px 12px', marginTop: -3,
                display: 'flex', flexDirection: 'column', gap: 8,
              }}>
                <div style={{ fontSize: '0.65rem', color: '#166534' }}>
                  Profit-based — no manual grade cutoff. Adjust the NSV range below to target specific stope tiers.
                </div>

                {/* NSV Range dual slider */}
                <DualRangeSlider
                  valueMin={econ.nsv_min_musd}
                  valueMax={econ.nsv_max_musd}
                  onChangeMin={v => setField('nsv_min_musd', v)}
                  onChangeMax={v => setField('nsv_max_musd', v)}
                />
                <div style={{ fontSize: '0.6rem', color: '#374151', marginTop: -4 }}>
                  Drag left handle = min · right handle = max · pull right to ∞ for no cap
                </div>
              </div>
            )}
          </div>

          {/* ── 2. Shared Economic Parameters ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: '0.68rem', color: '#4b5563', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              Economic Parameters
            </div>

            <SectionLabel>Revenue</SectionLabel>

            {/* Gold Price */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500 }}>Gold Price</span>
                <span style={{ fontSize: '0.65rem', color: '#4b5563', fontFamily: 'var(--mono)' }}>USD/oz</span>
              </div>
              <input
                type="number" min={500} max={15000} step={1}
                value={econ.gold_price_usd}
                onChange={e => setField('gold_price_usd', parseFloat(e.target.value) || 0)}
                style={{
                  background: '#0a0e1a', border: '1px solid #1f2937', borderRadius: 5,
                  color: '#f59e0b', fontFamily: 'var(--mono)', fontSize: '0.85rem',
                  fontWeight: 700, padding: '5px 8px', width: '100%',
                }}
              />
              <div style={{ fontSize: '0.62rem', color: '#374151', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span>Live Au spot: ${goldPrice.toLocaleString()}/oz</span>
                {Math.abs(econ.gold_price_usd - goldPrice) > 5 && (
                  <button
                    type="button"
                    onClick={() => { userChangedGoldPrice.current = false; setField('gold_price_usd', goldPrice) }}
                    style={{
                      background: 'none', border: 'none',
                      color: 'var(--primary)', cursor: 'pointer',
                      fontSize: '0.62rem', textDecoration: 'underline', padding: 0,
                    }}
                  >
                    sync
                  </button>
                )}
              </div>
            </div>

            <NumField
              label="Royalty" unit="% of NSR"
              value={econ.royalty_pct}
              onChange={v => setField('royalty_pct', Math.min(100, Math.max(0, v)))}
              min={0} max={20} step={0.1}
              hint="Government royalty — typical: 2–5%"
            />

            <SectionLabel>Costs</SectionLabel>

            <NumField
              label="Mining Cost" unit="USD/t mined"
              value={econ.mining_cost_per_t}
              onChange={v => setField('mining_cost_per_t', v)}
              min={0} max={200} step={1}
              hint="Drill, blast, muck, haul — typical: $30–80/t"
            />
            <NumField
              label="Processing Cost" unit="USD/t milled"
              value={econ.processing_cost_per_t}
              onChange={v => setField('processing_cost_per_t', v)}
              min={0} max={200} step={1}
              hint="Crush, grind, CIL/CIP leach — typical: $12–25/t"
            />
            <NumField
              label="Refining + Transport" unit="USD/oz"
              value={econ.refining_cost_per_oz}
              onChange={v => setField('refining_cost_per_oz', v)}
              min={0} max={100} step={0.5}
              hint="Smelting + logistics — typical: $15–35/oz"
            />
            <NumField
              label="G&A Overhead" unit="USD/t mined"
              value={econ.ga_cost_per_t}
              onChange={v => setField('ga_cost_per_t', v)}
              min={0} max={50} step={0.5}
              hint="General & administrative — typical: $3–8/t"
            />
            <NumField
              label="Sustaining CapEx" unit="USD/t mined"
              value={econ.sustaining_capex_per_t}
              onChange={v => setField('sustaining_capex_per_t', v)}
              min={0} max={50} step={0.5}
              hint="Development + equipment — typical: $3–8/t"
            />

            <SectionLabel>Recovery Factors</SectionLabel>

            <NumField
              label="Met. Recovery" unit="%"
              value={econ.metallurgical_recovery}
              onChange={v => setField('metallurgical_recovery', Math.min(100, Math.max(0, v)))}
              min={0} max={100} step={0.5}
              hint="CIL: 88–95% · Heap leach: 60–80%"
            />
            <NumField
              label="Mining Recovery" unit="%"
              value={econ.mining_recovery_pct}
              onChange={v => setField('mining_recovery_pct', Math.min(100, Math.max(0, v)))}
              min={50} max={100} step={1}
              hint="% of ore tonnes extracted — typical: 85–95%"
            />
            <NumField
              label="Payable Gold" unit="% (smelter)"
              value={econ.payable_pct}
              onChange={v => setField('payable_pct', Math.min(100, Math.max(50, v)))}
              min={50} max={100} step={0.1}
              hint="Smelter pays this % of recovered Au — typical: 99–99.9%"
            />
            <NumField
              label="Dilution Factor" unit="%"
              value={econ.dilution_factor_pct}
              onChange={v => setField('dilution_factor_pct', Math.min(50, Math.max(0, v)))}
              min={0} max={50} step={1}
              hint="Waste mixed at stope walls — typical: 10–25%"
            />

            {/* Implied Cutoff Grades — always visible, useful in both modes */}
            <div style={{
              background: '#0a0e1a', border: '1px solid #1f2937',
              borderRadius: 6, padding: '8px 10px', marginTop: 2,
            }}>
              <div style={{ fontSize: '0.62rem', color: '#374151', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                Implied Cutoff Grades (Lane's Theory)
              </div>
              {[
                { label: 'Breakeven',   value: cutoffGrades.breakeven,   hint: 'all costs',      color: '#4ade80' },
                { label: 'Incremental', value: cutoffGrades.incremental, hint: 'mine + process', color: '#f59e0b' },
                { label: 'Marginal',    value: cutoffGrades.marginal,    hint: 'mill only',      color: '#60a5fa' },
              ].map(({ label, value, hint, color }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                  <span style={{ fontSize: '0.7rem', color: '#6b7280' }}>{label}</span>
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                    <span style={{ color, fontFamily: 'var(--mono)', fontWeight: 700, fontSize: '0.78rem' }}>~{value} g/t</span>
                    <span style={{ color: '#374151', fontSize: '0.58rem' }}>{hint}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* ── 3. Stope Layout ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: '0.68rem', color: '#4b5563', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              Stope Layout
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Min Pillar Width</label>
              <select value={pillar} onChange={e => setPillar(parseInt(e.target.value))}>
                {PILLAR_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Z Level Start</label>
              <select value={zStart} onChange={e => setZStart(e.target.value)}>
                <option value="auto">Auto (best gold)</option>
                {[0,1,2,3,4,5].map(n => (
                  <option key={n} value={n}>Offset {n} ({n * 5} m)</option>
                ))}
              </select>
            </div>
          </div>

          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading
              ? <><span className="spinner" /> Running…</>
              : '▶  Run Optimization'
            }
          </button>
        </form>
      </div>

      {/* Summary metrics */}
      {summary && (
        <div className="card">
          <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Last Run Results</span>
            {summary.runtime_ms != null && (
              <span className="runtime-badge">{summary.runtime_ms} ms</span>
            )}
          </div>
          <div className="metric-grid">
            <div className="metric">
              <div className="metric-label">Economic Stopes</div>
              <div className="metric-value">{summary.total_stopes.toLocaleString()}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Mining Levels</div>
              <div className="metric-value">{summary.mining_levels}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Head Grade</div>
              <div className="metric-value gold">{summary.avg_grade_gt.toFixed(2)} g/t Au</div>
            </div>
            <div className="metric">
              <div className="metric-label">Dilution</div>
              <div className="metric-value" style={{ color: '#f59e0b' }}>
                {(summary.overall_dilution_pct ?? 0).toFixed(1)}%
              </div>
            </div>
            <div className="metric">
              <div className="metric-label">Contained Au</div>
              <div className="metric-value gold">
                {(summary.total_gold_oz / 1000).toFixed(1)} koz
              </div>
            </div>
            <div className="metric">
              <div className="metric-label">Recovered Au</div>
              <div className="metric-value green">
                {((summary.total_recovered_oz ?? 0) / 1000).toFixed(1)} koz
              </div>
            </div>
            <div className="metric">
              <div className="metric-label">Ore Mined</div>
              <div className="metric-value">{(summary.total_ore_tonnes / 1e6).toFixed(2)} Mt</div>
            </div>
            <div className="metric">
              <div className="metric-label">Avg NSR</div>
              <div className="metric-value green">
                ${(summary.avg_nsr_per_t ?? 0).toFixed(0)}/t
              </div>
            </div>
            {summary.total_nsv_usd != null && (
              <div className="metric" style={{ gridColumn: 'span 2' }}>
                <div className="metric-label">Total NSR (after all costs)</div>
                <div className="metric-value" style={{ color: summary.total_nsv_usd >= 0 ? 'var(--accent)' : '#ef4444' }}>
                  ${(summary.total_nsv_usd / 1e6).toFixed(1)}M USD
                </div>
              </div>
            )}
            <div className="metric" style={{ gridColumn: 'span 2' }}>
              <div className="metric-label">Gross Revenue @ ${econ.gold_price_usd.toLocaleString()}/oz</div>
              <div className="metric-value green">
                ${(summary.total_gold_oz * econ.gold_price_usd / 1e6).toFixed(1)}M USD
              </div>
            </div>
          </div>
          {summary.level_elevations?.length > 0 && (
            <div style={{ marginTop: 8, fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
              Levels (m): {summary.level_elevations.slice(0, 5).join(', ')}
              {summary.level_elevations.length > 5 && ` … +${summary.level_elevations.length - 5} more`}
            </div>
          )}
        </div>
      )}

      {loadTime != null && (
        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textAlign: 'center' }}>
          Block model loaded in {loadTime}s · WAG grid pre-computed
        </div>
      )}
    </div>
  )
}
