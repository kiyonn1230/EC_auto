import type { Product } from "@/lib/types";
import type { EnrichContext } from "@/lib/settings";
import { correctWeightAndDims } from "@/lib/weight/correct";
import { calculatePricing } from "@/lib/pricing/engine";
import { checkCompliance } from "@/lib/compliance/check";

/**
 * 商品1件に対して 重量補正 → 粗利計算 → コンプラ検査 を実行し、
 * products への更新パッチを返す (取込時と一括再計算で共用)。
 */
export function enrichProduct(
  p: Pick<
    Product,
    | "title" | "description_raw" | "category" | "ip_name" | "character_name"
    | "purchase_price_jpy" | "current_listed_price"
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

  const pricing = calculatePricing(
    {
      purchasePriceJpy: p.purchase_price_jpy,
      currentListedPrice: p.current_listed_price,
      weightG: w.weightG,
      lengthCm: w.lengthCm,
      widthCm: w.widthCm,
      heightCm: w.heightCm,
    },
    ctx.settings,
    ctx.shippingRates
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
    recommended_price: pricing.recommendedPrice,
    gross_margin_amount: pricing.grossMarginAmount,
    gross_margin_rate: pricing.grossMarginRate,
    margin_alert: pricing.marginAlert,
    pricing_breakdown: pricing.breakdown,
    compliance_ip_caution: compliance.ipCaution,
    compliance_bootleg_suspect: compliance.bootlegSuspect,
    compliance_restricted_item: compliance.restrictedItem,
    compliance_notes: compliance.notes,
  };
}
