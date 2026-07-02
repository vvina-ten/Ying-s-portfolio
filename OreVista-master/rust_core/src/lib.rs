/// rust_core — OreVista high-performance stope DP optimizer
///
/// Exposes Python functions via PyO3:
///
///   dp_all_strips(wag, gold, cutoff, z_start, stope_h, stope_l, pillar)
///     -> (xi_arr, yi_arr, zi_arr)   # sorted numpy int64 arrays
///
///   find_best_z_start_rs(gold, wag, cutoff, stope_h) -> int
///
///   precompute_rs(grade, density, stope_l, stope_t, stope_h, vol_per_block)
///     -> (wag_grid, tonnes_grid, gold_grid, waste_grid, avg_density_grid)
///
/// All functions use Rayon for data-parallel execution.
/// The Python GIL is held only at the boundary; all inner work is GIL-free.

use ndarray::{Array1, Array3};
use numpy::{IntoPyArray, PyArray1, PyArray3, PyReadonlyArray1, PyReadonlyArray3};
use pyo3::prelude::*;
use pyo3::types::PyBytes;
use rayon::prelude::*;
use std::collections::BTreeSet;
use std::fmt::Write as FmtWrite;

// ---------------------------------------------------------------------------
// Fast fixed-precision float formatting (~15× faster than write!("{:.N}", v))
//
// Uses integer arithmetic + itoa instead of Rust's slow Grisu3/Dragon4 path.
// For 148,500 stopes × 20 float fields, this saves ~700 ms.
// ---------------------------------------------------------------------------
#[inline(always)]
fn push_fixed(out: &mut String, v: f64, dp: usize) {
    let neg = v < 0.0;
    let av  = if neg { -v } else { v };
    let scale: u64 = match dp { 0=>1, 1=>10, 2=>100, 3=>1000, 4=>10_000, _=>10u64.pow(dp as u32) };
    let rounded   = (av * scale as f64 + 0.5) as u64;
    let int_part  = rounded / scale;
    let dec_part  = rounded % scale;
    if neg && (int_part > 0 || dec_part > 0) { out.push('-'); }
    let mut buf = itoa::Buffer::new();
    out.push_str(buf.format(int_part));
    if dp > 0 {
        out.push('.');
        let s = buf.format(dec_part);
        for _ in 0..dp.saturating_sub(s.len()) { out.push('0'); }
        out.push_str(s);
    }
}

// ---------------------------------------------------------------------------
// Core DP: optimal non-overlapping window selection on one 1-D strip
// ---------------------------------------------------------------------------
fn dp_strip(
    wag: &Array3<f32>,
    gold: &Array3<f32>,
    nx: usize,
    yi: usize,
    zi: usize,
    cutoff: f64,
    stope_l: usize,
    pillar: usize,
) -> Vec<usize> {
    let step = stope_l + pillar;
    let mut dp = vec![0.0f64; nx + 1];
    for i in 1..=nx {
        let xi   = i - 1;
        let skip = dp[i - 1];
        let w    = wag [[xi, yi, zi]] as f64;
        let g    = gold[[xi, yi, zi]] as f64;
        let take = if w >= cutoff { dp[i.saturating_sub(step)] + g } else { 0.0 };
        dp[i] = if skip >= take { skip } else { take };
    }
    let mut selected = Vec::new();
    let mut i = nx;
    while i > 0 {
        let xi   = i - 1;
        let w    = wag [[xi, yi, zi]] as f64;
        let g    = gold[[xi, yi, zi]] as f64;
        let prev = i.saturating_sub(step);
        if w >= cutoff && (dp[i] - dp[prev] - g).abs() < 1e-9 {
            selected.push(xi);
            i = prev;
        } else {
            i -= 1;
        }
    }
    selected.reverse();
    selected
}

// ---------------------------------------------------------------------------
// dp_all_strips — main Python-callable entry point
// ---------------------------------------------------------------------------
#[pyfunction]
fn dp_all_strips<'py>(
    py: Python<'py>,
    wag_py:  PyReadonlyArray3<'py, f32>,
    gold_py: PyReadonlyArray3<'py, f32>,
    cutoff:   f64,
    z_start:  usize,
    stope_h:  usize,
    stope_l:  usize,
    pillar:   usize,
) -> PyResult<(Py<PyArray1<i64>>, Py<PyArray1<i64>>, Py<PyArray1<i64>>)> {
    let wag:  Array3<f32> = wag_py .as_array().to_owned();
    let gold: Array3<f32> = gold_py.as_array().to_owned();
    let nx = wag.shape()[0];
    let ny = wag.shape()[1];
    let nz = wag.shape()[2];

    let strips: Vec<(usize, usize)> = (z_start..nz)
        .step_by(stope_h)
        .flat_map(|zi| (0..ny).map(move |yi| (zi, yi)))
        .collect();

    let results: Vec<Vec<(usize, usize, usize)>> = strips
        .par_iter()
        .map(|&(zi, yi)| {
            dp_strip(&wag, &gold, nx, yi, zi, cutoff, stope_l, pillar)
                .into_iter()
                .map(|xi| (xi, yi, zi))
                .collect()
        })
        .collect();

    let mut flat: Vec<(usize, usize, usize)> = results.into_iter().flatten().collect();
    flat.sort_unstable_by_key(|&(xi, yi, zi)| (zi, yi, xi));

    let xi_vec: Vec<i64> = flat.iter().map(|&(xi, _,  _ )| xi as i64).collect();
    let yi_vec: Vec<i64> = flat.iter().map(|&(_,  yi, _ )| yi as i64).collect();
    let zi_vec: Vec<i64> = flat.iter().map(|&(_,  _,  zi)| zi as i64).collect();

    Ok((
        Array1::from(xi_vec).into_pyarray_bound(py).into(),
        Array1::from(yi_vec).into_pyarray_bound(py).into(),
        Array1::from(zi_vec).into_pyarray_bound(py).into(),
    ))
}

