/**
 * xlsx列名 → 論理フィールドのマッピング。
 * 実ファイルの列構成が想定とズレている場合はここのエイリアスを追加する。
 * (実サンプル未受領のため仮エイリアス。受領後に要調整)
 */

export type ProductField =
  | "sku"
  | "title"
  | "description"
  | "price"
  | "category"
  | "ip_name"
  | "character_name"
  | "weight"
  | "dimensions"
  | "length"
  | "width"
  | "height";

export type CostField =
  | "sku"
  | "purchase_price"
  | "weight"
  | "dimensions"
  | "length"
  | "width"
  | "height";

/** ヘッダー正規化: 小文字化・空白/括弧/記号除去 */
export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[\s　_\-()（）:：*※]/g, "")
    .trim();
}

const PRODUCT_ALIASES: Record<ProductField, string[]> = {
  sku: ["sku", "商品id", "管理番号", "メルカリid", "itemid", "id"],
  title: ["商品名", "タイトル", "title", "name", "商品タイトル"],
  description: ["商品説明", "説明", "説明文", "description", "body", "商品詳細", "詳細"],
  price: [
    "想定売値", "売値", "販売価格", "価格", "price", "販売予定価格",
    "出品価格", "想定販売価格", "sellingprice",
  ],
  category: ["カテゴリ", "カテゴリー", "category", "商品タイプ", "type", "ジャンル"],
  ip_name: ["作品名", "作品", "ip", "シリーズ", "series", "タイトル名"],
  character_name: ["キャラ名", "キャラクター", "キャラクター名", "character", "キャラ"],
  weight: ["重量", "重さ", "weight", "重量g", "グラム", "weightg"],
  dimensions: ["寸法", "サイズ", "dimensions", "size", "外寸"],
  length: ["長さ", "縦", "奥行", "奥行き", "length", "depth"],
  width: ["幅", "横", "width"],
  height: ["高さ", "height"],
};

const COST_ALIASES: Record<CostField, string[]> = {
  sku: ["sku", "商品id", "管理番号", "メルカリid", "itemid", "id"],
  purchase_price: [
    "仕入価格", "仕入れ価格", "仕入値", "原価", "仕入金額", "仕入価格jpy",
    "cost", "purchaseprice", "仕入", "仕入額",
  ],
  weight: ["実重量", "重量", "実重量g", "weight", "重さ", "グラム"],
  dimensions: ["実寸法", "寸法", "サイズ", "dimensions", "size", "外寸"],
  length: ["長さ", "縦", "奥行", "奥行き", "length", "depth"],
  width: ["幅", "横", "width"],
  height: ["高さ", "height"],
};

/** 画像URL列の判定 (Cover / 画像1..N / image_url 等、複数列対応) */
export function isImageHeader(h: string): boolean {
  const n = normalizeHeader(h);
  return /画像|image|cover|photo|写真|img/.test(n) && !/サイズ|寸法/.test(n);
}

export interface HeaderMap<F extends string> {
  /** 論理フィールド → 実ヘッダー名 */
  fields: Partial<Record<F, string>>;
  /** 画像URL列 (元の並び順) */
  imageColumns: string[];
  /** どのフィールドにも一致しなかったヘッダー */
  unmapped: string[];
}

function buildMap<F extends string>(
  headers: string[],
  aliases: Record<F, string[]>,
  withImages: boolean
): HeaderMap<F> {
  const fields: Partial<Record<F, string>> = {};
  const imageColumns: string[] = [];
  const unmapped: string[] = [];

  for (const h of headers) {
    if (!h || !h.trim()) continue;
    if (withImages && isImageHeader(h)) {
      imageColumns.push(h);
      continue;
    }
    const n = normalizeHeader(h);
    let matched: F | null = null;
    for (const [field, list] of Object.entries(aliases) as [F, string[]][]) {
      if (fields[field]) continue; // 先勝ち
      if (list.some((a) => n === normalizeHeader(a))) {
        matched = field;
        break;
      }
    }
    // 完全一致しなければ部分一致で救済
    if (!matched) {
      for (const [field, list] of Object.entries(aliases) as [F, string[]][]) {
        if (fields[field]) continue;
        if (list.some((a) => {
          const na = normalizeHeader(a);
          return na.length >= 2 && n.includes(na);
        })) {
          matched = field;
          break;
        }
      }
    }
    if (matched) {
      fields[matched] = h;
    } else {
      unmapped.push(h);
    }
  }
  return { fields, imageColumns, unmapped };
}

export function mapProductHeaders(headers: string[]): HeaderMap<ProductField> {
  return buildMap(headers, PRODUCT_ALIASES, true);
}

export function mapCostHeaders(headers: string[]): HeaderMap<CostField> {
  return buildMap(headers, COST_ALIASES, false);
}
