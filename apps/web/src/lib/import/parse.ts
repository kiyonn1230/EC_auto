/**
 * xlsx → 論理レコードへの純粋な変換層 (DBアクセスなし)。
 * Shopeeテンプレートの複数シート/説明行/kg重量/プレースホルダ画像に対応。
 */
import * as XLSX from "xlsx";
import {
  cleanText,
  extractImageUrls,
  parseDimensions,
  parseNumber,
} from "./clean";
import {
  HeaderMap,
  mapCostHeaders,
  mapProductHeaders,
  SHOPEE_CATEGORY_MAP,
  type CostField,
  type ProductField,
} from "./mapping";
import type { IssueDraft } from "./ingest";

/** dummyimage.com 等のプレースホルダ画像URL (取込しない) */
const PLACEHOLDER_IMAGE_RE = /dummyimage\.com|placehold(er)?\.|via\.placeholder/i;

export interface ParsedProductRow {
  rowNumber: number; // xlsx上の行番号 (1-origin)
  sku: string;
  title: string;
  description: string | null;
  price: number | null;
  stock: number | null;
  category: string | null;
  ipName: string | null;
  characterName: string | null;
  weightG: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  imageUrls: string[];
}

export interface ParsedCostRow {
  rowNumber: number;
  sku: string;
  purchasePriceJpy: number;
  weightG: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
}

interface SheetData {
  sheetName: string;
  headers: string[];
  rows: Record<string, unknown>[];
}

function readSheets(buf: ArrayBuffer): SheetData[] {
  const wb = XLSX.read(buf, { type: "array" });
  return wb.SheetNames.map((sheetName) => {
    const sheet = wb.Sheets[sheetName];
    const headerRow = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 })[0] ?? [];
    const headers = (headerRow as unknown[]).map((h) => String(h ?? "").trim());
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: undefined,
      raw: true,
    });
    return { sheetName, headers, rows };
  });
}

/** 必須フィールドが見つかるシートを選ぶ (Guidance等の説明シートを避ける) */
function pickSheet<F extends string>(
  sheets: SheetData[],
  buildMap: (headers: string[]) => HeaderMap<F>,
  requiredFields: NoInfer<F>[]
): { sheet: SheetData; map: HeaderMap<F> } {
  let best: { sheet: SheetData; map: HeaderMap<F>; score: number } | null = null;
  for (const sheet of sheets) {
    const map = buildMap(sheet.headers);
    const hasRequired = requiredFields.every((f) => map.fields[f]);
    if (!hasRequired) continue;
    // 必須フィールドが全て埋まっている行数を重視 (見本シートよりデータシートを選ぶ)
    const dataLikeRows = sheet.rows.filter((row) =>
      requiredFields.every((f) => {
        const v = row[map.fields[f]!];
        return v !== undefined && v !== null && String(v).trim() !== "";
      })
    ).length;
    const score =
      Object.keys(map.fields).length + map.imageColumns.length + dataLikeRows * 10;
    if (!best || score > best.score) best = { sheet, map, score };
  }
  if (best) return best;
  // 見つからない場合は先頭シート (呼び出し側が必須列欠損として報告)
  return { sheet: sheets[0], map: buildMap(sheets[0]?.headers ?? []) };
}

function isEmptyRow(row: Record<string, unknown>): boolean {
  return Object.values(row).every(
    (v) => v === undefined || v === null || String(v).trim() === ""
  );
}

function pick(row: Record<string, unknown>, header: string | undefined): unknown {
  return header ? row[header] : undefined;
}

export interface ParsedProductFile {
  sheetName: string;
  map: HeaderMap<ProductField>;
  records: ParsedProductRow[];
  issues: IssueDraft[];
  rowCount: number;
}

