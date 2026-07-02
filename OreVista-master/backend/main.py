"""
main.py — OreVista FastAPI backend.

Startup:
  1. Load block model CSV — reads XC, YC, ZC, AU, DENSITY, XINC, YINC, ZINC.
  2. Build 3D grade/density/volume grids.
  3. Pre-compute WAG, tonnes, gold, waste grids (O(n) step).
  All subsequent requests are fast re-filters on the pre-computed grids.

API Endpoints:
  POST /api/optimize        — run with given cutoff, return stopes + summary
  GET  /api/export/dxf      — download DXF for given cutoff
  GET  /api/export/csv      — download CSV report for given cutoff
  POST /api/compare         — compare two cutoff grades side by side
  GET  /api/status          — health check
  GET  /api/blocks          — raw block model for ore body overlay
  GET  /api/grade-tonnage   — grade-tonnage sensitivity curve
  GET  /api/gold-price      — live gold spot price proxy
  GET  /api/performance     — acceleration mode + run history
"""

import os
import time
import logging
import threading
from contextlib import asynccontextmanager
from datetime import datetime

import httpx
import psutil
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, ORJSONResponse
from pydantic import BaseModel, Field

import numpy as np
import parser   as blk
import optimizer as opt
import exporter  as exp
import reporter  as rep

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("orevista")

# ---------------------------------------------------------------------------
# Global state
# ---------------------------------------------------------------------------

_state: dict = {
    "loaded":            False,
    "processing":        False,
    "filename":          None,
    "grade_grid":        None,
    "density_grid":      None,
    "volume_grid":       None,   # NEW — per-block volumes (XINC×YINC×ZINC)
    "x_coords":          None,
    "y_coords":          None,
    "z_coords":          None,
    "wag_grid":          None,
    "tonnes_grid":       None,
    "gold_grid":         None,
    "waste_grid":        None,
    "avg_density_grid":  None,
    "load_time_s":       None,
    "perf_history":      [],
    "cpu_cores":         [],
    "cpu_total":         0.0,
}

# Background CPU sampler — non-blocking reads every 500 ms
def _cpu_sampler():
    psutil.cpu_percent(percpu=True)
    while True:
        time.sleep(0.5)
        cores = psutil.cpu_percent(percpu=True)
        _state["cpu_cores"] = cores
        _state["cpu_total"] = round(sum(cores) / len(cores) if cores else 0.0, 1)

threading.Thread(target=_cpu_sampler, daemon=True, name="cpu-sampler").start()

