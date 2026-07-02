"""
optimizer.py — 3D sliding window stope optimizer.

Fixed stope dimensions (Part 1 — Technical Notes):
  Length    20m → 4 blocks  (X / Easting  direction)
  Thickness  5m → 1 block   (Y / Northing direction)
  Height    30m → 6 blocks  (Z / Elevation — VERTICAL)

MANDATORY constraint (from judging rules):
  All stopes on the same mining level MUST share the same bottom Z elevation.

WAG formula (Technical Notes §5):
  WAG = Σ(Vi × Di × Gi) / Σ(Vi × Di)
  where Vi = XINC × YINC × ZINC  (block volume, m³)
        Di = DENSITY              (t/m³)
        Gi = AU                   (g/t)

This is the correct tonnage-weighted average grade per the specification.
For uniform grids (all Vi equal), this reduces to Σ(Di × Gi) / ΣDi.

Selection algorithm: exact 1D DP per (level, Y-strip)
  Since STOPE_T = 1 block in Y, stopes at different Y positions never overlap.
  Each Y-strip is therefore independent; optimal non-overlapping selection
  along X is solved exactly with DP in O(nx). This is OPTIMAL, not greedy.
"""

import time
import numpy as np
from concurrent.futures import ThreadPoolExecutor, as_completed
from parser import CELL_SIZE
import os
import logging

log = logging.getLogger("orevista")

# ── Try to load Rust-accelerated core ────────────────────────────────────────
try:
    import rust_core as _rust_core
    _RUST = True
    log.info("rust_core loaded — DP running at native Rayon speed")
except ImportError:
    _RUST = False
    log.warning("rust_core not found — using Python/ThreadPool fallback. "
                "Run build_rust.bat to enable the Rust accelerator.")

_use_rust: bool = True

def set_rust_mode(enabled: bool) -> None:
    global _use_rust
    _use_rust = bool(enabled)

def get_rust_active() -> bool:
    return _RUST and _use_rust

_POOL = ThreadPoolExecutor(max_workers=os.cpu_count() or 4)

# Fixed stope geometry (Part 1 — must not change)
STOPE_LENGTH_M    = 20   # X direction (Easting)
STOPE_THICKNESS_M =  5   # Y direction (Northing)
STOPE_HEIGHT_M    = 30   # Z direction (Elevation)

STOPE_L = STOPE_LENGTH_M    // CELL_SIZE   # 4 blocks
STOPE_T = STOPE_THICKNESS_M // CELL_SIZE   # 1 block
STOPE_H = STOPE_HEIGHT_M    // CELL_SIZE   # 6 blocks

STOPE_VOLUME = STOPE_LENGTH_M * STOPE_THICKNESS_M * STOPE_HEIGHT_M  # 3000 m³


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _sliding_sum(arr: np.ndarray, wx: int, wy: int, wz: int) -> np.ndarray:
    """
    Compute 3D sliding window sum using separable prefix sums. O(n).
    Returns shape (nx-wx+1, ny-wy+1, nz-wz+1).
    """
    cs = np.cumsum(arr, axis=0)
    cs = np.concatenate([np.zeros((1, arr.shape[1], arr.shape[2]), dtype=arr.dtype), cs], axis=0)
    s  = cs[wx:] - cs[:-wx]
    cs = np.cumsum(s, axis=1)
    cs = np.concatenate([np.zeros((s.shape[0], 1, s.shape[2]), dtype=arr.dtype), cs], axis=1)
    s  = cs[:, wy:] - cs[:, :-wy]
    cs = np.cumsum(s, axis=2)
    cs = np.concatenate([np.zeros((s.shape[0], s.shape[1], 1), dtype=arr.dtype), cs], axis=2)
    return cs[:, :, wz:] - cs[:, :, :-wz]


