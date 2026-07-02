import PptxGenJS from "pptxgenjs";

const prs = new PptxGenJS();

// ─── Theme ───────────────────────────────────────────────────────────────────
const DARK      = "0D1117";   // near-black background
const GOLD      = "F5A623";   // gold accent
const LIGHT     = "E6EDF3";   // light text
const GREY      = "8B949E";   // muted text
const GREEN     = "3FB950";   // positive metrics
const CARD      = "161B22";   // card bg
const ACCENT2   = "58A6FF";   // blue accent

prs.layout = "LAYOUT_WIDE";   // 13.33 × 7.5 in
prs.author  = "OreVista";
prs.title   = "OreVista — Hackathon 2026";

// ─── Helpers ─────────────────────────────────────────────────────────────────
const W = 13.33, H = 7.5;

function bg(sld) {
  sld.addShape(prs.ShapeType.rect, {
    x: 0, y: 0, w: W, h: H, fill: { color: DARK }, line: { color: DARK }
  });
}

function goldBar(sld, y = 0.85) {
  sld.addShape(prs.ShapeType.rect, {
    x: 0.5, y, w: 1.0, h: 0.07, fill: { color: GOLD }, line: { color: GOLD }
  });
}

function heading(sld, text, y = 0.55, size = 36) {
  sld.addText(text, {
    x: 0.5, y, w: W - 1, h: 0.7,
    fontSize: size, bold: true, color: LIGHT, fontFace: "Segoe UI"
  });
}

function sub(sld, text, x, y, w, h, size = 14, color = GREY, align = "left") {
  sld.addText(text, {
    x, y, w, h,
    fontSize: size, color, fontFace: "Segoe UI", align, valign: "top"
  });
}

function card(sld, x, y, w, h) {
  sld.addShape(prs.ShapeType.roundRect, {
    x, y, w, h,
    fill: { color: CARD },
    line: { color: "30363D", width: 1 },
    rectRadius: 0.08
  });
}

function bullet(sld, lines, x, y, w, h, size = 13) {
  sld.addText(
    lines.map(t => ({ text: t, options: { bullet: { type: "bullet", indent: 10 }, paraSpaceAfter: 4 } })),
    { x, y, w, h, fontSize: size, color: LIGHT, fontFace: "Segoe UI" }
  );
}

function metric(sld, value, label, x, y) {
  card(sld, x, y, 2.8, 1.3);
  sld.addText(value, {
    x: x + 0.1, y: y + 0.1, w: 2.6, h: 0.65,
    fontSize: 30, bold: true, color: GOLD, fontFace: "Segoe UI", align: "center"
  });
  sld.addText(label, {
    x: x + 0.1, y: y + 0.72, w: 2.6, h: 0.45,
    fontSize: 11, color: GREY, fontFace: "Segoe UI", align: "center"
  });
}

function slideNumber(sld, n) {
  sld.addText(`${n}`, {
    x: W - 0.6, y: H - 0.4, w: 0.4, h: 0.3,
    fontSize: 9, color: GREY, fontFace: "Segoe UI", align: "right"
  });
}

// ─── Slide 1 — Title ─────────────────────────────────────────────────────────
{
  const sld = prs.addSlide();
  bg(sld);

  // Gradient side bar
  sld.addShape(prs.ShapeType.rect, {
    x: 0, y: 0, w: 0.18, h: H,
    fill: { color: GOLD }, line: { color: GOLD }
  });

  // Logo text
  sld.addText("ORE", {
    x: 0.4, y: 1.8, w: 4, h: 1.2,
    fontSize: 88, bold: true, color: GOLD, fontFace: "Segoe UI Black"
  });
  sld.addText("VISTA", {
    x: 0.4, y: 2.85, w: 5, h: 1.0,
    fontSize: 88, bold: true, color: LIGHT, fontFace: "Segoe UI Black"
  });

  sld.addText("AI-Powered Gold Stope Optimizer", {
    x: 0.45, y: 3.95, w: 8, h: 0.55,
    fontSize: 22, color: GREY, fontFace: "Segoe UI", italic: true
  });

  // Tagline box
  sld.addShape(prs.ShapeType.rect, {
    x: 0.45, y: 4.7, w: 5.5, h: 0.6,
    fill: { color: CARD }, line: { color: GOLD, width: 1 }
  });
  sld.addText("From block model to ranked mine plan — in under 60 ms", {
    x: 0.55, y: 4.75, w: 5.3, h: 0.5,
    fontSize: 14, color: GOLD, fontFace: "Segoe UI", bold: true
  });

  // Right panel
  const stats = [
    ["148,500+", "Stope candidates evaluated"],
    ["< 60 ms",  "Full optimisation time"],
    ["3,000 m³",  "Per stope volume"],
    ["100 %",    "Hackathon spec compliant"],
  ];
  stats.forEach(([v, l], i) => {
    metric(sld, v, l, 8.7, 0.8 + i * 1.55);
  });

  sld.addText("Hanson Venture Lab Hackathon 2026", {
    x: 0.45, y: H - 0.45, w: 6, h: 0.3,
    fontSize: 10, color: GREY, fontFace: "Segoe UI"
  });
}

