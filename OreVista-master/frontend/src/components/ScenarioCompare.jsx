import React, { useState } from 'react'

const DEFAULT_ECON = {
  gold_price_usd:        5200.0,
  mining_cost_per_t:       50.0,
  processing_cost_per_t:   18.0,
  refining_cost_per_oz:    20.0,
  metallurgical_recovery:  92.0,
  royalty_pct:              3.0,
  dilution_factor_pct:     15.0,
  mining_recovery_pct:     90.0,
}

const METRICS = [
  { key: 'total_stopes',    label: 'Economic Stopes',       fmt: v => v.toLocaleString(),                                 group: 'Geometry' },
  { key: 'mining_levels',   label: 'Mining Levels',         fmt: v => v.toLocaleString(),                                 group: 'Geometry' },
  { key: 'total_tonnes',    label: 'Ore Tonnes',            fmt: v => (v / 1e6).toFixed(3) + ' Mt',                       group: 'Geometry' },
  { key: 'total_ore_tonnes',label: 'Clean Ore Tonnes',      fmt: v => (v / 1e6).toFixed(3) + ' Mt',                       group: 'Geometry' },
  { key: 'total_volume_m3', label: 'Total Volume',          fmt: v => (v / 1e6).toFixed(3) + ' Mm³',                      group: 'Geometry' },
  { key: 'total_gold_oz',   label: 'Gold (oz)',             fmt: v => v.toLocaleString(undefined, { maximumFractionDigits: 0 }), group: 'Grade' },
  { key: 'avg_grade_gt',    label: 'Avg Grade (g/t)',       fmt: v => v.toFixed(4),                                        group: 'Grade' },
  { key: 'max_grade_gt',    label: 'Max Grade (g/t)',       fmt: v => v.toFixed(4),                                        group: 'Grade' },
  { key: 'total_nsv_usd',   label: 'Total NSV (USD)',       fmt: v => v != null ? '$' + (v / 1e6).toFixed(2) + 'M' : '—', group: 'Economics' },
  { key: 'total_waste_tonnes', label: 'Waste Tonnes',       fmt: v => (v / 1e6).toFixed(3) + ' Mt',                       group: 'Economics' },
  { key: 'runtime_ms',      label: 'Runtime (ms)',          fmt: v => v,                                                   group: 'Meta' },
]

function EconSection({ label, econ, onChange, color }) {
  const set = (k, v) => onChange({ ...econ, [k]: v })
  const field = (lbl, key, unit, min, max, step) => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 80px', alignItems: 'center', gap: 6, marginBottom: 6 }}>
      <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{lbl}</label>
      <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{unit}</span>
      <input
        type="number" min={min} max={max} step={step}
        value={econ[key]}
        onChange={e => set(key, parseFloat(e.target.value) || 0)}
        style={{ fontSize: '0.78rem', padding: '3px 6px', textAlign: 'right' }}
      />
    </div>
  )

  return (
    <div style={{
      border: `1px solid ${color}44`, borderRadius: 'var(--radius)',
      padding: '10px 12px', background: `${color}08`,
    }}>
      <div style={{ fontSize: '0.75rem', fontWeight: 700, color, marginBottom: 8 }}>{label}</div>
      {field('Gold Price',         'gold_price_usd',        'USD/oz',  500,  15000, 1)}
      {field('Mining Cost',        'mining_cost_per_t',     'USD/t',   0,    200,   1)}
      {field('Processing Cost',    'processing_cost_per_t', 'USD/t',   0,    200,   1)}
      {field('Refining+Transport', 'refining_cost_per_oz',  'USD/oz',  0,    100,   0.5)}
      {field('Met. Recovery',      'metallurgical_recovery','%',       0,    100,   0.5)}
      {field('Royalty',            'royalty_pct',           '%',       0,    20,    0.1)}
      {field('Dilution Factor',    'dilution_factor_pct',   '%',       0,    50,    1)}
      {field('Mining Recovery',    'mining_recovery_pct',   '%',       50,   100,   1)}
    </div>
  )
}

