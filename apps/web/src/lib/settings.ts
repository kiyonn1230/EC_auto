import { supabaseAdmin } from "@/lib/supabase/server";
import type {
  AppSettings,
  CategoryDefault,
  ComplianceKeyword,
  ShippingRate,
} from "@/lib/types";

/** app_settings が空でも動くための既定値 (0002_seed.sql と同値) */
export const DEFAULT_SETTINGS: AppSettings = {
  store_currency: "USD",
  fx_rate_jpy_per_store: 155,
  payment_fee_rate: 0.044,
  target_margin_rate: 0.3,
  domestic_shipping_jpy: 800,
  default_carrier: "EMS",
  volumetric_divisor: 6000,
  dummy_weight_values: [0, 1, 999, 9999],
  preorder_note_html:
    "<p>【予約商品 / Pre-order】ご注文確認後、日本国内で在庫を確保し2〜4週間以内に発送します。<br>This is a pre-order item. Ships from Japan within 2-4 weeks after stock confirmation.</p>",
  image_settings: {
    bg_removal_provider: "rembg",
    bg_removal_model: "isnet-general-use",
    canvas_size: 2048,
    margin_ratio: 0.06,
    main_background: "white",
    sub_transparent: true,
    watermark_enabled: false,
    watermark_text: "",
    lifestyle_enabled: false,
  },
  shopify_settings: {
    vendor: "",
    default_product_type: "Figure",
    default_status: "draft",
    inventory_policy: "continue",
    weight_unit: "g",
    output_mode: "api",
  },
};

export async function loadSettings(): Promise<AppSettings> {
  const { data, error } = await supabaseAdmin().from("app_settings").select("key, value");
  if (error) throw new Error(`app_settings取得失敗: ${error.message}`);
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of data ?? []) {
    if (row.key in DEFAULT_SETTINGS) {
      const def = DEFAULT_SETTINGS[row.key as keyof AppSettings];
      // ネストしたオブジェクト設定は既定値とマージして欠損キーを埋める
      if (def && typeof def === "object" && !Array.isArray(def)) {
        merged[row.key] = { ...def, ...(row.value as object) };
      } else {
        merged[row.key] = row.value;
      }
    }
  }
  return merged as unknown as AppSettings;
}

/** 粗利計算・補正・コンプラ検査に必要な参照データ一式 */
export interface EnrichContext {
  settings: AppSettings;
  categoryDefaults: CategoryDefault[];
  shippingRates: ShippingRate[];
  keywords: ComplianceKeyword[];
}

export async function loadEnrichContext(): Promise<EnrichContext> {
  const sb = supabaseAdmin();
  const [settings, cats, rates, kws] = await Promise.all([
    loadSettings(),
    sb.from("category_defaults").select("*"),
    sb.from("shipping_rate_table").select("*").order("weight_from_g"),
    sb.from("compliance_keywords").select("*"),
  ]);
  if (cats.error) throw new Error(`category_defaults取得失敗: ${cats.error.message}`);
  if (rates.error) throw new Error(`shipping_rate_table取得失敗: ${rates.error.message}`);
  if (kws.error) throw new Error(`compliance_keywords取得失敗: ${kws.error.message}`);
  return {
    settings,
    categoryDefaults: (cats.data ?? []) as CategoryDefault[],
    shippingRates: (rates.data ?? []) as ShippingRate[],
    keywords: (kws.data ?? []) as ComplianceKeyword[],
  };
}
