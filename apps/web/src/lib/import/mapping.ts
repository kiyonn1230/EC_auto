/**
 * xlsx列名 → 論理フィールドのマッピング。
 * Shopee一括アップロードテンプレート (ps_xxx|1|0 形式のフィールドコード) と
 * 汎用的な日本語/英語ヘッダーの両方を自動判別する。
 */

export type ProductField =
  | "sku"
  | "title"
  | "description"
  | "price"
  | "stock"
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

/** ヘッダー正規化: Shopeeの "|1|0" サフィックス除去・小文字化・空白/記号除去 */
export function normalizeHeader(h: string): string {
  return h
    .replace(/\|[\d|]+$/, "") // ps_product_name|1|0 → ps_product_name
    .toLowerCase()
    .replace(/[\s　_\-()（）:：*※]/g, "")
    .trim();
}

/**
 * Shopeeカテゴリ ID → 内部カテゴリ名 (category_defaultsのキー)。
 * ※現状の出品が全てフィギュアであることに基づく暫定マップ。必要に応じて追記する。
 */
export const SHOPEE_CATEGORY_MAP: Record<string, string> = {
  "101392": "フィギュア",
};

const PRODUCT_ALIASES: Record<ProductField, string[]> = {
  sku: [
    "ps_sku_parent_short", "ps_sku_short",
    "sku", "商品id", "管理番号", "メルカリid", "itemid", "id", "parent sku",
  ],
  title: ["ps_product_name", "商品名", "タイトル", "title", "product name", "name", "商品タイトル"],
  description: [
    "ps_product_description",
    "商品説明", "説明", "説明文", "description", "product description", "body", "商品詳細", "詳細",
  ],
  price: [
    "ps_price",
    "想定売値", "売値", "販売価格", "価格", "price", "販売予定価格",
    "出品価格", "想定販売価格", "sellingprice",
  ],
  stock: ["ps_stock", "在庫", "在庫数", "stock", "数量", "qty", "quantity"],
  category: ["ps_category", "カテゴリ", "カテゴリー", "category", "商品タイプ", "ジャンル"],
  ip_name: ["作品名", "作品", "ip", "シリーズ", "series", "タイトル名"],
  character_name: ["キャラ名", "キャラクター", "キャラクター名", "character", "キャラ"],
  weight: ["ps_weight", "重量", "重さ", "weight", "重量g", "重量kg", "グラム", "weightg"],
  dimensions: ["寸法", "サイズ", "dimensions", "size", "外寸"],
  length: ["ps_length", "長さ", "縦", "奥行", "奥行き", "length", "depth"],
  width: ["ps_width", "幅", "横", "width"],
  height: ["ps_height", "高さ", "height"],
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

/** Shopeeテンプレート固有で取込対象外の列 (unmapped警告を出さない)。
 *  normalizeHeader後 (小文字・アンダースコア除去済み) の形に対して照合する */
const IGNORED_HEADER_PATTERNS: RegExp[] = [
  /^psmaximumpurchase/,
  /^psminimumpurchase/,
  /^ettitlevariation/,
  /^ettitleoption/,
  /^psnewsizechart/,
  /^ettitlesizechart/,
  /^channelid/,
  /^psproductpreorder/,
  /^ettitlereason/,
  /^pshscode/,
  /^pstaxcode/,
  /^psbrand/,
  /^pstoolmassupload/,
];

/** 画像URL列の判定 (Cover / 画像1..N / ps_item_image_N / image_url 等、複数列対応) */
export function isImageHeader(h: string): boolean {
  const n = normalizeHeader(h);
  return /画像|image|cover|photo|写真|img/.test(n) && !/サイズ|寸法|sizechart/.test(n);
}

export interface HeaderMap<F extends string> {
  /** 論理フィールド → 実ヘッダー名 */
  fields: Partial<Record<F, string>>;
  /** 画像URL列 (元の並び順) */
  imageColumns: string[];
  /** どのフィールドにも一致しなかったヘッダー */
  unmapped: string[];
  /** 重量列の単位 (Shopeeはkg) */
  weightUnit: "g" | "kg";
  /** Shopeeテンプレート形式か (説明行スキップ等の挙動が変わる) */
  isShopeeTemplate: boolean;
}

function buildMap<F extends string>(
  headers: string[],
  aliases: Record<F, string[]>,
  withImages: boolean
): HeaderMap<F> {
  const fields: Partial<Record<F, string>> = {};
  const imageColumns: string[] = [];
  const unmapped: string[] = [];
  const isShopeeTemplate = headers.some((h) => /^(ps_|et_title_)/.test(h.trim()));

  for (const h of headers) {
    if (!h || !h.trim()) continue;
    if (withImages && isImageHeader(h)) {
      imageColumns.push(h);
      continue;
    }
    const n = normalizeHeader(h);
    if (IGNORED_HEADER_PATTERNS.some((re) => re.test(n))) continue;

    let matched: F | null = null;
    let aliasOfTakenField = false;
    for (const [field, list] of Object.entries(aliases) as [F, string[]][]) {
      if (list.some((a) => n === normalizeHeader(a))) {
        if (fields[field]) {
          aliasOfTakenField = true; // 先勝ちで確定済み (例: ps_sku_parent_short → ps_sku_short)
        } else {
          matched = field;
        }
        break;
      }
    }
    // 完全一致しなければ部分一致で救済 (Shopeeフィールドコードは完全一致のみ)
    if (!matched && !n.startsWith("ps") && !n.startsWith("ettitle")) {
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
    } else if (!aliasOfTakenField) {
      unmapped.push(h);
    }
  }

  const weightHeader = (fields as Partial<Record<string, string>>)["weight"];
  const wn = weightHeader ? normalizeHeader(weightHeader) : "";
  const weightUnit: "g" | "kg" = wn === "psweight" || wn.includes("kg") ? "kg" : "g";

  return { fields, imageColumns, unmapped, weightUnit, isShopeeTemplate };
}

export function mapProductHeaders(headers: string[]): HeaderMap<ProductField> {
  return buildMap(headers, PRODUCT_ALIASES, true);
}

export function mapCostHeaders(headers: string[]): HeaderMap<CostField> {
  return buildMap(headers, COST_ALIASES, false);
}
