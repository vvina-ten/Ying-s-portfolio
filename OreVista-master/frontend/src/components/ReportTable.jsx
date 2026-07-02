import { useState } from 'react'
import StopDetailModal from './StopDetailModal.jsx'

// Column groups matching Datamine MSO / Deswik.SO industry standard output
const COLUMNS = [
  // Identity
  { key: 'stope_id',      label: 'Stope ID',          group: 'id',   fmt: v => v,                                               align: 'left'  },
  { key: 'level_name',    label: 'Level',             group: 'id',   fmt: v => v ?? '—',                                        align: 'left'  },
  // World coordinates (centroid)
  { key: 'easting',       label: 'Easting (m)',        group: 'coord',fmt: v => v?.toFixed(1) ?? '—',                            align: 'right' },
  { key: 'northing',      label: 'Northing (m)',       group: 'coord',fmt: v => v?.toFixed(1) ?? '—',                            align: 'right' },
  { key: 'rl',            label: 'RL (m)',             group: 'coord',fmt: v => v?.toFixed(1) ?? '—',                            align: 'right' },
  // Geometry
  { key: 'strike_length', label: 'Strike (m)',         group: 'geom', fmt: v => v?.toFixed(0) ?? '—',                            align: 'right' },
  { key: 'stope_height',  label: 'Height (m)',         group: 'geom', fmt: v => v?.toFixed(0) ?? '—',                            align: 'right' },
  { key: 'stope_width',   label: 'Width (m)',          group: 'geom', fmt: v => v?.toFixed(0) ?? '—',                            align: 'right' },
  // Tonnage
  { key: 'ore_tonnes',    label: 'Ore Tonnes (t)',     group: 'mass', fmt: v => v?.toLocaleString() ?? '—',                      align: 'right' },
  { key: 'tonnes',        label: 'Total Tonnes (t)',   group: 'mass', fmt: v => v?.toLocaleString() ?? '—',                      align: 'right' },
  { key: 'dilution_pct',  label: 'Dilution %',         group: 'mass', fmt: v => v != null ? v.toFixed(1) + '%' : '—',           align: 'right' },
  // Grade & metal
  { key: 'head_grade',    label: 'Head Grade (g/t)',   group: 'grade',fmt: v => v?.toFixed(2) ?? '—',                            align: 'right' },
  { key: 'contained_oz',  label: 'Contained Au (oz)',  group: 'metal',fmt: v => v?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '—', align: 'right' },
  { key: 'recovered_oz',  label: 'Recovered Au (oz)',  group: 'metal',fmt: v => v?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '—', align: 'right' },
  // Economics
  { key: 'nsr_per_t',     label: 'NSR ($/t)',          group: 'econ', fmt: v => v != null ? '$' + v.toFixed(0) : '—',           align: 'right' },
  { key: 'nsv_usd',       label: 'Total NSR ($)',      group: 'econ', fmt: v => v != null ? '$' + (v / 1e6).toFixed(3) + 'M' : '—', align: 'right' },
]

const GROUP_COLORS = {
  id:    '#6b7280',
  coord: '#60a5fa',
  geom:  '#8b5cf6',
  mass:  '#f59e0b',
  grade: '#10b981',
  metal: '#f59e0b',
  econ:  '#4ade80',
}