// ─── Slide 2 — The Problem ───────────────────────────────────────────────────
{
  const sld = prs.addSlide();
  bg(sld);
  goldBar(sld);
  heading(sld, "The Problem");
  slideNumber(sld, 2);

  sub(sld,
    "Underground gold mining hinges on one question every mine planner asks daily:",
    0.5, 1.1, W - 1, 0.45, 15, GREY
  );
  sld.addText('"Which blocks should we excavate - and in what order?"', {
    x: 0.5, y: 1.55, w: W - 1, h: 0.65,
    fontSize: 20, bold: true, color: GOLD, fontFace: "Segoe UI", italic: true
  });

  // Pain points
  const pains = [
    ["⏳  Days of manual work",       "Engineers delineate stopes by hand in legacy CAD tools. A full mine plan takes days of specialist labour."],
    ["💸  Poor economic visibility",   "Cutoff grades are set by gut feel or static tables. The true NSV of each stope is rarely computed in real time."],
    ["📐  Spec compliance risk",       "WAG (Weighted Average Grade) must use per-block volume. Hardcoded cell sizes introduce silent calculation errors."],
    ["🔁  No live scenario testing",   "Changing the gold price or cutoff requires re-running the entire workflow — so it almost never happens."],
  ];

  pains.forEach(([title, body], i) => {
    const x = i < 2 ? 0.5 : 7.0;
    const y = i % 2 === 0 ? 2.55 : 4.35;
    card(sld, x, y, 5.8, 1.55);
    sld.addText(title, {
      x: x + 0.25, y: y + 0.18, w: 5.3, h: 0.4,
      fontSize: 14, bold: true, color: LIGHT, fontFace: "Segoe UI"
    });
    sub(sld, body, x + 0.25, y + 0.58, 5.3, 0.85, 12, GREY);
  });

  slideNumber(sld, 2);
}

// ─── Slide 3 — Our Solution ──────────────────────────────────────────────────
{
  const sld = prs.addSlide();
  bg(sld);
  goldBar(sld);
  heading(sld, "OreVista — Our Solution");
  slideNumber(sld, 3);

  sub(sld, "One browser session replaces days of specialist mine planning software.", 0.5, 1.1, W - 1, 0.4, 15, GREY);

  const steps = [
    { n: "01", title: "Upload", body: "Drag-and-drop block model CSV\nAuto-detects XINC/YINC/ZINC\nPolars parser — 8× faster than pandas" },
    { n: "02", title: "Compute", body: "Vectorised NumPy sliding window\n148,500 stope candidates in <1 s\nBinary .npy cache for instant reload" },
    { n: "03", title: "Optimise", body: "1D dynamic programming per strip\nGlobally optimal non-overlapping set\nRust/Rayon: ~60 ms end-to-end" },
    { n: "04", title: "Explore", body: "3D interactive stope viewer\nLive NSV calculator (11 parameters)\nPart 1 & Part 2 cutoff modes" },
  ];

  steps.forEach((s, i) => {
    const x = 0.5 + i * 3.2;
    card(sld, x, 1.75, 3.0, 4.8);
    sld.addText(s.n, {
      x: x + 0.2, y: 1.95, w: 2.6, h: 0.55,
      fontSize: 28, bold: true, color: GOLD, fontFace: "Segoe UI Black"
    });
    sld.addShape(prs.ShapeType.rect, {
      x: x + 0.2, y: 2.55, w: 2.6, h: 0.04,
      fill: { color: GOLD }, line: { color: GOLD }
    });
    sld.addText(s.title, {
      x: x + 0.2, y: 2.7, w: 2.6, h: 0.5,
      fontSize: 18, bold: true, color: LIGHT, fontFace: "Segoe UI"
    });
    sub(sld, s.body, x + 0.2, 3.3, 2.6, 2.9, 12, GREY);
  });

  // Arrow connectors between cards
  [0, 1, 2].forEach(i => {
    sld.addShape(prs.ShapeType.rightArrow, {
      x: 3.38 + i * 3.2, y: 3.9, w: 0.32, h: 0.32,
      fill: { color: GOLD }, line: { color: GOLD }
    });
  });
}

