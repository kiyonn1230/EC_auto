import type { ShopifyProductPayload } from "./payload";

/**
 * Shopify標準インポートCSV (6a)。
 * ※ヘッダーは現行標準仕様の仮実装。ユーザーのストアからエクスポートした
 *   サンプルCSVを受領したら、そのヘッダーに厳密に合わせて調整すること。
 */
export const SHOPIFY_CSV_HEADERS = [
  "Handle",
  "Title",
  "Body (HTML)",
  "Vendor",
  "Product Category",
  "Type",
  "Tags",
  "Published",
  "Option1 Name",
  "Option1 Value",
  "Variant SKU",
  "Variant Grams",
  "Variant Inventory Tracker",
  "Variant Inventory Qty",
  "Variant Inventory Policy",
  "Variant Fulfillment Service",
  "Variant Price",
  "Variant Compare At Price",
  "Variant Requires Shipping",
  "Variant Taxable",
  "Image Src",
  "Image Position",
  "Image Alt Text",
  "SEO Title",
  "SEO Description",
  "Status",
  "Cost per item",
  "Variant Weight Unit",
] as const;

type CsvRow = Record<(typeof SHOPIFY_CSV_HEADERS)[number], string>;

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function emptyRow(): CsvRow {
  return Object.fromEntries(SHOPIFY_CSV_HEADERS.map((h) => [h, ""])) as CsvRow;
}

/**
 * 1商品 → CSV行群。1枚目の画像は商品行に、2枚目以降は
 * 「同じHandle + Image Src/Position のみ」の追加行で表現する (Shopify仕様)。
 */
export function payloadToCsvRows(p: ShopifyProductPayload): CsvRow[] {
  const first = emptyRow();
  first["Handle"] = p.handle;
  first["Title"] = p.title;
  first["Body (HTML)"] = p.bodyHtml;
  first["Vendor"] = p.vendor;
  first["Type"] = p.productType;
  first["Tags"] = p.tags.join(", ");
  first["Published"] = p.status === "active" ? "TRUE" : "FALSE";
  first["Option1 Name"] = "Title";
  first["Option1 Value"] = "Default Title";
  first["Variant SKU"] = p.variant.sku;
  first["Variant Grams"] = String(p.variant.grams);
  first["Variant Inventory Tracker"] = "shopify";
  first["Variant Inventory Qty"] = String(p.variant.inventoryQty);
  first["Variant Inventory Policy"] = p.variant.inventoryPolicy;
  first["Variant Fulfillment Service"] = "manual";
  first["Variant Price"] = p.variant.price !== null ? p.variant.price.toFixed(2) : "";
  first["Variant Compare At Price"] =
    p.variant.compareAtPrice !== null ? p.variant.compareAtPrice.toFixed(2) : "";
  first["Variant Requires Shipping"] = "TRUE";
  first["Variant Taxable"] = "TRUE";
  first["SEO Title"] = p.seoTitle;
  first["SEO Description"] = p.seoDescription;
  first["Status"] = p.status;
  first["Cost per item"] =
    p.variant.costPerItem !== null ? p.variant.costPerItem.toFixed(2) : "";
  first["Variant Weight Unit"] = p.variant.weightUnit;

  if (p.images.length > 0) {
    first["Image Src"] = p.images[0].src;
    first["Image Position"] = "1";
    first["Image Alt Text"] = p.images[0].altText;
  }

  const rows: CsvRow[] = [first];
  for (const img of p.images.slice(1)) {
    const r = emptyRow();
    r["Handle"] = p.handle;
    r["Image Src"] = img.src;
    r["Image Position"] = String(img.position);
    r["Image Alt Text"] = img.altText;
    rows.push(r);
  }
  return rows;
}

export function payloadsToCsv(payloads: ShopifyProductPayload[]): string {
  const lines: string[] = [SHOPIFY_CSV_HEADERS.join(",")];
  for (const p of payloads) {
    for (const row of payloadToCsvRows(p)) {
      lines.push(SHOPIFY_CSV_HEADERS.map((h) => csvEscape(row[h])).join(","));
    }
  }
  return "﻿" + lines.join("\r\n") + "\r\n"; // BOM付きUTF-8 (Excel互換)
}
