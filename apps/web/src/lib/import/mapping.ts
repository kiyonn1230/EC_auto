/**
 * Amazon仕入れリスト (ASIN Pickエクスポート / 手動xlsx) の列名 → 論理フィールドのマッピング。
 * 列構成が変わってもエイリアス追加だけで対応できるようにする。
 * ※ASIN Pickの実エクスポートは未受領のため想定エイリアス。サンプル受領後に要調整。
 * 同梱テンプレート: apps/web/public/templates/amazon-products-template.xlsx
 */

export type ProductField =
  | "asin"
  | "title"
  | "description"
  | "purchase_price"   // Amazon価格 (JPY)
  | "amazon_url"
  | "category"
  | "shopee_category_id"
  | "ip_name"
  | "character_name"
  | "weight"
  | "dimensions"
  | "length"
  | "width"
  | "height"
  | "stock_status"
  | "note";

/** ヘッダー正規化: 小文字化・空白/記号除去 */
export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[\s　_\-()（）:：*※]/g, "")
    .trim();
}

const PRODUCT_ALIASES: Record<ProductField, string[]> = {
  asin: ["asin", "sku", "商品id", "管理番号", "id"],
  title: ["商品名", "タイトル", "title", "name", "商品タイトル", "product name"],
  description: ["商品説明", "説明", "説明文", "description", "商品詳細", "詳細"],
  purchase_price: [
    "amazon価格", "amazon価格jpy", "仕入価格", "仕入れ価格", "仕入値", "原価",
    "仕入金額", "価格", "price", "amazonprice", "仕入",
    "カート価格", "現在価格", "新品価格", "新品最安値", "最安値", "販売価格",
  ],
  amazon_url: ["amazonurl", "url", "リンク", "amazonリンク", "link", "商品url", "商品ページurl", "ページurl"],
  category: ["カテゴリ", "カテゴリー", "category", "商品タイプ", "ジャンル"],
  shopee_category_id: [
    "shopeeカテゴリid", "shopeeカテゴリ", "shopeecategoryid", "categoryid", "カテゴリid",
  ],
  ip_name: ["作品名", "作品", "ip", "シリーズ", "series", "ブランド", "brand", "メーカー", "manufacturer"],
  character_name: ["キャラ名", "キャラクター", "キャラクター名", "character", "キャラ"],
  weight: ["重量", "重さ", "weight", "重量g", "重量kg", "グラム", "weightg"],
  dimensions: ["寸法", "サイズ", "dimensions", "size", "外寸"],
  length: ["長さ", "縦", "奥行", "奥行き", "length", "depth"],
  width: ["幅", "横", "width"],
  height: ["高さ", "height"],
  stock_status: ["在庫", "在庫状況", "amazon在庫", "stock", "在庫有無"],
  note: ["メモ", "備考", "note", "memo", "notes"],
};

/** ASIN Pick等の指標列 (取込対象外。unmapped警告を出さない)。
 *  normalizeHeader後の形に対して照合。「参考価格」等が price に部分一致で
 *  誤マップされるのを防ぐ役割も兼ねる */
const IGNORED_HEADER_PATTERNS: RegExp[] = [
  /ランキング|セールスランク|salesrank/,
  /レビュー|review/,
  /評価|rating|星/,
  /出品者|セラー|seller/,
  /参考価格|定価|希望小売/,
  /ポイント|クーポン|point|coupon/,
  /発売日|releasedate/,
  /^jan|^ean|^upc/,
  /型番|モデル番号|modelnumber/,
  /fba|手数料/,
  /月間販売|販売数|売上/,
];

/** 画像URL列の判定 (画像 / 画像1..N / image / cover 等、複数列対応) */
export function isImageHeader(h: string): boolean {
  const n = normalizeHeader(h);
  return /画像|image|cover|photo|写真|img/.test(n) && !/サイズ|寸法/.test(n);
}

export interface HeaderMap {
  /** 論理フィールド → 実ヘッダー名 */
  fields: Partial<Record<ProductField, string>>;
  /** 画像URL列 (元の並び順) */
  imageColumns: string[];
  /** どのフィールドにも一致しなかったヘッダー */
  unmapped: string[];
  /** 重量列の単位 (「重量kg」ならkg) */
  weightUnit: "g" | "kg";
}

export function mapProductHeaders(headers: string[]): HeaderMap {
  const fields: Partial<Record<ProductField, string>> = {};
  const imageColumns: string[] = [];
  const unmapped: string[] = [];

  for (const h of headers) {
    if (!h || !h.trim()) continue;
    if (isImageHeader(h)) {
      imageColumns.push(h);
      continue;
    }
    const n = normalizeHeader(h);
    if (IGNORED_HEADER_PATTERNS.some((re) => re.test(n))) continue;

    let matched: ProductField | null = null;
    let aliasOfTakenField = false;
    for (const [field, list] of Object.entries(PRODUCT_ALIASES) as [ProductField, string[]][]) {
      if (list.some((a) => n === normalizeHeader(a))) {
        if (fields[field]) {
          aliasOfTakenField = true; // 先勝ちで確定済み
        } else {
          matched = field;
        }
        break;
      }
    }
    // 完全一致しなければ部分一致で救済
    if (!matched && !aliasOfTakenField) {
      for (const [field, list] of Object.entries(PRODUCT_ALIASES) as [ProductField, string[]][]) {
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

  const wn = fields.weight ? normalizeHeader(fields.weight) : "";
  const weightUnit: "g" | "kg" = wn.includes("kg") ? "kg" : "g";

  return { fields, imageColumns, unmapped, weightUnit };
}