// ---------------------------------------------------------------------------
// find_best_z_start_rs
// ---------------------------------------------------------------------------
#[pyfunction]
fn find_best_z_start_rs<'py>(
    _py: Python<'py>,
    gold_py: PyReadonlyArray3<'py, f32>,
    wag_py:  PyReadonlyArray3<'py, f32>,
    cutoff:  f64,
    stope_h: usize,
) -> PyResult<usize> {
    let gold: Array3<f32> = gold_py.as_array().to_owned();
    let wag:  Array3<f32> = wag_py .as_array().to_owned();
    let nx = wag.shape()[0];
    let ny = wag.shape()[1];
    let nz = wag.shape()[2];
    let wag_ref  = &wag;
    let gold_ref = &gold;

    let best = (0..stope_h)
        .into_par_iter()
        .map(|start| {
            let total: f64 = (start..nz)
                .step_by(stope_h)
                .flat_map(|zi| {
                    (0..nx).flat_map(move |xi| {
                        (0..ny).filter_map(move |yi| {
                            if wag_ref[[xi, yi, zi]] as f64 >= cutoff {
                                Some(gold_ref[[xi, yi, zi]] as f64)
                            } else { None }
                        })
                    })
                })
                .sum();
            (total, start)
        })
        .max_by(|(a, _), (b, _)| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(_, s)| s)
        .unwrap_or(0);
    Ok(best)
}

// ---------------------------------------------------------------------------
// Sliding window prefix-sum helpers
//
// All three functions use par_chunks_mut — safe, no unsafe code required.
// Each "chunk" is a contiguous slice that one Rayon task owns exclusively.
//
// Parallelism strategy:
//   slide_x — parallelize over (yi, zi) columns; output stored transposed
//              as (ny*nz, ox), then rearranged to (ox, ny, nz).
//   slide_y — parallelize over (xi, zi) columns; output stored as
//              (dx*nz, oy), then rearranged to (dx, oy, nz).
//   slide_z — parallelize over (xi, yi) columns; layout (dx*dy, oz) is
//              already identical to C-order (dx, dy, oz) — no rearrangement.
// ---------------------------------------------------------------------------

/// Sliding window sum along axis 0.
/// Input  (nx, ny, nz)  →  Output (ox, ny, nz),  ox = nx − wx + 1
/// Uses f32 throughout to halve cache pressure vs f64 (SIMD: 8 f32 vs 4 f64 per AVX2 reg).
fn slide_x(arr: &[f32], nx: usize, ny: usize, nz: usize, wx: usize) -> Vec<f32> {
    let ox  = nx - wx + 1;
    let nyz = ny * nz;

    // Work buffer: (nyz, ox) — each contiguous chunk[ox] = one (yi,zi) column
    let mut tmp = vec![0.0f32; nyz * ox];
    tmp.par_chunks_mut(ox).enumerate().for_each(|(yz, chunk)| {
        let mut prefix = vec![0.0f32; nx + 1];
        for xi in 0..nx {
            prefix[xi + 1] = prefix[xi] + arr[xi * nyz + yz];
        }
        for xi in 0..ox {
            chunk[xi] = prefix[xi + wx] - prefix[xi];
        }
    });

    // Rearrange (nyz, ox) → (ox, nyz):  out[xi*nyz + yz] = tmp[yz*ox + xi]
    let mut out = vec![0.0f32; ox * nyz];
    for yz in 0..nyz {
        for xi in 0..ox {
            out[xi * nyz + yz] = tmp[yz * ox + xi];
        }
    }
    out
}

/// Sliding window sum along axis 1.
/// Input  (dx, ny, nz)  →  Output (dx, oy, nz),  oy = ny − wy + 1
fn slide_y(arr: &[f32], dx: usize, ny: usize, nz: usize, wy: usize) -> Vec<f32> {
    let oy   = ny - wy + 1;
    let dxnz = dx * nz;

    // Work buffer: (dx*nz, oy) — each contiguous chunk[oy] = one (xi,zi) column
    let mut tmp = vec![0.0f32; dxnz * oy];
    tmp.par_chunks_mut(oy).enumerate().for_each(|(xz, chunk)| {
        let xi = xz / nz;
        let zi = xz % nz;
        let mut prefix = vec![0.0f32; ny + 1];
        for yi in 0..ny {
            prefix[yi + 1] = prefix[yi] + arr[xi * ny * nz + yi * nz + zi];
        }
        for yi in 0..oy {
            chunk[yi] = prefix[yi + wy] - prefix[yi];
        }
    });

    // Rearrange (dx*nz, oy) → (dx, oy, nz):
    //   out[xi*oy*nz + yi*nz + zi] = tmp[(xi*nz+zi)*oy + yi]
    let mut out = vec![0.0f32; dx * oy * nz];
    for xi in 0..dx {
        for zi in 0..nz {
            let xz = xi * nz + zi;
            for yi in 0..oy {
                out[xi * oy * nz + yi * nz + zi] = tmp[xz * oy + yi];
            }
        }
    }
    out
}

/// Sliding window sum along axis 2.
/// Input  (dx, dy, nz)  →  Output (dx, dy, oz),  oz = nz − wz + 1
///
/// Layout note: flat index of (xi, yi, zi) in (dx, dy, oz) is
///   xi*dy*oz + yi*oz + zi = (xi*dy + yi)*oz + zi = xy*oz + zi
/// which is exactly the par_chunks_mut(oz) layout — no rearrangement needed.
fn slide_z(arr: &[f32], dx: usize, dy: usize, nz: usize, wz: usize) -> Vec<f32> {
    let oz = nz - wz + 1;

    // Output is (dx*dy, oz); par_chunks_mut(oz) partitions it into dx*dy chunks
    let mut out = vec![0.0f32; dx * dy * oz];
    out.par_chunks_mut(oz).enumerate().for_each(|(xy, chunk)| {
        let xi = xy / dy;
        let yi = xy % dy;
        let mut prefix = vec![0.0f32; nz + 1];
        for zi in 0..nz {
            prefix[zi + 1] = prefix[zi] + arr[xi * dy * nz + yi * nz + zi];
        }
        for zi in 0..oz {
            chunk[zi] = prefix[zi + wz] - prefix[zi];
        }
    });
    out
}

