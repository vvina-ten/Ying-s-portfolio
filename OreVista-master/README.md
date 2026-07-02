# OreVista — Gold Stope Optimizer

Full-stack web application for gold mine stope optimization, built for the **Hanson Venture Lab Hackathon 2026**.

Given a block model CSV, OreVista finds every economically viable stope, computes Net Smelter Value, and lets you interactively explore the ore body in 3D — all in under a second.

---

## Features

### Core Optimization
- **Sliding-window stope enumeration** — evaluates every valid 20 m × 5 m × 30 m stope position (4 × 1 × 6 blocks) across the full block model
- **1D dynamic-programming selector** — finds the globally optimal set of non-overlapping stopes per Y-strip per Z-level in O(n) time
- **Spec-compliant WAG** — Weighted Average Grade = `Σ(Vᵢ × Dᵢ × Gᵢ) / Σ(Vᵢ × Dᵢ)` using per-block volumes from XINC × YINC × ZINC
- **Full NSV model** — 11-parameter economic calculation (gold price, recovery, refining, smelting, transport, royalty, sustaining OPEX, development cost)
- **Grade-cutoff sweep** — Part 1 fixed 10 g/t; Part 2 real-time cutoff slider with instant re-rank
- **Grade-tonnage curve** — pre-computed over 0–50 g/t range

### Performance
- **Rust/Rayon accelerator** (optional) — PyO3-bound parallel DP + metrics + JSON serialisation (~60 ms for 148,500 stope candidates)
- **Binary `.npy` / `.gridcache` cache** — grids precomputed once and reloaded from disk; invalidated automatically on CSV change
- **Polars CSV parser** — ~8–10× faster than pandas at block-model scale

### API (FastAPI)
| Endpoint | Description |
|----------|-------------|
| `GET /health` | Liveness check |
| `GET /api/model-info` | Grid dimensions, block counts, cell size |
| `GET /api/optimize?cutoff=10` | Run optimisation at given cutoff, return ranked stopes |
| `GET /api/grade-tonnage` | Grade-tonnage curve data |
| `GET /api/export/csv` | Download results as CSV |
| `GET /api/report` | Summary statistics JSON |
| `POST /api/upload` | Upload a new block model CSV |
| `POST /api/preload` | Pre-warm cache from server-side CSV path |

### Frontend (React + Three.js)
- **3D stope viewer** — colour-coded by WAG grade, orbit/pan/zoom
- **Parameter panel** — live NSV inputs, cutoff slider
- **Report table** — sortable ranked stope list
- **Grade-tonnage curve** — Recharts line chart
- **Scenario comparison** — side-by-side cutoff scenarios
- **CSV upload** — drag-and-drop new block model
- **Stope detail modal** — per-stope metrics on click

---

## Changes in v2.0.0 (vs. original submission)

### Critical Bug Fix — XINC/YINC/ZINC Volume Calculation

**Problem (Technical Notes §1–§2 violation):**
The original `parser.py` hardcoded `CELL_SIZE = 5` and computed every block volume as `125 m³` regardless of the actual block dimensions in the CSV. The spec requires:

```
Volume = XINC × YINC × ZINC   (per block)
WAG    = Σ(Vᵢ × Dᵢ × Gᵢ) / Σ(Vᵢ × Dᵢ)
```

**Fix:**
`parser.py` now reads `XINC`, `YINC`, `ZINC` columns when present and computes a per-block `volume_grid`. The return value is expanded to a **6-tuple**:

```python
# v1 (broken)
grade_grid, density_grid, x_coords, y_coords, z_coords = load_block_model(path)

# v2 (fixed)
grade_grid, density_grid, volume_grid, x_coords, y_coords, z_coords = load_block_model(path)
```

`optimizer.py` now uses `volume_grid` in all sliding-window sums:

```python
vd      = volume * density          # block tonnes
vgd     = volume * density * grade  # block gold (g)
wag     = sum_vgd / sum_vd          # spec-compliant WAG
tonnes  = sum_vd                    # stope tonnes
```

**Backward compatibility:**
For the hackathon dataset (uniform 5 m blocks), results are numerically identical to v1. Non-uniform block models now produce correct WAG values.

### Other Improvements
- Fallback auto-detects cell size from coordinate spacing when XINC/YINC/ZINC are absent
- Missing/gap blocks default: grade = 0.0 g/t, density = 2.8 t/m³ (Technical Notes §4)
- `main.py` version bumped to `2.0.0`, all endpoints pass `volume_grid` through

---

## Installation

### Prerequisites
- Python 3.11+
- Node.js 18+
- Rust + maturin (optional, for Rust accelerator)

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Rust Accelerator (optional)

```bash
build_rust.bat        # Windows
# or manually:
cd rust_core
maturin develop --release
```

### Quick Start (Windows)

```bash
start.bat
```

---

## Data Format

Block model CSV with 3 metadata header rows (skipped automatically), followed by columns:

| Column | Required | Description |
|--------|----------|-------------|
| XC | Yes | Block centroid X (m) |
| YC | Yes | Block centroid Y (m) |
| ZC | Yes | Block centroid Z (m) |
| AU | Yes | Gold grade (g/t) |
| DENSITY | Yes | Rock density (t/m³) |
| XINC | No | Block dimension X (m) — used for volume |
| YINC | No | Block dimension Y (m) — used for volume |
| ZINC | No | Block dimension Z (m) — used for volume |

---

## Stope Geometry

| Parameter | Value |
|-----------|-------|
| Length (X) | 20 m |
| Thickness (Y) | 5 m |
| Height (Z) | 30 m |
| Volume | 3,000 m³ |
| Block footprint | 4 × 1 × 6 |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend API | FastAPI + Uvicorn |
| CSV parsing | Polars |
| Numerics | NumPy |
| Accelerator | Rust + Rayon + PyO3 |
| Frontend | React + Vite |
| 3D viewer | Three.js / React Three Fiber |
| Charts | Recharts |

---

## Hackathon Compliance

| Requirement | Status |
|-------------|--------|
| Block model CSV ingestion | ✅ |
| Volume = XINC × YINC × ZINC | ✅ Fixed in v2.0.0 |
| WAG = Σ(V×D×G) / Σ(V×D) | ✅ |
| Part 1: 10 g/t fixed cutoff | ✅ |
| Part 2: live cutoff, speed test | ✅ |
| Non-overlapping stope selection | ✅ |
| NSV economic model | ✅ |
| Grade-tonnage curve | ✅ |
| CSV export | ✅ |
| Missing block defaults (§4) | ✅ |
