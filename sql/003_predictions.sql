-- Prediction logging & feedback loop tables

create table if not exists predictions (
  id            uuid primary key default gen_random_uuid(),
  product_id    text not null,
  customer_id   text,
  target_date   date not null,
  predicted_qty numeric not null,
  confidence_low numeric,
  confidence_high numeric,
  model_version text not null default 'v1',
  features_snapshot jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists idx_predictions_product on predictions (product_id);
create index if not exists idx_predictions_target_date on predictions (target_date);
create index if not exists idx_predictions_created_at on predictions (created_at);

create table if not exists prediction_outcomes (
  id            uuid primary key default gen_random_uuid(),
  prediction_id uuid not null references predictions(id),
  actual_qty    numeric not null,
  error         numeric not null,       -- actual - predicted
  error_percent numeric,                -- error / actual * 100 (null if actual = 0)
  matched_at    timestamptz not null default now()
);

create index if not exists idx_outcomes_prediction on prediction_outcomes (prediction_id);
create index if not exists idx_outcomes_matched_at on prediction_outcomes (matched_at);

-- Enable RLS (adjust policies as needed)
alter table predictions enable row level security;
alter table prediction_outcomes enable row level security;

-- Allow anon key full access (adjust for production)
create policy "anon_predictions_all" on predictions for all using (true) with check (true);
create policy "anon_outcomes_all" on prediction_outcomes for all using (true) with check (true);
