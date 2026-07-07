import type { Market, MarketListing, Product } from "@/lib/types";
import type { EnrichContext } from "@/lib/settings";
import { correctWeightAndDims } from "@/lib/weight/correct";
import { calculateMarketPricing } from "@/lib/pricing/engine";
import { checkCompliance } from "@/lib/compliance/check";

/**
 * 商品レベルの補正: 重量寸法補完 + コンプラ検査。
 * products への更新パッチを返す (取込時と一括再計算で共用)
 */
export function enrichProduct(
  p: Pick<
    Product,
    | "title" | "description_raw" | "category" | "ip_name" | "character_name"
    | "weight_g" | "weight_source"
    | "length_cm" | "width_cm" | "height_cm" | "dimension_source"
  >,
  ctx: EnrichContext
): Partial<Product> {
  const w = correctWeightAndDims(
    {
      weightG: p.weight_g,
      weightSource: p.weight_source,
      lengthCm: p.length_cm,
      widthCm: p.width_cm,
      heightCm: p.height_cm,
      dimensionSource: p.dimension_source,
      category: p.category,
    },
    ctx.categoryDefaults,
    ctx.settings.dummy_weight_values
  );

  const compliance = checkCompliance(
    {
      title: p.title,
      description: p.description_raw,
      category: p.category,
      ipName: p.ip_name,
      characterName: p.character_name,
    },
    ctx.keywords
  );

  return {
    weight_g: w.weightG,
    weight_source: w.weightSource,
    length_cm: w.lengthCm,
    width_cm: w.widthCm,
    height_cm: w.heightCm,
    dimension_source: w.dimensionSource,
    compliance_ip_caution: compliance.ipCaution,
    compliance_bootleg_suspect: compliance.bootlegSuspect,
    compliance_restricted_item: compliance.restrictedItem,
    compliance_notes: compliance.notes,
  };
}

/**
 * 市場別出品の価格計算パッチ。
 * enrichProduct 適用後の商品値 (補正済み重量) を渡すこと
 */
export function computeListingPatch(
  product: Pick<
    Product,
    "purchase_price_jpy" | "weight_g" | "length_cm" | "width_cm" | "height_cm"
  >,
  market: Market,
  existing: Pick<MarketListing, "listed_price"> | null,
  ctx: EnrichContext
): Partial<MarketListing> {
  const pricing = calculateMarketPricing(
    {
      purchasePriceJpy: product.purchase_price_jpy,
      listedPrice: existing?.listed_price ?? null,
      weightG: product.weight_g,
      lengthCm: product.length_cm,
      widthCm: product.width_cm,
      heightCm: product.height_cm,
    },
    market,
    ctx.settings,
    ctx.shippingRates
  );
  return {
    recommended_price: pricing.recommendedPrice,
    gross_margin_rate: pricing.grossMarginRate,
    margin_alert: pricing.marginAlert,
    pricing_breakdown: pricing.breakdown,
  };
}
