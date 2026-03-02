"""Feature engineering pipeline for Prophet training.

Loads data from Supabase views, builds Prophet-format DataFrames with
additional regressors (weather, rolling averages, YoY, customer patterns).
"""

import pandas as pd
import numpy as np
from config import get_supabase


def fetch_all_rows(query) -> list[dict]:
    """Paginate through Supabase to fetch all rows (default limit is 1000)."""
    page_size = 1000
    offset = 0
    all_rows = []
    while True:
        resp = query.range(offset, offset + page_size - 1).execute()
        if not resp.data:
            break
        all_rows.extend(resp.data)
        if len(resp.data) < page_size:
            break
        offset += page_size
    return all_rows


def load_product_data(product_id: str) -> pd.DataFrame:
    """Load enriched daily data from v_feature_engineering view."""
    sb = get_supabase()
    query = (
        sb.table("v_feature_engineering")
        .select("*")
        .eq("product_id", product_id)
        .order("ds")
    )
    rows = fetch_all_rows(query)
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    df["ds"] = pd.to_datetime(df["ds"])
    numeric_cols = [
        "y", "n_customers", "temp_avg", "precipitation_mm", "wind_speed",
        "rolling_7d", "rolling_30d", "rolling_90d",
        "lag_1d", "lag_7d", "lag_14d",
        "temp_seasonal_norm", "precip_seasonal_norm", "temp_delta", "precip_delta",
    ]
    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def build_prophet_df(product_id: str) -> pd.DataFrame:
    """Build a Prophet-ready DataFrame with ds, y, and additional regressors.

    Returns a gap-filled date range where missing days get y=0.
    Additional regressors: temp_avg, precipitation_mm, heavy_rain,
    rolling_7d, rolling_30d, temp_delta, yoy_same_week, n_customers.
    """
    df = load_product_data(product_id)
    if df.empty:
        return df

    # Gap-fill: create continuous date range, fill missing days with 0 demand
    date_range = pd.date_range(df["ds"].min(), df["ds"].max(), freq="D")
    full = pd.DataFrame({"ds": date_range})
    df = full.merge(df, on="ds", how="left")
    df["y"] = df["y"].fillna(0)
    df["n_customers"] = df["n_customers"].fillna(0)

    # Fill weather/rolling NaNs with forward-fill then 0
    fill_cols = [
        "temp_avg", "precipitation_mm", "wind_speed",
        "rolling_7d", "rolling_30d", "rolling_90d",
        "temp_delta", "precip_delta",
    ]
    for col in fill_cols:
        if col in df.columns:
            df[col] = df[col].ffill().fillna(0)

    # Heavy rain binary flag
    df["heavy_rain"] = (df["precipitation_mm"] > 10).astype(float)

    # Year-over-year same ISO week feature
    df["iso_week"] = df["ds"].dt.isocalendar().week.astype(int)
    df["iso_year"] = df["ds"].dt.isocalendar().year.astype(int)

    yoy_map = {}
    for _, row in df.iterrows():
        key = (row["iso_year"] - 1, row["iso_week"])
        yoy_map[(row["iso_year"], row["iso_week"])] = key

    # Build lookup: (year, week) -> average y
    week_avg = df.groupby(["iso_year", "iso_week"])["y"].mean().to_dict()
    df["yoy_same_week"] = df.apply(
        lambda r: week_avg.get((r["iso_year"] - 1, r["iso_week"]), 0), axis=1
    )

    # Select final columns for Prophet
    prophet_cols = [
        "ds", "y",
        "temp_avg", "precipitation_mm", "heavy_rain",
        "rolling_7d", "rolling_30d", "temp_delta",
        "yoy_same_week", "n_customers",
    ]
    result = df[[c for c in prophet_cols if c in df.columns]].copy()
    return result


def compute_customer_frequency(product_id: str) -> float:
    """Compute median order interval (in days) per customer for this product."""
    sb = get_supabase()
    query = (
        sb.table("order_history")
        .select("customer_id,order_date")
        .eq("product_id", product_id)
        .not_.is_("customer_id", "null")
        .order("order_date")
    )
    rows = fetch_all_rows(query)
    if not rows:
        return 0.0

    df = pd.DataFrame(rows)
    df["order_date"] = pd.to_datetime(df["order_date"])

    intervals = []
    for _, group in df.groupby("customer_id"):
        dates = group["order_date"].sort_values()
        if len(dates) >= 2:
            diffs = dates.diff().dropna().dt.days
            intervals.extend(diffs.tolist())

    return float(np.median(intervals)) if intervals else 0.0


def get_all_product_ids() -> list[str]:
    """Get all distinct product IDs that have order history."""
    sb = get_supabase()
    query = (
        sb.table("v_daily_product_demand")
        .select("product_id")
    )
    rows = fetch_all_rows(query)
    if not rows:
        return []
    return list({row["product_id"] for row in rows})