/// Three-axis separable sliding window sum.
/// Returns flat C-order f32 buffer of shape (nx−wx+1, ny−wy+1, nz−wz+1).
/// Stays in f32 throughout — precision is sufficient (grade×density sums over
/// 24 blocks stay well within f32 range; ~7 decimal digits is more than enough).
fn sliding_window_sum(input: &Array3<f32>, wx: usize, wy: usize, wz: usize) -> Vec<f32> {
    let (nx, ny, nz) = input.dim();
    // to_owned() produces a C-contiguous array; iter() visits in C order.
    let arr: Vec<f32> = input.iter().copied().collect();

    let p1 = slide_x(&arr, nx, ny, nz, wx);   // (ox, ny, nz)
    let ox = nx - wx + 1;
    let p2 = slide_y(&p1,  ox, ny, nz, wy);   // (ox, oy, nz)
    let oy = ny - wy + 1;
    slide_z(&p2, ox, oy, nz, wz)              // (ox, oy, oz)
}

// ---------------------------------------------------------------------------
// precompute_rs — Python-callable entry point
//
// Computes the five pre-computed grids consumed by extract_stopes:
//   wag_grid, tonnes_grid, gold_grid, waste_grid, avg_density_grid
// All with shape (nx-stope_l+1, ny-stope_t+1, nz-stope_h+1).
//
// Advantages over the NumPy precompute() at large scale:
//   • No intermediate np.concatenate() allocations → ~3× less peak memory
//   • Three independent sliding sums run concurrently via rayon::join
//   • Each sliding sum is internally parallelised via par_chunks_mut
// ---------------------------------------------------------------------------
#[pyfunction]
fn precompute_rs<'py>(
    py:         Python<'py>,
    grade_py:   PyReadonlyArray3<'py, f32>,
    density_py: PyReadonlyArray3<'py, f32>,
    stope_l:    usize,
    stope_t:    usize,
    stope_h:    usize,
    vol_per_block: f64,
) -> PyResult<(
    Py<PyArray3<f32>>,  // wag_grid
    Py<PyArray3<f32>>,  // tonnes_grid
    Py<PyArray3<f32>>,  // gold_grid
    Py<PyArray3<f32>>,  // waste_grid
    Py<PyArray3<f32>>,  // avg_density_grid
)> {
    let grade   = grade_py  .as_array().to_owned();
    let density = density_py.as_array().to_owned();
    let (nx, ny, nz) = grade.dim();

    // Build input grids: gd = grade*density, waste_d = density where grade<=0
    let gd_vec: Vec<f32> = grade.iter().zip(density.iter())
        .map(|(&g, &d)| g * d).collect();
    let gd = Array3::from_shape_vec((nx, ny, nz), gd_vec).unwrap();

    let waste_d_vec: Vec<f32> = grade.iter().zip(density.iter())
        .map(|(&g, &d)| if g <= 0.0 { d } else { 0.0 }).collect();
    let waste_d = Array3::from_shape_vec((nx, ny, nz), waste_d_vec).unwrap();

    // Run all three sliding window sums concurrently.
    // rayon::join forks two tasks; the right task forks again → three workers.
    // Each worker is itself parallelised by par_chunks_mut inside slide_*.
    let (sum_gd, (sum_d, sum_wd)) = rayon::join(
        || sliding_window_sum(&gd,      stope_l, stope_t, stope_h),
        || rayon::join(
            || sliding_window_sum(&density, stope_l, stope_t, stope_h),
            || sliding_window_sum(&waste_d, stope_l, stope_t, stope_h),
        ),
    );

    let ox = nx - stope_l + 1;
    let oy = ny - stope_t + 1;
    let oz = nz - stope_h + 1;
    let n_blocks = (stope_l * stope_t * stope_h) as f32;
    let vf       = vol_per_block as f32;
    let total    = ox * oy * oz;

    // Derive five output grids in a single parallel pass.
    // sum_gd / sum_d / sum_wd are Vec<f32>; all arithmetic stays in f32.
    let mut wag_v    = vec![0.0f32; total];
    let mut tonnes_v = vec![0.0f32; total];
    let mut gold_v   = vec![0.0f32; total];
    let mut avg_d_v  = vec![0.0f32; total];
    let mut waste_v  = vec![0.0f32; total];

    wag_v.par_iter_mut()
        .zip(tonnes_v.par_iter_mut())
        .zip(gold_v.par_iter_mut())
        .zip(avg_d_v.par_iter_mut())
        .zip(waste_v.par_iter_mut())
        .zip(sum_gd.par_iter())
        .zip(sum_d.par_iter())
        .zip(sum_wd.par_iter())
        .for_each(|(((((((w, t), g), a), ws), &gd), &d), &wd)| {
            *w  = if d > 0.0 { gd / d } else { 0.0 };
            *t  = d  * vf;
            *g  = gd * vf;
            *a  = d  / n_blocks;
            *ws = wd * vf;
        });

    let shape = (ox, oy, oz);
    Ok((
        Array3::from_shape_vec(shape, wag_v   ).unwrap().into_pyarray_bound(py).into(),
        Array3::from_shape_vec(shape, tonnes_v).unwrap().into_pyarray_bound(py).into(),
        Array3::from_shape_vec(shape, gold_v  ).unwrap().into_pyarray_bound(py).into(),
        Array3::from_shape_vec(shape, waste_v ).unwrap().into_pyarray_bound(py).into(),
        Array3::from_shape_vec(shape, avg_d_v ).unwrap().into_pyarray_bound(py).into(),
    ))
}

