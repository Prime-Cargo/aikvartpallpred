-- Add calendar features (holidays, school holidays, fellesferie, days until key dates)
-- to v_feature_engineering by joining calendar_features table.
-- Must DROP + CREATE because adding columns to a view requires it in Postgres.

drop view if exists v_feature_engineering;

create view v_feature_engineering as
with weather_dedup as (
  -- Pick one row per date: prefer 'frost' (actuals) over 'forecast'
  select distinct on (date)
    date, temp_avg, precipitation_mm, wind_speed
  from weather_data
  order by date, source desc  -- 'frost' (actuals) preferred over 'forecast'
),
daily as (
  select
    d.product_id,
    d.ds,
    d.y,
    d.n_customers,
    w.temp_avg,
    w.precipitation_mm,
    w.wind_speed,
    -- Calendar features (cast booleans to float for Prophet regressors)
    coalesce(c.is_public_holiday, false)::int::float as is_public_holiday,
    coalesce(c.is_school_holiday, false)::int::float as is_school_holiday,
    coalesce(c.is_fellesferie, false)::int::float as is_fellesferie,
    coalesce(c.day_of_week, extract(isodow from d.ds)::int) as day_of_week,
    c.days_until_christmas,
    c.days_until_easter,
    c.days_until_17mai
  from v_daily_product_demand d
  left join weather_dedup w on w.date = d.ds
  left join calendar_features c on c.date = d.ds
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
