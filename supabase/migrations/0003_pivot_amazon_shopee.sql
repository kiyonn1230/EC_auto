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
