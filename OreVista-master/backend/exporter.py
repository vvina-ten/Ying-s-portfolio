"""
exporter.py — DXF and CSV export for stope results.

DXF format: each stope rendered as a 3D wireframe box (12 edges).
Stopes are colour-coded by grade band on separate DXF layers:
  Layer STOPE_10_12  — 10–12 g/t
  Layer STOPE_12_15  — 12–15 g/t
  Layer STOPE_15_PLUS — 15+ g/t
"""

import io
import csv
import ezdxf
from ezdxf import colors as dxf_colors


def _grade_layer(avg_grade: float) -> str:
    if avg_grade < 12.0:
        return "STOPE_10_12"
    elif avg_grade < 15.0:
        return "STOPE_12_15"
    else:
        return "STOPE_15_PLUS"


def export_dxf(stopes: list[dict]) -> bytes:
    """
    Build a DXF document with all stopes as 3D wireframe boxes.
    Returns raw DXF bytes for HTTP streaming.
    """
    doc = ezdxf.new("R2010")
    doc.units = ezdxf.units.M
    msp = doc.modelspace()

    # Create layers with distinct colours
    layer_cfg = {
        "STOPE_10_12":   dxf_colors.YELLOW,
        "STOPE_12_15":   dxf_colors.GREEN,
        "STOPE_15_PLUS": dxf_colors.RED,
    }
    for name, colour in layer_cfg.items():
        doc.layers.new(name=name, dxfattribs={"color": colour})

    for stope in stopes:
        x0, x1 = stope["x_min"], stope["x_max"]
        y0, y1 = stope["y_min"], stope["y_max"]
        z0, z1 = stope["z_min"], stope["z_max"]
        layer  = _grade_layer(stope["avg_grade"])

        bottom = [(x0,y0,z0),(x1,y0,z0),(x1,y1,z0),(x0,y1,z0)]
        top    = [(x0,y0,z1),(x1,y0,z1),(x1,y1,z1),(x0,y1,z1)]

        # Bottom face
        for i in range(4):
            msp.add_line(bottom[i], bottom[(i+1) % 4], dxfattribs={"layer": layer})
        # Top face
        for i in range(4):
            msp.add_line(top[i], top[(i+1) % 4], dxfattribs={"layer": layer})
        # Vertical edges
        for i in range(4):
            msp.add_line(bottom[i], top[i], dxfattribs={"layer": layer})

        # Label: stope ID + grade as DXF TEXT entity
        label_x = (x0 + x1) / 2
        label_y = (y0 + y1) / 2
        label_z = z1 + 1
        label   = f"{stope['stope_id']} {stope['avg_grade']:.1f}g/t"
        msp.add_text(
            label,
            dxfattribs={
                "insert": (label_x, label_y, label_z),
                "height": 2,
                "layer":  layer,
            },
        )

    buf = io.StringIO()
    doc.write(buf)
    return buf.getvalue().encode("utf-8")


def export_csv(stopes: list[dict], summary: dict) -> bytes:
    """
    Export detailed per-stope report as CSV bytes.
    First section: summary row.  Second section: per-stope rows.
    """
    output = io.StringIO()
    writer = csv.writer(output)

    # Summary block
    writer.writerow(["=== OreVista Run Summary ==="])
    for key, val in summary.items():
        writer.writerow([key, val])
    writer.writerow([])

    # Per-stope table
    if stopes:
        headers = list(stopes[0].keys())
        writer.writerow(headers)
        for s in stopes:
            writer.writerow([s[h] for h in headers])

    return output.getvalue().encode("utf-8")
