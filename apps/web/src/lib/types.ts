// DB行の型 (supabase/migrations/0001_init.sql に対応)

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
  sku: string;
  title: string;
  description_raw: string | null;
  description_html: string | null;
  category: string | null;
  ip_name: string | null;
  character_name: string | null;
  tags: string[];

  purchase_price_jpy: number | null;
  current_listed_price: number | null;
  recommended_price: number | null;
  gross_margin_amount: number | null;
  gross_margin_rate: number | null;
  margin_alert: boolean;
  pricing_breakdown: PricingBreakdown | null;

  weight_g: number | null;
  weight_source: WeightSource | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  dimension_source: WeightSource | null;

  inventory_qty: number;
  purchase_status: "unpurchased" | "ordered" | "in_stock";
  restock_recheck_flag: boolean;

  compliance_ip_caution: boolean;
  compliance_bootleg_suspect: boolean;
  compliance_restricted_item: boolean;
  compliance_notes: ComplianceNote[];

  shopify_handle: string | null;
  shopify_product_id: string | null;
  export_status: "not_exported" | "csv_exported" | "api_created" | "api_failed";
  status: "draft" | "ready" | "archived";

  created_at: string;
  updated_at: string;
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
  purchase_price_jpy: number;
  domestic_shipping_jpy: number;
  intl_shipping_jpy: number;
  chargeable_weight_g: number;
  volumetric_weight_g: number | null;
  total_cost_jpy: number;
  total_cost_store: number;
  fx_rate_jpy_per_store: number;
  payment_fee_rate: number;
  target_margin_rate: number;
  carrier: string;
  store_currency: string;
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

export interface ShopifySettings {
  vendor: string;
  default_product_type: string;
  default_status: "draft" | "active";
  inventory_policy: "continue" | "deny";
  weight_unit: "g";
  output_mode: "csv" | "api";
}

export interface AppSettings {
  store_currency: string;
  fx_rate_jpy_per_store: number;
  payment_fee_rate: number;
  target_margin_rate: number;
  domestic_shipping_jpy: number;
  default_carrier: string;
  volumetric_divisor: number;
  dummy_weight_values: number[];
  preorder_note_html: string;
  image_settings: ImageSettings;
  shopify_settings: ShopifySettings;
}