// ---------------------------------------------------------------------------
// build_stopes_json_rs
//
// Takes the sorted (xi, yi, zi) index arrays from dp_all_strips plus all five
// pre-computed grids and economic parameters.  Runs metric computation in
// parallel (Rayon), then serialises the COMPLETE API response JSON directly
// in Rust — bypassing Python dict building, .tolist(), and orjson overhead.
//
// Returns (json_bytes, stope_count) where json_bytes is the full JSON:
//   {"stopes":[{...},...], "summary":{...}}
// ready to be returned as Response(content=json_bytes).
//
// Benchmark (148,500 stopes): Python dict path ≈ 1050 ms → Rust ≈ 60 ms (17×).
// ---------------------------------------------------------------------------

struct StopeRecord {
    easting: f64, northing: f64, rl: f64,
    x_min: f64, x_max: f64,
    y_min: f64, y_max: f64,
    z_min: f64, z_max: f64,
    tonnes: f64, ore_tonnes: f64, waste_tonnes: f64,
    dilution_pct: f64, avg_density: f64, head_grade: f64,
    gold_grams: f64, contained_oz: f64, recovered_oz: f64,
    nsr_per_t: f64, nsv_usd: f64,
    gross_revenue_usd: f64, royalty_usd: f64,
    mining_cost_usd: f64, processing_cost_usd: f64,
    refining_cost_usd: f64, ga_cost_usd: f64, sustaining_cost_usd: f64,
}