export default function ReportTable({ stopes, summary }) {
  const [sortKey,  setSortKey]  = useState('head_grade')
  const [sortDesc, setSortDesc] = useState(true)
  const [search,   setSearch]   = useState('')
  const [page,     setPage]     = useState(0)
  const [hiddenGroups, setHiddenGroups] = useState(new Set(['geom']))
  const [selected, setSelected] = useState(null)  // geometry collapsed by default
  const PAGE_SIZE = 50

  if (!stopes || stopes.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">📋</div>
        <div>No results yet — run optimization first</div>
      </div>
    )
  }

  const toggleGroup = (g) => setHiddenGroups(prev => {
    const next = new Set(prev)
    next.has(g) ? next.delete(g) : next.add(g)
    return next
  })

  const visibleCols = COLUMNS.filter(c => !hiddenGroups.has(c.group))

  const handleSort = (key) => {
    if (key === sortKey) setSortDesc(d => !d)
    else { setSortKey(key); setSortDesc(true) }
    setPage(0)
  }

  const filtered = stopes.filter(s =>
    s.stope_id.toLowerCase().includes(search.toLowerCase()) ||
    (s.level_name ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const sorted = [...filtered].sort((a, b) => {
    const va = a[sortKey] ?? 0, vb = b[sortKey] ?? 0
    if (typeof va === 'string') return sortDesc ? vb.localeCompare(va) : va.localeCompare(vb)
    return sortDesc ? vb - va : va - vb
  })

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE)
  const pageRows   = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const totalContained = stopes.reduce((s, x) => s + (x.contained_oz ?? x.gold_oz ?? 0), 0)
  const totalRecovered = stopes.reduce((s, x) => s + (x.recovered_oz ?? 0), 0)

  const GROUPS = [...new Set(COLUMNS.map(c => c.group))]

  return (
    <>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Summary strip */}
      {summary && (
        <div style={{
          display: 'flex', gap: 0, borderBottom: '1px solid var(--border)',
          background: '#0d1117', flexWrap: 'wrap',
        }}>
          {[
            { label: 'Stopes',       value: stopes.length.toLocaleString(),                          color: 'var(--text)' },
            { label: 'Ore',          value: (summary.total_ore_tonnes / 1e6).toFixed(2) + ' Mt',     color: '#f59e0b' },
            { label: 'Total Mined',  value: (summary.total_tonnes / 1e6).toFixed(2) + ' Mt',         color: '#6b7280' },
            { label: 'Head Grade',   value: summary.avg_grade_gt.toFixed(2) + ' g/t',                color: '#10b981' },
            { label: 'Dilution',     value: (summary.overall_dilution_pct ?? 0).toFixed(1) + '%',    color: '#f59e0b' },
            { label: 'Contained Au', value: (totalContained / 1000).toFixed(1) + ' koz',             color: '#f59e0b' },
            { label: 'Recovered Au', value: (totalRecovered / 1000).toFixed(1) + ' koz',             color: '#4ade80' },
            { label: 'Avg NSR',      value: '$' + (summary.avg_nsr_per_t ?? 0).toFixed(0) + '/t',   color: '#4ade80' },
            ...(summary.total_nsv_usd != null
              ? [{ label: 'Total NSR', value: '$' + (summary.total_nsv_usd / 1e6).toFixed(1) + 'M', color: '#4ade80' }]
              : []),
          ].map(({ label, value, color }) => (
            <div key={label} style={{
              display: 'flex', flexDirection: 'column', padding: '6px 14px',
              borderRight: '1px solid var(--border)',
            }}>
              <span style={{ fontSize: '0.58rem', color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
              <span style={{ fontSize: '0.8rem', color, fontFamily: 'var(--mono)', fontWeight: 700 }}>{value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border)', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Filter by stope ID or level…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0) }}
          style={{
            background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', color: 'var(--text)',
            fontSize: '0.78rem', padding: '4px 10px',
            fontFamily: 'var(--mono)', width: 200,
          }}
        />

        {/* Column group toggles */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {[
            { g: 'coord', label: 'Coords'  },
            { g: 'geom',  label: 'Geometry' },
            { g: 'mass',  label: 'Tonnage'  },
            { g: 'grade', label: 'Grade'    },
            { g: 'metal', label: 'Metal'    },
            { g: 'econ',  label: 'NSR'      },
          ].map(({ g, label }) => {
            const hidden = hiddenGroups.has(g)
            return (
              <button key={g} type="button" onClick={() => toggleGroup(g)} style={{
                background: hidden ? 'transparent' : GROUP_COLORS[g] + '22',
                border: `1px solid ${hidden ? '#1f2937' : GROUP_COLORS[g]}`,
                borderRadius: 4, color: hidden ? '#374151' : GROUP_COLORS[g],
                fontSize: '0.62rem', fontWeight: 600, padding: '2px 7px',
                cursor: 'pointer', fontFamily: 'Inter',
              }}>
                {hidden ? '+ ' : '✕ '}{label}
              </button>
            )
          })}
        </div>

        <span style={{ flex: 1 }} />

        {totalPages > 1 && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>‹</button>
            <span>{page + 1} / {totalPages}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}>›</button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {visibleCols.map(col => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  style={{
                    cursor: 'pointer', textAlign: col.align, userSelect: 'none',
                    borderBottom: `2px solid ${GROUP_COLORS[col.group]}33`,
                    color: GROUP_COLORS[col.group],
                  }}
                >
                  {col.label}
                  {sortKey === col.key && (
                    <span style={{ marginLeft: 4, color: 'var(--primary)' }}>
                      {sortDesc ? '▼' : '▲'}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map(s => (
              <tr
                key={s.stope_id}
                onClick={() => setSelected(s)}
                style={{ cursor: 'pointer' }}
                title="Click to view stope details"
              >
                {visibleCols.map(col => (
                  <td key={col.key} style={{ textAlign: col.align }}>
                    {col.fmt(s[col.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>

    {selected && (
      <StopDetailModal
        stope={selected}
        allStopes={stopes}
        onClose={() => setSelected(null)}
      />
    )}
    </>
  )
}