// ─── Slide 4 — Technical Architecture ────────────────────────────────────────
{
  const sld = prs.addSlide();
  bg(sld);
  goldBar(sld);
  heading(sld, "Technical Architecture");
  slideNumber(sld, 4);

  // Left column - stack layers
  const layers = [
    { label: "Frontend",    tech: "React 18 + Vite",      detail: "Three.js 3D viewer · Recharts · Tailwind" },
    { label: "API",         tech: "FastAPI + Uvicorn",    detail: "10 endpoints · async · CORS · upload" },
    { label: "Engine",      tech: "NumPy + Polars",       detail: "Vectorised sliding window · binary cache" },
    { label: "Accelerator", tech: "Rust + Rayon + PyO3",  detail: "Parallel DP · ~60 ms · optional" },
  ];

  layers.forEach((l, i) => {
    const y = 1.45 + i * 1.35;
    card(sld, 0.5, y, 5.8, 1.15);
    sld.addText(l.label.toUpperCase(), {
      x: 0.75, y: y + 0.14, w: 1.4, h: 0.35,
      fontSize: 9, bold: true, color: GOLD, fontFace: "Segoe UI"
    });
    sld.addText(l.tech, {
      x: 0.75, y: y + 0.42, w: 2.8, h: 0.38,
      fontSize: 15, bold: true, color: LIGHT, fontFace: "Segoe UI"
    });
    sub(sld, l.detail, 3.65, y + 0.22, 2.5, 0.75, 11, GREY);
  });

  // Right column — key code snippets as styled boxes
  sld.addText("Core Algorithms", {
    x: 7.1, y: 1.35, w: 5.6, h: 0.4,
    fontSize: 13, bold: true, color: GOLD, fontFace: "Segoe UI"
  });

  const snippets = [
    {
      title: "Spec-Compliant WAG  (Technical Notes §5)",
      code:  "WAG = Σ(Vᵢ × Dᵢ × Gᵢ)  /  Σ(Vᵢ × Dᵢ)\n     volume × density × grade  / volume × density"
    },
    {
      title: "Volume per block  (Technical Notes §1–§2)",
      code:  "Vol = XINC × YINC × ZINC\n      (5 × 5 × 5 = 125 m³ for hackathon dataset)"
    },
    {
      title: "Stope geometry",
      code:  "20 m (L) × 5 m (T) × 30 m (H) = 3,000 m³\n4 × 1 × 6 blocks — fixed per spec"
    },
    {
      title: "DP selector (per Y-strip per Z-level)",
      code:  "dp[i] = max(dp[i-1], dp[i-stope_len] + nsv[i])\n→ globally optimal non-overlapping set  O(n)"
    },
  ];

  snippets.forEach((s, i) => {
    const y = 1.85 + i * 1.35;
    card(sld, 7.1, y, 5.7, 1.15);
    sld.addText(s.title, {
      x: 7.3, y: y + 0.1, w: 5.3, h: 0.3,
      fontSize: 10, bold: true, color: ACCENT2, fontFace: "Segoe UI"
    });
    sld.addText(s.code, {
      x: 7.3, y: y + 0.42, w: 5.3, h: 0.62,
      fontSize: 11, color: GREEN, fontFace: "Courier New"
    });
  });
}