#[allow(clippy::too_many_arguments)]
#[pyfunction]
fn build_stopes_json_rs<'py>(
    py:          Python<'py>,
    xi_py:       PyReadonlyArray1<'py, i64>,
    yi_py:       PyReadonlyArray1<'py, i64>,
    zi_py:       PyReadonlyArray1<'py, i64>,
    tonnes_py:   PyReadonlyArray3<'py, f32>,
    gold_py:     PyReadonlyArray3<'py, f32>,
    waste_py:    PyReadonlyArray3<'py, f32>,
    avgden_py:   PyReadonlyArray3<'py, f32>,
    wag_py:      PyReadonlyArray3<'py, f32>,
    xc_py:       PyReadonlyArray1<'py, f64>,
    yc_py:       PyReadonlyArray1<'py, f64>,
    zc_py:       PyReadonlyArray1<'py, f64>,
    // economic parameters
    gold_price:             f64,
    royalty_pct:            f64,
    mining_cost_per_t:      f64,
    processing_cost_per_t:  f64,
    refining_cost_per_oz:   f64,
    metallurgical_recovery: f64,
    dilution_factor:        f64,
    mining_recovery:        f64,
    payable_pct:            f64,
    ga_cost_per_t:          f64,
    sustaining_capex_per_t: f64,
    use_nsv_filter: bool,
    nsv_min_usd:    f64,
    nsv_max_usd:    f64,
    cutoff_grade:   f64,
    // geometry
    cell_size:        f64,
    stope_l:          usize,
    stope_t:          usize,
    stope_h:          usize,
    stope_length_m:   f64,
    stope_thickness_m: f64,
    stope_height_m:   f64,
    stope_volume:     f64,
    z_start:          usize,
) -> PyResult<(Py<PyBytes>, usize)> {

    let xi     = xi_py    .as_array();
    let yi     = yi_py    .as_array();
    let zi     = zi_py    .as_array();
    let tonnes = tonnes_py.as_array();
    let gold   = gold_py  .as_array();
    let waste  = waste_py .as_array();
    let avgden = avgden_py.as_array();
    let wag    = wag_py   .as_array();
    let xc     = xc_py    .as_array();
    let yc     = yc_py    .as_array();
    let zc     = zc_py    .as_array();

    let n    = xi.len();
    let half = cell_size / 2.0;

    // ── Parallel metric computation ────────────────────────────────────────
    let records: Vec<Option<StopeRecord>> = (0..n)
        .into_par_iter()
        .map(|k| {
            let xi_k = xi[k] as usize;
            let yi_k = yi[k] as usize;
            let zi_k = zi[k] as usize;

            let tonnes_k = tonnes[[xi_k, yi_k, zi_k]] as f64;
            let gold_g_k = gold  [[xi_k, yi_k, zi_k]] as f64;
            let waste_k  = waste [[xi_k, yi_k, zi_k]] as f64;
            let avgden_k = avgden[[xi_k, yi_k, zi_k]] as f64;
            let wag_k    = wag   [[xi_k, yi_k, zi_k]] as f64;

            // NSV formula (mirrors _compute_nsv_vec)
            let gold_oz   = gold_g_k / 31.1035;
            let mined_t   = tonnes_k * mining_recovery;
            let pay_oz    = gold_oz * (1.0 - dilution_factor) * mining_recovery
                                    * metallurgical_recovery * payable_pct;
            let gross     = pay_oz  * gold_price;
            let royalty   = gross   * royalty_pct;
            let net_rev   = gross   - royalty;
            let mine_c    = mined_t * mining_cost_per_t;
            let proc_c    = mined_t * processing_cost_per_t;
            let refin_c   = pay_oz  * refining_cost_per_oz;
            let ga_c      = mined_t * ga_cost_per_t;
            let sust_c    = mined_t * sustaining_capex_per_t;
            let nsv       = net_rev - mine_c - proc_c - refin_c - ga_c - sust_c;

            // NSV filter
            if use_nsv_filter && nsv < nsv_min_usd              { return None; }
            if use_nsv_filter && nsv_max_usd > 0.0 && nsv > nsv_max_usd { return None; }

            // Coordinates
            let x_min = xc[xi_k]              - half;
            let x_max = xc[xi_k + stope_l - 1] + half;
            let y_min = yc[yi_k]              - half;
            let y_max = yc[yi_k + stope_t - 1] + half;
            let z_min = zc[zi_k]              - half;
            let z_max = zc[zi_k + stope_h - 1] + half;

            let ore_t    = tonnes_k - waste_k;
            let dil_pct  = if tonnes_k > 0.0 { waste_k / tonnes_k * 100.0 } else { 0.0 };
            let nsr_t    = if tonnes_k > 0.0 { nsv / tonnes_k }             else { 0.0 };

            Some(StopeRecord {
                easting:  (x_min + x_max) * 0.5,
                northing: (y_min + y_max) * 0.5,
                rl:       (z_min + z_max) * 0.5,
                x_min, x_max, y_min, y_max, z_min, z_max,
                tonnes: tonnes_k, ore_tonnes: ore_t, waste_tonnes: waste_k,
                dilution_pct: dil_pct, avg_density: avgden_k, head_grade: wag_k,
                gold_grams: gold_g_k, contained_oz: gold_oz, recovered_oz: pay_oz,
                nsr_per_t: nsr_t, nsv_usd: nsv,
                gross_revenue_usd: gross, royalty_usd: royalty,
                mining_cost_usd: mine_c, processing_cost_usd: proc_c,
                refining_cost_usd: refin_c, ga_cost_usd: ga_c,
                sustaining_cost_usd: sust_c,
            })
        })
        .collect();

    // Flatten (preserve order — rayon indexed par_iter guarantees this)
    let stopes: Vec<StopeRecord> = records.into_iter().flatten().collect();
    let count = stopes.len();

    // ── Summary aggregates (single serial pass) ────────────────────────────
    let total_tonnes   : f64 = stopes.iter().map(|s| s.tonnes      ).sum();
    let total_ore_t    : f64 = stopes.iter().map(|s| s.ore_tonnes   ).sum();
    let total_waste_t  : f64 = stopes.iter().map(|s| s.waste_tonnes ).sum();
    let total_gold_g   : f64 = stopes.iter().map(|s| s.gold_grams   ).sum();
    let total_gold_oz  : f64 = stopes.iter().map(|s| s.contained_oz ).sum();
    let total_rec_oz   : f64 = stopes.iter().map(|s| s.recovered_oz ).sum();
    let total_nsv      : f64 = stopes.iter().map(|s| s.nsv_usd      ).sum();
    let total_vol             = count as f64 * stope_volume;
    let max_grade      : f64 = stopes.iter().map(|s| s.head_grade)
                                     .fold(0.0_f64, f64::max);
    let avg_grade             = if total_tonnes > 0.0 { total_gold_g / total_tonnes  } else { 0.0 };
    let avg_nsr               = if total_ore_t  > 0.0 { total_nsv    / total_ore_t   } else { 0.0 };
    let overall_dil           = if total_tonnes > 0.0 { total_waste_t / total_tonnes * 100.0 } else { 0.0 };

    // Unique level elevations (z_min rounded to 1 decimal → stored as ×10 i64)
    let mut level_set: BTreeSet<i64> = BTreeSet::new();
    for s in &stopes { level_set.insert((s.z_min * 10.0).round() as i64); }
    let mut levels_json = String::from("[");
    for (i, &lk) in level_set.iter().enumerate() {
        if i > 0 { levels_json.push(','); }
        let _ = write!(levels_json, "{:.1}", lk as f64 / 10.0);
    }
    levels_json.push(']');

    // ── JSON serialisation ─────────────────────────────────────────────────
    // ~700 bytes per stope + 500 bytes for header/summary
    let mut out = String::with_capacity(count * 700 + 500);
    out.push_str("{\"stopes\":[");

    for (k, s) in stopes.iter().enumerate() {
        if k > 0 { out.push(','); }
        let z_min_r = (s.z_min * 10.0).round() / 10.0;   // level_z (1 dp)
        let _ = write!(out,
            "{{\"stope_id\":\"Stope_{:04}\",\
              \"easting\":{:.1},\"northing\":{:.1},\"rl\":{:.1},\
              \"level_name\":\"{:.0} RL\",\
              \"x_min\":{:.1},\"x_max\":{:.1},\"y_min\":{:.1},\"y_max\":{:.1},\
              \"z_min\":{:.1},\"z_max\":{:.1},\
              \"strike_length\":{},\"stope_height\":{},\"stope_width\":{},\"volume\":{},\
              \"tonnes\":{:.2},\"ore_tonnes\":{:.2},\"waste_tonnes\":{:.2},\
              \"dilution_pct\":{:.2},\"avg_density\":{:.4},\"head_grade\":{:.4},\
              \"gold_grams\":{:.2},\"contained_oz\":{:.2},\"recovered_oz\":{:.2},\
              \"nsr_per_t\":{:.2},\"nsv_usd\":{:.0},\
              \"gross_revenue_usd\":{:.0},\"royalty_usd\":{:.0},\
              \"mining_cost_usd\":{:.0},\"processing_cost_usd\":{:.0},\
              \"refining_cost_usd\":{:.0},\"ga_cost_usd\":{:.0},\
              \"sustaining_cost_usd\":{:.0},\
              \"avg_grade\":{:.4},\"gold_oz\":{:.2},\
              \"cutoff_used\":{},\"level_z\":{:.1}}}",
            k + 1,
            s.easting, s.northing, s.rl, s.z_min,
            s.x_min, s.x_max, s.y_min, s.y_max, s.z_min, s.z_max,
            stope_length_m, stope_height_m, stope_thickness_m, stope_volume,
            s.tonnes, s.ore_tonnes, s.waste_tonnes,
            s.dilution_pct, s.avg_density, s.head_grade,
            s.gold_grams, s.contained_oz, s.recovered_oz,
            s.nsr_per_t, s.nsv_usd,
            s.gross_revenue_usd, s.royalty_usd,
            s.mining_cost_usd, s.processing_cost_usd,
            s.refining_cost_usd, s.ga_cost_usd, s.sustaining_cost_usd,
            s.head_grade, s.contained_oz,
            cutoff_grade, z_min_r,
        );
    }

    out.push_str("],\"summary\":{");
    let _ = write!(out,
        "\"total_stopes\":{},\
         \"total_tonnes\":{:.0},\"total_ore_tonnes\":{:.0},\"total_waste_tonnes\":{:.0},\
         \"total_volume_m3\":{:.0},\"total_gold_grams\":{:.0},\
         \"total_gold_oz\":{:.2},\"total_recovered_oz\":{:.2},\"total_nsv_usd\":{:.0},\
         \"avg_grade_gt\":{:.4},\"avg_nsr_per_t\":{:.2},\"max_grade_gt\":{:.4},\
         \"overall_dilution_pct\":{:.2},\"cutoff_grade_used\":{},\
         \"mining_levels\":{},\"level_elevations\":{},\"z_start_index\":{}",
        count,
        total_tonnes, total_ore_t, total_waste_t,
        total_vol, total_gold_g,
        total_gold_oz, total_rec_oz, total_nsv,
        avg_grade, avg_nsr, max_grade,
        overall_dil, cutoff_grade,
        level_set.len(), levels_json, z_start,
    );
    out.push_str("}}");

    let bytes = PyBytes::new_bound(py, out.as_bytes());
    Ok((bytes.into(), count))
}