def _dp_1d(wag_row: np.ndarray, gold_row: np.ndarray,
           cutoff: float, L: int, pillar: int = 1) -> list[int]:
    """
    Exact 1D DP: optimal non-overlapping window selection maximising gold.
    Pillar gap of `pillar` blocks enforced between adjacent stopes.
    """
    step = L + pillar
    n    = len(wag_row)
    dp   = np.zeros(n + 1, dtype=np.float64)
    for i in range(1, n + 1):
        xi       = i - 1
        skip_val = dp[i - 1]
        take_val = 0.0
        if wag_row[xi] >= cutoff:
            prev     = max(0, i - step)
            take_val = dp[prev] + gold_row[xi]
        dp[i] = skip_val if skip_val >= take_val else take_val
    selected = []
    i = n
    while i > 0:
        xi = i - 1
        if (wag_row[xi] >= cutoff and
                dp[i] == dp[max(0, i - step)] + gold_row[xi]):
            selected.append(xi)
            i = max(0, i - step)
        else:
            i -= 1
    return selected[::-1]


def _total_gold_for_start(gold_grid: np.ndarray, wag_grid: np.ndarray,
                           cutoff: float, z_start: int) -> float:
    nz_w  = wag_grid.shape[2]
    total = 0.0
    for zi in range(z_start, nz_w, STOPE_H):
        mask   = wag_grid[:, :, zi] >= cutoff
        total += gold_grid[:, :, zi][mask].sum()
    return total


def find_best_z_start(gold_grid: np.ndarray, wag_grid: np.ndarray,
                       cutoff: float) -> int:
    """Try all STOPE_H starting Z offsets; return the one maximising gold."""
    if get_rust_active():
        return _rust_core.find_best_z_start_rs(
            np.ascontiguousarray(gold_grid, dtype=np.float32),
            np.ascontiguousarray(wag_grid,  dtype=np.float32),
            float(cutoff), int(STOPE_H),
        )
    futures = {
        _POOL.submit(_total_gold_for_start, gold_grid, wag_grid, cutoff, s): s
        for s in range(STOPE_H)
    }
    best_gold, best_start = -1.0, 0
    for fut in as_completed(futures):
        s = futures[fut]
        g = fut.result()
        if g > best_gold:
            best_gold, best_start = g, s
    return best_start


# ---------------------------------------------------------------------------
# Precompute — spec-compliant using XINC×YINC×ZINC volumes
# ---------------------------------------------------------------------------

def precompute(grade_grid: np.ndarray, density_grid: np.ndarray,
               volume_grid: np.ndarray):
    """
    Pre-compute stope-level metrics at every valid window position.

    Implements Technical Notes §2 & §5:
      tonnes_block = volume × density
      gold_block   = tonnes × grade  =  volume × density × grade
      WAG          = Σ(gold_block) / Σ(tonnes_block)
                   = Σ(V×D×G)     / Σ(V×D)

    For uniform grids (all volumes equal), this is identical to the
    simplified formula WAG = Σ(D×G)/ΣD.

    Precomputed grids (shape nx-L+1, ny-T+1, nz-H+1):
      wag_grid         — weighted average grade per stope (g/t)
      tonnes_grid      — total tonnes per stope
      gold_grid        — total gold grams per stope
      waste_grid       — waste tonnes per stope (blocks with AU=0)
      avg_density_grid — average density per stope (t/m³)
    """
    g  = grade_grid  .astype(np.float32)
    d  = density_grid.astype(np.float32)
    v  = volume_grid .astype(np.float32)

    # Per-block tonnes and gold  (Technical Notes §2)
    vd      = v * d                               # block tonnes
    vgd     = v * d * g                           # block gold (g)
    waste_vd = np.where(g <= 0, vd, 0.0).astype(np.float32)

    # Parallelise 4 independent sliding-sum calls
    futures = {
        _POOL.submit(_sliding_sum, vd,       STOPE_L, STOPE_T, STOPE_H): "vd",
        _POOL.submit(_sliding_sum, vgd,      STOPE_L, STOPE_T, STOPE_H): "vgd",
        _POOL.submit(_sliding_sum, v,        STOPE_L, STOPE_T, STOPE_H): "v",
        _POOL.submit(_sliding_sum, waste_vd, STOPE_L, STOPE_T, STOPE_H): "wvd",
    }
    results = {}
    for fut in as_completed(futures):
        results[futures[fut]] = fut.result()

    sum_vd, sum_vgd, sum_v, sum_wvd = (
        results["vd"], results["vgd"], results["v"], results["wvd"]
    )

    n_blocks          = STOPE_L * STOPE_T * STOPE_H
    wag_grid          = np.where(sum_vd > 0, sum_vgd / sum_vd, 0.0).astype(np.float32)
    tonnes_grid       = sum_vd .astype(np.float32)
    gold_grid         = sum_vgd.astype(np.float32)
    waste_grid        = sum_wvd.astype(np.float32)
    avg_density_grid  = np.where(sum_v > 0, sum_vd / sum_v, DEFAULT_DENSITY).astype(np.float32)

    return wag_grid, tonnes_grid, gold_grid, waste_grid, avg_density_grid


