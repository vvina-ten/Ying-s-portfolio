import { useState, useEffect } from 'react'
import ParameterPanel    from './components/ParameterPanel.jsx'
import StopViewer3D      from './components/StopViewer3D.jsx'
import ReportTable       from './components/ReportTable.jsx'
import ScenarioCompare   from './components/ScenarioCompare.jsx'
import UploadPanel       from './components/UploadPanel.jsx'
import GradeTonnageCurve from './components/GradeTonnageCurve.jsx'
import PerformancePanel  from './components/PerformancePanel.jsx'

// SVG logo — diamond/ore crystal icon
const Logo = () => (
  <svg className="logo-icon" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <polygon points="16,3 29,12 24,29 8,29 3,12" stroke="#f59e0b" strokeWidth="1.5" fill="none"/>
    <polygon points="16,3 29,12 16,16" fill="#f59e0b" opacity="0.6"/>
    <polygon points="16,3 3,12 16,16" fill="#f59e0b" opacity="0.3"/>
    <polygon points="3,12 8,29 16,16" fill="#f59e0b" opacity="0.45"/>
    <polygon points="29,12 24,29 16,16" fill="#f59e0b" opacity="0.7"/>
    <polygon points="8,29 24,29 16,16" fill="#f59e0b" opacity="0.9"/>
  </svg>
)

const TABS = ['3D View', 'Report Table', 'Compare Scenarios', 'Grade–Tonnage', 'Performance']

const GOLD_FALLBACK_USD = 3300  // fallback if API unreachable

