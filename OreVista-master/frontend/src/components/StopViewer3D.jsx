import { useMemo, useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, Html, GizmoHelper, GizmoViewport } from '@react-three/drei'
import * as THREE from 'three'
import StopDetailModal from './StopDetailModal.jsx'

// ── Grade → Three.js Color (green → amber → red) ─────────────────────────────
const C_LOW  = new THREE.Color('#10b981')
const C_MID  = new THREE.Color('#f59e0b')
const C_HIGH = new THREE.Color('#ef4444')

function gradeColor(grade, minG, maxG, out = new THREE.Color()) {
  const t = maxG > minG ? Math.max(0, Math.min(1, (grade - minG) / (maxG - minG))) : 0.5
  return t < 0.5
    ? out.lerpColors(C_LOW, C_MID, t * 2)
    : out.lerpColors(C_MID, C_HIGH, (t - 0.5) * 2)
}

// ── Reusable temporaries (avoid GC pressure) ──────────────────────────────────
const _mat = new THREE.Matrix4()
const _col = new THREE.Color()

// ── Instanced stope boxes ─────────────────────────────────────────────────────
function StopeMesh({ stopes, center, gradeRange, onHover, onSelect }) {
  const meshRef = useRef()

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh || !stopes.length) return

    stopes.forEach((s, i) => {
      // Map mining coords → Three.js: X=Easting, Y=Elevation(Z), Z=Northing(Y)
      const cx = (s.x_min + s.x_max) / 2 - center.x
      const cy = (s.z_min + s.z_max) / 2 - center.z
      const cz = (s.y_min + s.y_max) / 2 - center.y
      const sx = s.x_max - s.x_min
      const sy = s.z_max - s.z_min
      const sz = s.y_max - s.y_min

      _mat.makeScale(sx, sy, sz)
      _mat.setPosition(cx, cy, cz)
      mesh.setMatrixAt(i, _mat)

      gradeColor(s.avg_grade, gradeRange.min, gradeRange.max, _col)
      mesh.setColorAt(i, _col)
    })

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [stopes, center, gradeRange])

  return (
    <instancedMesh
      ref={meshRef}
      args={[null, null, stopes.length]}
      onPointerOver={e => {
        e.stopPropagation()
        document.body.style.cursor = 'pointer'
        onHover(e.instanceId)
      }}
      onPointerOut={() => {
        document.body.style.cursor = 'auto'
        onHover(null)
      }}
      onClick={e => {
        e.stopPropagation()
        onSelect(stopes[e.instanceId])
      }}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial transparent opacity={0.85} />
    </instancedMesh>
  )
}

// ── Hovered stope wireframe highlight ─────────────────────────────────────────
function HoverHighlight({ stope, center }) {
  if (!stope) return null
  return (
    <mesh
      position={[
        (stope.x_min + stope.x_max) / 2 - center.x,
        (stope.z_min + stope.z_max) / 2 - center.z,
        (stope.y_min + stope.y_max) / 2 - center.y,
      ]}
      scale={[
        stope.x_max - stope.x_min + 1.5,
        stope.z_max - stope.z_min + 1.5,
        stope.y_max - stope.y_min + 1.5,
      ]}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.5} />
    </mesh>
  )
}

