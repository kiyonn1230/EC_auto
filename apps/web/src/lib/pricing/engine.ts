import type { AppSettings, Market, PricingBreakdown, ShippingRate } from "@/lib/types";

export interface PricingInput {
  purchasePriceJpy: number | null;   // Amazon価格
  listedPrice: number | null;        // 実際の出品価格 (市場通貨, 粗利率評価用)
  weightG: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
}

export interface PricingResult {
  recommendedPrice: number | null;   // 市場通貨
  grossMarginRate: number | null;    // listedPrice(なければ推奨売値)ベース
  marginAlert: boolean;
  breakdown: PricingBreakdown;
}

/** 容積重量(g) = L×W×H(cm3) / divisor × 1000 */
export function volumetricWeightG(
  l: number | null, w: number | null, h: number | null, divisor: number
): number | null {
  if (l === null || w === null || h === null || divisor <= 0) return null;
  if (l <= 0 || w <= 0 || h <= 0) return null;
  return Math.round(((l * w * h) / divisor) * 1000);
}

/** 送料テーブルlookup。上限超過は最大ブラケット料金+警告 */
function lookupIntlShipping(
  weightG: number,
  carrier: string,
  rates: ShippingRate[],
  warnings: string[]
): number {
  const table = rates
    .filter((r) => r.carrier === carrier)
    .sort((a, b) => a.weight_from_g - b.weight_from_g);
  if (table.length === 0) {
    warnings.push(`送料テーブルにキャリア「${carrier}」の料金がありません`);
    return 0;
  }
  const hit = table.find((r) => weightG >= r.weight_from_g && weightG <= r.weight_to_g);
  if (hit) return hit.price_jpy;
  const max = table[table.length - 1];
  if (weightG > max.weight_to_g) {
    warnings.push(
      `重量${weightG}gが送料テーブル上限(${max.weight_to_g}g)を超過。最大料金で仮計算`
    );
    return max.price_jpy;
  }
  return table[0].price_jpy;
}

/**
 * 市場別の推奨売値逆算:
 *   総原価(市場通貨) = (Amazon価格 + 国内固定費 + 国際送料) / fx
 *   推奨売値 = 総原価 / (1 - Shopee手数料率 - 目標粗利率)
 * 粗利率 = (売値×(1-手数料率) - 総原価) / 売値
 */
export function calculateMarketPricing(
  input: PricingInput,
  market: Market,
  settings: Pick<AppSettings, "volumetric_divisor" | "amazon_domestic_shipping_jpy">,
  rates: ShippingRate[]
): PricingResult {
  const warnings: string[] = [];
  const fx = market.fx_rate_jpy;
  const fee = market.fee_rate;
  const target = market.target_margin_rate;
  const domestic = market.domestic_cost_jpy + settings.amazon_domestic_shipping_jpy;

  const purchase = input.purchasePriceJpy ?? 0;
  if (input.purchasePriceJpy === null) {
    warnings.push("Amazon価格が未設定 (原価0で仮計算)");
  }

  const volG = volumetricWeightG(
    input.lengthCm, input.widthCm, input.heightCm, settings.volumetric_divisor
  );
  const actualG = input.weightG ?? 0;
  if (input.weightG === null) warnings.push("重量が未設定");
  const chargeableG = Math.max(actualG, volG ?? 0);

  const intl = chargeableG > 0
    ? lookupIntlShipping(chargeableG, market.shipping_carrier, rates, warnings)
    : 0;
  if (chargeableG === 0) warnings.push("重量・寸法とも不明のため国際送料を0で仮計算");

  const totalJpy = purchase + domestic + intl;
  const totalMarket = fx > 0 ? totalJpy / fx : 0;
  if (fx <= 0) warnings.push("為替レートが不正です");

  const denominator = 1 - fee - target;
  let recommendedPrice: number | null = null;
  if (denominator > 0.01) {
    recommendedPrice = Math.ceil((totalMarket / denominator) * 100) / 100;
  } else {
    warnings.push("手数料率+目標粗利率が100%近くのため推奨売値を計算できません");
  }

  const evalPrice = input.listedPrice ?? recommendedPrice;
  let grossMarginRate: number | null = null;
  let marginAlert = false;
  if (evalPrice !== null && evalPrice > 0) {
    const marginAmount = evalPrice * (1 - fee) - totalMarket;
    grossMarginRate = Math.round((marginAmount / evalPrice) * 1000) / 1000;
    marginAlert = marginAmount < 0;
  }

  return {
    recommendedPrice,
    grossMarginRate,
    marginAlert,
    breakdown: {
      purchase_price_jpy: purchase,
      domestic_cost_jpy: domestic,
      intl_shipping_jpy: intl,
      chargeable_weight_g: chargeableG,
      volumetric_weight_g: volG,
      total_cost_jpy: totalJpy,
      total_cost_market: Math.round(totalMarket * 100) / 100,
      fx_rate_jpy: fx,
      fee_rate: fee,
      target_margin_rate: target,
      carrier: market.shipping_carrier,
      currency: market.currency,
      warnings,
    },
  };
}
