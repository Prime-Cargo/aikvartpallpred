"""Evaluate and compare OLS, Prophet, and baseline models.

Loads actuals from order_history for the last 90 days,
loads predictions from each model's table, computes MAPE/RMSE/MAE/bias,
stores aggregate metrics in model_evaluations, and prints a JSON report.
"""

import json
import sys
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

from config import get_supabase
from features import fetch_all_rows

EVAL_DAYS = 90


def load_actuals() -> pd.DataFrame:
    """Load actual daily demand for last 90 days."""
    sb = get_supabase()
    cutoff = (datetime.now() - timedelta(days=EVAL_DAYS)).strftime("%Y-%m-%d")

    query = (
        sb.table("v_daily_product_demand")
        .select("product_id,ds,y")
        .gte("ds", cutoff)
        .order("ds")
    )
    rows = fetch_all_rows(query)
    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows)
    df["ds"] = pd.to_datetime(df["ds"])
    df["y"] = pd.to_numeric(df["y"], errors="coerce").fillna(0)
    return df


def load_ols_predictions() -> pd.DataFrame:
    """Load OLS predictions from predictions table for last 90 days."""
    sb = get_supabase()
    cutoff = (datetime.now() - timedelta(days=EVAL_DAYS)).strftime("%Y-%m-%d")

    query = (
        sb.table("predictions")
        .select("product_id,target_date,predicted_qty,model_version")
        .gte("target_date", cutoff)
        .like("model_version", "%lr%")
        .order("target_date")
    )
    rows = fetch_all_rows(query)
    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows)
    df["ds"] = pd.to_datetime(df["target_date"])
    df["yhat"] = pd.to_numeric(df["predicted_qty"], errors="coerce")
    return df[["product_id", "ds", "yhat", "model_version"]]


def load_prophet_predictions() -> pd.DataFrame:
    """Load Prophet forecasts for last 90 days."""
    sb = get_supabase()
    cutoff = (datetime.now() - timedelta(days=EVAL_DAYS)).strftime("%Y-%m-%d")

    query = (
        sb.table("prophet_forecasts")
        .select("product_id,target_date,predicted_qty,model_version")
        .gte("target_date", cutoff)
        .order("target_date")
    )
    rows = fetch_all_rows(query)
    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows)
    df["ds"] = pd.to_datetime(df["target_date"])
    df["yhat"] = pd.to_numeric(df["predicted_qty"], errors="coerce")
    return df[["product_id", "ds", "yhat", "model_version"]]


def load_baseline_predictions() -> pd.DataFrame:
    """Load baseline forecasts for last 90 days."""
    sb = get_supabase()
    cutoff = (datetime.now() - timedelta(days=EVAL_DAYS)).strftime("%Y-%m-%d")

    query = (
        sb.table("baseline_forecasts")
        .select("product_id,target_date,predicted_qty,model_version")
        .gte("target_date", cutoff)
        .order("target_date")
    )
    rows = fetch_all_rows(query)
    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows)
    df["ds"] = pd.to_datetime(df["target_date"])
    df["yhat"] = pd.to_numeric(df["predicted_qty"], errors="coerce")
    return df[["product_id", "ds", "yhat", "model_version"]]


def compute_metrics(actuals: pd.DataFrame, predictions: pd.DataFrame) -> dict:
    """Join actuals with predictions and compute aggregate metrics."""
    if actuals.empty or predictions.empty:
        return {"mae": None, "rmse": None, "mape": None, "bias": None, "n_samples": 0}

    merged = actuals.merge(predictions, on=["product_id", "ds"], how="inner")
    if merged.empty:
        return {"mae": None, "rmse": None, "mape": None, "bias": None, "n_samples": 0}

    y_true = merged["y"].values
    y_pred = merged["yhat"].values

    mae = float(np.mean(np.abs(y_true - y_pred)))
    rmse = float(np.sqrt(np.mean((y_true - y_pred) ** 2)))
    bias = float(np.mean(y_pred - y_true))

    mask = y_true > 0
    mape = float(np.mean(np.abs((y_true[mask] - y_pred[mask]) / y_true[mask])) * 100) if mask.any() else 0.0

    return {
        "mae": round(mae, 4),
        "rmse": round(rmse, 4),
        "mape": round(mape, 4),
        "bias": round(bias, 4),
        "n_samples": int(len(merged)),
    }


def store_metrics(model_type: str, model_version: str, metrics: dict):
    """Store aggregate metrics in model_evaluations."""
    if metrics["n_samples"] == 0:
        return

    sb = get_supabase()
    eval_period = {
        "from": (datetime.now() - timedelta(days=EVAL_DAYS)).strftime("%Y-%m-%d"),
        "to": datetime.now().strftime("%Y-%m-%d"),
    }

    for metric_name in ["mae", "rmse", "mape", "bias"]:
        value = metrics.get(metric_name)
        if value is None:
            continue
        sb.table("model_evaluations").upsert({
            "model_type": model_type,
            "model_version": model_version,
            "product_id": None,
            "metric_name": metric_name,
            "metric_value": value,
            "n_samples": metrics["n_samples"],
            "eval_period": eval_period,
        }).execute()


def main():
    actuals = load_actuals()
    if actuals.empty:
        print(json.dumps({"error": "No actuals found for evaluation period"}))
        sys.exit(1)

    # Load predictions from each model
    ols_preds = load_ols_predictions()
    prophet_preds = load_prophet_predictions()
    baseline_preds = load_baseline_predictions()

    # Compute metrics
    ols_metrics = compute_metrics(actuals, ols_preds)
    prophet_metrics = compute_metrics(actuals, prophet_preds)
    baseline_metrics = compute_metrics(actuals, baseline_preds)

    # Determine model versions for storage
    ols_version = ols_preds["model_version"].iloc[0] if not ols_preds.empty else "unknown"
    prophet_version = prophet_preds["model_version"].iloc[0] if not prophet_preds.empty else "unknown"
    baseline_version = baseline_preds["model_version"].iloc[0] if not baseline_preds.empty else "unknown"

    # Store aggregate metrics
    store_metrics("ols", ols_version, ols_metrics)
    store_metrics("prophet", prophet_version, prophet_metrics)
    store_metrics("baseline", baseline_version, baseline_metrics)

    report = {
        "eval_period_days": EVAL_DAYS,
        "models": {
            "ols": {"version": ols_version, **ols_metrics},
            "prophet": {"version": prophet_version, **prophet_metrics},
            "baseline": {"version": baseline_version, **baseline_metrics},
        },
    }

    # Determine best model by MAPE
    valid = {k: v for k, v in report["models"].items() if v.get("mape") is not None and v["n_samples"] > 0}
    if valid:
        best = min(valid, key=lambda k: valid[k]["mape"])
        report["best_model"] = best
        report["best_mape"] = valid[best]["mape"]

    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
