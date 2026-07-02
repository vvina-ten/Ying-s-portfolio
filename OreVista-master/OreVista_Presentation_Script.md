# OreVista — Presentation Script
### Hanson Venture Lab Hackathon 2026

---

## SLIDE 1 — Title

**[Opening — confident, direct]**

Good [morning/afternoon], everyone.

We're OreVista.

Every year, mining companies lose weeks — sometimes months — to a single bottleneck: figuring out which underground blocks to actually mine.
That decision shapes every dollar in a mine's budget. And right now, it's slow, manual, and error-prone.

We built OreVista to fix that.
From a block model CSV to a fully ranked mine plan — in under 60 milliseconds.

Let's show you how.

---

## SLIDE 2 — The Problem

**[Build urgency, make it real]**

Here's the problem in plain terms.

Underground gold mining lives or dies on stope selection — those are the 3,000-cubic-metre excavation shapes that define what you dig and what you leave behind.

Today, a mine planner opens a block model in legacy CAD software and manually draws stope shapes — one at a time. It takes days. Experts only. And every time the gold price moves, they do it again.

The economic calculation — called WAG, or Weighted Average Grade — is supposed to weight each block by its actual volume, density, and grade. But the original code we were given hardcodes every block as 125 cubic metres, ignoring the XINC, YINC, and ZINC columns that the spec explicitly requires. That's a silent calculation error hiding in production.

And if you want to test a different cutoff grade? Start the whole process over.

This is the status quo we're replacing.

---

## SLIDE 3 — Our Solution

**[Walk through the four steps with momentum]**

OreVista solves this in four clean steps.

**Step 01 — Upload.**
Drag your block model CSV into the browser. Polars, our parsing library, reads it eight to ten times faster than pandas. XINC, YINC, and ZINC are read automatically to compute exact per-block volumes.

**Step 02 — Compute.**
We build a 3D NumPy grid of the entire ore body and slide a 20-by-5-by-30-metre stope window across every valid position. That's over 148,000 candidate stopes. Results are cached to a binary file so the second query is instant.

**Step 03 — Optimise.**
Here's where the magic happens. We apply 1D dynamic programming across each cross-section strip to find the globally optimal set of non-overlapping stopes. No two stopes share a single block. Our Rust and Rayon accelerator parallelises this across all CPU cores and completes in approximately 60 milliseconds.

**Step 04 — Explore.**
The results appear in a live React dashboard — 3D viewer, sortable table, grade-tonnage curve — where any engineer can tune 11 economic parameters and see the impact immediately.

---

## SLIDE 4 — Technical Architecture

**[Credibility slide — speak to the engineers in the room]**

Under the hood, OreVista is a modern full-stack system.

The frontend is React 18 with Vite, Three.js for 3D visualisation, and Recharts for the grade-tonnage curve.

The API is FastAPI — ten endpoints, async, with automatic Swagger documentation at /docs.

The computation engine is NumPy with a Polars CSV parser — vectorised sliding windows, no Python loops where they matter.

And our optional accelerator is a Rust library compiled with Rayon for data parallelism and exposed to Python through PyO3 bindings. On a modern laptop that's 60 milliseconds. On a server it'll be even faster.

The three core formulas are on the right:
- Volume = XINC times YINC times ZINC — per block, per the spec
- WAG = sum of V times D times G, divided by sum of V times D — exactly as Technical Notes paragraph 5 requires
- And the stope geometry is fixed: 20 metres long, 5 metres thick, 30 metres high — 4 by 1 by 6 blocks

---

## SLIDE 5 — Hackathon Compliance

**[Read through confidently — this is your scorecard]**

Every requirement in the Technical Notes — addressed.

Paragraphs 1 and 2: volume from XINC times YINC times ZINC — fixed in version 2.

Paragraph 3: the WAG formula uses volume-weighted sums — correct.

Paragraph 4: missing blocks default to zero grade and 2.8 tonnes per cubic metre density — handled.

Paragraph 5: non-overlapping stope selection via 1D dynamic programming — done.

Part 1: fixed 10 grams-per-tonne cutoff, ranked stope output — done, via GET /api/optimize with cutoff equals 10.

Part 2: live cutoff slider with instant re-optimisation — the frontend slider hits the API and returns a new ranked list in real time.

Speed test: Rust brings us to 60 milliseconds. Python fallback is under one second.

CSV export, grade-tonnage curve, and a full NSV economic model — all implemented.

---

## SLIDE 6 — The Critical Fix

**[This is where you prove technical depth]**

I want to spend a moment on what we actually fixed, because it matters.

The original parser — on the left — hardcodes CELL_SIZE equals 5 and VOL_PER_BLOCK equals 125 cubic metres for every single block in the model. XINC, YINC, and ZINC are never read. The function returns a 5-tuple with no volume information.

For the hackathon's uniform 5-metre grid, that happens to give the same answer. But for any real-world block model with variable block sizes — which is extremely common — the WAG calculation is silently wrong.

