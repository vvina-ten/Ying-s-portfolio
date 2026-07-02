import { useEffect, useState, useRef, useCallback } from 'react'

const PERF_POLL_MS  = 2000   // history + toggle state
const CPU_POLL_MS   = 600    // per-core live monitor
const HISTORY_LEN   = 90    // ~54 s of history at 600 ms intervals

// Task-Manager blue palette
const TM_LINE  = '#17a2cf'
const TM_FILL  = 'rgba(23,162,207,0.22)'
const TM_GRID  = '#0e2030'
const TM_BG    = '#071420'
const TM_CELL  = '#081824'
const TM_BORD  = '#0d2535'

export default function PerformancePanel({ visible = true }) {
  const [perf,     setPerf]     = useState(null)
  const [cpu,      setCpu]      = useState(null)
  const [toggling, setToggling] = useState(false)

  // Rolling per-core history stored in a ref — never triggers re-renders
  const histRef    = useRef([])   // Array<number[]>
  const gridCanvas = useRef(null)
  const chartRef   = useRef(null)
  const stepBarRef = useRef(null)  // stacked step bar chart
  const stepLineRef= useRef(null)  // step trend line chart

  const fetchPerf = useCallback(async () => {
    try { setPerf(await (await fetch('/api/performance')).json()) } catch {}
  }, [])

  const fetchCpu = useCallback(async () => {
    try { setCpu(await (await fetch('/api/performance/cpu')).json()) } catch {}
  }, [])

  useEffect(() => { fetchPerf(); const t = setInterval(fetchPerf, PERF_POLL_MS); return () => clearInterval(t) }, [fetchPerf])
  useEffect(() => { fetchCpu();  const t = setInterval(fetchCpu,  CPU_POLL_MS);  return () => clearInterval(t) }, [fetchCpu])

  // Append new readings to rolling history and redraw
  useEffect(() => {
    if (!cpu?.cores?.length) return
    const cores = cpu.cores

    // Init history arrays on first data
    if (histRef.current.length !== cores.length) {
      histRef.current = cores.map(() => [])
    }

    cores.forEach((pct, i) => {
      histRef.current[i].push(pct)
      if (histRef.current[i].length > HISTORY_LEN) histRef.current[i].shift()
    })

    if (gridCanvas.current) drawCpuGrid(gridCanvas.current, histRef.current, cores)
  }, [cpu])

  // Redraw all history charts whenever history list changes
  useEffect(() => {
    if (!perf?.history?.length) return
    if (chartRef.current)   drawHistoryChart(chartRef.current,   perf.history)
    if (stepBarRef.current) drawStepBars    (stepBarRef.current,  perf.history)
    if (stepLineRef.current)drawStepLines   (stepLineRef.current, perf.history)
  }, [perf])

  // Redraw all canvases when tab becomes visible (canvases have 0-size when hidden)
  useEffect(() => {
    if (!visible) return
    if (cpu?.cores?.length && gridCanvas.current) drawCpuGrid(gridCanvas.current, histRef.current, cpu.cores)
    if (perf?.history?.length) {
      if (chartRef.current)    drawHistoryChart(chartRef.current,    perf.history)
      if (stepBarRef.current)  drawStepBars    (stepBarRef.current,  perf.history)
      if (stepLineRef.current) drawStepLines   (stepLineRef.current, perf.history)
    }
  }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async () => {
    if (!perf || toggling) return
    setToggling(true)
    try {
      await fetch('/api/performance/toggle', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !perf.rust_enabled }),
      })
      await fetchPerf()
    } finally { setToggling(false) }
  }

  const cores      = cpu?.cores ?? []
  const cpuTotal   = cpu?.total ?? 0
  const active     = perf?.rust_active ?? false
  const rustRuns   = (perf?.history ?? []).filter(r => r.mode === 'rust')
  const pyRuns     = (perf?.history ?? []).filter(r => r.mode === 'python')
  const avgRust    = rustRuns.length ? avg(rustRuns.map(r => r.runtime_ms)) : null
  const avgPy      = pyRuns.length   ? avg(pyRuns.map(r => r.runtime_ms))   : null
  const speedup    = avgRust && avgPy ? (avgPy / avgRust).toFixed(1) : null

  // Grid dimensions
  const COLS    = 4
  const ROWS    = Math.max(1, Math.ceil((cores.length || 16) / COLS))
  const gridH   = ROWS * 86   // px per row

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: TM_BG }}>

      {/* ── Task-Manager CPU grid (fixed, always visible) ────────────── */}
      <div style={{ flexShrink: 0, padding: '10px 12px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>

        {/* Header bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#e2e8f0' }}>CPU</span>
            <span style={{ marginLeft: 10, fontSize: '0.7rem', color: '#4a7fa0' }}>AMD Ryzen 7 7735H  ·  {perf?.cpu_count ?? cores.length} logical processors</span>
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <Stat label="Overall" value={`${cpuTotal}%`}   color={cpuTotal > 75 ? '#ef4444' : cpuTotal > 40 ? '#f59e0b' : TM_LINE} />
            <Stat label="Mode"    value={active ? 'Rust' : 'Python'} color={active ? '#f59e0b' : '#60a5fa'} />
          </div>
        </div>

        {/* Per-core canvas grid */}
        <canvas
          ref={gridCanvas}
          style={{ width: '100%', height: gridH, display: 'block', borderRadius: 4, border: `1px solid ${TM_BORD}` }}
        />

        {/* Grid legend */}
        <div style={{ display: 'flex', gap: 16, paddingBottom: 6, fontSize: '0.63rem', color: '#2a5570', fontFamily: 'monospace' }}>
          <span>⬜ {HISTORY_LEN * CPU_POLL_MS / 1000}s window</span>
          <span>↑ 100%</span>
          <span style={{ color: TM_LINE }}>── {cores.length} logical cores (C0–C{cores.length - 1})</span>
        </div>
      </div>

      {/* ── Scrollable lower section ──────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Divider */}
        <div style={{ height: 1, background: TM_BORD, marginTop: 4 }} />

        {/* Toggle */}
        {perf && (
          <div style={S.card}>
            <div style={{ flex: 1 }}>
              <div style={S.cardTitle}>{active ? 'Rust Accelerator  ON' : 'Python Fallback  ON'}</div>
              <div style={S.cardSub}>
                {active
                  ? `Rayon uses all ${perf.cpu_count} cores — no GIL — true parallelism`
                  : 'ThreadPoolExecutor — Python GIL caps parallel throughput'}
              </div>
            </div>
            <button onClick={toggle} disabled={!perf.rust_available || toggling} style={{
              position: 'relative', width: 48, height: 26, borderRadius: 13,
              border: 'none', cursor: perf.rust_available ? 'pointer' : 'not-allowed',
              background: active ? '#f59e0b' : '#374151', transition: 'background 0.2s',
              padding: 0, flexShrink: 0, opacity: perf.rust_available ? 1 : 0.4,
            }}>
              <span style={{
                position: 'absolute', top: 3, left: active ? 25 : 3,
                width: 20, height: 20, borderRadius: '50%', background: '#fff',
                transition: 'left 0.2s', display: 'block',
              }} />
            </button>
          </div>
        )}

        {/* Speed comparison */}
        {(rustRuns.length > 0 || pyRuns.length > 0) && (
          <div style={{ display: 'flex', gap: 8 }}>
            <SpeedCard label="Rust avg"   value={avgRust} color="#f59e0b" runs={rustRuns.length} />
            <SpeedCard label="Python avg" value={avgPy}   color="#60a5fa" runs={pyRuns.length} />
            {speedup && (
              <div style={{ flex: 1, ...S.card, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#10b981', fontFamily: 'monospace' }}>{speedup}×</div>
                <div style={{ fontSize: '0.62rem', color: '#6b7280' }}>speedup</div>
              </div>
            )}
          </div>
        )}

        {/* Status badges */}
        {perf && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Badge label="Rust installed" value={perf.rust_available ? 'Yes' : 'No'}   color={perf.rust_available ? '#10b981' : '#ef4444'} />
            <Badge label="Cores"          value={`${perf.cpu_count}`}                  color="#a78bfa" />
            <Badge label="Runs recorded"  value={String(perf.history.length)}           color="#9ca3af" />
          </div>
        )}

        {/* Runtime history chart */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={S.sectionLabel}>Optimization Runtime History</div>
            <span style={{ fontSize: '0.65rem', color: '#f59e0b' }}>■ Rust</span>
            <span style={{ fontSize: '0.65rem', color: '#60a5fa' }}>■ Python</span>
          </div>
          {perf?.history?.length ? (
            <canvas ref={chartRef} style={{ width: '100%', height: 140, display: 'block' }} />
          ) : (
            <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151', fontSize: '0.75rem', border: `1px dashed ${TM_BORD}`, borderRadius: 6 }}>
              No runs yet — click Optimize to record the first entry
            </div>
          )}
        </div>

        {/* Step breakdown — stacked bars */}
        {perf?.history?.some(r => r.steps) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={S.sectionLabel}>Step Breakdown (per run)</div>
              <span style={{ fontSize: '0.62rem', color: '#10b981' }}>■ Z-start</span>
              <span style={{ fontSize: '0.62rem', color: '#3b82f6' }}>■ DP select</span>
              <span style={{ fontSize: '0.62rem', color: '#ec4899' }}>■ Post-process</span>
              <span style={{ fontSize: '0.62rem', color: '#6b7280' }}>■ Summary</span>
            </div>
            <canvas ref={stepBarRef} style={{ width: '100%', height: 140, display: 'block' }} />
          </div>
        )}

        {/* Step trend — line chart across runs */}
        {perf?.history?.some(r => r.steps) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={S.sectionLabel}>Step Time Trend (line)</div>
              <span style={{ fontSize: '0.62rem', color: '#10b981' }}>— Z-start</span>
              <span style={{ fontSize: '0.62rem', color: '#3b82f6' }}>— DP select</span>
              <span style={{ fontSize: '0.62rem', color: '#ec4899' }}>— Post-process</span>
              <span style={{ fontSize: '0.62rem', color: '#e2e8f0' }}>— Total</span>
            </div>
            <canvas ref={stepLineRef} style={{ width: '100%', height: 160, display: 'block' }} />
            <div style={{ fontSize: '0.62rem', color: '#2a5570' }}>
              Each line shows how one computation step scales across runs — the tallest line is your bottleneck.
            </div>
          </div>
        )}

        {/* Recent runs table */}
        {perf?.history?.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={S.sectionLabel}>Recent Runs (last 10)</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.7rem', fontFamily: 'monospace' }}>
              <thead>
                <tr style={{ color: '#4b5563', borderBottom: `1px solid ${TM_BORD}` }}>
                  {['#', 'Mode', 'Cutoff', 'Stopes', 'Runtime', 'Cores', 'Time'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '3px 8px', fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...perf.history].reverse().slice(0, 10).map(r => (
                  <tr key={r.id} style={{ borderBottom: `1px solid #0a1520` }}>
                    <td style={{ padding: '4px 8px', color: '#4b5563' }}>{r.id}</td>
                    <td style={{ padding: '4px 8px' }}>
                      <span style={{ color: r.mode === 'rust' ? '#f59e0b' : '#60a5fa', fontWeight: 700 }}>
                        {r.mode === 'rust' ? 'Rust' : 'Python'}
                      </span>
                    </td>
                    <td style={{ padding: '4px 8px', color: '#9ca3af' }}>{r.cutoff} g/t</td>
                    <td style={{ padding: '4px 8px', color: '#d1d5db' }}>{r.stope_count.toLocaleString()}</td>
                    <td style={{ padding: '4px 8px', fontWeight: 700, color: r.mode === 'rust' ? '#f59e0b' : '#60a5fa' }}>
                      {r.runtime_ms} ms
                    </td>
                    <td style={{ padding: '4px 8px', color: '#6b7280' }}>{r.threads}</td>
                    <td style={{ padding: '4px 8px', color: '#4b5563' }}>{r.timestamp.slice(11)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────
function Stat({ label, value, color }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: '0.6rem', color: '#2a5570', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: '0.8rem', fontWeight: 700, color, fontFamily: 'monospace' }}>{value}</div>
    </div>
  )
}

function Badge({ label, value, color }) {
  return (
    <div style={{ background: TM_CELL, border: `1px solid ${TM_BORD}`, borderRadius: 5, padding: '4px 8px' }}>
      <div style={{ fontSize: '0.58rem', color: '#1e4060', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, color, fontFamily: 'monospace', marginTop: 1 }}>{value}</div>
    </div>
  )
}

function SpeedCard({ label, value, color, runs }) {
  return (
    <div style={{ flex: 1, background: TM_CELL, borderRadius: 8, border: `1px solid ${color}33`, padding: '8px 12px' }}>
      <div style={{ fontSize: '0.6rem', color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: '1.2rem', fontWeight: 700, color, fontFamily: 'monospace', marginTop: 2 }}>
        {value !== null ? `${Math.round(value)} ms` : '—'}
      </div>
      <div style={{ fontSize: '0.6rem', color: '#4b5563', marginTop: 2 }}>{runs} run{runs !== 1 ? 's' : ''}</div>
    </div>
  )
}

const S = {
  card:        { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: TM_CELL, borderRadius: 8, border: `1px solid ${TM_BORD}` },
  cardTitle:   { fontSize: '0.78rem', fontWeight: 600, color: '#e2e8f0' },
  cardSub:     { fontSize: '0.67rem', color: '#6b7280', marginTop: 2 },
  sectionLabel:{ fontSize: '0.68rem', fontWeight: 600, color: '#2a5570', textTransform: 'uppercase', letterSpacing: '0.05em' },
}

// ── Helper ────────────────────────────────────────────────────────────────────
function avg(arr) { return arr.reduce((s, v) => s + v, 0) / arr.length }

// Step colours: z_start, dp, postprocess, summary
const STEP_COLORS = ['#10b981', '#3b82f6', '#ec4899', '#6b7280']
const STEP_KEYS   = ['z_start_ms', 'dp_ms', 'postprocess_ms', 'summary_ms']

function getSteps(r) {
  if (!r.steps) return null
  return STEP_KEYS.map(k => r.steps[k] ?? 0)
}

// ── Stacked bar chart: each run = one stacked bar coloured by step ────────────
function drawStepBars(canvas, history) {
  const dpr  = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  if (rect.width === 0) return
  canvas.width  = rect.width  * dpr
  canvas.height = rect.height * dpr
  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)

  const W = rect.width, H = rect.height
  const pad = { top: 10, right: 16, bottom: 26, left: 52 }
  const cw = W - pad.left - pad.right
  const ch = H - pad.top  - pad.bottom

  ctx.fillStyle = TM_BG
  ctx.fillRect(0, 0, W, H)

  const n     = history.length
  const maxMs = Math.max(...history.map(r => r.runtime_ms), 1)
  const step  = cw / n
  const barW  = Math.max(2, Math.min(28, step * 0.75))

  // Grid
  ctx.strokeStyle = TM_GRID; ctx.lineWidth = 0.5
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + ch * i / 4
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cw, y); ctx.stroke()
  }

  // Stacked bars
  history.forEach((r, i) => {
    const steps = getSteps(r)
    const cx = pad.left + step * i + step / 2 - barW / 2
    let yBase = pad.top + ch   // bottom of chart area

    if (steps) {
      steps.forEach((ms, si) => {
        const barH = (ms / maxMs) * ch
        yBase -= barH
        ctx.fillStyle = STEP_COLORS[si]
        ctx.fillRect(cx, yBase, barW, barH)
      })
    } else {
      // No step data — solid mode colour
      const barH = (r.runtime_ms / maxMs) * ch
      ctx.fillStyle = r.mode === 'rust' ? '#f59e0b' : '#3b82f6'
      ctx.fillRect(cx, pad.top + ch - barH, barW, barH)
    }
  })

  // Y labels
  ctx.font = '9px JetBrains Mono, monospace'; ctx.textAlign = 'right'
  ctx.fillStyle = '#2a5570'
  for (let i = 0; i <= 4; i++) {
    const v = maxMs * (1 - i / 4)
    ctx.fillText(Math.round(v) + 'ms', pad.left - 4, pad.top + ch * i / 4 + 3)
  }

  // X run labels
  ctx.textAlign = 'center'; ctx.fillStyle = '#1e4060'
  const every = Math.max(1, Math.ceil(n / 12))
  history.forEach((r, i) => {
    if (i % every === 0 || i === n - 1)
      ctx.fillText(String(r.id), pad.left + step * i + step / 2, pad.top + ch + 13)
  })
  ctx.fillStyle = '#1a3550'
  ctx.fillText('Run #', pad.left + cw / 2, H - 2)
}

// ── Line chart: one line per step, X = run index, Y = ms ─────────────────────
function drawStepLines(canvas, history) {
  const dpr  = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  if (rect.width === 0) return
  canvas.width  = rect.width  * dpr
  canvas.height = rect.height * dpr
  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)

  const W = rect.width, H = rect.height
  const pad = { top: 12, right: 16, bottom: 26, left: 52 }
  const cw = W - pad.left - pad.right
  const ch = H - pad.top  - pad.bottom

  ctx.fillStyle = TM_BG
  ctx.fillRect(0, 0, W, H)

  const n = history.length
  if (n < 2) return

  // Max across total runtime
  const maxMs = Math.max(...history.map(r => r.runtime_ms), 1)
  const xOf = i => pad.left + (i / (n - 1)) * cw
  const yOf = ms => pad.top + ch - Math.min(1, ms / maxMs) * ch

  // Grid
  ctx.strokeStyle = TM_GRID; ctx.lineWidth = 0.5
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + ch * i / 4
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cw, y); ctx.stroke()
  }

  // Total line (white, thin)
  drawLine(ctx, history.map((r, i) => [xOf(i), yOf(r.runtime_ms)]), '#e2e8f066', 1)

  // Per-step lines — only for runs that have steps data
  STEP_KEYS.forEach((key, si) => {
    const pts = history.map((r, i) => {
      const ms = r.steps?.[key] ?? null
      return ms !== null ? [xOf(i), yOf(ms)] : null
    }).filter(Boolean)
    if (pts.length >= 2) drawLine(ctx, pts, STEP_COLORS[si], 1.8)
  })

  // Y axis labels
  ctx.font = '9px JetBrains Mono, monospace'; ctx.textAlign = 'right'
  ctx.fillStyle = '#2a5570'
  for (let i = 0; i <= 4; i++) {
    const v = maxMs * (1 - i / 4)
    ctx.fillText(Math.round(v) + 'ms', pad.left - 4, pad.top + ch * i / 4 + 3)
  }

  // X axis labels
  ctx.textAlign = 'center'; ctx.fillStyle = '#1e4060'
  const every = Math.max(1, Math.ceil(n / 12))
  history.forEach((r, i) => {
    if (i % every === 0 || i === n - 1)
      ctx.fillText(String(r.id), xOf(i), pad.top + ch + 13)
  })
  ctx.fillStyle = '#1a3550'
  ctx.fillText('Run #', pad.left + cw / 2, H - 2)

  // Annotation: mark the latest run's dominant step
  const last = history[n - 1]
  if (last.steps) {
    const vals = STEP_KEYS.map(k => last.steps[k] ?? 0)
    const maxIdx = vals.indexOf(Math.max(...vals))
    const labels = ['Z-start', 'DP select', 'Post-process', 'Summary']
    ctx.font = 'bold 8px JetBrains Mono, monospace'
    ctx.fillStyle = STEP_COLORS[maxIdx]
    ctx.textAlign = 'right'
    ctx.fillText(`← bottleneck: ${labels[maxIdx]} (${vals[maxIdx].toFixed(0)}ms)`,
      xOf(n - 1) - 4, yOf(vals[maxIdx]) - 4)
  }
}