// ─── Slide 5 — Hackathon Compliance ──────────────────────────────────────────
{
  const sld = prs.addSlide();
  bg(sld);
  goldBar(sld);
  heading(sld, "Hackathon Compliance Checklist");
  slideNumber(sld, 5);

  sub(sld, "Every requirement from the Technical Notes — addressed.", 0.5, 1.1, W - 1, 0.4, 15, GREY);

  const rows = [
    ["Technical Notes §",  "Requirement",                               "Status",  "How We Meet It"],
    ["§1–§2",   "Volume = XINC × YINC × ZINC per block",               "✅ Fixed", "parser.py reads XINC/YINC/ZINC; per-block volume_grid"],
    ["§3",      "WAG = Σ(V×D×G) / Σ(V×D)",                            "✅ Done",  "optimizer.py uses vgd/vd with volume_grid"],
    ["§4",      "Missing blocks: 0 g/t grade, 2.8 t/m³ density",       "✅ Done",  "fill_null defaults in parser.py"],
    ["§5",      "Non-overlapping stope selection",                      "✅ Done",  "1D DP per Y-strip per Z-level"],
    ["Part 1",  "Fixed 10 g/t cutoff, ranked stope output",            "✅ Done",  "GET /api/optimize?cutoff=10"],
    ["Part 2",  "Live cutoff slider, re-optimise in real time",        "✅ Done",  "Frontend slider → API → instant re-rank"],
    ["Part 2",  "Speed test — full optimisation ≤ 2 s",               "✅ Done",  "Rust: ~60 ms · Python fallback: <1 s"],
    ["Output",  "CSV export of ranked stopes",                         "✅ Done",  "GET /api/export/csv"],
    ["Bonus",   "Grade-tonnage curve",                                  "✅ Done",  "GET /api/grade-tonnage + Recharts UI"],
    ["Bonus",   "NSV economic model (gold price, recovery, OPEX…)",    "✅ Done",  "11-parameter NSV in optimizer.py"],
  ];

  const colW = [1.0, 3.4, 1.0, 6.0];
  const colX = [0.5, 1.6, 5.1, 6.25];
  const rowH = 0.42;
  const startY = 1.65;

  rows.forEach((row, ri) => {
    const y = startY + ri * rowH;
    const isHeader = ri === 0;
    row.forEach((cell, ci) => {
      const color = isHeader ? GOLD
                  : cell.startsWith("✅") ? GREEN
                  : LIGHT;
      sld.addText(cell, {
        x: colX[ci], y: y + 0.04, w: colW[ci], h: rowH - 0.06,
        fontSize: isHeader ? 10 : 10,
        bold: isHeader,
        color,
        fontFace: "Segoe UI",
        valign: "middle"
      });
    });
    if (ri > 0) {
      sld.addShape(prs.ShapeType.line, {
        x: 0.5, y: y, w: W - 1, h: 0,
        line: { color: "21262D", width: 0.5 }
      });
    }
  });
}

// ─── Slide 6 — Key Fix: XINC/YINC/ZINC ──────────────────────────────────────
{
  const sld = prs.addSlide();
  bg(sld);
  goldBar(sld);
  heading(sld, "The Critical Fix: Per-Block Volume");
  slideNumber(sld, 6);

  // Before
  card(sld, 0.5, 1.45, 5.8, 4.6);
  sld.addShape(prs.ShapeType.rect, {
    x: 0.5, y: 1.45, w: 5.8, h: 0.45,
    fill: { color: "3D1515" }, line: { color: "3D1515" }
  });
  sld.addText("❌  v1.0 — Original (Spec Violation)", {
    x: 0.7, y: 1.5, w: 5.4, h: 0.35,
    fontSize: 12, bold: true, color: "FF6B6B", fontFace: "Segoe UI"
  });
  const before = `# CELL_SIZE hardcoded — XINC/YINC/ZINC never read\nCELL_SIZE     = 5\nVOL_PER_BLOCK = 125  # m³ — same for every block!\n\nrequired = {"XC", "YC", "ZC", "AU", "DENSITY"}\n#           ^ XINC, YINC, ZINC missing from required!\n\n# Returns 5-tuple — no volume_grid\nreturn grade_grid, density_grid, x, y, z`;
  sld.addText(before, {
    x: 0.7, y: 2.05, w: 5.4, h: 3.7,
    fontSize: 11, color: GREY, fontFace: "Courier New"
  });

  // After
  card(sld, 7.0, 1.45, 5.8, 4.6);
  sld.addShape(prs.ShapeType.rect, {
    x: 7.0, y: 1.45, w: 5.8, h: 0.45,
    fill: { color: "0D2818" }, line: { color: "0D2818" }
  });
  sld.addText("✅  v2.0 — Fixed (Spec Compliant)", {
    x: 7.2, y: 1.5, w: 5.4, h: 0.35,
    fontSize: 12, bold: true, color: GREEN, fontFace: "Segoe UI"
  });
  const after = `if {"XINC","YINC","ZINC"}.issubset(cols):\n    xinc = df["XINC"].fill_null(5.0).to_numpy()\n    yinc = df["YINC"].fill_null(5.0).to_numpy()\n    zinc = df["ZINC"].fill_null(5.0).to_numpy()\n    # Per-block volume — Technical Notes §2\n    block_vol = xinc * yinc * zinc\nelse:\n    cs = auto_detect_cell_size(xv, yv, zv)\n    block_vol = np.full(len(xv), cs**3)\n\n# Returns 6-tuple with volume_grid\nreturn grade, density, volume_grid, x, y, z`;
  sld.addText(after, {
    x: 7.2, y: 2.05, w: 5.4, h: 3.7,
    fontSize: 11, color: GREEN, fontFace: "Courier New"
  });

  // Impact note
  card(sld, 0.5, 6.2, 12.3, 0.9);
  sld.addText("Impact: For the hackathon's uniform 5 m grid the numbers are identical. For any non-uniform block model, v1 was silently wrong — v2 is correct.", {
    x: 0.75, y: 6.3, w: 11.8, h: 0.7,
    fontSize: 12, color: GOLD, fontFace: "Segoe UI", bold: false, italic: true
  });
}