export default function App() {
  const [tab,       setTab]       = useState(0)
  const [stopes,    setStopes]    = useState(null)
  const [summary,   setSummary]   = useState(null)
  const [loading,   setLoading]   = useState(false)
  const [status,    setStatus]    = useState('loading')  // 'loading' | 'processing' | 'ready' | 'error'
  const [loadTime,  setLoadTime]  = useState(null)
  const [filename,  setFilename]  = useState(null)
  const [goldPrice, setGoldPrice] = useState(GOLD_FALLBACK_USD)
  const [showUpload, setShowUpload] = useState(false)
  const [showDxfUpload, setShowDxfUpload] = useState(false)
  const [dxfStatus, setDxfStatus] = useState(null)  // null | 'uploading' | 'done' | 'error'

  // Poll /api/status until model is loaded
  useEffect(() => {
    let attempts = 0
    const poll = async () => {
      try {
        const res  = await fetch('/api/status')
        const data = await res.json()
        if (data.loaded) {
          setStatus('ready')
          setLoadTime(data.load_time_s)
          if (data.filename) setFilename(data.filename)
          clearInterval(timer)
        } else if (data.processing) {
          setStatus('processing')
          attempts = 0  // reset timeout while actively processing
        } else {
          attempts++
          if (attempts > 60) { setStatus('error'); clearInterval(timer) }
        }
      } catch {
        attempts++
        if (attempts > 60) { setStatus('error'); clearInterval(timer) }
      }
    }
    const timer = setInterval(poll, 1000)
    poll()
    return () => clearInterval(timer)
  }, [])

  // After upload completes, re-poll until ready
  const handleUploaded = (uploadResult) => {
    setShowUpload(false)
    setStatus('processing')
    setStopes(null)
    setSummary(null)
    setFilename(uploadResult.filename)
    // re-poll status
    let attempts = 0
    const timer = setInterval(async () => {
      try {
        const res  = await fetch('/api/status')
        const data = await res.json()
        if (data.loaded) {
          setStatus('ready')
          setLoadTime(data.load_time_s)
          clearInterval(timer)
        } else {
          attempts++
          if (attempts > 120) { setStatus('error'); clearInterval(timer) }
        }
      } catch { attempts++ }
    }, 500)
  }

  // Fetch live gold spot price via backend proxy (avoids browser CORS)
  useEffect(() => {
    const fetchGold = async () => {
      try {
        const r = await fetch('/api/gold-price')
        const d = await r.json()
        if (d.price && d.price > 100) {
          console.log('[gold] live price:', d.price, 'via', d.source)
          setGoldPrice(Math.round(d.price))
        }
      } catch (e) {
        console.warn('[gold] fetch failed, keeping current value', e)
      }
    }
    fetchGold()
    const timer = setInterval(fetchGold, 5 * 60 * 1000)
    return () => clearInterval(timer)
  }, [])

  const handleRun = async (cutoff, pillarBlocks = 1, zStart = null, economics = null) => {
    setLoading(true)
    try {
      const body = { cutoff_grade: cutoff, pillar_blocks: pillarBlocks }
      if (zStart !== null) body.z_start = zStart
      if (economics !== null) body.economics = economics
      const res  = await fetch('/api/optimize', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const data = await res.json()
      setStopes(data.stopes)
      setSummary(data.summary)
      setTab(0)  // jump to 3D view
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const handleUploadDxf = async (file) => {
    if (!file) return
    setDxfStatus('uploading')
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/upload/dxf', { method: 'POST', body: form })
      if (!res.ok) throw new Error('Upload failed')
      setDxfStatus('done')
      setTimeout(() => { setShowDxfUpload(false); setDxfStatus(null) }, 1800)
    } catch {
      setDxfStatus('error')
    }
  }

  const handleDownloadDXF = () => {
    const cutoffVal = summary?.cutoff_grade_used ?? 10.0
    window.open(`/api/export/dxf?cutoff=${cutoffVal}`, '_blank')
  }

  const handleDownloadCSV = async () => {
    const cutoffVal = summary?.cutoff_grade_used ?? 10.0
    window.open(`/api/export/csv?cutoff=${cutoffVal}`, '_blank')
  }

  return (
    <div className="app-shell">
      {/* Top bar */}
      <header className="topbar">
        <div className="topbar-logo">
          <Logo />
          <div>
            <div className="topbar-title">OreVista</div>
            <div className="topbar-tagline">See Your Gold. Mine Smarter.</div>
          </div>
        </div>
        <div className="topbar-spacer" />

        {/* Live gold price + NSV */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: '0.75rem', lineHeight: 1.3, textAlign: 'right' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>Au spot</div>
            <div style={{ color: 'var(--primary)', fontFamily: 'var(--mono)', fontWeight: 600 }}>
              ${goldPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}/oz
            </div>
          </div>
          {summary && summary.total_gold_oz > 0 && (
            <div style={{ fontSize: '0.75rem', lineHeight: 1.3, textAlign: 'right', borderLeft: '1px solid var(--border)', paddingLeft: 12 }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>Total NSV</div>
              <div style={{ color: 'var(--accent)', fontFamily: 'var(--mono)', fontWeight: 600 }}>
                ${(summary.total_gold_oz * goldPrice / 1e6).toFixed(1)}M
              </div>
            </div>
          )}
        </div>

        {/* Download buttons (shown after a run) */}
        {stopes && stopes.length > 0 && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={handleDownloadDXF}>
              ↓ DXF
            </button>
            <button className="btn btn-ghost btn-sm" onClick={handleDownloadCSV}>
              ↓ CSV
            </button>
          </div>
        )}

        {/* Upload buttons */}
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setShowUpload(v => !v)}
          title="Upload a new block model CSV"
          style={{ fontSize: '0.75rem' }}
        >
          ↑ Upload CSV
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => { setShowDxfUpload(true); setDxfStatus(null) }}
          title="Upload a DXF constraint / boundary file"
          style={{ fontSize: '0.75rem' }}
        >
          ↑ Upload DXF
        </button>

        <span className={`status-pill ${status}`}>
          {status === 'loading'    && '⏳ Loading model…'}
          {status === 'processing' && '⏳ Processing…'}
          {status === 'ready'      && `✓ ${filename ?? 'Model ready'}`}
          {status === 'error'      && '✗ Server error'}
        </span>
      </header>

      {/* Upload overlay */}
      {showUpload && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
          onClick={e => { if (e.target === e.currentTarget) setShowUpload(false) }}
        >
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', minWidth: 480, maxWidth: 560,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text)' }}>Upload Block Model</span>
              <button onClick={() => setShowUpload(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.1rem' }}>✕</button>
            </div>
            <UploadPanel onUploaded={handleUploaded} />
          </div>
        </div>
      )}

      {/* DXF Upload overlay */}
      {showDxfUpload && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
          onClick={e => { if (e.target === e.currentTarget) { setShowDxfUpload(false); setDxfStatus(null) } }}
        >
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', minWidth: 400, maxWidth: 480,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text)' }}>Upload DXF File</span>
              <button onClick={() => { setShowDxfUpload(false); setDxfStatus(null) }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.1rem' }}>✕</button>
            </div>
            <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Upload a DXF file containing pit limits, domain boundaries, or reference geometry to overlay on the 3D view.
              </p>
              <label style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                border: '2px dashed var(--border)', borderRadius: 8, padding: '24px 16px',
                cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.82rem',
                transition: 'border-color 0.15s',
              }}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); handleUploadDxf(e.dataTransfer.files[0]) }}
              >
                <span style={{ fontSize: '1.6rem' }}>📐</span>
                {dxfStatus === null    && <span>Drag &amp; drop a <strong>.dxf</strong> file here, or click to browse</span>}
                {dxfStatus === 'uploading' && <span style={{ color: 'var(--primary)' }}>Uploading…</span>}
                {dxfStatus === 'done'  && <span style={{ color: '#22c55e' }}>✓ DXF uploaded successfully</span>}
                {dxfStatus === 'error' && <span style={{ color: '#ef4444' }}>✗ Upload failed — check file format</span>}
                <input type="file" accept=".dxf" style={{ display: 'none' }}
                  onChange={e => handleUploadDxf(e.target.files[0])} />
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Main layout */}
      <div className="main-content">
        {/* Sidebar — parameter panel */}
        <aside className="sidebar">
          <ParameterPanel
            onRun={handleRun}
            loading={loading || status === 'loading'}
            summary={summary}
            loadTime={loadTime}
            goldPrice={goldPrice}
          />
        </aside>

        {/* Content pane with tabs */}
        <main className="main-panel">
          <div className="tab-bar">
            {TABS.map((t, idx) => (
              <button
                key={t}
                className={`tab-btn ${tab === idx ? 'active' : ''}`}
                onClick={() => setTab(idx)}
              >
                {t}
                {idx === 0 && stopes && (
                  <span style={{ marginLeft: 6, fontSize: '0.7rem', color: 'var(--accent)' }}>
                    {stopes.length.toLocaleString()}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="tab-content">
            {tab === 0 && <StopViewer3D stopes={stopes} />}
            {tab === 1 && <ReportTable stopes={stopes} summary={summary} />}
            {tab === 2 && <ScenarioCompare goldPrice={goldPrice} />}
            {tab === 3 && <GradeTonnageCurve cutoff={summary?.cutoff_grade_used ?? 10} />}
            {/* Always mounted so CPU polling & history survive tab switches */}
            <div style={{ display: tab === 4 ? 'contents' : 'none' }}>
              <PerformancePanel visible={tab === 4} />
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