export function parseProductFile(buf: ArrayBuffer): ParsedProductFile {
  const sheets = readSheets(buf);
  const { sheet, map } = pickSheet(sheets, mapProductHeaders, ["sku", "title"]);
  const issues: IssueDraft[] = [];
  const records: ParsedProductRow[] = [];

  for (const h of map.unmapped) {
    issues.push({
      sku: null, row_number: null, issue_type: "unmapped_column", field: h,
      message: `列「${h}」はどのフィールドにも対応付けできませんでした (無視されます)`,
      severity: "warning",
    });
  }
  if (!map.fields.sku || !map.fields.title) {
    issues.push({
      sku: null, row_number: null, issue_type: "missing_required", field: null,
      message: `必須列が見つかりません (SKU列: ${map.fields.sku ?? "なし"} / 商品名列: ${map.fields.title ?? "なし"})。取込を中止しました`,
      severity: "error",
    });
    return { sheetName: sheet?.sheetName ?? "", map, records, issues, rowCount: sheet?.rows.length ?? 0 };
  }

  const seenSkus = new Set<string>();

  for (let i = 0; i < sheet.rows.length; i++) {
    const row = sheet.rows[i];
    const rowNo = i + 2; // ヘッダーが1行目
    if (isEmptyRow(row)) continue;

    const price = parseNumber(pick(row, map.fields.price));
    const stock = parseNumber(pick(row, map.fields.stock));
    const rawWeight = parseNumber(pick(row, map.fields.weight));

    // 画像URL: 複数列 + カンマ区切り両対応。プレースホルダは除外
    const imageUrls: string[] = [];
    let placeholderSkipped = 0;
    for (const col of map.imageColumns) {
      for (const u of extractImageUrls(row[col])) {
        if (PLACEHOLDER_IMAGE_RE.test(u)) {
          placeholderSkipped++;
          continue;
        }
        if (!imageUrls.includes(u)) imageUrls.push(u);
      }
    }

    // Shopeeテンプレートの説明行 (Mandatory/Optional/ガイダンス文) を除外:
    // 数値列が一つも解釈できず画像URLも無い行はデータ行とみなさない
    if (price === null && stock === null && rawWeight === null && imageUrls.length === 0) {
      if (!map.isShopeeTemplate) {
        issues.push({
          sku: cleanText(pick(row, map.fields.sku)), row_number: rowNo,
          issue_type: "skipped_non_data_row", field: null,
          message: "価格・在庫・重量・画像のいずれも無いためデータ行と判定せずスキップしました",
          severity: "warning",
        });
      }
      continue;
    }

    const sku = cleanText(pick(row, map.fields.sku));
    const title = cleanText(pick(row, map.fields.title));

    if (!sku) {
      issues.push({
        sku: null, row_number: rowNo, issue_type: "missing_required", field: "sku",
        message: "SKUが空のためスキップ (バリエーション行の可能性)", severity: "error",
      });
      continue;
    }
    if (!title) {
      issues.push({
        sku, row_number: rowNo, issue_type: "missing_required", field: "title",
        message: "商品名が空のためスキップ (バリエーション行の可能性)", severity: "error",
      });
      continue;
    }
    if (seenSkus.has(sku)) {
      issues.push({
        sku, row_number: rowNo, issue_type: "sku_duplicate", field: "sku",
        message: "ファイル内でSKUが重複 (最初の行のみ取込)", severity: "warning",
      });
      continue;
    }
    seenSkus.add(sku);

    if (placeholderSkipped > 0) {
      issues.push({
        sku, row_number: rowNo, issue_type: "placeholder_image_skipped", field: null,
        message: `プレースホルダ画像 (dummyimage.com等) ${placeholderSkipped}件を除外しました`,
        severity: "warning",
      });
    }
    if (imageUrls.length === 0) {
      issues.push({
        sku, row_number: rowNo, issue_type: "no_image_url", field: null,
        message: "画像URLが1件もありません", severity: "warning",
      });
    }

    const rawPrice = pick(row, map.fields.price);
    if (rawPrice !== undefined && rawPrice !== null && String(rawPrice).trim() !== "" && price === null) {
      issues.push({
        sku, row_number: rowNo, issue_type: "invalid_number", field: "price",
        message: `売値「${rawPrice}」を数値として解釈できません`, severity: "warning",
      });
    }
    let priceValue = price;
    if (priceValue !== null && priceValue < 0) {
      issues.push({
        sku, row_number: rowNo, issue_type: "shopify_constraint_violation", field: "price",
        message: "売値が負の値です", severity: "error",
      });
      priceValue = null;
    }

    // 重量: Shopee (ps_weight) はkg単位 → gへ変換
    const weightG =
      rawWeight === null ? null : map.weightUnit === "kg" ? rawWeight * 1000 : rawWeight;

    let dims: { length: number | null; width: number | null; height: number | null } = {
      length: parseNumber(pick(row, map.fields.length)),
      width: parseNumber(pick(row, map.fields.width)),
      height: parseNumber(pick(row, map.fields.height)),
    };
    if (dims.length === null && map.fields.dimensions) {
      const parsed = parseDimensions(pick(row, map.fields.dimensions));
      if (parsed) dims = parsed;
    }

    // カテゴリ: ShopeeカテゴリIDは内部名にマップ (未知IDは生値のまま)
    let category = cleanText(pick(row, map.fields.category));
    if (category && SHOPEE_CATEGORY_MAP[category]) {
      category = SHOPEE_CATEGORY_MAP[category];
    }

    records.push({
      rowNumber: rowNo,
      sku,
      title,
      description: cleanText(pick(row, map.fields.description)),
      price: priceValue,
      stock,
      category,
      ipName: cleanText(pick(row, map.fields.ip_name)),
      characterName: cleanText(pick(row, map.fields.character_name)),
      weightG,
      lengthCm: dims.length,
      widthCm: dims.width,
      heightCm: dims.height,
      imageUrls,
    });
  }

  return { sheetName: sheet.sheetName, map, records, issues, rowCount: sheet.rows.length };
}