# ---------------------------------------------------------------------------
# Binary grid cache — skips CSV parse + precompute on repeated loads
# ---------------------------------------------------------------------------

_CACHE_NAMES = ["wag", "tonnes", "gold", "waste", "avgden"]

DEFAULT_DENSITY = 2.8  # imported constant

def _cache_dir(csv_path: str) -> str:
    return csv_path + ".gridcache"

def _cache_valid(csv_path: str) -> bool:
    import os as _os
    cdir = _cache_dir(csv_path)
    if not _os.path.isdir(cdir):
        return False
    csv_mtime = _os.path.getmtime(csv_path)
    for name in _CACHE_NAMES:
        p = _os.path.join(cdir, f"{name}.npy")
        if not _os.path.exists(p) or _os.path.getmtime(p) <= csv_mtime:
            return False
    return True

def _load_cache(csv_path: str):
    import os as _os
    cdir  = _cache_dir(csv_path)
    grids = [np.load(_os.path.join(cdir, f"{n}.npy")) for n in _CACHE_NAMES]
    log.info("Loaded grids from cache: %s", cdir)
    return tuple(grids)

def _save_cache(csv_path: str, wag, tonnes, gold, waste, avgden) -> None:
    import os as _os
    cdir = _cache_dir(csv_path)
    _os.makedirs(cdir, exist_ok=True)
    for name, arr in zip(_CACHE_NAMES, [wag, tonnes, gold, waste, avgden]):
        np.save(_os.path.join(cdir, f"{name}.npy"), arr)
    log.info("Saved grid cache to: %s  (%.0f MB total)",
             cdir, sum(a.nbytes for a in [wag, tonnes, gold, waste, avgden]) / 1e6)

def precompute_cached(grade_grid: np.ndarray, density_grid: np.ndarray,
                      volume_grid: np.ndarray, csv_path: str):
    """
    Precompute with binary .npy cache.
    Cache is invalidated automatically when the source CSV is modified.
    """
    if csv_path and _cache_valid(csv_path):
        return _load_cache(csv_path)

    # Use Rust precompute when volume is uniform (all blocks same size)
    vol_flat = volume_grid.ravel()
    is_uniform = bool(np.allclose(vol_flat, vol_flat[0], rtol=1e-5))

    if get_rust_active() and is_uniform:
        grids = _rust_core.precompute_rs(
            np.ascontiguousarray(grade_grid,   dtype=np.float32),
            np.ascontiguousarray(density_grid, dtype=np.float32),
            int(STOPE_L), int(STOPE_T), int(STOPE_H),
            float(vol_flat[0]),
        )
    else:
        if not is_uniform:
            log.info("Non-uniform block volumes detected — using Python precompute path")
        grids = precompute(grade_grid, density_grid, volume_grid)

    if csv_path:
        try:
            _save_cache(csv_path, *grids)
        except Exception as exc:
            log.warning("Could not save grid cache: %s", exc)

    return grids