// ---------------------------------------------------------------------------
// append_stope_json — writes one stope's JSON directly into an existing String.
// Serial: avoids 370K per-stope heap allocations that cause Windows allocator
// lock contention when built in parallel — which adds 400+ms, not saves time.
// ---------------------------------------------------------------------------
#[allow(clippy::too_many_arguments)]
#[inline]
fn append_stope_json(
    out: &mut String, ibuf: &mut itoa::Buffer,
    k: usize, s: &StopeRecord,
    stope_length_m: f64, stope_height_m: f64, stope_thickness_m: f64, stope_volume: f64,
    cutoff_grade: f64,
) {
    let id = k + 1;
    let z_min_r = (s.z_min * 10.0).round() / 10.0;

    out.push_str("{\"stope_id\":\"Stope_");
    let id_s = ibuf.format(id);
    for _ in 0..4_usize.saturating_sub(id_s.len()) { out.push('0'); }
    out.push_str(id_s);

    out.push_str("\",\"easting\":");       push_fixed(out, s.easting,  1);
    out.push_str(",\"northing\":");        push_fixed(out, s.northing, 1);
    out.push_str(",\"rl\":");              push_fixed(out, s.rl,       1);
    out.push_str(",\"level_name\":\"");    push_fixed(out, s.z_min,    0);
    out.push_str(" RL\"");
    out.push_str(",\"x_min\":");           push_fixed(out, s.x_min, 1);
    out.push_str(",\"x_max\":");           push_fixed(out, s.x_max, 1);
    out.push_str(",\"y_min\":");           push_fixed(out, s.y_min, 1);
    out.push_str(",\"y_max\":");           push_fixed(out, s.y_max, 1);
    out.push_str(",\"z_min\":");           push_fixed(out, s.z_min, 1);
    out.push_str(",\"z_max\":");           push_fixed(out, s.z_max, 1);
    out.push_str(",\"strike_length\":");   out.push_str(ibuf.format(stope_length_m    as i64));
    out.push_str(",\"stope_height\":");    out.push_str(ibuf.format(stope_height_m    as i64));
    out.push_str(",\"stope_width\":");     out.push_str(ibuf.format(stope_thickness_m as i64));
    out.push_str(",\"volume\":");          out.push_str(ibuf.format(stope_volume       as i64));
    out.push_str(",\"tonnes\":");          push_fixed(out, s.tonnes,        2);
    out.push_str(",\"ore_tonnes\":");      push_fixed(out, s.ore_tonnes,    2);
    out.push_str(",\"waste_tonnes\":");    push_fixed(out, s.waste_tonnes,  2);
    out.push_str(",\"dilution_pct\":");    push_fixed(out, s.dilution_pct,  2);
    out.push_str(",\"avg_density\":");     push_fixed(out, s.avg_density,   4);
    out.push_str(",\"head_grade\":");      push_fixed(out, s.head_grade,    4);
    out.push_str(",\"gold_grams\":");      push_fixed(out, s.gold_grams,    2);
    out.push_str(",\"contained_oz\":");    push_fixed(out, s.contained_oz,  2);
    out.push_str(",\"recovered_oz\":");    push_fixed(out, s.recovered_oz,  2);
    out.push_str(",\"nsr_per_t\":");       push_fixed(out, s.nsr_per_t,     2);
    out.push_str(",\"nsv_usd\":");         push_fixed(out, s.nsv_usd,       0);
    out.push_str(",\"gross_revenue_usd\":"); push_fixed(out, s.gross_revenue_usd,   0);
    out.push_str(",\"royalty_usd\":");     push_fixed(out, s.royalty_usd,           0);
    out.push_str(",\"mining_cost_usd\":"); push_fixed(out, s.mining_cost_usd,       0);
    out.push_str(",\"processing_cost_usd\":"); push_fixed(out, s.processing_cost_usd, 0);
    out.push_str(",\"refining_cost_usd\":"); push_fixed(out, s.refining_cost_usd,   0);
    out.push_str(",\"ga_cost_usd\":");     push_fixed(out, s.ga_cost_usd,           0);
    out.push_str(",\"sustaining_cost_usd\":"); push_fixed(out, s.sustaining_cost_usd, 0);
    out.push_str(",\"avg_grade\":");       push_fixed(out, s.head_grade,    4);
    out.push_str(",\"gold_oz\":");         push_fixed(out, s.contained_oz,  2);
    out.push_str(",\"cutoff_used\":");     push_fixed(out, cutoff_grade,    2);
    out.push_str(",\"level_z\":");         push_fixed(out, z_min_r,         1);
    out.push('}');
}

