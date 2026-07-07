-- ============================================================
-- セットアップ用 統合SQL: これ1ファイルをSupabaseのSQL Editorに
-- 貼り付けて Run するだけでDB準備が完了します
-- (内容は migrations/0001〜0003 と同一。再実行しても安全)
-- ============================================================

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

-- ============================================================
-- 初期シードデータ (UIから変更可能な既定値)
-- ============================================================

-- アプリ設定既定値
insert into app_settings (key, value) values
  ('store_currency',        '"USD"'),
  ('fx_rate_jpy_per_store', '155'),          -- 1ストア通貨あたりのJPY (例: 1USD=155JPY)
  ('payment_fee_rate',      '0.044'),        -- 決済手数料率 (Shopify Payments越境目安)
  ('target_margin_rate',    '0.30'),         -- 目標粗利率
  ('domestic_shipping_jpy', '800'),          -- 国内送料 (メルカリ→自宅/倉庫)
  ('default_carrier',       '"EMS"'),
  ('volumetric_divisor',    '6000'),         -- 容積重量 (cm3 / divisor = kg)
  ('dummy_weight_values',   '[0, 1, 999, 1000, 9999]'),  -- ダミー重量とみなす値(g)。1000=Shopeeの1kgダミー
  ('preorder_note_html',
   '"<p>【予約商品 / Pre-order】ご注文確認後、日本国内で在庫を確保し2〜4週間以内に発送します。<br>This is a pre-order item. Ships from Japan within 2-4 weeks after stock confirmation.</p>"'),
  ('image_settings', '{
    "bg_removal_provider": "rembg",
    "bg_removal_model": "isnet-general-use",
    "canvas_size": 2048,
    "margin_ratio": 0.06,
    "main_background": "white",
    "sub_transparent": true,
    "watermark_enabled": false,
    "watermark_text": "",
    "lifestyle_enabled": false
  }'),
  ('shopify_settings', '{
    "vendor": "",
    "default_product_type": "Figure",
    "default_status": "draft",
    "inventory_policy": "continue",
    "weight_unit": "g",
    "output_mode": "api"
  }')
on conflict (key) do nothing;

-- カテゴリ別デフォルト重量・寸法
insert into category_defaults (category, default_weight_g, default_length_cm, default_width_cm, default_height_cm) values
  ('フィギュア',   800,  25, 20, 18),
  ('一番くじ',     600,  22, 18, 15),
  ('プライズ',     500,  22, 18, 15),
  ('ぬいぐるみ',   400,  30, 25, 20),
  ('文具',         150,  25, 18, 5),
  ('カード',       100,  20, 15, 3),
  ('その他',       500,  25, 20, 15)
on conflict (category) do nothing;

-- 国際送料テーブル (EMS 2024改定 第2地帯(米国以外)ベースの目安。UIで要調整)
insert into shipping_rate_table (carrier, weight_from_g, weight_to_g, price_jpy) values
  ('EMS',     0,   500,  3900),
  ('EMS',   501,   600,  4180),
  ('EMS',   601,   700,  4460),
  ('EMS',   701,   800,  4740),
  ('EMS',   801,   900,  5020),
  ('EMS',   901,  1000,  5300),
  ('EMS',  1001,  1250,  5990),
  ('EMS',  1251,  1500,  6680),
  ('EMS',  1501,  1750,  7370),
  ('EMS',  1751,  2000,  8060),
  ('EMS',  2001,  2500,  9200),
  ('EMS',  2501,  3000, 10340),
  ('EMS',  3001,  3500, 11480),
  ('EMS',  3501,  4000, 12620),
  ('EMS',  4001,  4500, 13760),
  ('EMS',  4501,  5000, 14900),
  ('EMS',  5001,  6000, 16700),
  ('EMS',  6001,  7000, 18500),
  ('EMS',  7001,  8000, 20300),
  ('EMS',  8001,  9000, 22100),
  ('EMS',  9001, 10000, 23900);

