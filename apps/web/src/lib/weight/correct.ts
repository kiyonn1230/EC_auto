import type { CategoryDefault, WeightSource } from "@/lib/types";

export interface WeightInput {
  weightG: number | null;
  weightSource: WeightSource | null; // 'measured' は(B)実測由来。上書きしない
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  dimensionSource: WeightSource | null;
  category: string | null;
}

export interface WeightResult {
  weightG: number | null;
  weightSource: WeightSource;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  dimensionSource: WeightSource;
  corrected: boolean; // 補完・置換が発生したか (UI表示用フラグ)
}

const FALLBACK_CATEGORY = "その他";

function findDefault(
  category: string | null,
  defaults: CategoryDefault[]
): CategoryDefault | null {
  if (category) {
    const exact = defaults.find((d) => d.category === category);
    if (exact) return exact;
    // 部分一致 (例: カテゴリ「フィギュア/スケール」→ 既定値「フィギュア」)
    const partial = defaults.find(
      (d) => category.includes(d.category) || d.category.includes(category)
    );
    if (partial) return partial;
  }
  return defaults.find((d) => d.category === FALLBACK_CATEGORY) ?? null;
}

/**
 * ダミー値・空欄を検知してカテゴリ既定値で補完。
 * (B)実測由来 (source='measured') の値はダミー値チェックのみ行い、原則そのまま使う。
 */
export function correctWeightAndDims(
  input: WeightInput,
  defaults: CategoryDefault[],
  dummyValues: number[]
): WeightResult {
  const def = findDefault(input.category, defaults);
  let corrected = false;

  // ---- 重量 ----
  let weightG = input.weightG;
  let weightSource: WeightSource;
  const isDummy = weightG !== null && dummyValues.includes(weightG);
  const isMissing = weightG === null || weightG <= 0;

  // (B)実測・手動入力の値はダミー値と同値でも信頼して使う
  if (input.weightSource === "measured" && !isMissing) {
    weightSource = "measured";
  } else if (isDummy || isMissing) {
    if (def) {
      weightG = def.default_weight_g;
      weightSource = isDummy ? "dummy_detected" : "category_default";
    } else {
      weightG = null;
      weightSource = "missing";
    }
    corrected = true;
  } else {
    // (A)由来の値がそのまま使える場合も「実測ではない」ことを区別する
    weightSource = input.weightSource ?? "category_default";
  }

  // ---- 寸法 ----
  let { lengthCm, widthCm, heightCm } = input;
  let dimensionSource: WeightSource;
  const dimsMissing =
    lengthCm === null || widthCm === null || heightCm === null ||
    lengthCm <= 0 || widthCm <= 0 || heightCm <= 0;
  // Shopeeエクスポート等でよくある 1x1x1 のダミー寸法
  const dimsDummy = lengthCm === 1 && widthCm === 1 && heightCm === 1;

  if (input.dimensionSource === "measured" && !dimsMissing) {
    dimensionSource = "measured";
  } else if (dimsMissing || dimsDummy) {
    if (def && def.default_length_cm && def.default_width_cm && def.default_height_cm) {
      lengthCm = def.default_length_cm;
      widthCm = def.default_width_cm;
      heightCm = def.default_height_cm;
      dimensionSource = dimsDummy ? "dummy_detected" : "category_default";
    } else {
      dimensionSource = "missing";
    }
    corrected = true;
  } else {
    dimensionSource = input.dimensionSource ?? "category_default";
  }

  return { weightG, weightSource, lengthCm, widthCm, heightCm, dimensionSource, corrected };
}