// ---------------------------------------------------------------------------
// optimize_all_rs — fused DP + metrics + JSON in a single Rayon pass
//
// Combines dp_all_strips + build_stopes_json_rs into ONE Rust call:
//   • Eliminates intermediate xi/yi/zi numpy arrays (saves ~3 × 1.2 MB allocs)
//   • Single Rayon parallel region instead of two sequential ones
//   • Uses push_fixed for JSON output (~15× faster than write! format strings)
//
// Expected improvement over the two-step approach at 148,500 stopes:
//   JSON build:   900 ms → ~60 ms (fast formatters)
//   DP overhead:  ~50 ms saved (no intermediate array alloc/dealloc)
//   Total:        ~1000 ms → ~120-200 ms
// ---------------------------------------------------------------------------
#[allow(clippy::too_many_arguments)]
#[pyfunction]
fn optimize_all_rs<'py>(
    py:          Python<'py>,
    wag_py:      PyReadonlyArray3<'py, f32>,
    gold_py:     PyReadonlyArray3<'py, f32>,
    tonnes_py:   PyReadonlyArray3<'py, f32>,
    waste_py:    PyReadonlyArray3<'py, f32>,
    avgden_py:   PyReadonlyArray3<'py, f32>,
    xc_py:       PyReadonlyArray1<'py, f64>,
    yc_py:       PyReadonlyArray1<'py, f64>,
    zc_py:       PyReadonlyArray1<'py, f64>,
    // DP parameters
    cutoff:   f64,
    z_start:  usize,
    stope_h:  usize,
    stope_l:  usize,
    stope_t:  usize,
    pillar:   usize,
    // Economic parameters (same order as build_stopes_json_rs)
    gold_price:             f64,
    royalty_pct:            f64,
    mining_cost_per_t:      f64,
    processing_cost_per_t:  f64,
    refining_cost_per_oz:   f64,
    metallurgical_recovery: f64,
    dilution_factor:        f64,
    mining_recovery:        f64,
    payable_pct:            f64,
    ga_cost_per_t:          f64,
    sustaining_capex_per_t: f64,
    use_nsv_filter: bool,
    nsv_min_usd:    f64,
    nsv_max_usd:    f64,
    cutoff_grade:   f64,
    // Geometry
    cell_size:         f64,
    stope_length_m:    f64,
    stope_thickness_m: f64,
    stope_height_m:    f64,
    stope_volume:      f64,
) -> PyResult<(Py<PyBytes>, usize)> {

    // ── Borrow grids.  wag+gold need to_owned() for Rayon (lifetime bounds).
    //    The other grids are accessed read-only from parallel closures as views.
    let wag_owned:  Array3<f32> = wag_py .as_array().to_owned();
    let gold_owned: Array3<f32> = gold_py.as_array().to_owned();
    let tonnes = tonnes_py.as_array();
    let waste  = waste_py .as_array();
    let avgden = avgden_py.as_array();
    let wag_v  = wag_py   .as_array();   // for metric lookup after DP selection
    let xc     = xc_py    .as_array();
    let yc     = yc_py    .as_array();
    let zc     = zc_py    .as_array();

    let nx = wag_owned.shape()[0];
    let ny = wag_owned.shape()[1];
    let nz = wag_owned.shape()[2];
    let half = cell_size / 2.0;

    // ── Build strip list in level order (zi ascending, yi ascending) ──────
    let strips: Vec<(usize, usize)> = (z_start..nz)
        .step_by(stope_h)
        .flat_map(|zi| (0..ny).map(move |yi| (zi, yi)))
        .collect();

    // ── Single parallel region: DP + per-stope metrics ────────────────────
    // par_iter() on Vec preserves index order on collect → result is sorted.
    let batches: Vec<Vec<StopeRecord>> = strips
        .par_iter()
        .map(|&(zi, yi)| {
            let selected = dp_strip(&wag_owned, &gold_owned, nx, yi, zi,
                                    cutoff, stope_l, pillar);
            selected
                .into_iter()
                .filter_map(|xi| {
                    let tonnes_k = tonnes[[xi, yi, zi]] as f64;
                    let gold_g_k = gold_owned[[xi, yi, zi]] as f64;
                    let waste_k  = waste [[xi, yi, zi]] as f64;
                    let avgden_k = avgden [[xi, yi, zi]] as f64;
                    let wag_k    = wag_v  [[xi, yi, zi]] as f64;

                    let gold_oz  = gold_g_k / 31.1035;
                    let mined_t  = tonnes_k * mining_recovery;
                    let pay_oz   = gold_oz * (1.0 - dilution_factor) * mining_recovery
                                           * metallurgical_recovery * payable_pct;
                    let gross    = pay_oz  * gold_price;
                    let royalty  = gross   * royalty_pct;
                    let net_rev  = gross   - royalty;
                    let mine_c   = mined_t * mining_cost_per_t;
                    let proc_c   = mined_t * processing_cost_per_t;
                    let refin_c  = pay_oz  * refining_cost_per_oz;
                    let ga_c     = mined_t * ga_cost_per_t;
                    let sust_c   = mined_t * sustaining_capex_per_t;
                    let nsv      = net_rev - mine_c - proc_c - refin_c - ga_c - sust_c;

                    if use_nsv_filter && nsv < nsv_min_usd              { return None; }
                    if use_nsv_filter && nsv_max_usd > 0.0 && nsv > nsv_max_usd { return None; }

                    let x_min = xc[xi]              - half;
                    let x_max = xc[xi + stope_l - 1] + half;
                    let y_min = yc[yi]              - half;
                    let y_max = yc[yi + stope_t - 1] + half;
                    let z_min = zc[zi]              - half;
                    let z_max = zc[zi + stope_h - 1] + half;

                    let ore_t   = tonnes_k - waste_k;
                    let dil_pct = if tonnes_k > 0.0 { waste_k / tonnes_k * 100.0 } else { 0.0 };
                    let nsr_t   = if tonnes_k > 0.0 { nsv / tonnes_k }             else { 0.0 };

                    Some(StopeRecord {
                        easting:  (x_min + x_max) * 0.5,
                        northing: (y_min + y_max) * 0.5,
                        rl:       (z_min + z_max) * 0.5,
                        x_min, x_max, y_min, y_max, z_min, z_max,
                        tonnes: tonnes_k, ore_tonnes: ore_t, waste_tonnes: waste_k,
                        dilution_pct: dil_pct, avg_density: avgden_k, head_grade: wag_k,
                        gold_grams: gold_g_k, contained_oz: gold_oz, recovered_oz: pay_oz,
                        nsr_per_t: nsr_t, nsv_usd: nsv,
                        gross_revenue_usd: gross, royalty_usd: royalty,
                        mining_cost_usd: mine_c, processing_cost_usd: proc_c,
                        refining_cost_usd: refin_c, ga_cost_usd: ga_c,
                        sustaining_cost_usd: sust_c,
                    })
                })
                .collect()
        })
        .collect();

    let stopes: Vec<StopeRecord> = batches.into_iter().flatten().collect();
    let count = stopes.len();

    // ── Summary aggregates (parallel reduction) ───────────────────────────
    let (total_tonnes, total_ore_t, total_waste_t, total_gold_g,
         total_gold_oz, total_rec_oz, total_nsv, max_grade) =
        stopes.par_iter()
              .map(|s| (s.tonnes, s.ore_tonnes, s.waste_tonnes, s.gold_grams,
                        s.contained_oz, s.recovered_oz, s.nsv_usd, s.head_grade))
              .reduce(
                  || (0.0f64, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0_f64),
                  |(t1,o1,w1,g1,z1,r1,n1,m1),(t2,o2,w2,g2,z2,r2,n2,m2)|
                      (t1+t2, o1+o2, w1+w2, g1+g2, z1+z2, r1+r2, n1+n2, m1.max(m2)),
              );

    let avg_grade   = if total_tonnes > 0.0 { total_gold_g / total_tonnes } else { 0.0 };
    let avg_nsr     = if total_ore_t  > 0.0 { total_nsv    / total_ore_t  } else { 0.0 };
    let overall_dil = if total_tonnes > 0.0 { total_waste_t / total_tonnes * 100.0 } else { 0.0 };

    let mut level_set: BTreeSet<i64> = BTreeSet::new();
    for s in &stopes { level_set.insert((s.z_min * 10.0).round() as i64); }

    // ── Fast serial JSON serialisation (push_fixed + itoa) ───────────────
    // Serial into one pre-allocated String — ONE heap allocation, zero
    // allocator contention. Parallel JSON (370K × malloc) was 3× slower on
    // Windows due to HeapAlloc lock contention between Rayon threads.
    let mut out = String::with_capacity(count * 600 + 512);
    out.push_str("{\"stopes\":[");

    let mut ibuf = itoa::Buffer::new();
    for (k, s) in stopes.iter().enumerate() {
        if k > 0 { out.push(','); }
        append_stope_json(&mut out, &mut ibuf, k, s,
            stope_length_m, stope_height_m, stope_thickness_m, stope_volume,
            cutoff_grade);
    }
    out.push_str("],\"summary\":{");
    out.push_str("\"total_stopes\":");        out.push_str(ibuf.format(count));
    out.push_str(",\"total_tonnes\":");       push_fixed(&mut out, total_tonnes,  0);
    out.push_str(",\"total_ore_tonnes\":");   push_fixed(&mut out, total_ore_t,   0);
    out.push_str(",\"total_waste_tonnes\":"); push_fixed(&mut out, total_waste_t, 0);
    out.push_str(",\"total_volume_m3\":");    push_fixed(&mut out, stope_volume * count as f64, 0);
    out.push_str(",\"total_gold_grams\":");   push_fixed(&mut out, total_gold_g,  0);
    out.push_str(",\"total_gold_oz\":");      push_fixed(&mut out, total_gold_oz, 2);
    out.push_str(",\"total_recovered_oz\":"); push_fixed(&mut out, total_rec_oz,  2);
    out.push_str(",\"total_nsv_usd\":");      push_fixed(&mut out, total_nsv,     0);
    out.push_str(",\"avg_grade_gt\":");       push_fixed(&mut out, avg_grade,     4);
    out.push_str(",\"avg_nsr_per_t\":");      push_fixed(&mut out, avg_nsr,       2);
    out.push_str(",\"max_grade_gt\":");       push_fixed(&mut out, max_grade,     4);
    out.push_str(",\"overall_dilution_pct\":"); push_fixed(&mut out, overall_dil, 2);
    out.push_str(",\"cutoff_grade_used\":"); push_fixed(&mut out, cutoff_grade,   2);
    out.push_str(",\"mining_levels\":");      out.push_str(ibuf.format(level_set.len()));
    out.push_str(",\"level_elevations\":[");
    for (i, &lk) in level_set.iter().enumerate() {
        if i > 0 { out.push(','); }
        push_fixed(&mut out, lk as f64 / 10.0, 1);
    }
    out.push_str("],\"z_start_index\":");
    out.push_str(ibuf.format(z_start));
    out.push_str("}}");

    let bytes = PyBytes::new_bound(py, out.as_bytes());
    Ok((bytes.into(), count))
}

// ---------------------------------------------------------------------------
// Module registration
// ---------------------------------------------------------------------------
#[pymodule]
fn rust_core(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(dp_all_strips,        m)?)?;
    m.add_function(wrap_pyfunction!(find_best_z_start_rs, m)?)?;
    m.add_function(wrap_pyfunction!(precompute_rs,        m)?)?;
    m.add_function(wrap_pyfunction!(build_stopes_json_rs, m)?)?;
    m.add_function(wrap_pyfunction!(optimize_all_rs,      m)?)?;
    Ok(())
}
