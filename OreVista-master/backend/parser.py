"""
parser.py — Load CSV block model and build 3D numpy grids.

Supports two modes:
  1. Full spec-compliant: reads XINC, YINC, ZINC columns and computes
     per-block volume = XINC × YINC × ZINC  (as required by Technical Notes).
  2. Fallback: auto-detects cell size from coordinate spacing when
     XINC/YINC/ZINC columns are absent.

Expected CSV format:
  - 3 header/metadata rows (skipped automatically, with retry on failure)
  - Required columns: XC, YC, ZC, AU, DENSITY  (case-insensitive)
  - Optional columns: XINC, YINC, ZINC          (block dimensions in metres)

WAG formula (Technical Notes §5):
  WAG = Σ(Ti × Gi) / ΣTi
      = Σ(Vi × Di × Gi) / Σ(Vi × Di)   where Vi = XINC×YINC×ZINC

Missing/gapped blocks (Technical Notes §4):
  grade   → 0.0  g/t
  density → 2.8  t/m³
  volume  → CELL_SIZE³  m³  (from auto-detection or spec default 5³=125 m³)

Uses Polars for CSV parsing (~8-10× faster than pandas at large scale).
"""

import io
import numpy as np
import polars as pl

# Default fallback constants (used when XINC/YINC/ZINC are absent)
CELL_SIZE     = 5           # metres — hackathon dataset default
VOL_PER_BLOCK = CELL_SIZE ** 3  # 125 m³ — used only as scalar fallback

DEFAULT_GRADE   = 0.0   # g/t  (Technical Notes §4: missing blocks)
DEFAULT_DENSITY = 2.8   # t/m³ (Technical Notes §4: missing blocks)
DEFAULT_XINC    = float(CELL_SIZE)
DEFAULT_YINC    = float(CELL_SIZE)
DEFAULT_ZINC    = float(CELL_SIZE)


def load_block_model(csv_path: str):
    """
    Load block model CSV (skip 3 metadata rows) and build 3D grids.
    Returns: (grade_grid, density_grid, volume_grid, x_coords, y_coords, z_coords)
    """
    df = pl.read_csv(csv_path, skip_rows=3, infer_schema_length=10000)
    return build_3d_grid(df)


def load_block_model_from_bytes(data: bytes):
    """
    Load block model from raw CSV bytes (used by the upload endpoint).
    Tries skiprows=3 first; if columns are missing, retries with skiprows=0.
    Returns: (grade_grid, density_grid, volume_grid, x_coords, y_coords, z_coords)
    """
    required = {"XC", "YC", "ZC", "AU", "DENSITY"}
    for skip in (3, 2, 1, 0):
        try:
            df = pl.read_csv(io.BytesIO(data), skip_rows=skip, infer_schema_length=10000)
            df = df.rename({c: c.strip().upper() for c in df.columns})
            if required.issubset(set(df.columns)):
                return build_3d_grid(df)
        except Exception:
            continue
    raise ValueError(
        "CSV must contain columns: XC, YC, ZC, AU, DENSITY  "
        "(after skipping up to 3 header rows)"
    )


def build_3d_grid(df: pl.DataFrame):
    """
    Convert block model dataframe into 3D numpy grids.

    Per Technical Notes §1-§2:
      - Reads XINC, YINC, ZINC if present → volume = XINC × YINC × ZINC per block
      - Falls back to auto-detected cell size when those columns are absent

    Returns: (grade_grid, density_grid, volume_grid, x_coords, y_coords, z_coords)
      All grids have shape (nx, ny, nz).
      volume_grid[xi, yi, zi] = XINC × YINC × ZINC for that block (m³).
    """
    # Normalise column names
    df = df.rename({c: c.strip().upper() for c in df.columns})

    # ── Extract coordinate and value arrays ──────────────────────────────────
    xv = df["XC"]     .fill_null(0.0).cast(pl.Float64).to_numpy()
    yv = df["YC"]     .fill_null(0.0).cast(pl.Float64).to_numpy()
    zv = df["ZC"]     .fill_null(0.0).cast(pl.Float64).to_numpy()
    au = df["AU"]     .fill_null(DEFAULT_GRADE  ).cast(pl.Float64).to_numpy()
    dn = df["DENSITY"].fill_null(DEFAULT_DENSITY).cast(pl.Float64).to_numpy()

    # ── Block dimensions — Technical Notes §1 ───────────────────────────────
    # Prefer explicit XINC/YINC/ZINC; fall back to auto-detected cell size.
    cols = set(df.columns)
    if {"XINC", "YINC", "ZINC"}.issubset(cols):
        xinc = df["XINC"].fill_null(DEFAULT_XINC).cast(pl.Float64).to_numpy()
        yinc = df["YINC"].fill_null(DEFAULT_YINC).cast(pl.Float64).to_numpy()
        zinc = df["ZINC"].fill_null(DEFAULT_ZINC).cast(pl.Float64).to_numpy()
        # Per-block volume: XINC × YINC × ZINC  (Technical Notes §2)
        block_vol = (xinc * yinc * zinc).astype(np.float32)
        # Use the minimum increment as the grid cell size
        cs = float(np.min([np.min(xinc[xinc > 0]), np.min(yinc[yinc > 0]), np.min(zinc[zinc > 0])]))
    else:
        # Auto-detect cell size from minimum spacing between unique coordinates
        def _cell_size(arr):
            u = np.unique(arr)
            if len(u) < 2:
                return CELL_SIZE
            diffs = np.diff(u)
            return float(np.min(diffs[diffs > 0]))

        cs = min(_cell_size(xv), _cell_size(yv), _cell_size(zv))
        if cs <= 0:
            cs = CELL_SIZE
        block_vol = np.full(len(xv), cs ** 3, dtype=np.float32)

    # ── Grid extents ─────────────────────────────────────────────────────────
    x_min, x_max = xv.min(), xv.max()
    y_min, y_max = yv.min(), yv.max()
    z_min, z_max = zv.min(), zv.max()

    nx = int(round((x_max - x_min) / cs)) + 1
    ny = int(round((y_max - y_min) / cs)) + 1
    nz = int(round((z_max - z_min) / cs)) + 1

    x_coords = np.array([x_min + i * cs for i in range(nx)], dtype=np.float64)
    y_coords = np.array([y_min + i * cs for i in range(ny)], dtype=np.float64)
    z_coords = np.array([z_min + i * cs for i in range(nz)], dtype=np.float64)

    # ── Initialise grids with Technical Notes §4 defaults ───────────────────
    grade_grid   = np.full((nx, ny, nz), DEFAULT_GRADE,    dtype=np.float32)
    density_grid = np.full((nx, ny, nz), DEFAULT_DENSITY,  dtype=np.float32)
    volume_grid  = np.full((nx, ny, nz), cs ** 3,          dtype=np.float32)

    # ── Vectorised index computation ─────────────────────────────────────────
    xi = np.round((xv - x_min) / cs).astype(int)
    yi = np.round((yv - y_min) / cs).astype(int)
    zi = np.round((zv - z_min) / cs).astype(int)

    valid = (xi >= 0) & (xi < nx) & (yi >= 0) & (yi < ny) & (zi >= 0) & (zi < nz)
    xi, yi, zi = xi[valid], yi[valid], zi[valid]

    grade_grid  [xi, yi, zi] = au[valid]        .astype(np.float32)
    density_grid[xi, yi, zi] = dn[valid]        .astype(np.float32)
    volume_grid [xi, yi, zi] = block_vol[valid]

    return grade_grid, density_grid, volume_grid, x_coords, y_coords, z_coords
