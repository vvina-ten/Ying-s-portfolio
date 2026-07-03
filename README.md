# Ying's Portfolio

Interactive Web, AR, and VR projects.

**Live site:** https://vvina-ten.github.io/Ying-s-portfolio/

## Structure

| Path | What it is |
|---|---|
| [`index.html`](index.html) | Entry page — links out to the Web/AR and VR sections |
| [`web/`](web/) | **Suspended Assembly** — a Three.js viewer with a 4-state camera flow (close-up → full view → exploded view → part focus), plus a QR code linking to the AR page |
| [`ar/`](ar/) | Cross-platform AR viewer built on Google's `<model-viewer>`. iOS opens the model via Quick Look (`kn0_w3r.usdz`), Android via Scene Viewer/WebXR (`model.glb`) — same link works on both |
| [`vr/`](vr/) | A Unity VR drumming build. Two demo clips (click to open a native-aspect-ratio lightbox) each explain a different hit-detection approach; the interaction-logic C# scripts are in [`vr/script/`](vr/script/) |
| [`OreVista-master/`](OreVista-master/) | Separate project — a gold-mine stope optimizer (FastAPI + Rust + React/Three.js) built for a hackathon. See its own [README](OreVista-master/README.md) |

## Tech

- Vanilla HTML/CSS/JS — no build step, served directly as static files via GitHub Pages
- [Three.js](https://threejs.org/) for the web viewer
- [`<model-viewer>`](https://modelviewer.dev/) for the AR page
- Unity (C#) for the VR drumming build