CSV_PATH = os.environ.get(
    "BLOCK_MODEL_CSV",
    os.path.join(os.path.dirname(__file__), "..", "data", "Hackathon 2026 - Block Model.csv"),
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load and pre-compute on startup."""
    log.info("Loading block model from: %s", CSV_PATH)
    t0 = time.perf_counter()

    grade, density, volume, xc, yc, zc = blk.load_block_model(CSV_PATH)
    wag, tonnes, gold, waste, avg_den  = opt.precompute_cached(grade, density, volume, CSV_PATH)

    elapsed = time.perf_counter() - t0
    log.info("Block model loaded & WAG grid pre-computed in %.2fs", elapsed)
    log.info("WAG grid shape: %s  |  non-zero positions: %d", wag.shape, (wag > 0).sum())

    _state.update({
        "loaded":           True,
        "grade_grid":       grade,
        "density_grid":     density,
        "volume_grid":      volume,
        "x_coords":         xc,
        "y_coords":         yc,
        "z_coords":         zc,
        "wag_grid":         wag,
        "tonnes_grid":      tonnes,
        "gold_grid":        gold,
        "waste_grid":       waste,
        "avg_density_grid": avg_den,
        "load_time_s":      round(elapsed, 2),
    })
    yield


app = FastAPI(title="OreVista API", version="2.0.0", lifespan=lifespan,
              default_response_class=ORJSONResponse)

app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class EconomicParams(BaseModel):
    gold_price_usd:         float = Field(default=5200.0, ge=0.0)
    mining_cost_per_t:      float = Field(default=50.0,   ge=0.0)
    processing_cost_per_t:  float = Field(default=18.0,   ge=0.0)
    refining_cost_per_oz:   float = Field(default=20.0,   ge=0.0)
    metallurgical_recovery: float = Field(default=0.92,   ge=0.0, le=1.0)
    royalty_pct:            float = Field(default=0.03,   ge=0.0, le=1.0)
    dilution_factor:        float = Field(default=0.15,   ge=0.0, le=0.5)
    mining_recovery:        float = Field(default=0.90,   ge=0.0, le=1.0)
    payable_pct:            float = Field(default=0.995,  ge=0.5, le=1.0)
    ga_cost_per_t:          float = Field(default=5.0,    ge=0.0)
    sustaining_capex_per_t: float = Field(default=5.0,    ge=0.0)
    use_nsv_filter:         bool  = Field(default=False)
    nsv_min_usd:            float = Field(default=0.0,    ge=0.0)
    nsv_max_usd:            float = Field(default=0.0,    ge=0.0)

class OptimizeRequest(BaseModel):
    cutoff_grade:  float          = Field(default=10.0, ge=0.0)
    z_start:       int | None     = Field(default=None, ge=0, le=5)
    pillar_blocks: int            = Field(default=1,    ge=0, le=4)
    economics:     EconomicParams = Field(default_factory=EconomicParams)

class CompareRequest(BaseModel):
    cutoff_a:    float          = Field(default=3.0,  ge=0.0)
    cutoff_b:    float          = Field(default=1.5,  ge=0.0)
    economics_a: EconomicParams = Field(default_factory=EconomicParams)
    economics_b: EconomicParams = Field(default_factory=EconomicParams)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _require_loaded():
    if not _state["loaded"]:
        raise HTTPException(status_code=503, detail="Block model not loaded yet")


def _run_cutoff(cutoff, z_start=None, pillar_blocks=1, economics=None,
                record_history=True):
    t0   = time.perf_counter()
    econ = economics or EconomicParams()
    steps: dict = {}
    stopes, z_used = opt.extract_stopes(
        _state["wag_grid"], _state["tonnes_grid"], _state["gold_grid"],
        _state["waste_grid"], _state["avg_density_grid"],
        _state["x_coords"], _state["y_coords"], _state["z_coords"],
        cutoff, z_start=z_start, pillar_blocks=pillar_blocks,
        economics=econ.model_dump(), _timing=steps,
    )
    ts = time.perf_counter()
    summary = rep.generate_summary(stopes, z_used)
    steps["summary_ms"] = round((time.perf_counter() - ts) * 1000, 1)
    runtime_ms = round((time.perf_counter() - t0) * 1000, 1)
    summary["runtime_ms"] = runtime_ms

    if record_history:
        history = _state["perf_history"]
        history.append({
            "id":          len(history) + 1,
            "timestamp":   datetime.now().isoformat(timespec='seconds'),
            "mode":        "rust" if opt.get_rust_active() else "python",
            "cutoff":      cutoff,
            "stope_count": len(stopes),
            "runtime_ms":  runtime_ms,
            "threads":     os.cpu_count() or 4,
            "steps":       steps,
        })
        if len(history) > 100:
            _state["perf_history"] = history[-100:]

    return stopes, summary


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/status")
def status():
    return {
        "loaded":      _state["loaded"],
        "processing":  _state["processing"],
        "filename":    _state["filename"],
        "load_time_s": _state["load_time_s"],
        "stope_dims":  {
            "length_m":    opt.STOPE_LENGTH_M,
            "height_m":    opt.STOPE_HEIGHT_M,
            "thickness_m": opt.STOPE_THICKNESS_M,
        },
    }


@app.get("/api/available-models")
def available_models():
    data_dir = os.path.join(os.path.dirname(__file__), "..", "data")
    files = []
    for name in sorted(os.listdir(data_dir)):
        if name.lower().endswith(".csv") and not name.startswith("gen_"):
            path    = os.path.join(data_dir, name)
            size_mb = round(os.path.getsize(path) / 1e6, 1)
            files.append({"filename": name, "size_mb": size_mb})
    return {"models": files}


@app.post("/api/preload")
async def preload_model(payload: dict):
    """Load a CSV by filename from the server-side data directory."""
    filename = payload.get("filename", "")
    if not filename.lower().endswith(".csv"):
        raise HTTPException(400, "Only CSV files are supported.")
    data_dir = os.path.join(os.path.dirname(__file__), "..", "data")
    path     = os.path.realpath(os.path.join(data_dir, filename))
    if not path.startswith(os.path.realpath(data_dir)):
        raise HTTPException(400, "Invalid filename.")
    if not os.path.isfile(path):
        raise HTTPException(404, f"File not found: {filename}")

    _state["loaded"] = False; _state["processing"] = True
    _state["filename"] = filename
    try:
        t0 = time.perf_counter()
        grade, density, volume, xc, yc, zc = blk.load_block_model(path)
        wag, tonnes, gold, waste, avg_den  = opt.precompute_cached(grade, density, volume, path)
        elapsed = time.perf_counter() - t0
        _state.update({
            "loaded": True, "processing": False, "filename": filename,
            "grade_grid": grade, "density_grid": density, "volume_grid": volume,
            "x_coords": xc, "y_coords": yc, "z_coords": zc,
            "wag_grid": wag, "tonnes_grid": tonnes, "gold_grid": gold,
            "waste_grid": waste, "avg_density_grid": avg_den,
            "load_time_s": round(elapsed, 2),
        })
        return {"ok": True, "filename": filename, "load_time_s": round(elapsed, 2),
                "grid_shape": list(wag.shape)}
    except Exception as e:
        _state["processing"] = False
        raise HTTPException(422, str(e))


@app.post("/api/upload")
async def upload_block_model(file: UploadFile = File(...)):
    """Accept a CSV block model upload — reads XINC, YINC, ZINC if present."""
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(400, "Only CSV files are supported.")
    _state["loaded"] = False; _state["processing"] = True
    _state["filename"] = file.filename
    try:
        data = await file.read()
        t0   = time.perf_counter()
        grade, density, volume, xc, yc, zc = blk.load_block_model_from_bytes(data)
        wag, tonnes, gold, waste, avg_den  = opt.precompute_cached(grade, density, volume, None)
        elapsed = time.perf_counter() - t0
        _state.update({
            "loaded": True, "processing": False, "filename": file.filename,
            "grade_grid": grade, "density_grid": density, "volume_grid": volume,
            "x_coords": xc, "y_coords": yc, "z_coords": zc,
            "wag_grid": wag, "tonnes_grid": tonnes, "gold_grid": gold,
            "waste_grid": waste, "avg_density_grid": avg_den,
            "load_time_s": round(elapsed, 2),
        })
        return {"ok": True, "filename": file.filename, "load_time_s": round(elapsed, 2),
                "grid_shape": list(wag.shape)}
    except Exception as e:
        _state["processing"] = False
        raise HTTPException(422, str(e))


@app.post("/api/upload/dxf")
async def upload_dxf(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".dxf"):
        raise HTTPException(400, "Only .dxf files are accepted")
    data    = await file.read()
    out_dir = os.path.join(os.path.dirname(__file__), "..", "data", "dxf")
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, file.filename), "wb") as fh:
        fh.write(data)
    return {"filename": file.filename, "size_bytes": len(data)}


@app.post("/api/optimize")
def optimize(req: OptimizeRequest):
    _require_loaded()
    if opt.get_rust_active():
        t0 = time.perf_counter()
        json_bytes, z_used, count, steps = opt.extract_stopes_fast(
            _state["wag_grid"], _state["tonnes_grid"], _state["gold_grid"],
            _state["waste_grid"], _state["avg_density_grid"],
            _state["x_coords"], _state["y_coords"], _state["z_coords"],
            req.cutoff_grade, z_start=req.z_start,
            pillar_blocks=req.pillar_blocks, economics=req.economics.model_dump(),
        )
        runtime_ms = round((time.perf_counter() - t0) * 1000, 1)
        history = _state["perf_history"]
        history.append({
            "id": len(history)+1, "timestamp": datetime.now().isoformat(timespec='seconds'),
            "mode": "rust", "cutoff": req.cutoff_grade, "stope_count": count,
            "runtime_ms": runtime_ms, "threads": os.cpu_count() or 4, "steps": steps,
        })
        if len(history) > 100:
            _state["perf_history"] = history[-100:]
        return Response(content=json_bytes, media_type="application/json")

    stopes, summary = _run_cutoff(req.cutoff_grade, req.z_start,
                                   req.pillar_blocks, req.economics)
    return {"stopes": stopes, "summary": summary}


@app.get("/api/export/dxf")
def export_dxf(cutoff: float = 10.0, z_start: int | None = None):
    _require_loaded()
    stopes, _ = _run_cutoff(cutoff, z_start, record_history=False)
    dxf_bytes = exp.export_dxf(stopes)
    return Response(content=dxf_bytes, media_type="application/octet-stream",
                    headers={"Content-Disposition":
                             f'attachment; filename="orevista_stopes_cutoff_{cutoff}gt.dxf"'})


@app.get("/api/export/csv")
def export_csv(cutoff: float = 10.0, z_start: int | None = None):
    _require_loaded()
    stopes, summary = _run_cutoff(cutoff, z_start, record_history=False)
    csv_bytes = exp.export_csv(stopes, summary)
    return Response(content=csv_bytes, media_type="text/csv",
                    headers={"Content-Disposition":
                             f'attachment; filename="orevista_report_cutoff_{cutoff}gt.csv"'})


@app.post("/api/compare")
def compare(req: CompareRequest):
    _require_loaded()
    stopes_a, summary_a = _run_cutoff(req.cutoff_a, economics=req.economics_a,
                                       record_history=False)
    stopes_b, summary_b = _run_cutoff(req.cutoff_b, economics=req.economics_b,
                                       record_history=False)
    return {
        "scenario_a": {"cutoff": req.cutoff_a, "stopes": stopes_a, "summary": summary_a},
        "scenario_b": {"cutoff": req.cutoff_b, "stopes": stopes_b, "summary": summary_b},
    }


@app.get("/api/gold-price")
async def gold_price():
    """Proxy live gold spot price — tries 3 sources with fallback."""
    sources = [
        ("https://api.metals.live/v1/spot/gold",
         lambda d: d[0]["gold"] if isinstance(d, list) and d else d.get("gold")),
        ("https://api.exchangerate.host/latest?base=USD&symbols=XAU",
         lambda d: 1 / d["rates"]["XAU"] if d.get("rates", {}).get("XAU") else None),
        ("https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD",
         lambda d: float(d[0]["spreadProfilePrices"][0]["ask"]) if d else None),
    ]
    async with httpx.AsyncClient(timeout=5.0) as client:
        for url, parse in sources:
            try:
                r = await client.get(url)
                price = parse(r.json())
                if price and float(price) > 100:
                    return {"price": round(float(price), 2), "source": url}
            except Exception:
                continue
    return {"price": 3300, "source": "fallback"}


@app.get("/api/grade-tonnage")
def grade_tonnage(steps: int = 30):
    """Grade-tonnage curve: tonnes, average grade, gold vs. cutoff."""
    _require_loaded()
    wag  = _state["wag_grid"]
    tg   = _state["tonnes_grid"]
    gg   = _state["gold_grid"]

    valid    = wag > 0
    wag_vals = wag[valid]
    max_cog  = float(np.percentile(wag_vals, 99)) if len(wag_vals) else 20.0
    cutoffs  = np.linspace(0.0, max_cog, steps + 1)

    result = []
    for cog in cutoffs:
        mask    = wag >= float(cog)
        t       = float(tg[mask].sum())
        g       = float(gg[mask].sum())
        gold_oz = g / 31.1035
        result.append({
            "cutoff":    round(float(cog), 2),
            "tonnes_mt": round(t / 1e6, 3),
            "gold_moz":  round(gold_oz / 1e6, 4),
            "avg_grade": round(g / t if t > 0 else 0.0, 3),
            "positions": int(mask.sum()),
        })
    return {"data": result, "max_cog": round(max_cog, 2)}


@app.get("/api/blocks")
def get_blocks(min_grade: float = 0.0):
    """Raw block model for 3D ore-body overlay. Capped at 200k points."""
    MAX_BLOCKS = 200_000
    _require_loaded()
    g  = _state["grade_grid"]
    xc = _state["x_coords"]
    yc = _state["y_coords"]
    zc = _state["z_coords"]

    xi, yi, zi = np.where(g >= min_grade)
    total = len(xi)
    if total > 0:
        x_min, x_max = float(xc[xi].min()), float(xc[xi].max())
        y_min, y_max = float(yc[yi].min()), float(yc[yi].max())
        z_min, z_max = float(zc[zi].min()), float(zc[zi].max())
    else:
        x_min = x_max = y_min = y_max = z_min = z_max = 0.0

    if total > MAX_BLOCKS:
        rng = np.random.default_rng(42)
        idx = rng.choice(total, MAX_BLOCKS, replace=False)
        xi, yi, zi = xi[idx], yi[idx], zi[idx]

    return {
        "x": xc[xi].tolist(), "y": yc[yi].tolist(), "z": zc[zi].tolist(),
        "grade": g[xi, yi, zi].tolist(),
        "count": total, "rendered": int(len(xi)),
        "x_min": x_min, "x_max": x_max,
        "y_min": y_min, "y_max": y_max,
        "z_min": z_min, "z_max": z_max,
    }


class PerformanceToggleRequest(BaseModel):
    enabled: bool

@app.get("/api/performance")
def get_performance():
    return {
        "rust_available": opt._RUST,
        "rust_enabled":   opt._use_rust,
        "rust_active":    opt.get_rust_active(),
        "cpu_count":      os.cpu_count() or 4,
        "history":        _state["perf_history"],
    }

@app.post("/api/performance/toggle")
def toggle_performance(req: PerformanceToggleRequest):
    opt.set_rust_mode(req.enabled)
    return {"rust_active": opt.get_rust_active(),
            "mode": "rust" if opt.get_rust_active() else "python"}

@app.get("/api/performance/cpu")
def get_cpu():
    return {"cores": _state["cpu_cores"], "total": _state["cpu_total"],
            "count": len(_state["cpu_cores"]) or (os.cpu_count() or 1)}