On the right, version 2: we read XINC, YINC, and ZINC from the CSV. We compute per-block volume as their product. We build a full volume grid and pass it through the entire pipeline. The function now returns a 6-tuple. Every calculation downstream — WAG, tonnes, NSV — uses the correct geometry.

And if the columns are absent, we auto-detect the cell size from coordinate spacing so the fallback is also correct.

This wasn't a cosmetic change. This was fixing the spec.

---

## SLIDE 7 — Performance

**[Keep energy high — these numbers are impressive]**

Let's talk numbers.

60 milliseconds — that's the full optimisation time with our Rust accelerator. 148,500-plus stope candidates enumerated, DP selected, metrics computed, JSON serialised.

Under one second — our pure-Python NumPy path. No Rust required.

8 to 10 times faster CSV parsing — Polars versus pandas at block model scale.

And when the grid is already cached? Instant. We serialise the 3D numpy arrays to binary .npy files and check them against the CSV's modification time. Second query, zero compute.

The pipeline across the bottom shows the full flow: CSV in, 3D grid, sliding window, DP selection, ranked results out. That's the 60 millisecond path.

---

## SLIDE 8 — User Interface

**[Pivot to the demo feel — make judges want to try it]**

The interface was designed for mine engineers, not just developers.

The 3D Stope Viewer renders every selected stope in an interactive Three.js scene, colour-coded by WAG grade from low to high. You can orbit, pan, zoom, and click any stope to see its full economics in a modal.

The Parameter Panel exposes all 11 economic inputs: gold price, recovery rate, refining charges, smelting costs, transport, royalties, sustaining OPEX, and development cost. Change any one of them — the NSV table updates immediately.

The Report Table is a sortable ranked list of every selected stope — WAG, tonnes, gold ounces, NSV — with a one-click CSV export.

And the Grade-Tonnage Curve is a pre-computed Recharts chart sweeping from 0 to 50 grams per tonne, showing at a glance how the ore body responds to cutoff changes. This directly addresses one of the competition's core analysis requirements.

---

## SLIDE 9 — API Endpoints

**[Quick, confident — shows completeness]**

The backend is a clean REST API with ten endpoints.

GET /health — liveness check for deployment monitoring.

GET /api/optimize — the core endpoint. Pass ?cutoff=10 for Part 1, or any value for Part 2. Returns a ranked list of stopes with all metrics.

GET /api/grade-tonnage — the full 0-to-50 g/t sweep, pre-computed.

GET /api/export/csv — one call, download results.

POST /api/upload — upload a new block model from the browser. The cache is invalidated and recomputed automatically.

Every endpoint is documented automatically at /docs via FastAPI's built-in Swagger UI. No manual documentation to maintain.

---

## SLIDE 10 — Why OreVista Wins

**[Build to a close — strong finish]**

Let me sum up why OreVista stands out.

We're **correct**. The WAG formula is implemented exactly as the Technical Notes specify — per-block volume from XINC, YINC, and ZINC. Missing blocks get the right defaults. The DP selector produces a provably optimal, non-overlapping result.

We're **fast**. 60 milliseconds with Rust. Under a second without it. Instant on cache hit. This isn't just meeting the Part 2 speed requirement — it's exceeding it by an order of magnitude.

We're **usable**. Any engineer can upload a block model, tune economic parameters, and see results without touching code. That's the real product.

And we're **complete**. Both competition parts, grade-tonnage curve, NSV model, CSV export, REST API, interactive 3D interface. Everything that was asked for — and a few things that weren't.

OreVista is what modern mine planning infrastructure should look like.

---

## SLIDE 11 — Thank You

**[Close with confidence]**

Thank you.

OreVista is live on GitHub at github.com/vvina-ten/OreVista.

The full stack — FastAPI, React, Three.js, Rust, Polars, NumPy — is open, documented, and ready to run.

We're happy to take questions, walk through the code, or do a live demo.

**[Pause — smile — done.]**

---

## TIMING GUIDE

| Slide | Target Time | Notes |
|-------|-------------|-------|
| 1 — Title | 30 sec | Open strong, don't rush |
| 2 — Problem | 60 sec | Make the pain real |
| 3 — Solution | 75 sec | Walk all four steps |
| 4 — Architecture | 60 sec | Technical depth |
| 5 — Compliance | 45 sec | Read crisply, show confidence |
| 6 — The Fix | 60 sec | This is your biggest differentiator |
| 7 — Performance | 45 sec | Numbers speak for themselves |
| 8 — UI | 45 sec | Make them want the demo |
| 9 — API | 30 sec | Fast, factual |
| 10 — Why We Win | 60 sec | Confident close |
| 11 — Thank You | 15 sec | Short and strong |
| **Total** | **~9 min** | Leaves 6 min for Q&A in a 15-min slot |

---

## KEY PHRASES TO HIT

- *"148,000 stope candidates in under 60 milliseconds"*
- *"Per-block volume from XINC times YINC times ZINC — exactly as the spec requires"*
- *"Globally optimal — no two stopes share a single block"*
- *"Any engineer can use this — no code required"*
- *"We didn't just meet the requirements. We fixed the spec."*