# ---------------------------------------------------------------------------
# NSV (Net Smelter Value) computation
# ---------------------------------------------------------------------------

def _compute_nsv_vec(gold_oz_v: np.ndarray, tonnes_v: np.ndarray,
                     econ: dict) -> tuple:
    """Vectorised NSV for all stopes — returns 10-tuple of arrays."""
    dilution   = econ["dilution_factor"]
    mine_rec   = econ["mining_recovery"]
    recovery   = econ["metallurgical_recovery"]
    payable    = econ["payable_pct"]
    gold_px    = econ["gold_price_usd"]
    royalty_rt = econ["royalty_pct"]
    ga_cost    = econ["ga_cost_per_t"]
    sustaining = econ["sustaining_capex_per_t"]

    mined_t      = tonnes_v  * mine_rec
    payable_oz   = gold_oz_v * (1.0 - dilution) * mine_rec * recovery * payable
    gross_rev    = payable_oz * gold_px
    royalty_v    = gross_rev  * royalty_rt
    revenue_net  = gross_rev  - royalty_v
    mining_v     = mined_t   * econ["mining_cost_per_t"]
    proc_v       = mined_t   * econ["processing_cost_per_t"]
    refining_v   = payable_oz * econ["refining_cost_per_oz"]
    ga_v         = mined_t   * ga_cost
    sust_v       = mined_t   * sustaining
    nsv_v        = revenue_net - mining_v - proc_v - refining_v - ga_v - sust_v
    return nsv_v, payable_oz, gross_rev, royalty_v, mining_v, proc_v, refining_v, ga_v, sust_v, mined_t


# ---------------------------------------------------------------------------
# Stope extraction
# ---------------------------------------------------------------------------

def _dp_strip_indices_only(wag_grid, gold_grid, zi, yi, cutoff, stope_l, pillar):
    return [
        (xi, yi, zi)
        for xi in _dp_1d(wag_grid[:, yi, zi], gold_grid[:, yi, zi],
                         cutoff, stope_l, pillar=pillar)
    ]