function drawLine(ctx, pts, color, width) {
  if (pts.length < 2) return
  ctx.beginPath()
  pts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y))
  ctx.strokeStyle = color
  ctx.lineWidth   = width
  ctx.stroke()
  // Dots at each point
  pts.forEach(([x, y]) => {
    ctx.beginPath()
    ctx.arc(x, y, width + 0.5, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
  })
}

// ── Task-Manager style CPU grid ───────────────────────────────────────────────
function drawCpuGrid(canvas, history, currentCores) {
  const dpr  = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  if (rect.width === 0) return
  canvas.width  = rect.width  * dpr
  canvas.height = rect.height * dpr
  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)

  const W = rect.width, H = rect.height
  const n    = currentCores.length
  const COLS = 4
  const ROWS = Math.ceil(n / COLS)
  const cw   = W / COLS
  const ch   = H / ROWS

  // Full background
  ctx.fillStyle = TM_BG
  ctx.fillRect(0, 0, W, H)

  currentCores.forEach((pct, i) => {
    const col  = i % COLS
    const row  = Math.floor(i / COLS)
    const x0   = col * cw
    const y0   = row * ch
    const hist = history[i] || []
    drawCell(ctx, x0, y0, cw, ch, hist, pct, i)
  })
}

function drawCell(ctx, x0, y0, w, h, hist, pct, index) {
  const GAP  = 2
  const TITLE_H = 16
  const px = x0 + GAP
  const py = y0 + GAP + TITLE_H
  const pw = w - GAP * 2
  const ph = h - GAP * 2 - TITLE_H

  // Cell background
  ctx.fillStyle = TM_CELL
  ctx.fillRect(px, py, pw, ph)

  // Title bar
  ctx.fillStyle = TM_BG
  ctx.fillRect(x0 + GAP, y0 + GAP, pw, TITLE_H)

  // "CPU N" label
  ctx.font      = `bold 9px JetBrains Mono, monospace`
  ctx.fillStyle = TM_LINE
  ctx.textAlign = 'left'
  ctx.fillText(`CPU ${index}`, px + 3, y0 + GAP + TITLE_H - 4)

  // Percentage
  ctx.textAlign = 'right'
  ctx.fillStyle = pct > 80 ? '#ef4444' : pct > 50 ? '#f59e0b' : TM_LINE
  ctx.fillText(`${Math.round(pct)}%`, px + pw - 2, y0 + GAP + TITLE_H - 4)

  // Clip to cell area for chart drawing
  ctx.save()
  ctx.beginPath()
  ctx.rect(px, py, pw, ph)
  ctx.clip()

  // Horizontal grid lines at 25 / 50 / 75 %
  ctx.strokeStyle = TM_GRID
  ctx.lineWidth   = 0.5
  ;[0.25, 0.5, 0.75].forEach(f => {
    const gy = py + ph * (1 - f)
    ctx.beginPath(); ctx.moveTo(px, gy); ctx.lineTo(px + pw, gy); ctx.stroke()
  })

  // Vertical grid lines (divide into 4 time segments)
  ;[0.25, 0.5, 0.75].forEach(f => {
    const gx = px + pw * f
    ctx.beginPath(); ctx.moveTo(gx, py); ctx.lineTo(gx, py + ph); ctx.stroke()
  })

  // Draw history line + fill
  if (hist.length >= 2) {
    const xStep  = pw / (HISTORY_LEN - 1)
    // Start position: right-align so newest reading is at the right edge
    const startX = px + pw - (hist.length - 1) * xStep

    const points = hist.map((v, j) => ({
      x: startX + j * xStep,
      y: py + ph - (Math.min(100, Math.max(0, v)) / 100) * ph,
    }))

    // Fill
    ctx.beginPath()
    ctx.moveTo(points[0].x, py + ph)
    points.forEach(p => ctx.lineTo(p.x, p.y))
    ctx.lineTo(points[points.length - 1].x, py + ph)
    ctx.closePath()
    ctx.fillStyle = TM_FILL
    ctx.fill()

    // Line
    ctx.beginPath()
    points.forEach((p, j) => j === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
    ctx.strokeStyle = TM_LINE
    ctx.lineWidth   = 1.2
    ctx.stroke()
  }

  ctx.restore()

  // Cell border
  ctx.strokeStyle = TM_BORD
  ctx.lineWidth   = 1
  ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1)
}

