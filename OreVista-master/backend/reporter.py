"""
reporter.py — Generate summary statistics for a stope run.
"""


def generate_summary(stopes: list[dict], z_start: int = 0) -> dict:
    """Return aggregate metrics for all economic stopes in this run."""
    if not stopes:
        return {
            "total_stopes": 0, "total_tonnes": 0.0,
            "total_ore_tonnes": 0.0, "total_waste_tonnes": 0.0,
            "total_volume_m3": 0.0, "total_gold_grams": 0.0,
            "total_gold_oz": 0.0, "total_recovered_oz": 0.0,
            "avg_grade_gt": 0.0, "avg_nsr_per_t": 0.0,
            "max_grade_gt": 0.0, "overall_dilution_pct": 0.0,
            "cutoff_grade_used": None,
            "mining_levels": 0, "level_elevations": [],
            "z_start_index": z_start,
        }

    total_tonnes        = sum(s["tonnes"]                   for s in stopes)
    total_ore_tonnes    = sum(s["ore_tonnes"]               for s in stopes)
    total_waste_tonnes  = sum(s["waste_tonnes"]             for s in stopes)
    total_gold_grams    = sum(s["gold_grams"]               for s in stopes)
    total_gold_oz       = sum(s.get("contained_oz", s.get("gold_oz", 0))  for s in stopes)
    total_recovered_oz  = sum(s.get("recovered_oz", 0)      for s in stopes)
    total_volume        = sum(s["volume"]                   for s in stopes)
    total_nsv_usd       = sum(s.get("nsv_usd", 0)          for s in stopes)

    avg_grade         = total_gold_grams / total_tonnes if total_tonnes > 0 else 0.0
    max_grade         = max(s["avg_grade"] for s in stopes)
    avg_nsr_per_t     = total_nsv_usd / total_ore_tonnes if total_ore_tonnes > 0 else 0.0
    overall_dilution  = total_waste_tonnes / total_tonnes * 100.0 if total_tonnes > 0 else 0.0

    levels = sorted(set(s["level_z"] for s in stopes))

    return {
        "total_stopes":         len(stopes),
        "total_tonnes":         round(total_tonnes,        0),
        "total_ore_tonnes":     round(total_ore_tonnes,    0),
        "total_waste_tonnes":   round(total_waste_tonnes,  0),
        "total_volume_m3":      round(total_volume,        0),
        "total_gold_grams":     round(total_gold_grams,    0),
        "total_gold_oz":        round(total_gold_oz,       2),
        "total_recovered_oz":   round(total_recovered_oz,  2),
        "total_nsv_usd":        round(total_nsv_usd,       0),
        "avg_grade_gt":         round(avg_grade,           4),
        "avg_nsr_per_t":        round(avg_nsr_per_t,       2),
        "max_grade_gt":         round(max_grade,           4),
        "overall_dilution_pct": round(overall_dilution,    2),
        "cutoff_grade_used":    stopes[0]["cutoff_used"],
        "mining_levels":        len(levels),
        "level_elevations":     levels,
        "z_start_index":        z_start,
    }
