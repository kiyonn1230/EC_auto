import type { AppSettings, Product, ProductImage } from "@/lib/types";
import { generateHandle } from "@/lib/import/clean";

/** CSV出力(6a)とAdmin API出力(6b)が共有する中間モデル */
export interface ShopifyProductPayload {
  handle: string;
  title: string;
  bodyHtml: string;
  vendor: string;
  productType: string;
  tags: string[];
  status: "draft" | "active";
  seoTitle: string;
  seoDescription: string;
  variant: {
    sku: string;
    grams: number;
    price: number | null;
    compareAtPrice: number | null;
    inventoryQty: number;
    inventoryPolicy: "continue" | "deny";
    costPerItem: number | null; // ストア通貨換算の仕入原価
    requiresShipping: true;
    taxable: true;
    weightUnit: "g";
  };
  images: { src: string; position: number; altText: string }[];
  warnings: string[];
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * products + product_images → ShopifyProductPayload。
 * - 画像は加工済み(processed_url)優先。未処理は警告付きで除外
 * - 説明文には予約販売の発送目安定型文を付加
 * - Cost per item = 仕入原価JPY / 為替
 */
export function buildPayload(
  product: Product,
  images: ProductImage[],
  settings: AppSettings
): ShopifyProductPayload {
  const warnings: string[] = [];
  const sp = settings.shopify_settings;

  const usable = images
    .filter((img) => img.status === "success" && img.processed_url)
    .sort((a, b) => a.position - b.position);
  const skipped = images.length - usable.length;
  if (skipped > 0) warnings.push(`未処理/失敗の画像${skipped}件を除外しました`);
  if (usable.length === 0) warnings.push("使用可能な加工済み画像がありません");

  const bodyParts: string[] = [];
  if (product.description_html) bodyParts.push(product.description_html);
  if (settings.preorder_note_html) bodyParts.push(settings.preorder_note_html);
  const bodyHtml = bodyParts.join("\n");

  const price = product.recommended_price ?? product.current_listed_price;
  if (price === null) warnings.push("売値が未確定です (推奨売値も現状売値もなし)");

  const costPerItem =
    product.purchase_price_jpy !== null && settings.fx_rate_jpy_per_store > 0
      ? Math.round((product.purchase_price_jpy / settings.fx_rate_jpy_per_store) * 100) / 100
      : null;
  if (costPerItem === null) warnings.push("仕入原価が未設定のため Cost per item が空になります");

  const grams = Math.round(product.weight_g ?? 0);
  if (grams === 0) warnings.push("重量が0gです");

  const plainDesc = product.description_html ? stripHtml(product.description_html) : "";

  return {
    handle: product.shopify_handle ?? generateHandle(product.title, product.sku),
    title: product.title,
    bodyHtml,
    vendor: sp.vendor,
    productType: sp.default_product_type,
    tags: product.tags,
    status: sp.default_status,
    seoTitle: product.title.slice(0, 70),
    seoDescription: plainDesc.slice(0, 320),
    variant: {
      sku: product.sku,
      grams,
      price,
      compareAtPrice: null,
      inventoryQty: product.inventory_qty,
      inventoryPolicy: sp.inventory_policy,
      costPerItem,
      requiresShipping: true,
      taxable: true,
      weightUnit: "g",
    },
    images: usable.map((img, idx) => ({
      src: img.processed_url!,
      position: idx + 1,
      altText: product.title,
    })),
    warnings,
  };
}