export default function ScenarioCompare({ goldPrice }) {
  const [cutoffA, setCutoffA] = useState(3.0)
  const [cutoffB, setCutoffB] = useState(1.5)
  const [econA,   setEconA]   = useState({ ...DEFAULT_ECON, gold_price_usd: goldPrice ?? DEFAULT_ECON.gold_price_usd })
  const [econB,   setEconB]   = useState({ ...DEFAULT_ECON, gold_price_usd: goldPrice ?? DEFAULT_ECON.gold_price_usd })
  const [result,  setResult]  = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  const toApiEcon = (e) => ({
    gold_price_usd:         e.gold_price_usd,
    mining_cost_per_t:      e.mining_cost_per_t,
    processing_cost_per_t:  e.processing_cost_per_t,
    refining_cost_per_oz:   e.refining_cost_per_oz,
    metallurgical_recovery: e.metallurgical_recovery / 100,
    royalty_pct:            e.royalty_pct / 100,
    dilution_factor:        e.dilution_factor_pct / 100,
    mining_recovery:        e.mining_recovery_pct / 100,
    use_nsv_filter:         false,
  })

  const handleCompare = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cutoff_a:    cutoffA,
          cutoff_b:    cutoffB,
          economics_a: toApiEcon(econA),
          economics_b: toApiEcon(econB),
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      setResult(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const delta = (key) => {
    if (!result) return null
    const a = result.scenario_a.summary[key]
    const b = result.scenario_b.summary[key]
    if (typeof a !== 'number' || typeof b !== 'number') return null
    const d = b - a
    const pct = a !== 0 ? ((d / a) * 100).toFixed(1) : '—'
    return { d, pct }
  }

  let lastGroup = null

  return (
    <div style={{ padding: 16, overflowY: 'auto', height: '100%', display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Scenario inputs */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <div style={{ marginBottom: 8 }}>
            <div className="field">
              <label style={{ color: '#f59e0b', fontWeight: 700 }}>Scenario A — Cutoff Grade (g/t)</label>
              <input type="number" min={0.1} max={30} step={0.5} value={cutoffA}
                onChange={e => setCutoffA(parseFloat(e.target.value))} />
            </div>
          </div>
          <EconSection label="Scenario A Economics" econ={econA} onChange={setEconA} color="#f59e0b" />
        </div>
        <div>
          <div style={{ marginBottom: 8 }}>
            <div className="field">
              <label style={{ color: '#10b981', fontWeight: 700 }}>Scenario B — Cutoff Grade (g/t)</label>
              <input type="number" min={0.1} max={30} step={0.5} value={cutoffB}
                onChange={e => setCutoffB(parseFloat(e.target.value))} />
            </div>
          </div>
          <EconSection label="Scenario B Economics" econ={econB} onChange={setEconB} color="#10b981" />
        </div>
      </div>

      <button className="btn btn-primary" onClick={handleCompare} disabled={loading}
        style={{ alignSelf: 'flex-start', padding: '9px 28px' }}>
        {loading ? <><span className="spinner" /> Running…</> : '⇌  Compare Scenarios'}
      </button>

      {error && (
        <div style={{ color: 'var(--danger)', fontSize: '0.8rem' }}>Error: {error}</div>
      )}

      {result && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', fontFamily: 'var(--mono)' }}>Metric</th>
              <th style={{ textAlign: 'right', padding: '8px 12px', color: '#f59e0b', borderBottom: '1px solid var(--border)', fontFamily: 'var(--mono)' }}>A — {cutoffA} g/t</th>
              <th style={{ textAlign: 'right', padding: '8px 12px', color: '#10b981', borderBottom: '1px solid var(--border)', fontFamily: 'var(--mono)' }}>B — {cutoffB} g/t</th>
              <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', fontFamily: 'var(--mono)' }}>Δ B vs A</th>
            </tr>
          </thead>
          <tbody>
            {METRICS.map(m => {
              const showGroup = m.group !== lastGroup
              lastGroup = m.group
              const va = result.scenario_a.summary[m.key]
              const vb = result.scenario_b.summary[m.key]
              const d  = delta(m.key)
              return (
                <React.Fragment key={m.key}>
                  {showGroup && (
                    <tr>
                      <td colSpan={4} style={{ padding: '10px 12px 4px', fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid var(--border)' }}>
                        {m.group}
                      </td>
                    </tr>
                  )}
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '7px 12px', color: 'var(--text-muted)', fontFamily: 'var(--mono)', fontSize: '0.75rem' }}>{m.label}</td>
                    <td style={{ padding: '7px 12px', textAlign: 'right', fontFamily: 'var(--mono)', color: '#f59e0b' }}>{va != null ? m.fmt(va) : '—'}</td>
                    <td style={{ padding: '7px 12px', textAlign: 'right', fontFamily: 'var(--mono)', color: '#10b981' }}>{vb != null ? m.fmt(vb) : '—'}</td>
                    <td style={{ padding: '7px 12px', textAlign: 'right', fontFamily: 'var(--mono)', color: d ? (d.d >= 0 ? '#10b981' : '#ef4444') : 'var(--text-muted)', fontSize: '0.75rem' }}>
                      {d ? `${d.d >= 0 ? '+' : ''}${d.pct}%` : '—'}
                    </td>
                  </tr>
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      )}

      {!result && !loading && (
        <div className="empty-state">
          <div className="empty-icon">⇌</div>
          <div>Set two scenarios and click Compare</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Each scenario has independent cutoff grade and economic parameters</div>
        </div>
      )}
    </div>
  )
}