def _build_stopes_from_indices(xi_arr, yi_arr, zi_arr,
                                wag_grid, tonnes_grid, gold_grid,
                                waste_grid, avg_density_grid,
                                x_coords, y_coords, z_coords,
                                cutoff_grade, econ) -> list[dict]:
    """Vectorised stope metrics computation — all NumPy before the list loop."""
    n = len(xi_arr)
    if n == 0:
        return []

    half     = CELL_SIZE / 2.0
    dilution = econ["dilution_factor"]
    mine_rec = econ["mining_recovery"]
    met_rec  = econ["metallurgical_recovery"]
    payable  = econ["payable_pct"]
    use_nsv  = econ["use_nsv_filter"]
    nsv_min  = econ["nsv_min_usd"]
    nsv_max  = econ["nsv_max_usd"]

    tonnes_v  = tonnes_grid    [xi_arr, yi_arr, zi_arr].astype(np.float64)
    gold_g_v  = gold_grid      [xi_arr, yi_arr, zi_arr].astype(np.float64)
    waste_v   = waste_grid     [xi_arr, yi_arr, zi_arr].astype(np.float64)
    avg_den_v = avg_density_grid[xi_arr, yi_arr, zi_arr].astype(np.float64)
    wag_v     = wag_grid       [xi_arr, yi_arr, zi_arr].astype(np.float64)

    gold_oz_v = gold_g_v / 31.1035
    nsv_v, payable_oz_v, gross_v, royalty_v, mining_v, proc_v, \
        refining_v, ga_v, sust_v, mined_t_v = _compute_nsv_vec(gold_oz_v, tonnes_v, econ)

    if use_nsv:
        mask = nsv_v >= nsv_min
        if nsv_max > 0:
            mask &= nsv_v <= nsv_max
        if not mask.all():
            xi_arr, yi_arr, zi_arr = xi_arr[mask], yi_arr[mask], zi_arr[mask]
            tonnes_v  = tonnes_v[mask];  gold_g_v   = gold_g_v[mask]
            waste_v   = waste_v[mask];   avg_den_v  = avg_den_v[mask]
            wag_v     = wag_v[mask];     gold_oz_v  = gold_oz_v[mask]
            nsv_v     = nsv_v[mask];     payable_oz_v = payable_oz_v[mask]
            gross_v   = gross_v[mask];   royalty_v  = royalty_v[mask]
            mining_v  = mining_v[mask];  proc_v     = proc_v[mask]
            refining_v = refining_v[mask]; ga_v     = ga_v[mask]
            sust_v    = sust_v[mask];    mined_t_v  = mined_t_v[mask]
            n = len(xi_arr)
            if n == 0:
                return []

    x_min_v = x_coords[xi_arr].astype(np.float64)               - half
    x_max_v = x_coords[xi_arr + STOPE_L - 1].astype(np.float64) + half
    y_min_v = y_coords[yi_arr].astype(np.float64)               - half
    y_max_v = y_coords[yi_arr + STOPE_T - 1].astype(np.float64) + half
    z_min_v = z_coords[zi_arr].astype(np.float64)               - half
    z_max_v = z_coords[zi_arr + STOPE_H - 1].astype(np.float64) + half

    ore_t_v   = tonnes_v - waste_v
    dil_pct_v = np.where(tonnes_v > 0, waste_v / tonnes_v * 100.0, 0.0)
    rec_oz_v  = gold_oz_v * (1.0 - dilution) * mine_rec * met_rec * payable
    nsr_t_v   = np.where(tonnes_v > 0, nsv_v / tonnes_v, 0.0)
    east_v    = (x_min_v + x_max_v) * 0.5
    north_v   = (y_min_v + y_max_v) * 0.5
    rl_v      = (z_min_v + z_max_v) * 0.5

    # Pre-round to lists (50× faster than per-element Python round)
    def rl(a, dp): return np.round(a, dp).tolist()

    east_L     = rl(east_v,      1);  north_L    = rl(north_v,    1)
    rl_L       = rl(rl_v,        1);  tonnes_L   = rl(tonnes_v,   2)
    ore_t_L    = rl(ore_t_v,     2);  waste_L    = rl(waste_v,    2)
    dil_L      = rl(dil_pct_v,   2);  avg_den_L  = rl(avg_den_v,  4)
    wag_L      = rl(wag_v,       4);  gold_g_L   = rl(gold_g_v,   2)
    gold_oz_L  = rl(gold_oz_v,   2);  rec_oz_L   = rl(rec_oz_v,   2)
    nsr_L      = rl(nsr_t_v,     2);  nsv_L      = rl(nsv_v,      0)
    gross_L    = rl(gross_v,     0);  royalty_L  = rl(royalty_v,  0)
    mining_L   = rl(mining_v,    0);  proc_L     = rl(proc_v,     0)
    refining_L = rl(refining_v,  0);  ga_L       = rl(ga_v,       0)
    sust_L     = rl(sust_v,      0);  z_min_L    = rl(z_min_v,    1)
    x_min_L = x_min_v.tolist(); x_max_L = x_max_v.tolist()
    y_min_L = y_min_v.tolist(); y_max_L = y_max_v.tolist()
    z_min_fL = z_min_v.tolist(); z_max_L = z_max_v.tolist()

    SL = float(STOPE_LENGTH_M); SH = float(STOPE_HEIGHT_M)
    SW = float(STOPE_THICKNESS_M); SV = float(STOPE_VOLUME)
    cg = float(cutoff_grade)

    return [
        {
            "stope_id":      None,
            "easting":       east_L[k],  "northing":   north_L[k],  "rl": rl_L[k],
            "level_name":    f"{z_min_fL[k]:.0f} RL",
            "x_min": x_min_L[k], "x_max": x_max_L[k],
            "y_min": y_min_L[k], "y_max": y_max_L[k],
            "z_min": z_min_fL[k], "z_max": z_max_L[k],
            "strike_length": SL, "stope_height": SH, "stope_width": SW, "volume": SV,
            "tonnes":        tonnes_L[k],  "ore_tonnes":   ore_t_L[k],
            "waste_tonnes":  waste_L[k],   "dilution_pct": dil_L[k],
            "avg_density":   avg_den_L[k], "head_grade":   wag_L[k],
            "gold_grams":    gold_g_L[k],  "contained_oz": gold_oz_L[k],
            "recovered_oz":  rec_oz_L[k],  "nsr_per_t":    nsr_L[k],
            "nsv_usd":       nsv_L[k],
            "gross_revenue_usd":   gross_L[k],    "royalty_usd":         royalty_L[k],
            "mining_cost_usd":     mining_L[k],   "processing_cost_usd": proc_L[k],
            "refining_cost_usd":   refining_L[k], "ga_cost_usd":         ga_L[k],
            "sustaining_cost_usd": sust_L[k],
            "avg_grade":   wag_L[k], "gold_oz":     gold_oz_L[k],
            "cutoff_used": cg,       "level_z":     z_min_L[k],
        }
        for k in range(n)
    ]


