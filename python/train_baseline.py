"""Baseline model: last year same ISO week ± trend adjustment.

For each product, for each of the next 7 days:
  1. Look up same ISO week last year (±3 day window average)
  2. Apply trend factor: recent_30d_avg / year_ago_30d_avg
  3. Upsert into baseline_forecasts
"""

import json
import sys
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

from config import get_supabase
from features import get_all_product_ids, fetch_all_rows

VERSION = f"baseline-v1-{datetime.now().strftime('%Y-%m')}"


def train_baseline_product(product_id: str) -> dict:
    """Generate baseline forecasts for a single product."""
    sb = get_supabase()

    # Load all daily demand
    query = (
        sb.table("v_daily_product_demand")
        .select("ds,y")
        .eq("product_id", product_id)
        .order("ds")
    )
    rows = fetch_all_rows(query)
    if not rows:
        return {"product_id": product_id, "status": "skipped", "reason": "no data"}

    df = pd.DataFrame(rows)
    df["ds"] = pd.to_datetime(df["ds"])
    df["y"] = pd.to_numeric(df["y"], errors="coerce").fillna(0)

    if len(df) < 60:
        return {"product_id": product_id, "status": "skipped", "reason": "insufficient data"}

    today = pd.Timestamp.now().normalize()
    last_date = df["ds"].max()

    # Compute trend factor: recent 30d avg / year-ago 30d avg
    recent_30d = df[df["ds"] > (last_date - timedelta(days=30))]["y"].mean()
    year_ago_30d_start = last_date - timedelta(days=395)
    year_ago_30d_end = last_date - timedelta(days=365)
    year_ago_30d = df[(df["ds"] >= year_ago_30d_start) & (df["ds"] <= year_ago_30d_end)]["y"].mean()

    if year_ago_30d > 0:
        trend_factor = recent_30d / year_ago_30d
    else:
        trend_factor = 1.0

    # Clamp trend factor to reasonable range
    trend_factor = max(0.5, min(2.0, trend_factor))

    forecast_rows = []
    for day_offset in range(1, 8):
        target = today + timedelta(days=day_offset)
        target_iso_week = target.isocalendar()[1]
        target_iso_dow = target.isocalendar()[2]

        # Look up same ISO week last year, ±3 day window
        year_ago = target - timedelta(days=364)  # approximate same week last year
        window_start = year_ago - timedelta(days=3)
        window_end = year_ago + timedelta(days=3)

        window_data = df[(df["ds"] >= window_start) & (df["ds"] <= window_end)]

        if len(window_data) > 0:
            base_qty = window_data["y"].mean()
        else:
            # Fallback: overall average for that ISO week across all years
            df["iso_week"] = df["ds"].dt.isocalendar().week.astype(int)
            week_data = df[df["iso_week"] == target_iso_week]
            base_qty = week_data["y"].mean() if len(week_data) > 0 else recent_30d

        predicted_qty = round(max(0, base_qty * trend_factor), 2)

        forecast_rows.append({
            "product_id": product_id,
            "target_date": str(target.date()),
            "predicted_qty": predicted_qty,
            "model_version": VERSION,
        })

    # Upsert forecasts
    for row in forecast_rows:
        sb.table("baseline_forecasts").upsert(
            row, on_conflict="product_id,target_date,model_version"
        ).execute()

    return {
        "product_id": product_id,
        "status": "trained",
        "trend_factor": round(trend_factor, 3),
        "forecasts": len(forecast_rows),
    }


def main():
    product_ids = get_all_product_ids()

    results = []
    trained = 0
    skipped = 0
    failed = 0

    for pid in product_ids:
        try:
            result = train_baseline_product(pid)
            results.append(result)
            if result["status"] == "trained":
                trained += 1
            else:
                skipped += 1
        except Exception as e:
            failed += 1
            results.append({"product_id": pid, "status": "failed", "error": str(e)})

    summary = {
        "model_version": VERSION,
        "total_products": len(product_ids),
        "trained": trained,
        "skipped": skipped,
        "failed": failed,
        "results": results,
    }

    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
