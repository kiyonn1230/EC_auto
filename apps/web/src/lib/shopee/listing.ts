import * as XLSX from "xlsx";
import type { AppSettings, Market, MarketListing, Product, ProductImage } from "@/lib/types";

const MAX_IMAGES = 9; // Shopeeの上限

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** 出品に使える画像 (加工済み優先、なければ元URL) */
export function usableImageUrls(images: ProductImage[]): { urls: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const sorted = [...images].sort((a, b) => a.position - b.position);
  const urls = sorted
    .map((img) => (img.status === "success" && img.processed_url ? img.processed_url : img.source_url))
    .slice(0, MAX_IMAGES);
  const unprocessed = sorted.filter((i) => !(i.status === "success" && i.processed_url)).length;
  if (unprocessed > 0) {
    warnings.push(`未加工の画像${unprocessed}件は元URLをそのまま使用します`);
  }
  if (sorted.length > MAX_IMAGES) {
    warnings.push(`画像が${sorted.length}件ありますがShopee上限の${MAX_IMAGES}件に切り詰めます`);
  }
  return { urls, warnings };
}

/** 説明文: プレーンテキスト + 発送目安の定型文 (Shopeeの説明はプレーンテキスト) */
export function buildDescription(product: Product, settings: AppSettings): string {
  const parts: string[] = [];
  if (product.description_raw) {
    parts.push(product.description_raw);
  } else if (product.description_html) {
    parts.push(stripHtml(product.description_html));
  }
  if (settings.shipping_note_text) parts.push(settings.shipping_note_text);
  let desc = parts.join("\n\n").trim();
  // Shopeeは20文字以上が必要。短すぎる場合は定型文で底上げ
  if (desc.length < 20) {
    desc = `${product.title}\n\n${settings.shipping_note_text}`.trim();
  }
  return desc.slice(0, 3000);
}

/**
 * Shopee一括アップロードテンプレートへ「貼り付けるための」xlsx生成。
 * 公式テンプレートはバージョンハッシュ入りで自前生成すると弾かれるため、
 * Template シートと同じ列順のデータ行を出力し、ユーザーが公式テンプレの
 * データ行位置 (7行目以降) にコピペしてアップロードする運用にする。
 */
const TEMPLATE_COLUMNS = [
  "ps_category",
  "ps_product_name",
  "ps_product_description",
  "ps_maximum_purchase_quantity",
  "ps_maximum_purchase_quantity_start_date",
  "ps_maximum_purchase_quantity_time_period",
  "ps_maximum_purchase_quantity_end_date",
  "ps_minimum_purchase_quantity",
  "ps_sku_parent_short",
  "et_title_variation_integration_no",
  "et_title_variation_1",
  "et_title_option_for_variation_1",
  "et_title_image_per_variation",
  "et_title_variation_2",
  "et_title_option_for_variation_2",
  "ps_price",
  "ps_stock",
  "ps_sku_short",
  "ps_new_size_chart",
  "et_title_size_chart",
  "ps_item_cover_image",
  "ps_item_image_1",
  "ps_item_image_2",
  "ps_item_image_3",
  "ps_item_image_4",
  "ps_item_image_5",
  "ps_item_image_6",
  "ps_item_image_7",
  "ps_item_image_8",
  "ps_weight",
  "ps_length",
  "ps_width",
  "ps_height",
  "channel_id",
  "ps_product_pre_order_dts",
  "et_title_reason",
] as const;

export function buildBulkUploadXlsx(
  rows: {
    product: Product;
    listing: MarketListing;
    market: Market;
    images: ProductImage[];
  }[],
  settings: AppSettings
): ArrayBuffer {
  const aoa: (string | number | null)[][] = [
    [...TEMPLATE_COLUMNS],
    // 2行目: 人間向けの注意書き
    [
      "ShopeeカテゴリID", "商品名", "説明", ...Array(5).fill(null),
      "SKU(ASIN)", ...Array(6).fill(null),
      "売値", "在庫", "SKU(ASIN)", null, null,
      "メイン画像", ...Array(8).fill("追加画像"),
      "重量kg", "長cm", "幅cm", "高cm", "配送チャネルOn", "発送日数DTS", null,
    ],
  ];

  for (const { product, listing, market, images } of rows) {
    const { urls } = usableImageUrls(images);
    const price = listing.listed_price ?? listing.recommended_price;
    const row: (string | number | null)[] = new Array(TEMPLATE_COLUMNS.length).fill(null);
    row[0] = product.shopee_category_id ?? null;
    row[1] = product.title;
    row[2] = buildDescription(product, settings);
    row[8] = product.sku;
    row[15] = price !== null ? Math.round(price * 100) / 100 : null;
    row[16] = listing.stock;
    row[17] = product.sku;
    row[20] = urls[0] ?? null;
    for (let i = 0; i < 8; i++) row[21 + i] = urls[i + 1] ?? null;
    row[29] = product.weight_g ? Math.round((product.weight_g / 1000) * 100) / 100 : null;
    row[30] = product.length_cm ?? null;
    row[31] = product.width_cm ?? null;
    row[32] = product.height_cm ?? null;
    row[33] = "On";
    row[34] = market.days_to_ship;
    aoa.push(row);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "PasteRows");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