// ─── Slide 7 — Performance ───────────────────────────────────────────────────
{
  const sld = prs.addSlide();
  bg(sld);
  goldBar(sld);
  heading(sld, "Performance at Scale");
  slideNumber(sld, 7);

  const metrics = [
    ["~60 ms",     "Rust/Rayon full optimisation"],
    ["< 1 s",      "Python NumPy fallback"],
    ["148,500+",   "Stope candidates evaluated"],
    ["8–10×",      "Faster CSV parsing vs pandas"],
    ["Instant",    "Cache hit (binary .npy)"],
    ["11 params",  "Live NSV economic model"],
  ];

  metrics.forEach(([v, l], i) => {
    metric(sld, v, l, 0.5 + (i % 3) * 4.28, 1.65 + Math.floor(i / 3) * 1.7);
  });

  // Architecture diagram labels
  const steps2 = [
    "CSV Upload\n(Polars)",
    "3D Grid\n(NumPy)",
    "Sliding Window\n148K stopes",
    "DP Selector\n(Rust/Rayon)",
    "Ranked\nResults",
  ];
  const arrowY = 5.5;
  steps2.forEach((s, i) => {
    card(sld, 0.5 + i * 2.6, arrowY, 2.3, 1.25);
    sld.addText(s, {
      x: 0.55 + i * 2.6, y: arrowY + 0.25, w: 2.2, h: 0.8,
      fontSize: 11, color: LIGHT, fontFace: "Segoe UI", align: "center"
    });
    if (i < 4) {
      sld.addShape(prs.ShapeType.rightArrow, {
        x: 2.72 + i * 2.6, y: arrowY + 0.42, w: 0.38, h: 0.42,
        fill: { color: GOLD }, line: { color: GOLD }
      });
    }
  });

  sld.addText("⚡  Full pipeline — CSV in to ranked JSON out", {
    x: 0.5, y: 6.9, w: W - 1, h: 0.35,
    fontSize: 12, color: GOLD, fontFace: "Segoe UI", bold: true, align: "center"
  });
}