export interface ParsedCostFile {
  sheetName: string;
  map: HeaderMap<CostField>;
  records: ParsedCostRow[];
  issues: IssueDraft[];
  rowCount: number;
}

export function parseCostFile(buf: ArrayBuffer): ParsedCostFile {
  const sheets = readSheets(buf);
  const { sheet, map } = pickSheet(sheets, mapCostHeaders, ["sku", "purchase_price"]);
  const issues: IssueDraft[] = [];
  const records: ParsedCostRow[] = [];

  for (const h of map.unmapped) {
    issues.push({
      sku: null, row_number: null, issue_type: "unmapped_column", field: h,
      message: `列「${h}」はどのフィールドにも対応付けできませんでした (無視されます)`,
      severity: "warning",
    });
  }
  if (!map.fields.sku || !map.fields.purchase_price) {
    issues.push({
      sku: null, row_number: null, issue_type: "missing_required", field: null,
      message: `必須列が見つかりません (SKU列: ${map.fields.sku ?? "なし"} / 仕入価格列: ${map.fields.purchase_price ?? "なし"})。取込を中止しました`,
      severity: "error",
    });
    return { sheetName: sheet?.sheetName ?? "", map, records, issues, rowCount: sheet?.rows.length ?? 0 };
  }

  for (let i = 0; i < sheet.rows.length; i++) {
    const row = sheet.rows[i];
    const rowNo = i + 2;
    if (isEmptyRow(row)) continue;

    const sku = cleanText(pick(row, map.fields.sku));
    if (!sku) {
      issues.push({
        sku: null, row_number: rowNo, issue_type: "missing_required", field: "sku",
        message: "SKUが空のためスキップ", severity: "error",
      });
      continue;
    }

    const rawPrice = pick(row, map.fields.purchase_price);
    const purchasePrice = parseNumber(rawPrice);
    if (purchasePrice === null) {
      issues.push({
        sku, row_number: rowNo, issue_type: "invalid_number", field: "purchase_price",
        message: `仕入価格「${rawPrice ?? "(空)"}」を数値として解釈できません`, severity: "error",
      });
      continue;
    }

    const weightG = parseNumber(pick(row, map.fields.weight));
    let dims: { length: number | null; width: number | null; height: number | null } = {
      length: parseNumber(pick(row, map.fields.length)),
      width: parseNumber(pick(row, map.fields.width)),
      height: parseNumber(pick(row, map.fields.height)),
    };
    if (dims.length === null && map.fields.dimensions) {
      const parsed = parseDimensions(pick(row, map.fields.dimensions));
      if (parsed) dims = parsed;
    }

    records.push({
      rowNumber: rowNo,
      sku,
      purchasePriceJpy: purchasePrice,
      weightG,
      lengthCm: dims.length,
      widthCm: dims.width,
      heightCm: dims.height,
    });
  }

  return { sheetName: sheet.sheetName, map, records, issues, rowCount: sheet.rows.length };
}
