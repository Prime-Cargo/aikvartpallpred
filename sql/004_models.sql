-- Trained models table for storing OLS regression coefficients

create table if not exists trained_models (
  id               uuid primary key default gen_random_uuid(),
  product_id       text not null,
  model_version    text not null,
  coefficients     jsonb not null,       -- array of coefficients
  feature_names    jsonb not null,       -- array of feature name strings
  normalization    jsonb not null,       -- { feature: { mean, std } } for z-score
  metrics          jsonb not null,       -- { r2, rmse, n_samples }
  training_range   jsonb not null,       -- { from, to, n_days }
  is_active        boolean not null default true,
  trained_at       timestamptz not null default now()
);

create index if not exists idx_trained_models_product_active
  on trained_models (product_id, is_active)
  where is_active = true;

create index if not exists idx_trained_models_trained_at
  on trained_models (trained_at);

-- Enable RLS
alter table trained_models enable row level security;

-- Allow anon key full access (adjust for production)
create policy "anon_trained_models_all" on trained_models
  for all using (true) with check (true);
