"""Train Facebook Prophet model per product and write forecasts to Supabase.

Usage:
    python train_prophet.py --product "10275201 SEASONKP100"
    python train_prophet.py --all
"""

import argparse
import json
import sys
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
from prophet import Prophet
from sklearn.metrics import mean_absolute_error, mean_squared_error

from config import get_supabase
from features import build_prophet_df, get_all_product_ids

VERSION = f"prophet-v1-{datetime.now().strftime('%Y-%m')}"

REGRESSORS = [
    "temp_avg", "precipitation_mm", "heavy_rain",
    "rolling_7d", "rolling_30d", "temp_delta",
    "is_public_holiday", "is_school_holiday", "is_fellesferie",
    "days_until_christmas", "days_until_easter", "days_until_17mai",
]


def train_product(product_id: str) -> dict:
    """Train Prophet for a single product. Returns summary dict."""
    df = build_prophet_df(product_id)

    if df.empty or len(df) < 60:
        return {"product_id": product_id, "status": "skipped", "reason": "insufficient data", "n_rows": len(df)}

    # Train/test split: hold out last 90 days
    cutoff = df["ds"].max() - timedelta(days=90)
    train = df[df["ds"] <= cutoff].copy()
    test = df[df["ds"] > cutoff].copy()

    if len(train) < 30 or len(test) < 7:
        return {"product_id": product_id, "status": "skipped", "reason": "insufficient train/test split"}

    # Configure Prophet
    model = Prophet(
        yearly_seasonality=True,
        weekly_seasonality=True,
        daily_seasonality=False,
        changepoint_prior_scale=0.05,
        interval_width=0.80,
    )

    # Add regressors
    available_regressors = [r for r in REGRESSORS if r in df.columns]
    for reg in available_regressors:
        model.add_regressor(reg)

    # Fit on train set
    model.fit(train[["ds", "y"] + available_regressors])

    # Evaluate on test set
    test_pred = model.predict(test[["ds"] + available_regressors])
    y_true = test["y"].values
    y_pred = test_pred["yhat"].values
    y_pred_clipped = np.maximum(y_pred, 0)

    mae = mean_absolute_error(y_true, y_pred_clipped)
    rmse = np.sqrt(mean_squared_error(y_true, y_pred_clipped))
    mask = y_true > 0
    mape = float(np.mean(np.abs((y_true[mask] - y_pred_clipped[mask]) / y_true[mask])) * 100) if mask.any() else 0.0
    bias = float(np.mean(y_pred_clipped - y_true))

    # Store evaluation metrics
    sb = get_supabase()
    eval_period = {"from": str(test["ds"].min().date()), "to": str(test["ds"].max().date())}

    for metric_name, metric_value in [("mae", mae), ("rmse", rmse), ("mape", mape), ("bias", bias)]:
        sb.table("model_evaluations").upsert({
            "model_type": "prophet",
            "model_version": VERSION,
            "product_id": product_id,
            "metric_name": metric_name,
            "metric_value": round(float(metric_value), 4),
            "n_samples": int(len(test)),
            "eval_period": eval_period,
        }).execute()

    # Retrain on full data
    full_model = Prophet(
        yearly_seasonality=True,
        weekly_seasonality=True,
        daily_seasonality=False,
        changepoint_prior_scale=0.05,
        interval_width=0.80,
    )
    for reg in available_regressors:
        full_model.add_regressor(reg)
    full_model.fit(df[["ds", "y"] + available_regressors])

    # Generate 21-day forecast (this week + 2 weeks ahead)
    last_date = df["ds"].max()
    future_dates = pd.date_range(last_date + timedelta(days=1), periods=21, freq="D")
    future_df = pd.DataFrame({"ds": future_dates})

    # Use actual calendar features for future dates, carry-forward for weather
    calendar_regressors = [
        "is_public_holiday", "is_school_holiday", "is_fellesferie",
        "days_until_christmas", "days_until_easter", "days_until_17mai",
    ]
    cal_data = None
    cal_regs_in_model = [r for r in calendar_regressors if r in available_regressors]
    if cal_regs_in_model:
        future_start = str((last_date + timedelta(days=1)).date())
        future_end = str((last_date + timedelta(days=21)).date())
        cal_rows = sb.table("calendar_features").select("date," + ",".join(cal_regs_in_model)) \
            .gte("date", future_start).lte("date", future_end).order("date").execute()
        if cal_rows.data:
            cal_data = pd.DataFrame(cal_rows.data)
            cal_data["ds"] = pd.to_datetime(cal_data["date"])

    for reg in available_regressors:
        if cal_data is not None and reg in cal_data.columns:
            future_df = future_df.merge(cal_data[["ds", reg]], on="ds", how="left")
            future_df[reg] = future_df[reg].fillna(0)
        else:
            # Weather/rolling regressors: carry forward last known value
            future_df[reg] = df[reg].iloc[-1]

    forecast = full_model.predict(future_df)

    # Upsert forecasts into prophet_forecasts
    forecast_rows = []
    for _, row in forecast.iterrows():
        forecast_rows.append({
            "product_id": product_id,
            "target_date": str(row["ds"].date()),
            "predicted_qty": round(max(0, float(row["yhat"])), 2),
            "yhat_lower": round(max(0, float(row["yhat_lower"])), 2),
            "yhat_upper": round(max(0, float(row["yhat_upper"])), 2),
            "model_version": VERSION,
        })

    for row in forecast_rows:
        sb.table("prophet_forecasts").upsert(
            row, on_conflict="product_id,target_date,model_version"
        ).execute()

    return {
        "product_id": product_id,
        "status": "trained",
        "n_train": len(train),
        "n_test": len(test),
        "mae": round(mae, 2),
        "rmse": round(rmse, 2),
        "mape": round(mape, 2),
        "bias": round(bias, 2),
        "forecasts": len(forecast_rows),
    }


def main():
    parser = argparse.ArgumentParser(description="Train Prophet models")
    parser.add_argument("--product", type=str, help="Single product ID to train")
    parser.add_argument("--all", action="store_true", help="Train all products")
    args = parser.parse_args()

    if not args.product and not args.all:
        parser.error("Specify --product <ID> or --all")

    if args.product:
        product_ids = [args.product]
    else:
        product_ids = get_all_product_ids()

    results = []
    trained = 0
    skipped = 0
    failed = 0

    for pid in product_ids:
        try:
            result = train_product(pid)
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
