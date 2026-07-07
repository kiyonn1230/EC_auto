/**
 * Amazon仕入れリスト xlsx → 論理レコードへの純粋な変換層 (DBアクセスなし)。
 * 空セル・不正値・列ズレでも落ちない。
 */
import * as XLSX from "xlsx";
import {
  cleanText,
  extractImageUrls,
  parseDimensions,
  parseNumber,
} from "./clean";
import { HeaderMap, mapProductHeaders } from "./mapping";
import type { IssueDraft } from "./ingest";

/** プレースホルダ画像URL (取込しない) */
const PLACEHOLDER_IMAGE_RE = /dummyimage\.com|placehold(er)?\.|via\.placeholder/i;

const ASIN_RE = /^[A-Z0-9]{10}$/i;

export interface ParsedProductRow {
  rowNumber: number;
  asin: string;
  title: string;
  description: string | null;
  purchasePriceJpy: number | null;
  amazonUrl: string | null;
  category: string | null;
  shopeeCategoryId: number | null;
  ipName: string | null;
  characterName: string | null;
  weightG: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  stockStatus: "in_stock" | "out_of_stock" | "unknown";
  note: string | null;
  imageUrls: string[];
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

/** ASIN+商品名が埋まったデータ行が最も多いシートを選ぶ */
function pickSheet(sheets: SheetData[]): { sheet: SheetData; map: HeaderMap } {
  let best: { sheet: SheetData; map: HeaderMap; score: number } | null = null;
  for (const sheet of sheets) {
    const map = mapProductHeaders(sheet.headers);
    if (!map.fields.asin || !map.fields.title) continue;
    const dataLikeRows = sheet.rows.filter((row) => {
      const a = row[map.fields.asin!];
      const t = row[map.fields.title!];
      return a && t && String(a).trim() !== "" && String(t).trim() !== "";
    }).length;
    const score = Object.keys(map.fields).length + map.imageColumns.length + dataLikeRows * 10;
    if (!best || score > best.score) best = { sheet, map, score };
  }
  if (best) return best;
  return { sheet: sheets[0], map: mapProductHeaders(sheets[0]?.headers ?? []) };
}

function isEmptyRow(row: Record<string, unknown>): boolean {
  return Object.values(row).every(
    (v) => v === undefined || v === null || String(v).trim() === ""
  );
}

function pick(row: Record<string, unknown>, header: string | undefined): unknown {
  return header ? row[header] : undefined;
}

function parseStockStatus(raw: unknown): ParsedProductRow["stockStatus"] {
  if (raw === null || raw === undefined) return "unknown";
  const s = String(raw).trim().toLowerCase();
  if (s === "") return "unknown";
  if (/あり|有|ok|◯|○|in|yes|1|true/.test(s)) return "in_stock";
  if (/なし|無|切れ|×|out|no|0|false/.test(s)) return "out_of_stock";
  return "unknown";
}

export interface ParsedProductFile {
  sheetName: string;
  map: HeaderMap;
  records: ParsedProductRow[];
  issues: IssueDraft[];
  rowCount: number;
}

export function parseProductFile(buf: ArrayBuffer): ParsedProductFile {
  const sheets = readSheets(buf);
  const { sheet, map } = pickSheet(sheets);
  const issues: IssueDraft[] = [];
  const records: ParsedProductRow[] = [];

  for (const h of map.unmapped) {
    issues.push({
      sku: null, row_number: null, issue_type: "unmapped_column", field: h,
      message: `列「${h}」はどのフィールドにも対応付けできませんでした (無視されます)`,
      severity: "warning",
    });
  }
  if (!map.fields.asin || !map.fields.title) {
    issues.push({
      sku: null, row_number: null, issue_type: "missing_required", field: null,
      message: `必須列が見つかりません (ASIN列: ${map.fields.asin ?? "なし"} / 商品名列: ${map.fields.title ?? "なし"})。取込を中止しました`,
      severity: "error",
    });
    return { sheetName: sheet?.sheetName ?? "", map, records, issues, rowCount: sheet?.rows.length ?? 0 };
  }

  const seen = new Set<string>();

  for (let i = 0; i < sheet.rows.length; i++) {
    const row = sheet.rows[i];
    const rowNo = i + 2; // ヘッダーが1行目
    if (isEmptyRow(row)) continue;

    const asin = cleanText(pick(row, map.fields.asin))?.toUpperCase() ?? null;
    const title = cleanText(pick(row, map.fields.title));

    if (!asin) {
      issues.push({
        sku: null, row_number: rowNo, issue_type: "missing_required", field: "asin",
        message: "ASINが空のためスキップ", severity: "error",
      });
      continue;
    }
    if (!title) {
      issues.push({
        sku: asin, row_number: rowNo, issue_type: "missing_required", field: "title",
        message: "商品名が空のためスキップ", severity: "error",
      });
      continue;
    }
    if (!ASIN_RE.test(asin)) {
      issues.push({
        sku: asin, row_number: rowNo, issue_type: "invalid_asin", field: "asin",
        message: `「${asin}」はASIN形式 (英数字10桁) ではありません。そのまま取込みますが確認してください`,
        severity: "warning",
      });
    }
    if (seen.has(asin)) {
      issues.push({
        sku: asin, row_number: rowNo, issue_type: "sku_duplicate", field: "asin",
        message: "ファイル内でASINが重複 (最初の行のみ取込)", severity: "warning",
      });
      continue;
    }
    seen.add(asin);

    const rawPrice = pick(row, map.fields.purchase_price);
    const purchasePrice = parseNumber(rawPrice);
    if (purchasePrice === null) {
      issues.push({
        sku: asin, row_number: rowNo, issue_type: "missing_purchase_price", field: "purchase_price",
        message: `Amazon価格が${rawPrice === undefined || rawPrice === null ? "空" : `「${rawPrice}」で解釈不能`}です。粗利計算は原価0で仮計算されます`,
        severity: "warning",
      });
    }

    const amazonUrl = cleanText(pick(row, map.fields.amazon_url));
    if (amazonUrl && !/^https?:\/\//i.test(amazonUrl)) {
      issues.push({
        sku: asin, row_number: rowNo, issue_type: "invalid_url", field: "amazon_url",
        message: `Amazon URL「${amazonUrl.slice(0, 50)}」がURL形式ではありません`,
        severity: "warning",
      });
    }

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
    if (placeholderSkipped > 0) {
      issues.push({
        sku: asin, row_number: rowNo, issue_type: "placeholder_image_skipped", field: null,
        message: `プレースホルダ画像 ${placeholderSkipped}件を除外しました`, severity: "warning",
      });
    }
    if (imageUrls.length === 0) {
      issues.push({
        sku: asin, row_number: rowNo, issue_type: "no_image_url", field: null,
        message: "画像URLが1件もありません (Shopee出品には画像が必須)", severity: "warning",
      });
    }

    const rawWeight = parseNumber(pick(row, map.fields.weight));
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

    const shopeeCategoryId = parseNumber(pick(row, map.fields.shopee_category_id));

    records.push({
      rowNumber: rowNo,
      asin,
      title,
      description: cleanText(pick(row, map.fields.description)),
      purchasePriceJpy: purchasePrice,
      amazonUrl: amazonUrl && /^https?:\/\//i.test(amazonUrl) ? amazonUrl : null,
      category: cleanText(pick(row, map.fields.category)),
      shopeeCategoryId: shopeeCategoryId !== null ? Math.round(shopeeCategoryId) : null,
      ipName: cleanText(pick(row, map.fields.ip_name)),
      characterName: cleanText(pick(row, map.fields.character_name)),
      weightG,
      lengthCm: dims.length,
      widthCm: dims.width,
      heightCm: dims.height,
      stockStatus: parseStockStatus(pick(row, map.fields.stock_status)),
      note: cleanText(pick(row, map.fields.note)),
      imageUrls,
    });
  }

  return { sheetName: sheet.sheetName, map, records, issues, rowCount: sheet.rows.length };
}