def extract_stopes(wag_grid, tonnes_grid, gold_grid, waste_grid, avg_density_grid,
                   x_coords, y_coords, z_coords,
                   cutoff_grade, z_start=None, pillar_blocks=1,
                   economics=None, _timing=None):
    """
    Extract optimal non-overlapping stopes aligned to discrete Z levels.
    Returns: (stopes list, z_start used)
    """
    if economics is None:
        economics = {}
    econ = {
        "gold_price_usd":         economics.get("gold_price_usd",        5200.0),
        "mining_cost_per_t":      economics.get("mining_cost_per_t",       50.0),
        "processing_cost_per_t":  economics.get("processing_cost_per_t",   18.0),
        "refining_cost_per_oz":   economics.get("refining_cost_per_oz",    20.0),
        "metallurgical_recovery": economics.get("metallurgical_recovery",   0.92),
        "royalty_pct":            economics.get("royalty_pct",              0.03),
        "dilution_factor":        economics.get("dilution_factor",          0.15),
        "mining_recovery":        economics.get("mining_recovery",          0.90),
        "payable_pct":            economics.get("payable_pct",             0.995),
        "ga_cost_per_t":          economics.get("ga_cost_per_t",            5.0),
        "sustaining_capex_per_t": economics.get("sustaining_capex_per_t",   5.0),
        "use_nsv_filter":         economics.get("use_nsv_filter",          False),
        "nsv_min_usd":            economics.get("nsv_min_usd",             0.0),
        "nsv_max_usd":            economics.get("nsv_max_usd",             0.0),
    }

    _t0 = time.perf_counter()
    if z_start is None:
        z_start = find_best_z_start(gold_grid, wag_grid, cutoff_grade)
    if _timing is not None:
        _timing["z_start_ms"] = round((time.perf_counter() - _t0) * 1000, 1)

    nz_w = wag_grid.shape[2]
    ny_w = wag_grid.shape[1]

    _t0 = time.perf_counter()
    if get_rust_active():
        xi_arr, yi_arr, zi_arr = _rust_core.dp_all_strips(
            np.ascontiguousarray(wag_grid,  dtype=np.float32),
            np.ascontiguousarray(gold_grid, dtype=np.float32),
            float(cutoff_grade), int(z_start), int(STOPE_H), int(STOPE_L), int(pillar_blocks),
        )
    else:
        level_zis = list(range(z_start, nz_w, STOPE_H))
        futures_list = [
            _POOL.submit(_dp_strip_indices_only,
                         wag_grid, gold_grid, zi, yi, cutoff_grade, STOPE_L, pillar_blocks)
            for zi in level_zis for yi in range(ny_w)
        ]
        all_idx = []
        for fut in futures_list:
            all_idx.extend(fut.result())
        all_idx.sort(key=lambda t: (t[2], t[1], t[0]))
        if all_idx:
            xi_arr = np.array([t[0] for t in all_idx], dtype=np.int64)
            yi_arr = np.array([t[1] for t in all_idx], dtype=np.int64)
            zi_arr = np.array([t[2] for t in all_idx], dtype=np.int64)
        else:
            xi_arr = yi_arr = zi_arr = np.array([], dtype=np.int64)
    if _timing is not None:
        _timing["dp_ms"] = round((time.perf_counter() - _t0) * 1000, 1)

    _t0 = time.perf_counter()
    stopes = _build_stopes_from_indices(
        xi_arr, yi_arr, zi_arr,
        wag_grid, tonnes_grid, gold_grid, waste_grid, avg_density_grid,
        x_coords, y_coords, z_coords, cutoff_grade, econ,
    )
    if _timing is not None:
        _timing["postprocess_ms"] = round((time.perf_counter() - _t0) * 1000, 1)

    for k, s in enumerate(stopes, start=1):
        s["stope_id"] = f"Stope_{k:04d}"

    return stopes, z_start


