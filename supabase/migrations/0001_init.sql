-- ============================================================
-- 越境EC自動化ダッシュボード Phase 1: 初期スキーマ
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 商品本体 ((A)商品データ + (B)仕入原価 をSKUで突合した結果)
-- ------------------------------------------------------------
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  sku text unique not null,                       -- メルカリ商品ID (突合キー)
  title text not null,
  description_raw text,                           -- xlsx原文 (_x000d_ 等を含みうる)
  description_html text,                          -- 整形後 (Body (HTML) 用)
  category text,
  ip_name text,                                   -- 作品名
  character_name text,
  tags text[] not null default '{}',

  -- 価格系
  purchase_price_jpy numeric,                     -- (B) 仕入価格
  current_listed_price numeric,                   -- (A) 現状の想定売値 (ストア通貨)
  recommended_price numeric,                      -- 粗利エンジンの推奨売値 (ストア通貨)
  gross_margin_amount numeric,                    -- 現状売値ベースの粗利額 (ストア通貨)
  gross_margin_rate numeric,                      -- 現状売値ベースの粗利率 (0-1)
  margin_alert boolean not null default false,    -- 赤字警告
  pricing_breakdown jsonb,                        -- 送料/手数料/為替の内訳スナップショット

  -- 重量・寸法
  weight_g numeric,
  weight_source text check (weight_source in ('measured','category_default','dummy_detected','missing')),
  length_cm numeric,
  width_cm numeric,
  height_cm numeric,
  dimension_source text check (dimension_source in ('measured','category_default','dummy_detected','missing')),

  -- 在庫・仕入れ状態 (有在庫/予約販売モデル)
  inventory_qty integer not null default 0,
  purchase_status text not null default 'unpurchased'
    check (purchase_status in ('unpurchased','ordered','in_stock')),
  restock_recheck_flag boolean not null default false,  -- 元メルカリ在庫の再確認フラグ

  -- コンプラ・真贋 (警告のみ、出品はブロックしない)
  compliance_ip_caution boolean not null default false,
  compliance_bootleg_suspect boolean not null default false,
  compliance_restricted_item boolean not null default false,
  compliance_notes jsonb not null default '[]',   -- [{flag_type, keyword, field}]

  -- Shopify出力
  shopify_handle text,
  shopify_product_id text,                        -- API出品後の gid
  export_status text not null default 'not_exported'
    check (export_status in ('not_exported','csv_exported','api_created','api_failed')),
  status text not null default 'draft'
    check (status in ('draft','ready','archived')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_products_sku on products (sku);
create index if not exists idx_products_status on products (status);

-- ------------------------------------------------------------
-- 商品画像 (入力xlsxに含まれるURLのみ。URL推測収集はしない)
-- ------------------------------------------------------------
create table if not exists product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  source_url text not null,                       -- 例 static.mercdn.net/... (クエリ付きのまま保持)
  position integer not null default 1,            -- 1 = 主画像
  role text not null default 'main' check (role in ('main','sub')),

  processed_url text,                             -- 白背景1:1 (Storage公開URL)
  transparent_url text,                           -- 透過PNG版
  lifestyle_url text,                             -- 任意: 生成背景版 (既定OFF)
  status text not null default 'pending'
    check (status in ('pending','queued','downloading','removing_bg','composing','uploading',
                      'success','failed','manual_required')),
  error_message text,
  bg_removal_model text,
  retries integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, source_url)
);

create index if not exists idx_product_images_product on product_images (product_id);
create index if not exists idx_product_images_status on product_images (status);

-- ------------------------------------------------------------
-- 画像処理ジョブキュー (Pythonワーカーがポーリング)
-- ------------------------------------------------------------
create table if not exists image_jobs (
  id uuid primary key default gen_random_uuid(),
  product_image_id uuid not null references product_images(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued','processing','succeeded','failed')),
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  last_error text,
  payload jsonb not null default '{}',            -- 画像設定のスナップショット(モデル/余白率/透過等)
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_image_jobs_status on image_jobs (status, created_at);

-- ワーカーが安全にジョブを1件claimするRPC (競合はSKIP LOCKEDで回避)
create or replace function claim_image_job()
returns setof image_jobs
language plpgsql
as $$
declare
  job image_jobs;
begin
  select * into job
  from image_jobs
  where status = 'queued'
  order by created_at
  limit 1
  for update skip locked;

  if job.id is null then
    return;
  end if;

  update image_jobs
  set status = 'processing',
      attempts = attempts + 1,
      locked_at = now(),
      updated_at = now()
  where id = job.id;

  return query select * from image_jobs where id = job.id;
end;
$$;

-- ------------------------------------------------------------
-- 取込バッチと検証エラー
-- ------------------------------------------------------------
create table if not exists import_batches (
  id uuid primary key default gen_random_uuid(),
  file_type text not null check (file_type in ('product_data','cost_data')),
  file_name text,
  row_count integer not null default 0,
  ok_count integer not null default 0,
  issue_count integer not null default 0,
  status text not null default 'processing'
    check (status in ('processing','completed','failed')),
  created_at timestamptz not null default now()
);

create table if not exists import_issues (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references import_batches(id) on delete cascade,
  sku text,
  row_number integer,
  issue_type text not null,
  -- issue_type例: missing_required / sku_unmatched_cost / sku_duplicate /
  --               invalid_number / dummy_weight_detected / no_image_url /
  --               shopify_constraint_violation / unmapped_column
  field text,
  message text not null,
  severity text not null default 'warning' check (severity in ('warning','error')),
  created_at timestamptz not null default now()
);

create index if not exists idx_import_issues_batch on import_issues (batch_id);

-- ------------------------------------------------------------
-- 設定類 (UIから変更可能。秘匿情報=トークン等はここに置かず .env 管理)
-- ------------------------------------------------------------
create table if not exists category_defaults (
  category text primary key,
  default_weight_g numeric not null,
  default_length_cm numeric,
  default_width_cm numeric,
  default_height_cm numeric
);

create table if not exists shipping_rate_table (
  id uuid primary key default gen_random_uuid(),
  carrier text not null,                          -- 'EMS' / 'courier' 等
  weight_from_g numeric not null,
  weight_to_g numeric not null,
  price_jpy numeric not null
);

create index if not exists idx_shipping_rate on shipping_rate_table (carrier, weight_from_g);

create table if not exists compliance_keywords (
  id uuid primary key default gen_random_uuid(),
  keyword text not null,
  flag_type text not null check (flag_type in ('ip_caution','bootleg_suspect','restricted_item')),
  note text,
  unique (keyword, flag_type)
);

create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists shopify_export_logs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id) on delete set null,
  export_type text not null check (export_type in ('csv','api')),
  result text not null check (result in ('success','failed')),
  detail jsonb,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- updated_at 自動更新
-- ------------------------------------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_products_updated on products;
create trigger trg_products_updated before update on products
  for each row execute function set_updated_at();

drop trigger if exists trg_product_images_updated on product_images;
create trigger trg_product_images_updated before update on product_images
  for each row execute function set_updated_at();

drop trigger if exists trg_image_jobs_updated on image_jobs;
create trigger trg_image_jobs_updated before update on image_jobs
  for each row execute function set_updated_at();

-- ------------------------------------------------------------
-- Storage バケット (加工済み画像の公開配信用)
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;
