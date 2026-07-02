import { useState, useRef, useEffect } from 'react'

export default function UploadPanel({ onUploaded }) {
  const [dragging,  setDragging]  = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error,     setError]     = useState(null)
  const [models,    setModels]    = useState([])
  const [loading,   setLoading]   = useState(null)   // filename being preloaded
  const inputRef = useRef()

  // Fetch available server-side models on mount
  useEffect(() => {
    fetch('/api/available-models')
      .then(r => r.json())
      .then(d => setModels(d.models || []))
      .catch(() => {})
  }, [])

  const handleFile = async (file) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Only CSV files are supported.')
      return
    }
    setError(null)
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res  = await fetch('/api/upload', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Upload failed')
      onUploaded(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  const handlePreload = async (filename) => {
    setError(null)
    setLoading(filename)
    try {
      const res  = await fetch('/api/preload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Preload failed')
      onUploaded(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(null)
    }
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    handleFile(e.dataTransfer.files[0])
  }

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: '1.0rem', fontWeight: 700, color: 'var(--text)' }}>Load Block Model</div>

      {/* Server-side model list */}
      {models.length > 0 && (
        <div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Available Datasets (server-side)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {models.map(m => (
              <button
                key={m.filename}
                onClick={() => handlePreload(m.filename)}
                disabled={loading === m.filename}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', cursor: 'pointer',
                  color: 'var(--text)', fontSize: '0.78rem', textAlign: 'left',
                  opacity: loading && loading !== m.filename ? 0.5 : 1,
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--primary)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
              >
                <span style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem' }}>
                  {loading === m.filename
                    ? <><span style={{ marginRight: 6 }}>⏳</span>Loading…</>
                    : m.filename
                  }
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginLeft: 8, whiteSpace: 'nowrap' }}>
                  {m.size_mb} MB
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Upload Your Own CSV
        </div>
        <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginBottom: 10 }}>
          Columns required: <span style={{ fontFamily: 'var(--mono)', color: 'var(--primary)' }}>XC, YC, ZC, AU, DENSITY</span>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? 'var(--primary)' : 'var(--border)'}`,
            borderRadius: 'var(--radius)',
            background: dragging ? 'rgba(245,158,11,0.06)' : 'var(--bg)',
            padding: '24px 16px',
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
        >
          <div style={{ fontSize: '1.6rem', marginBottom: 6 }}>📂</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {uploading
              ? <><span className="spinner" style={{ display: 'inline-block', marginRight: 6 }} /> Processing…</>
              : 'Drag & drop CSV here, or click to browse'
            }
          </div>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        style={{ display: 'none' }}
        onChange={e => handleFile(e.target.files[0])}
      />

      {error && (
        <div style={{
          background: '#2d0a0a', border: '1px solid #ef4444',
          borderRadius: 'var(--radius)', padding: '8px 12px',
          fontSize: '0.78rem', color: '#ef4444',
        }}>
          ✗ {error}
        </div>
      )}
    </div>
  )
}