-- コンプラ・真贋キーワード辞書
insert into compliance_keywords (keyword, flag_type, note) values
  -- ブートレグ疑い (真贋要確認)
  ('garage kit',   'bootleg_suspect', '海賊版ガレージキットの可能性'),
  ('ガレージキット', 'bootleg_suspect', '海賊版ガレージキットの可能性'),
  ('ガレキ',        'bootleg_suspect', '海賊版ガレージキットの可能性'),
  ('recast',       'bootleg_suspect', 'リキャスト(複製品)の可能性'),
  ('リキャスト',     'bootleg_suspect', 'リキャスト(複製品)の可能性'),
  ('resin kit',    'bootleg_suspect', 'レジンキットは真贋要確認'),
  ('レジンキット',   'bootleg_suspect', 'レジンキットは真贋要確認'),
  ('bootleg',      'bootleg_suspect', 'ブートレグ明記'),
  ('海賊版',        'bootleg_suspect', '海賊版明記'),
  ('コピー品',      'bootleg_suspect', 'コピー品明記'),
  ('無版権',        'bootleg_suspect', '無版権品'),
  ('中国製ノーブランド', 'bootleg_suspect', 'ノーブランド品は真贋要確認'),
  -- 禁制品・輸送制限
  ('リチウム',      'restricted_item', 'リチウム電池は国際輸送制限あり'),
  ('lithium',      'restricted_item', 'リチウム電池は国際輸送制限あり'),
  ('電池内蔵',      'restricted_item', '電池内蔵品は輸送制限の可能性'),
  ('バッテリー',    'restricted_item', 'バッテリーは輸送制限の可能性'),
  ('模造刀',        'restricted_item', '刀剣類は多くの国で輸入禁止'),
  ('日本刀',        'restricted_item', '刀剣類は多くの国で輸入禁止'),
  ('ナイフ',        'restricted_item', '刃物は輸送・輸入制限の可能性'),
  ('エアガン',      'restricted_item', '武器類は輸入禁止の可能性'),
  ('モデルガン',    'restricted_item', '武器類は輸入禁止の可能性'),
  ('スプレー',      'restricted_item', 'エアゾールは航空輸送不可'),
  ('香水',          'restricted_item', 'アルコール含有で航空輸送制限'),
  ('ライター',      'restricted_item', '可燃物は航空輸送不可')
on conflict (keyword, flag_type) do nothing;

-- 版権ワード (IP注意) : 主要IPの例。運用しながらUIで追加する
insert into compliance_keywords (keyword, flag_type, note) values
  ('ポケモン',      'ip_caution', '任天堂/ポケモン社は権利行使に積極的'),
  ('pokemon',      'ip_caution', '任天堂/ポケモン社は権利行使に積極的'),
  ('ディズニー',    'ip_caution', 'ディズニーは権利行使に積極的'),
  ('disney',       'ip_caution', 'ディズニーは権利行使に積極的'),
  ('サンリオ',      'ip_caution', 'サンリオは権利行使に積極的'),
  ('任天堂',        'ip_caution', '任天堂は権利行使に積極的'),
  ('スタジオジブリ', 'ip_caution', 'ジブリは権利行使に積極的'),
  ('ジブリ',        'ip_caution', 'ジブリは権利行使に積極的')
on conflict (keyword, flag_type) do nothing;

-- ============================================================
-- 路線変更: Amazon仕入れ → Shopee無在庫販売 モデルへの改修
-- (0001/0002 適用済みでも未適用でも動くよう IF EXISTS で防御)
-- ============================================================

-- ------------------------------------------------------------
-- products: Amazon仕入れ用の列を追加、Shopify専用列を廃止
-- ------------------------------------------------------------
alter table products add column if not exists asin text;
alter table products add column if not exists amazon_url text;
alter table products add column if not exists source_stock_status text not null default 'unknown'
  check (source_stock_status in ('in_stock','out_of_stock','unknown'));
alter table products add column if not exists source_checked_at timestamptz;
alter table products add column if not exists note text;
alter table products add column if not exists shopee_category_id bigint;  -- Shopeeカテゴリ (API出品に必要)

create unique index if not exists idx_products_asin on products (asin) where asin is not null;

alter table products drop column if exists shopify_handle;
alter table products drop column if exists shopify_product_id;
-- 市場別に持つため商品レベルの価格計算列は撤去 (market_listings へ移動)
alter table products drop column if exists recommended_price;
alter table products drop column if exists gross_margin_amount;
alter table products drop column if exists gross_margin_rate;
alter table products drop column if exists margin_alert;
alter table products drop column if exists pricing_breakdown;
alter table products drop column if exists current_listed_price;
alter table products drop column if exists export_status;
alter table products drop column if exists restock_recheck_flag;

drop table if exists shopify_export_logs;

