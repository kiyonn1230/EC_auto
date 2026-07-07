// DB行の型 (supabase/migrations 0001〜0003 に対応)
// モデル: Amazon仕入れ → Shopee(多市場)無在庫販売

export type WeightSource = "measured" | "category_default" | "dummy_detected" | "missing";

export type ImageStatus =
  | "pending"
  | "queued"
  | "downloading"
  | "removing_bg"
  | "composing"
  | "uploading"
  | "success"
  | "failed"
  | "manual_required";

export interface Product {
  id: string;
  sku: string;                       // = ASIN
  asin: string | null;
  amazon_url: string | null;
  title: string;
  description_raw: string | null;
  description_html: string | null;
  category: string | null;
  shopee_category_id: number | null; // Shopee API出品に必要
  ip_name: string | null;
  character_name: string | null;
  tags: string[];
  note: string | null;

  purchase_price_jpy: number | null; // Amazon価格 (仕入原価)
  source_stock_status: "in_stock" | "out_of_stock" | "unknown"; // Amazon側の在庫
  source_checked_at: string | null;

  weight_g: number | null;
  weight_source: WeightSource | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  dimension_source: WeightSource | null;

  compliance_ip_caution: boolean;
  compliance_bootleg_suspect: boolean;
  compliance_restricted_item: boolean;
  compliance_notes: ComplianceNote[];

  status: "draft" | "ready" | "archived";
  created_at: string;
  updated_at: string;
}

export interface Market {
  code: string;                      // 'SG' | 'TW' | ...
  name: string;
  currency: string;
  fx_rate_jpy: number;               // 1通貨あたりのJPY
  fee_rate: number;                  // Shopee手数料合計 (販売+決済+サービス)
  target_margin_rate: number;
  shipping_carrier: string;          // shipping_rate_table.carrier
  domestic_cost_jpy: number;         // 国内固定費 (Amazon送料・梱包等)
  default_stock: number;
  days_to_ship: number;
  logistics_channel_id: number | null;
  enabled: boolean;
}

export interface MarketListing {
  id: string;
  product_id: string;
  market_code: string;
  recommended_price: number | null;  // 市場通貨
  listed_price: number | null;
  stock: number;
  gross_margin_rate: number | null;
  margin_alert: boolean;
  pricing_breakdown: PricingBreakdown | null;
  shopee_item_id: number | null;
  status: "draft" | "ready" | "exported_xlsx" | "listed" | "update_required" | "delisted" | "error";
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShopeeShop {
  id: string;
  market_code: string;
  shop_id: number;
  shop_name: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  authorized_at: string;
}

export interface ProductImage {
  id: string;
  product_id: string;
  source_url: string;
  position: number;
  role: "main" | "sub";
  processed_url: string | null;
  transparent_url: string | null;
  lifestyle_url: string | null;
  status: ImageStatus;
  error_message: string | null;
  bg_removal_model: string | null;
  retries: number;
  created_at: string;
  updated_at: string;
}

export interface ImportBatch {
  id: string;
  file_type: "product_data" | "cost_data";
  file_name: string | null;
  row_count: number;
  ok_count: number;
  issue_count: number;
  status: "processing" | "completed" | "failed";
  created_at: string;
}

export interface ImportIssue {
  id: string;
  batch_id: string | null;
  sku: string | null;
  row_number: number | null;
  issue_type: string;
  field: string | null;
  message: string;
  severity: "warning" | "error";
  created_at: string;
}

export interface CategoryDefault {
  category: string;
  default_weight_g: number;
  default_length_cm: number | null;
  default_width_cm: number | null;
  default_height_cm: number | null;
}

export interface ShippingRate {
  id?: string;
  carrier: string;
  weight_from_g: number;
  weight_to_g: number;
  price_jpy: number;
}

export interface ComplianceKeyword {
  id?: string;
  keyword: string;
  flag_type: "ip_caution" | "bootleg_suspect" | "restricted_item";
  note: string | null;
}

export interface ComplianceNote {
  flag_type: ComplianceKeyword["flag_type"];
  keyword: string;
  field: string;
  note?: string;
}

export interface PricingBreakdown {
  purchase_price_jpy: number;        // Amazon価格
  domestic_cost_jpy: number;
  intl_shipping_jpy: number;
  chargeable_weight_g: number;
  volumetric_weight_g: number | null;
  total_cost_jpy: number;
  total_cost_market: number;         // 市場通貨換算
  fx_rate_jpy: number;
  fee_rate: number;
  target_margin_rate: number;
  carrier: string;
  currency: string;
  warnings: string[];
}

export interface ImageSettings {
  bg_removal_provider: "rembg" | "external_api";
  bg_removal_model: string;
  canvas_size: number;
  margin_ratio: number;
  main_background: "white";
  sub_transparent: boolean;
  watermark_enabled: boolean;
  watermark_text: string;
  lifestyle_enabled: boolean;
}

export interface AppSettings {
  volumetric_divisor: number;
  dummy_weight_values: number[];
  amazon_domestic_shipping_jpy: number;
  shipping_note_text: string;
  image_settings: ImageSettings;
}