// ── Optimization run history bar chart ───────────────────────────────────────
function drawHistoryChart(canvas, history) {
  const dpr  = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  if (rect.width === 0) return
  canvas.width  = rect.width  * dpr
  canvas.height = rect.height * dpr
  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)

  const W = rect.width, H = rect.height
  const pad = { top: 12, right: 16, bottom: 26, left: 48 }
  const cw  = W - pad.left - pad.right
  const ch  = H - pad.top  - pad.bottom

  ctx.fillStyle = TM_BG
  ctx.fillRect(0, 0, W, H)

  const n     = history.length
  const maxMs = Math.max(...history.map(r => r.runtime_ms), 1)
  const yS    = v => pad.top + ch - (v / maxMs) * ch
  const step  = cw / n
  const barW  = Math.max(2, Math.min(24, step * 0.72))

  // Grid
  ctx.strokeStyle = TM_GRID; ctx.lineWidth = 0.5
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + ch * i / 4
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cw, y); ctx.stroke()
  }

  // Bars
  history.forEach((r, i) => {
    const x = pad.left + step * i + step / 2 - barW / 2
    const y = yS(r.runtime_ms)
    ctx.fillStyle = r.mode === 'rust' ? '#f59e0b' : '#3b82f6'
    ctx.fillRect(x, y, barW, pad.top + ch - y)
  })

  // Y labels
  ctx.font = '9px JetBrains Mono, monospace'; ctx.textAlign = 'right'
  ctx.fillStyle = '#2a5570'
  for (let i = 0; i <= 4; i++) {
    const v = maxMs * (1 - i / 4)
    ctx.fillText(Math.round(v) + 'ms', pad.left - 4, pad.top + ch * i / 4 + 3)
  }

  // X run labels
  ctx.textAlign = 'center'; ctx.fillStyle = '#1e4060'
  const every = Math.max(1, Math.ceil(n / 12))
  history.forEach((r, i) => {
    if (i % every === 0 || i === n - 1)
      ctx.fillText(String(r.id), pad.left + step * i + step / 2, pad.top + ch + 13)
  })
  ctx.fillStyle = '#1a3550'
  ctx.fillText('Run #', pad.left + cw / 2, H - 2)
}
