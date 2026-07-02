import type { AppSettings, PricingBreakdown, ShippingRate } from "@/lib/types";

export interface PricingInput {
  purchasePriceJpy: number | null;
  currentListedPrice: number | null; // ストア通貨
  weightG: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
}

export interface PricingResult {
  recommendedPrice: number | null;
  grossMarginAmount: number | null; // 現状売値ベース (ストア通貨)
  grossMarginRate: number | null;
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
 * 推奨売値の逆算:
 *   総原価Store = (仕入 + 国内送料 + 国際送料) / fx
 *   推奨売値 = 総原価Store / (1 - 決済手数料率 - 目標粗利率)
 * 現状売値の粗利率 = (売値×(1-手数料) - 総原価Store) / 売値
 */
export function calculatePricing(
  input: PricingInput,
  settings: AppSettings,
  rates: ShippingRate[]
): PricingResult {
  const warnings: string[] = [];
  const {
    fx_rate_jpy_per_store: fx,
    payment_fee_rate: fee,
    target_margin_rate: target,
    domestic_shipping_jpy: domestic,
    volumetric_divisor: divisor,
    default_carrier: carrier,
    store_currency,
  } = settings;

  const purchase = input.purchasePriceJpy ?? 0;
  if (input.purchasePriceJpy === null) {
    warnings.push("仕入価格が未設定 (原価0で仮計算)");
  }

  const volG = volumetricWeightG(input.lengthCm, input.widthCm, input.heightCm, divisor);
  const actualG = input.weightG ?? 0;
  if (input.weightG === null) warnings.push("重量が未設定");
  const chargeableG = Math.max(actualG, volG ?? 0);

  const intl = chargeableG > 0
    ? lookupIntlShipping(chargeableG, carrier, rates, warnings)
    : 0;
  if (chargeableG === 0) warnings.push("重量・寸法とも不明のため国際送料を0で仮計算");

  const totalJpy = purchase + domestic + intl;
  const totalStore = fx > 0 ? totalJpy / fx : 0;
  if (fx <= 0) warnings.push("為替レートが不正です");

  const denominator = 1 - fee - target;
  let recommendedPrice: number | null = null;
  if (denominator > 0.01) {
    recommendedPrice = Math.ceil((totalStore / denominator) * 100) / 100;
  } else {
    warnings.push("手数料率+目標粗利率が100%近くのため推奨売値を計算できません");
  }

  let grossMarginAmount: number | null = null;
  let grossMarginRate: number | null = null;
  let marginAlert = false;
  const listed = input.currentListedPrice;
  if (listed !== null && listed > 0) {
    grossMarginAmount = Math.round((listed * (1 - fee) - totalStore) * 100) / 100;
    grossMarginRate = Math.round((grossMarginAmount / listed) * 1000) / 1000;
    marginAlert = grossMarginAmount < 0;
  } else {
    warnings.push("現状売値が未設定のため粗利を計算できません");
  }

  return {
    recommendedPrice,
    grossMarginAmount,
    grossMarginRate,
    marginAlert,
    breakdown: {
      purchase_price_jpy: purchase,
      domestic_shipping_jpy: domestic,
      intl_shipping_jpy: intl,
      chargeable_weight_g: chargeableG,
      volumetric_weight_g: volG,
      total_cost_jpy: totalJpy,
      total_cost_store: Math.round(totalStore * 100) / 100,
      fx_rate_jpy_per_store: fx,
      payment_fee_rate: fee,
      target_margin_rate: target,
      carrier,
      store_currency,
      warnings,
    },
  };
}