// ─── Slide 8 — Live Demo / UI ─────────────────────────────────────────────────
{
  const sld = prs.addSlide();
  bg(sld);
  goldBar(sld);
  heading(sld, "User Interface");
  slideNumber(sld, 8);

  const panels = [
    {
      title: "3D Stope Viewer",
      icon: "🗺",
      body: "Interactive Three.js scene\nColour-coded by WAG grade\nOrbit · Pan · Zoom\nClick any stope for full metrics"
    },
    {
      title: "Parameter Panel",
      icon: "⚙",
      body: "Gold price ($/oz)\nRecovery, refining, smelting\nTransport, royalty\nSustaining OPEX · Dev cost"
    },
    {
      title: "Report Table",
      icon: "📋",
      body: "Sortable ranked stope list\nWAG · Tonnes · Gold oz\nNSV per stope\nCSV export one-click"
    },
    {
      title: "Grade-Tonnage Curve",
      icon: "📈",
      body: "Pre-computed 0–50 g/t sweep\nRecharts line chart\nInstant sensitivity view\nBoth Part 1 & Part 2 modes"
    },
  ];

  panels.forEach((p, i) => {
    const x = 0.5 + (i % 2) * 6.45;
    const y = 1.5 + Math.floor(i / 2) * 2.85;
    card(sld, x, y, 6.2, 2.6);

    sld.addText(p.icon + "  " + p.title, {
      x: x + 0.25, y: y + 0.2, w: 5.7, h: 0.5,
      fontSize: 16, bold: true, color: GOLD, fontFace: "Segoe UI"
    });
    sld.addShape(prs.ShapeType.rect, {
      x: x + 0.25, y: y + 0.75, w: 5.7, h: 0.04,
      fill: { color: "30363D" }, line: { color: "30363D" }
    });
    sub(sld, p.body, x + 0.25, y + 0.92, 5.7, 1.5, 13, LIGHT);
  });
}

// ─── Slide 9 — API Reference ─────────────────────────────────────────────────
{
  const sld = prs.addSlide();
  bg(sld);
  goldBar(sld);
  heading(sld, "API Endpoints");
  slideNumber(sld, 9);

  sub(sld, "FastAPI backend — fully RESTful, auto-documented at /docs", 0.5, 1.1, W - 1, 0.4, 14, GREY);

  const endpoints = [
    ["GET",  "/health",              "Liveness check — returns {status: ok}"],
    ["GET",  "/api/model-info",      "Grid dimensions, block count, cell size"],
    ["GET",  "/api/optimize",        "Run optimisation at ?cutoff=10 (or any g/t)"],
    ["GET",  "/api/grade-tonnage",   "Grade-tonnage curve — 0 to 50 g/t sweep"],
    ["GET",  "/api/export/csv",      "Download ranked stopes as CSV"],
    ["GET",  "/api/report",          "Summary stats JSON (ore, waste, NSV total)"],
    ["POST", "/api/upload",          "Upload new block model CSV (multipart/form-data)"],
    ["POST", "/api/preload",         "Pre-warm binary cache from server-side path"],
  ];

  const methColor = { GET: "3FB950", POST: "F5A623" };

  endpoints.forEach(([method, path, desc], i) => {
    const y = 1.75 + i * 0.62;
    sld.addShape(prs.ShapeType.roundRect, {
      x: 0.5, y, w: 0.85, h: 0.45,
      fill: { color: method === "GET" ? "0D2818" : "2E1E00" },
      line: { color: methColor[method], width: 1 },
      rectRadius: 0.05
    });
    sld.addText(method, {
      x: 0.5, y: y + 0.04, w: 0.85, h: 0.38,
      fontSize: 10, bold: true, color: methColor[method],
      fontFace: "Courier New", align: "center"
    });
    sld.addText(path, {
      x: 1.5, y: y + 0.06, w: 3.5, h: 0.38,
      fontSize: 12, color: ACCENT2, fontFace: "Courier New"
    });
    sld.addText(desc, {
      x: 5.3, y: y + 0.06, w: 7.5, h: 0.38,
      fontSize: 12, color: GREY, fontFace: "Segoe UI"
    });
  });
}