def extract_stopes_fast(wag_grid, tonnes_grid, gold_grid, waste_grid, avg_density_grid,
                        x_coords, y_coords, z_coords,
                        cutoff_grade, z_start=None, pillar_blocks=1, economics=None):
    """Rust-only fast path: DP + metrics + JSON all in Rust/Rayon."""
    if not _RUST:
        raise RuntimeError("Rust not available — use extract_stopes instead")
    if economics is None:
        economics = {}

    _t0 = time.perf_counter()
    if z_start is None:
        z_start = find_best_z_start(gold_grid, wag_grid, cutoff_grade)
    steps = {"z_start_ms": round((time.perf_counter() - _t0) * 1000, 1)}

    _t0 = time.perf_counter()
    json_bytes, count = _rust_core.optimize_all_rs(
        np.ascontiguousarray(wag_grid,         dtype=np.float32),
        np.ascontiguousarray(gold_grid,        dtype=np.float32),
        np.ascontiguousarray(tonnes_grid,      dtype=np.float32),
        np.ascontiguousarray(waste_grid,       dtype=np.float32),
        np.ascontiguousarray(avg_density_grid, dtype=np.float32),
        np.ascontiguousarray(x_coords,         dtype=np.float64),
        np.ascontiguousarray(y_coords,         dtype=np.float64),
        np.ascontiguousarray(z_coords,         dtype=np.float64),
        float(cutoff_grade), int(z_start), int(STOPE_H), int(STOPE_L), int(STOPE_T),
        int(pillar_blocks),
        float(economics.get("gold_price_usd",         5200.0)),
        float(economics.get("royalty_pct",              0.03)),
        float(economics.get("mining_cost_per_t",        50.0)),
        float(economics.get("processing_cost_per_t",    18.0)),
        float(economics.get("refining_cost_per_oz",     20.0)),
        float(economics.get("metallurgical_recovery",    0.92)),
        float(economics.get("dilution_factor",           0.15)),
        float(economics.get("mining_recovery",           0.90)),
        float(economics.get("payable_pct",              0.995)),
        float(economics.get("ga_cost_per_t",             5.0)),
        float(economics.get("sustaining_capex_per_t",    5.0)),
        bool (economics.get("use_nsv_filter",           False)),
        float(economics.get("nsv_min_usd",               0.0)),
        float(economics.get("nsv_max_usd",               0.0)),
        float(cutoff_grade),
        float(CELL_SIZE),
        float(STOPE_LENGTH_M), float(STOPE_THICKNESS_M),
        float(STOPE_HEIGHT_M), float(STOPE_VOLUME),
    )
    steps["dp_ms"]          = 0.0
    steps["postprocess_ms"] = round((time.perf_counter() - _t0) * 1000, 1)
    steps["summary_ms"]     = 0.0

    return json_bytes, int(z_start), count, steps