-- ------------------------------------------------------------
-- 市場マスタ (Shopee SG / TW / ...)
-- ------------------------------------------------------------
create table if not exists markets (
  code text primary key,                       -- 'SG', 'TW', 'MY' ...
  name text not null,
  currency text not null,                      -- 'SGD', 'TWD' ...
  fx_rate_jpy numeric not null,                -- 1通貨あたりのJPY
  fee_rate numeric not null default 0.10,      -- Shopee手数料合計 (販売+決済+サービス)
  target_margin_rate numeric not null default 0.30,
  shipping_carrier text not null default 'SLS-SG',  -- shipping_rate_table.carrier
  domestic_cost_jpy numeric not null default 0,     -- Amazon送料+梱包等の国内固定費
  default_stock integer not null default 1,         -- 無在庫時のShopee表示在庫
  days_to_ship integer not null default 7,          -- DTS (発送日数)
  logistics_channel_id bigint,                      -- Shopee物流チャネルID (API出品に必要)
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

insert into markets (code, name, currency, fx_rate_jpy, fee_rate, target_margin_rate, shipping_carrier, domestic_cost_jpy, default_stock, days_to_ship, enabled) values
  ('SG', 'Shopee Singapore', 'SGD', 115, 0.10, 0.30, 'SLS-SG', 0, 1, 7, true),
  ('TW', 'Shopee Taiwan',    'TWD', 4.8, 0.10, 0.30, 'SLS-TW', 0, 1, 7, true)
on conflict (code) do nothing;

-- SLS(Shopee Logistics)の送料目安をシード (要実測調整)
insert into shipping_rate_table (carrier, weight_from_g, weight_to_g, price_jpy) values
  ('SLS-SG',    0,  100,  700),
  ('SLS-SG',  101,  250,  900),
  ('SLS-SG',  251,  500, 1200),
  ('SLS-SG',  501, 1000, 1800),
  ('SLS-SG', 1001, 2000, 2900),
  ('SLS-SG', 2001, 5000, 5500),
  ('SLS-TW',    0,  100,  600),
  ('SLS-TW',  101,  250,  800),
  ('SLS-TW',  251,  500, 1100),
  ('SLS-TW',  501, 1000, 1600),
  ('SLS-TW', 1001, 2000, 2600),
  ('SLS-TW', 2001, 5000, 5000);

-- ------------------------------------------------------------
-- 市場別出品 (商品 × 市場)
-- ------------------------------------------------------------
create table if not exists market_listings (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  market_code text not null references markets(code) on delete cascade,
  recommended_price numeric,                   -- 推奨売値 (市場通貨)
  listed_price numeric,                        -- 実際にShopeeへ出した売値
  stock integer not null default 1,
  gross_margin_rate numeric,                   -- listed_price(なければrecommended)ベース
  margin_alert boolean not null default false,
  pricing_breakdown jsonb,
  shopee_item_id bigint,                       -- API出品後のitem_id
  status text not null default 'draft'
    check (status in ('draft','ready','exported_xlsx','listed','update_required','delisted','error')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, market_code)
);

create index if not exists idx_market_listings_product on market_listings (product_id);
create index if not exists idx_market_listings_status on market_listings (market_code, status);

drop trigger if exists trg_market_listings_updated on market_listings;
create trigger trg_market_listings_updated before update on market_listings
  for each row execute function set_updated_at();

-- ------------------------------------------------------------
-- Shopeeショップ認証 (Open Platform OAuth)
-- partner_id / partner_key は .env 管理。ここはショップ単位のトークンのみ
-- ------------------------------------------------------------
create table if not exists shopee_shops (
  id uuid primary key default gen_random_uuid(),
  market_code text not null references markets(code),
  shop_id bigint unique not null,
  shop_name text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  authorized_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_shopee_shops_updated on shopee_shops;
create trigger trg_shopee_shops_updated before update on shopee_shops
  for each row execute function set_updated_at();

-- ------------------------------------------------------------
-- 出力ログ (汎用化)
-- ------------------------------------------------------------
create table if not exists export_logs (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references market_listings(id) on delete set null,
  export_type text not null check (export_type in ('shopee_api','shopee_xlsx')),
  result text not null check (result in ('success','failed')),
  detail jsonb,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 設定の整理: Shopify設定を廃止し、Shopee/無在庫向け既定値を追加
-- ------------------------------------------------------------
delete from app_settings where key in ('shopify_settings', 'store_currency', 'fx_rate_jpy_per_store', 'payment_fee_rate', 'target_margin_rate', 'default_carrier', 'domestic_shipping_jpy', 'preorder_note_html');
insert into app_settings (key, value) values
  ('shipping_note_text',
   '"Ships from Japan. Please allow 7-14 days for delivery after payment. / 日本から発送します。お支払い後7〜14日でお届けします。"'),
  ('amazon_domestic_shipping_jpy', '0')   -- プライム前提。必要なら設定画面で変更
on conflict (key) do nothing;