// ─── Slide 10 — Why OreVista Wins ────────────────────────────────────────────
{
  const sld = prs.addSlide();
  bg(sld);
  goldBar(sld);
  heading(sld, "Why OreVista Wins");
  slideNumber(sld, 10);

  const pillars = [
    {
      emoji: "🎯",
      title: "Correct",
      points: [
        "Per-block volume from XINC×YINC×ZINC",
        "WAG = Σ(V×D×G) / Σ(V×D) — exact spec",
        "Non-overlapping DP — no double counting",
        "Missing block defaults per §4",
      ]
    },
    {
      emoji: "⚡",
      title: "Fast",
      points: [
        "Rust/Rayon parallel: ~60 ms",
        "NumPy vectorised: <1 s",
        "Binary cache: instant reload",
        "Polars: 8× faster CSV parsing",
      ]
    },
    {
      emoji: "🖥",
      title: "Usable",
      points: [
        "Drag-and-drop CSV upload",
        "Live cutoff slider — instant re-rank",
        "3D ore body visualisation",
        "One-click CSV export",
      ]
    },
    {
      emoji: "🏗",
      title: "Complete",
      points: [
        "Part 1 + Part 2 both implemented",
        "Grade-tonnage curve",
        "11-parameter NSV model",
        "Full REST API with auto-docs",
      ]
    },
  ];

  pillars.forEach((p, i) => {
    const x = 0.5 + i * 3.2;
    card(sld, x, 1.5, 3.0, 5.45);
    sld.addText(p.emoji, {
      x, y: 1.7, w: 3.0, h: 0.55,
      fontSize: 28, align: "center"
    });
    sld.addText(p.title, {
      x, y: 2.3, w: 3.0, h: 0.5,
      fontSize: 20, bold: true, color: GOLD, fontFace: "Segoe UI", align: "center"
    });
    sld.addShape(prs.ShapeType.rect, {
      x: x + 0.3, y: 2.85, w: 2.4, h: 0.04,
      fill: { color: GOLD }, line: { color: GOLD }
    });
    bullet(sld, p.points, x + 0.2, 3.05, 2.6, 3.7, 12);
  });
}

// ─── Slide 11 — Thank You ─────────────────────────────────────────────────────
{
  const sld = prs.addSlide();
  bg(sld);

  sld.addShape(prs.ShapeType.rect, {
    x: 0, y: 0, w: W, h: 0.18,
    fill: { color: GOLD }, line: { color: GOLD }
  });
  sld.addShape(prs.ShapeType.rect, {
    x: 0, y: H - 0.18, w: W, h: 0.18,
    fill: { color: GOLD }, line: { color: GOLD }
  });

  sld.addText("ORE", {
    x: 1.5, y: 1.4, w: 5, h: 1.5,
    fontSize: 96, bold: true, color: GOLD, fontFace: "Segoe UI Black", align: "center"
  });
  sld.addText("VISTA", {
    x: 1.5, y: 2.7, w: 5, h: 1.5,
    fontSize: 96, bold: true, color: LIGHT, fontFace: "Segoe UI Black", align: "center"
  });
  sld.addText("Block Model → Mine Plan → Under 60 ms", {
    x: 1, y: 4.3, w: 6, h: 0.55,
    fontSize: 16, color: GREY, fontFace: "Segoe UI", italic: true, align: "center"
  });

  card(sld, 1.0, 5.0, 5.6, 1.85);
  sld.addText("GitHub Repository", {
    x: 1.2, y: 5.1, w: 5.2, h: 0.4,
    fontSize: 12, bold: true, color: GOLD, fontFace: "Segoe UI"
  });
  sld.addText("github.com/vvina-ten/OreVista", {
    x: 1.2, y: 5.5, w: 5.2, h: 0.4,
    fontSize: 14, color: ACCENT2, fontFace: "Courier New"
  });
  sld.addText("FastAPI · React · Three.js · Rust/Rayon · Polars · NumPy", {
    x: 1.2, y: 5.95, w: 5.2, h: 0.6,
    fontSize: 11, color: GREY, fontFace: "Segoe UI"
  });

  // Right side summary
  const finals = [
    ["✅", "Fully spec-compliant WAG formula"],
    ["✅", "XINC × YINC × ZINC volume — fixed"],
    ["✅", "Part 1 + Part 2 complete"],
    ["✅", "~60 ms Rust-accelerated pipeline"],
    ["✅", "Interactive 3D web interface"],
  ];
  finals.forEach(([icon, text], i) => {
    sld.addText(`${icon}  ${text}`, {
      x: 7.5, y: 2.1 + i * 0.75, w: 5.3, h: 0.55,
      fontSize: 15, color: i === 0 ? GOLD : LIGHT, fontFace: "Segoe UI"
    });
  });

  sld.addText("Hanson Venture Lab Hackathon 2026", {
    x: 0, y: H - 0.52, w: W, h: 0.3,
    fontSize: 10, color: GREY, fontFace: "Segoe UI", align: "center"
  });
}

// ─── Save ────────────────────────────────────────────────────────────────────
const outPath = "C:/Users/TY/Desktop/OreVista/OreVista_Presentation.pptx";
prs.writeFile({ fileName: outPath })
   .then(() => console.log("✅  Saved:", outPath))
   .catch(e => { console.error(e); process.exit(1); });
