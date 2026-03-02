-- Prophet forecasts, baseline forecasts, model evaluations, and feature engineering views

-- ============================================================
-- Table: prophet_forecasts — pre-computed Prophet predictions
-- ============================================================
create table if not exists prophet_forecasts (
  id              uuid primary key default gen_random_uuid(),
  product_id      text not null,
  target_date     date not null,
  predicted_qty   numeric not null,
  yhat_lower      numeric,
  yhat_upper      numeric,
  model_version   text not null,
  created_at      timestamptz not null default now()
);

create unique index if not exists uq_prophet_forecasts_product_date_version
  on prophet_forecasts (product_id, target_date, model_version);

create index if not exists idx_prophet_forecasts_target_date
  on prophet_forecasts (target_date);

-- ============================================================
-- Table: baseline_forecasts — last-year-same-week predictions
-- ============================================================
create table if not exists baseline_forecasts (
  id              uuid primary key default gen_random_uuid(),
  product_id      text not null,
  target_date     date not null,
  predicted_qty   numeric not null,
  model_version   text not null,
  created_at      timestamptz not null default now()
);

create unique index if not exists uq_baseline_forecasts_product_date_version
  on baseline_forecasts (product_id, target_date, model_version);

create index if not exists idx_baseline_forecasts_target_date
  on baseline_forecasts (target_date);

-- ============================================================
-- Table: model_evaluations — cross-model comparison metrics
-- ============================================================
create table if not exists model_evaluations (
  id              uuid primary key default gen_random_uuid(),
  model_type      text not null,          -- 'ols', 'prophet', 'baseline'
  model_version   text not null,
  product_id      text,                   -- null for aggregate metrics
  metric_name     text not null,          -- 'mape', 'rmse', 'mae', 'bias'
  metric_value    numeric not null,
  n_samples       integer not null,
  eval_period     jsonb,                  -- { "from": "...", "to": "..." }
  created_at      timestamptz not null default now()
);

create index if not exists idx_model_evaluations_type_version
  on model_evaluations (model_type, model_version);

create index if not exists idx_model_evaluations_product
  on model_evaluations (product_id)
  where product_id is not null;

-- ============================================================
-- View: v_daily_product_demand
-- Aggregates order_history to daily totals per product
-- ============================================================
create or replace view v_daily_product_demand as
select
  product_id,
  order_date as ds,
  sum(quantity) as y,
  count(distinct customer_id) as n_customers
from order_history
group by product_id, order_date;

-- ============================================================
-- View: v_feature_engineering
-- Joins demand + weather, computes rolling averages, lags, weather deltas
-- ============================================================
create or replace view v_feature_engineering as
with daily as (
  select
    d.product_id,
    d.ds,
    d.y,
    d.n_customers,
    w.temp_avg,
    w.precipitation_mm,
    w.wind_speed
  from v_daily_product_demand d
  left join weather_data w on w.date = d.ds
),
with_rolling as (
  select
    *,
    -- Rolling averages
    avg(y) over (partition by product_id order by ds rows between 6 preceding and current row) as rolling_7d,
    avg(y) over (partition by product_id order by ds rows between 29 preceding and current row) as rolling_30d,
    avg(y) over (partition by product_id order by ds rows between 89 preceding and current row) as rolling_90d,
    -- Lag features
    lag(y, 1) over (partition by product_id order by ds) as lag_1d,
    lag(y, 7) over (partition by product_id order by ds) as lag_7d,
    lag(y, 14) over (partition by product_id order by ds) as lag_14d,
    -- Weather seasonal norms (90-day rolling averages)
    avg(temp_avg) over (partition by product_id order by ds rows between 89 preceding and current row) as temp_seasonal_norm,
    avg(precipitation_mm) over (partition by product_id order by ds rows between 89 preceding and current row) as precip_seasonal_norm
  from daily
)
select
  *,
  -- Weather deltas (deviation from seasonal norm)
  temp_avg - temp_seasonal_norm as temp_delta,
  precipitation_mm - precip_seasonal_norm as precip_delta
from with_rolling;

-- ============================================================
-- RLS policies (matching existing open-access pattern)
-- ============================================================
alter table prophet_forecasts enable row level security;
create policy "anon_prophet_forecasts_all" on prophet_forecasts
  for all using (true) with check (true);

alter table baseline_forecasts enable row level security;
create policy "anon_baseline_forecasts_all" on baseline_forecasts
  for all using (true) with check (true);

alter table model_evaluations enable row level security;
create policy "anon_model_evaluations_all" on model_evaluations
  for all using (true) with check (true);