// ── Ore block point cloud ─────────────────────────────────────────────────────
function OreBlocks({ blockData, center }) {
  const geo = useMemo(() => {
    const n = blockData.x.length
    const pos  = new Float32Array(n * 3)
    const cols = new Float32Array(n * 3)
    const grades = blockData.grade
    let minG = Infinity, maxG = -Infinity
    for (let i = 0; i < n; i++) { if (grades[i] < minG) minG = grades[i]; if (grades[i] > maxG) maxG = grades[i] }
    const col = new THREE.Color()
    for (let i = 0; i < n; i++) {
      pos[i*3]   = blockData.x[i] - center.x
      pos[i*3+1] = blockData.z[i] - center.z   // elevation → Y
      pos[i*3+2] = blockData.y[i] - center.y   // northing → Z
      gradeColor(grades[i], minG, maxG, col)
      cols[i*3] = col.r; cols[i*3+1] = col.g; cols[i*3+2] = col.b
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('color',    new THREE.BufferAttribute(cols, 3))
    g.computeBoundingSphere()
    return g
  }, [blockData, center])

  return (
    <points geometry={geo}>
      <pointsMaterial size={3} vertexColors transparent opacity={0.5} sizeAttenuation={false} />
    </points>
  )
}

// ── Camera preset controller ──────────────────────────────────────────────────
const PRESETS = {
  '3D':            { pos: r => [r*0.9, r*0.6, r*0.9], up: [0, 1, 0] },
  'Long Section':  { pos: r => [0,     r*0.05, r*2  ], up: [0, 1, 0] },
  'Plan View':     { pos: r => [0,     r*2,    0.01 ], up: [0, 0, -1] },
  'Cross Section': { pos: r => [r*2,   r*0.05, 0    ], up: [0, 1, 0] },
}

function CameraController({ view, radius, ctrlRef }) {
  const { camera } = useThree()

  useEffect(() => {
    const preset = PRESETS[view] ?? PRESETS['3D']
    const [x, y, z] = preset.pos(radius)
    camera.position.set(x, y, z)
    camera.up.set(...preset.up)
    camera.lookAt(0, 0, 0)
    camera.near = radius * 0.001
    camera.far  = radius * 20
    camera.updateProjectionMatrix()
    if (ctrlRef.current) {
      ctrlRef.current.target.set(0, 0, 0)
      ctrlRef.current.update()
    }
  }, [view, radius])

  return null
}

// ── Axis labels overlay ───────────────────────────────────────────────────────
function AxisLabels({ radius }) {
  return (
    <>
      <Html position={[radius, 0, 0]} center style={{ pointerEvents: 'none' }}>
        <span style={{ color: '#ef4444', fontSize: '0.6rem', fontFamily: 'JetBrains Mono', fontWeight: 700 }}>E →</span>
      </Html>
      <Html position={[0, 0, radius]} center style={{ pointerEvents: 'none' }}>
        <span style={{ color: '#60a5fa', fontSize: '0.6rem', fontFamily: 'JetBrains Mono', fontWeight: 700 }}>N →</span>
      </Html>
      <Html position={[0, radius * 0.7, 0]} center style={{ pointerEvents: 'none' }}>
        <span style={{ color: '#4ade80', fontSize: '0.6rem', fontFamily: 'JetBrains Mono', fontWeight: 700 }}>↑ Z (RL)</span>
      </Html>
    </>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
const VIEW_MODES = ['Stopes', 'Ore Body', 'Both']

export default function StopViewer3D({ stopes }) {
  const [displayMode,  setDisplayMode]  = useState('Stopes')
  const [blockData,    setBlockData]    = useState(null)
  const [blockLoading, setBlockLoading] = useState(false)
  const [blockError,   setBlockError]   = useState(null)
  const [minGrade,     setMinGrade]     = useState(2.0)
  const [view,         setView]         = useState('3D')
  const [hovered,      setHovered]      = useState(null)   // instance index
  const [selected,     setSelected]     = useState(null)   // stope object
  const ctrlRef = useRef()

  const showBlocks = displayMode === 'Ore Body' || displayMode === 'Both'
  const showStopes = displayMode === 'Stopes'   || displayMode === 'Both'

  useEffect(() => {
    if (!showBlocks) return
    setBlockLoading(true)
    setBlockError(null)
    fetch(`/api/blocks?min_grade=${minGrade}`)
      .then(r => r.json())
      .then(d => { setBlockData(d); setBlockLoading(false) })
      .catch(e => { setBlockError(e.message); setBlockLoading(false) })
  }, [showBlocks, minGrade])

  // Scene geometry — center and scale from stope bounds, with block data fallback
  const scene = useMemo(() => {
    let xMin=Infinity, xMax=-Infinity
    let yMin=Infinity, yMax=-Infinity
    let zMin=Infinity, zMax=-Infinity

    stopes?.forEach(s => {
      if (s.x_min < xMin) xMin = s.x_min; if (s.x_max > xMax) xMax = s.x_max
      if (s.y_min < yMin) yMin = s.y_min; if (s.y_max > yMax) yMax = s.y_max
      if (s.z_min < zMin) zMin = s.z_min; if (s.z_max > zMax) zMax = s.z_max
    })

    // When no stopes loaded yet, derive bounds from block data so camera is positioned correctly
    if (xMin === Infinity && blockData) {
      xMin = blockData.x_min; xMax = blockData.x_max
      yMin = blockData.y_min; yMax = blockData.y_max
      zMin = blockData.z_min; zMax = blockData.z_max
    }

    if (xMin === Infinity) return { center: { x: 0, y: 0, z: 0 }, radius: 100, gridY: -50 }

    const cx = (xMin + xMax) / 2
    const cy = (yMin + yMax) / 2
    const cz = (zMin + zMax) / 2
    const r  = Math.max(xMax - xMin, yMax - yMin, zMax - zMin) * 0.75
    return {
      center: { x: cx, y: cy, z: cz },
      radius: Math.max(r, 50),
      gridY:  zMin - cz - 5,
    }
  }, [stopes, blockData])

  const gradeRange = useMemo(() => {
    if (!stopes || !stopes.length) return { min: 0, max: 20 }
    let minG = Infinity, maxG = -Infinity
    stopes.forEach(s => { if (s.avg_grade < minG) minG = s.avg_grade; if (s.avg_grade > maxG) maxG = s.avg_grade })
    return { min: minG, max: maxG }
  }, [stopes])

  const hoveredStope = hovered !== null ? stopes?.[hovered] : null

  if (!stopes || !stopes.length) {
    return (
      <div className="empty-state">
        <div className="empty-icon">⛏</div>
        <div>Run optimization to visualize stopes</div>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>

      {/* ── Display mode toggle (top-left) ── */}
      <div style={{
        position: 'absolute', top: 8, left: 8, zIndex: 10,
        display: 'flex', alignItems: 'center', gap: 6,
        background: '#111827cc', border: '1px solid #1f2937',
        borderRadius: 8, padding: '6px 10px', backdropFilter: 'blur(4px)',
      }}>
        {VIEW_MODES.map(mode => (
          <button key={mode} onClick={() => setDisplayMode(mode)} style={{
            background: displayMode === mode ? '#f59e0b' : 'transparent',
            border: `1px solid ${displayMode === mode ? '#f59e0b' : '#374151'}`,
            borderRadius: 5, color: displayMode === mode ? '#0a0e1a' : '#9ca3af',
            fontSize: '0.7rem', fontWeight: displayMode === mode ? 700 : 400,
            padding: '3px 9px', cursor: 'pointer', fontFamily: 'Inter',
          }}>
            {mode}
          </button>
        ))}

        {showBlocks && (
          <>
            <div style={{ width: 1, height: 16, background: '#1f2937' }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', color: '#9ca3af' }}>
              Min grade
              <input
                type="number" min={0} max={22} step={0.5} value={minGrade}
                onChange={e => setMinGrade(parseFloat(e.target.value) || 0)}
                style={{
                  width: 52, background: '#0a0e1a', border: '1px solid #1f2937',
                  borderRadius: 4, color: '#f59e0b', fontFamily: 'JetBrains Mono',
                  fontSize: '0.75rem', padding: '2px 5px',
                }}
              />
              <span style={{ color: '#6b7280' }}>g/t</span>
            </label>
            {blockLoading && <span className="spinner" style={{ width: 12, height: 12 }} />}
            {blockData && (
              <span style={{ fontSize: '0.68rem', color: '#6b7280', fontFamily: 'JetBrains Mono' }}>
                {blockData.rendered < blockData.count
                  ? `${blockData.rendered.toLocaleString()} / ${blockData.count.toLocaleString()} blocks (sampled)`
                  : `${blockData.count.toLocaleString()} blocks`}
              </span>
            )}
            {blockError && (
              <span style={{ fontSize: '0.68rem', color: '#ef4444', fontFamily: 'JetBrains Mono' }}>
                {blockError}
              </span>
            )}
          </>
        )}
      </div>

      {/* ── Camera presets (top-right) ── */}
      <div style={{
        position: 'absolute', top: 8, right: 8, zIndex: 10,
        display: 'flex', gap: 4,
      }}>
        {Object.keys(PRESETS).map(v => (
          <button key={v} onClick={() => setView(v)} style={{
            background: view === v ? '#f59e0b' : '#111827cc',
            border: `1px solid ${view === v ? '#f59e0b' : '#1f2937'}`,
            borderRadius: 6, color: view === v ? '#0a0e1a' : '#9ca3af',
            fontSize: '0.68rem', fontWeight: view === v ? 700 : 400,
            padding: '4px 8px', cursor: 'pointer', fontFamily: 'Inter',
            backdropFilter: 'blur(4px)',
          }}>
            {v}
          </button>
        ))}
      </div>

      {/* ── Grade color bar (bottom-right) ── */}
      <div style={{
        position: 'absolute', bottom: 40, right: 16, zIndex: 10,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
      }}>
        <span style={{ fontSize: '0.58rem', color: '#9ca3af', fontFamily: 'JetBrains Mono' }}>
          {gradeRange.max.toFixed(1)}
        </span>
        <div style={{
          width: 10, height: 80,
          background: 'linear-gradient(to bottom, #ef4444, #f59e0b, #10b981)',
          borderRadius: 3, border: '1px solid #374151',
        }} />
        <span style={{ fontSize: '0.58rem', color: '#9ca3af', fontFamily: 'JetBrains Mono' }}>
          {gradeRange.min.toFixed(1)}
        </span>
        <span style={{ fontSize: '0.52rem', color: '#4b5563', marginTop: 1 }}>g/t Au</span>
      </div>

      {/* ── Stope count + instructions (bottom-left) ── */}
      <div style={{
        position: 'absolute', bottom: 8, left: 8, zIndex: 10,
        fontSize: '0.62rem', color: '#374151', fontFamily: 'JetBrains Mono',
        lineHeight: 1.5,
      }}>
        <div style={{ color: '#4b5563' }}>
          {stopes.length.toLocaleString()} stopes
          {hoveredStope && <span style={{ color: '#f59e0b' }}> · {hoveredStope.stope_id}</span>}
        </div>
        <div>Left drag: rotate · Right drag: pan · Scroll: zoom · Click: details</div>
      </div>

      {/* ── Three.js Canvas ── */}
      <Canvas
        style={{ width: '100%', height: '100%', background: '#060b14' }}
        camera={{ position: [scene.radius * 0.9, scene.radius * 0.6, scene.radius * 0.9], fov: 45 }}
        gl={{ antialias: true, alpha: false }}
      >
        {/* Lighting */}
        <ambientLight intensity={0.45} />
        <directionalLight position={[1, 2, 1.5]} intensity={0.9} castShadow={false} />
        <directionalLight position={[-1, 0.5, -1]} intensity={0.25} />

        {/* Controls */}
        <OrbitControls ref={ctrlRef} makeDefault enableDamping dampingFactor={0.08} />
        <CameraController view={view} radius={scene.radius} ctrlRef={ctrlRef} />

        {/* Ground grid */}
        <gridHelper
          args={[scene.radius * 2.5, 24, '#1a2236', '#111827']}
          position={[0, scene.gridY, 0]}
        />

        {/* Axis labels */}
        <AxisLabels radius={scene.radius * 0.9} />

        {/* Stope instanced mesh */}
        {showStopes && (
          <StopeMesh
            stopes={stopes}
            center={scene.center}
            gradeRange={gradeRange}
            onHover={setHovered}
            onSelect={setSelected}
          />
        )}

        {/* Hovered stope wireframe */}
        {showStopes && <HoverHighlight stope={hoveredStope} center={scene.center} />}

        {/* Ore block point cloud */}
        {showBlocks && blockData && (
          <OreBlocks blockData={blockData} center={scene.center} />
        )}

        {/* Hover tooltip */}
        {hoveredStope && (
          <Html
            position={[
              (hoveredStope.x_min + hoveredStope.x_max) / 2 - scene.center.x,
              hoveredStope.z_max - scene.center.z + scene.radius * 0.05,
              (hoveredStope.y_min + hoveredStope.y_max) / 2 - scene.center.y,
            ]}
            center
            style={{ pointerEvents: 'none' }}
          >
            <div style={{
              background: '#0d1117f0', border: '1px solid #f59e0b44',
              borderLeft: '2px solid #f59e0b',
              borderRadius: 6, padding: '7px 12px',
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: '0.68rem', color: '#e5e7eb',
              whiteSpace: 'nowrap', lineHeight: 1.7,
              boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
            }}>
              <div style={{ color: '#f59e0b', fontWeight: 700, marginBottom: 1 }}>
                {hoveredStope.stope_id}
              </div>
              <div>
                Grade: <span style={{ color: '#10b981' }}>
                  {(hoveredStope.head_grade ?? hoveredStope.avg_grade ?? 0).toFixed(2)} g/t
                </span>
              </div>
              {hoveredStope.nsv_usd != null && (
                <div>
                  NSR: <span style={{ color: '#4ade80' }}>
                    ${((hoveredStope.nsv_usd) / 1000).toFixed(0)}k
                  </span>
                </div>
              )}
              {hoveredStope.contained_oz != null && (
                <div>
                  Au: <span style={{ color: '#f59e0b' }}>
                    {hoveredStope.contained_oz.toFixed(0)} oz
                  </span>
                </div>
              )}
              <div style={{ color: '#4b5563', fontSize: '0.6rem', marginTop: 2 }}>
                Click to view full details ↗
              </div>
            </div>
          </Html>
        )}

        {/* Orientation gizmo (bottom-left of canvas) */}
        <GizmoHelper alignment="bottom-left" margin={[70, 70]}>
          <GizmoViewport
            axisColors={['#ef4444', '#4ade80', '#60a5fa']}
            labels={['X', 'Z', 'Y']}
            labelColor="#9ca3af"
          />
        </GizmoHelper>
      </Canvas>

      {/* Stope detail modal */}
      {selected && createPortal(
        <StopDetailModal
          stope={selected}
          allStopes={stopes}
          onClose={() => setSelected(null)}
        />,
        document.body
      )}
    </div>
  )
}
