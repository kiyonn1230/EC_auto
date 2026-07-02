import * as XLSX from "xlsx";
import { supabaseAdmin } from "@/lib/supabase/server";
import { loadEnrichContext } from "@/lib/settings";
import { enrichProduct } from "@/lib/enrich";
import {
  cleanText,
  descriptionToHtml,
  extractImageUrls,
  generateHandle,
  parseDimensions,
  parseNumber,
} from "./clean";
import { mapCostHeaders, mapProductHeaders } from "./mapping";
import type { Product } from "@/lib/types";

export interface IssueDraft {
  sku: string | null;
  row_number: number | null;
  issue_type: string;
  field: string | null;
  message: string;
  severity: "warning" | "error";
}

export interface ImportResult {
  batchId: string;
  fileType: "product_data" | "cost_data";
  rowCount: number;
  okCount: number;
  issues: IssueDraft[];
}

const SHOPIFY_TITLE_MAX = 255;

/** xlsxバッファ → ヘッダー行とレコード配列 (空セルは undefined) */
function readSheet(buf: ArrayBuffer): { headers: string[]; rows: Record<string, unknown>[] } {
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [] };
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: undefined,
    raw: true,
  });
  const headerRow = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 })[0] ?? [];
  const headers = (headerRow as unknown[]).map((h) => String(h ?? "").trim());
  return { headers, rows };
}

function isEmptyRow(row: Record<string, unknown>): boolean {
  return Object.values(row).every(
    (v) => v === undefined || v === null || String(v).trim() === ""
  );
}

/** 自動タグ生成: 作品名・キャラ名・カテゴリから */
function buildTags(ip: string | null, chara: string | null, category: string | null): string[] {
  const tags = new Set<string>();
  for (const t of [ip, chara, category]) {
    if (t) {
      for (const part of t.split(/[,、/／]+/)) {
        const s = part.trim();
        if (s) tags.add(s);
      }
    }
  }
  return [...tags];
}

/** (A) 商品データ xlsx の取込 */
export async function ingestProductData(
  buf: ArrayBuffer,
  fileName: string
): Promise<ImportResult> {
  const sb = supabaseAdmin();
  const { headers, rows } = readSheet(buf);
  const issues: IssueDraft[] = [];
  let okCount = 0;

  const { data: batch, error: batchErr } = await sb
    .from("import_batches")
    .insert({ file_type: "product_data", file_name: fileName, row_count: rows.length })
    .select()
    .single();
  if (batchErr || !batch) throw new Error(`import_batches作成失敗: ${batchErr?.message}`);

  const map = mapProductHeaders(headers);
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
    await finalizeBatch(batch.id, issues, 0);
    return { batchId: batch.id, fileType: "product_data", rowCount: rows.length, okCount: 0, issues };
  }

  const ctx = await loadEnrichContext();
  const seenSkus = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNo = i + 2; // ヘッダーが1行目
    if (isEmptyRow(row)) continue;

    const sku = cleanText(row[map.fields.sku!]);
    const title = cleanText(row[map.fields.title!]);

    if (!sku) {
      issues.push({
        sku: null, row_number: rowNo, issue_type: "missing_required", field: "sku",
        message: "SKUが空のためスキップ", severity: "error",
      });
      continue;
    }
    if (!title) {
      issues.push({
        sku, row_number: rowNo, issue_type: "missing_required", field: "title",
        message: "商品名が空のためスキップ", severity: "error",
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

    if (title.length > SHOPIFY_TITLE_MAX) {
      issues.push({
        sku, row_number: rowNo, issue_type: "shopify_constraint_violation", field: "title",
        message: `商品名が${SHOPIFY_TITLE_MAX}文字を超過 (${title.length}文字)。Shopifyインポートで失敗します`,
        severity: "error",
      });
    }

    const description = map.fields.description ? cleanText(row[map.fields.description]) : null;
    const category = map.fields.category ? cleanText(row[map.fields.category]) : null;
    const ipName = map.fields.ip_name ? cleanText(row[map.fields.ip_name]) : null;
    const charaName = map.fields.character_name ? cleanText(row[map.fields.character_name]) : null;

    let price: number | null = null;
    if (map.fields.price) {
      const rawPrice = row[map.fields.price];
      price = parseNumber(rawPrice);
      if (rawPrice !== undefined && rawPrice !== null && String(rawPrice).trim() !== "" && price === null) {
        issues.push({
          sku, row_number: rowNo, issue_type: "invalid_number", field: "price",
          message: `売値「${rawPrice}」を数値として解釈できません`, severity: "warning",
        });
      }
      if (price !== null && price < 0) {
        issues.push({
          sku, row_number: rowNo, issue_type: "shopify_constraint_violation", field: "price",
          message: "売値が負の値です", severity: "error",
        });
        price = null;
      }
    }

    const weight = map.fields.weight ? parseNumber(row[map.fields.weight]) : null;
    let dims: { length: number | null; width: number | null; height: number | null } = {
      length: map.fields.length ? parseNumber(row[map.fields.length]) : null,
      width: map.fields.width ? parseNumber(row[map.fields.width]) : null,
      height: map.fields.height ? parseNumber(row[map.fields.height]) : null,
    };
    if (dims.length === null && map.fields.dimensions) {
      const parsed = parseDimensions(row[map.fields.dimensions]);
      if (parsed) dims = parsed;
    }

    // 画像URL: 複数列 + カンマ区切りの両対応。入力データのURLのみ使用 (推測収集はしない)
    const imageUrls: string[] = [];
    for (const col of map.imageColumns) {
      for (const u of extractImageUrls(row[col])) {
        if (!imageUrls.includes(u)) imageUrls.push(u);
      }
    }
    if (imageUrls.length === 0) {
      issues.push({
        sku, row_number: rowNo, issue_type: "no_image_url", field: null,
        message: "画像URLが1件もありません", severity: "warning",
      });
    }

    // 既存行を取得して(B)由来の値を保持しつつupsert
    const { data: existing } = await sb
      .from("products")
      .select("id, purchase_price_jpy, weight_g, weight_source, length_cm, width_cm, height_cm, dimension_source")
      .eq("sku", sku)
      .maybeSingle();

    const keepMeasuredWeight = existing?.weight_source === "measured";
    const keepMeasuredDims = existing?.dimension_source === "measured";

    const base = {
      sku,
      title,
      description_raw: description,
      description_html: descriptionToHtml(description),
      category,
      ip_name: ipName,
      character_name: charaName,
      tags: buildTags(ipName, charaName, category),
      current_listed_price: price,
      purchase_price_jpy: existing?.purchase_price_jpy ?? null,
      weight_g: keepMeasuredWeight ? existing!.weight_g : weight,
      weight_source: keepMeasuredWeight ? ("measured" as const) : null,
      length_cm: keepMeasuredDims ? existing!.length_cm : dims.length,
      width_cm: keepMeasuredDims ? existing!.width_cm : dims.width,
      height_cm: keepMeasuredDims ? existing!.height_cm : dims.height,
      dimension_source: keepMeasuredDims ? ("measured" as const) : null,
      shopify_handle: generateHandle(title, sku),
    };

    const patch = enrichProduct(base as Partial<Product> as Parameters<typeof enrichProduct>[0], ctx);
    const { data: upserted, error: upErr } = await sb
      .from("products")
      .upsert({ ...base, ...patch }, { onConflict: "sku" })
      .select("id")
      .single();

    if (upErr || !upserted) {
      issues.push({
        sku, row_number: rowNo, issue_type: "db_error", field: null,
        message: `保存失敗: ${upErr?.message}`, severity: "error",
      });
      continue;
    }

    // 画像は (product_id, source_url) 一意でupsert。位置を更新
    for (let pos = 0; pos < imageUrls.length; pos++) {
      await sb.from("product_images").upsert(
        {
          product_id: upserted.id,
          source_url: imageUrls[pos],
          position: pos + 1,
          role: pos === 0 ? "main" : "sub",
        },
        { onConflict: "product_id,source_url", ignoreDuplicates: false }
      );
    }
    okCount++;
  }

  await finalizeBatch(batch.id, issues, okCount);
  return { batchId: batch.id, fileType: "product_data", rowCount: rows.length, okCount, issues };
}

/** (B) 仕入原価データ xlsx の取込 (SKU突合) */
export async function ingestCostData(
  buf: ArrayBuffer,
  fileName: string
): Promise<ImportResult> {
  const sb = supabaseAdmin();
  const { headers, rows } = readSheet(buf);
  const issues: IssueDraft[] = [];
  let okCount = 0;

  const { data: batch, error: batchErr } = await sb
    .from("import_batches")
    .insert({ file_type: "cost_data", file_name: fileName, row_count: rows.length })
    .select()
    .single();
  if (batchErr || !batch) throw new Error(`import_batches作成失敗: ${batchErr?.message}`);

  const map = mapCostHeaders(headers);
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
    await finalizeBatch(batch.id, issues, 0);
    return { batchId: batch.id, fileType: "cost_data", rowCount: rows.length, okCount: 0, issues };
  }

  const ctx = await loadEnrichContext();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNo = i + 2;
    if (isEmptyRow(row)) continue;

    const sku = cleanText(row[map.fields.sku!]);
    if (!sku) {
      issues.push({
        sku: null, row_number: rowNo, issue_type: "missing_required", field: "sku",
        message: "SKUが空のためスキップ", severity: "error",
      });
      continue;
    }

    const rawPrice = row[map.fields.purchase_price!];
    const purchasePrice = parseNumber(rawPrice);
    if (purchasePrice === null) {
      issues.push({
        sku, row_number: rowNo, issue_type: "invalid_number", field: "purchase_price",
        message: `仕入価格「${rawPrice ?? "(空)"}」を数値として解釈できません`, severity: "error",
      });
      continue;
    }

    const weight = map.fields.weight ? parseNumber(row[map.fields.weight]) : null;
    let dims: { length: number | null; width: number | null; height: number | null } = {
      length: map.fields.length ? parseNumber(row[map.fields.length]) : null,
      width: map.fields.width ? parseNumber(row[map.fields.width]) : null,
      height: map.fields.height ? parseNumber(row[map.fields.height]) : null,
    };
    if (dims.length === null && map.fields.dimensions) {
      const parsed = parseDimensions(row[map.fields.dimensions]);
      if (parsed) dims = parsed;
    }

    // SKU突合: (A)側が先に取込済みであることが前提
    const { data: product } = await sb
      .from("products")
      .select("*")
      .eq("sku", sku)
      .maybeSingle();

    if (!product) {
      issues.push({
        sku, row_number: rowNo, issue_type: "sku_unmatched_cost", field: "sku",
        message: "商品データ(A)に存在しないSKUです。先に(A)を取込むか、SKUを確認してください",
        severity: "error",
      });
      continue;
    }

    const base = {
      ...product,
      purchase_price_jpy: purchasePrice,
      weight_g: weight ?? product.weight_g,
      weight_source: weight !== null ? ("measured" as const) : product.weight_source,
      length_cm: dims.length ?? product.length_cm,
      width_cm: dims.width ?? product.width_cm,
      height_cm: dims.height ?? product.height_cm,
      dimension_source: dims.length !== null ? ("measured" as const) : product.dimension_source,
      purchase_status: "in_stock" as const,
      inventory_qty: product.inventory_qty > 0 ? product.inventory_qty : 1,
    };
    const patch = enrichProduct(base, ctx);

    const { error: upErr } = await sb
      .from("products")
      .update({
        purchase_price_jpy: base.purchase_price_jpy,
        purchase_status: base.purchase_status,
        inventory_qty: base.inventory_qty,
        ...patch,
      })
      .eq("id", product.id);

    if (upErr) {
      issues.push({
        sku, row_number: rowNo, issue_type: "db_error", field: null,
        message: `保存失敗: ${upErr.message}`, severity: "error",
      });
      continue;
    }
    okCount++;
  }

  await finalizeBatch(batch.id, issues, okCount);
  return { batchId: batch.id, fileType: "cost_data", rowCount: rows.length, okCount, issues };
}

async function finalizeBatch(batchId: string, issues: IssueDraft[], okCount: number) {
  const sb = supabaseAdmin();
  if (issues.length > 0) {
    await sb.from("import_issues").insert(
      issues.map((i) => ({ ...i, batch_id: batchId }))
    );
  }
  await sb
    .from("import_batches")
    .update({
      ok_count: okCount,
      issue_count: issues.length,
      status: issues.some((i) => i.severity === "error" && i.row_number === null)
        ? "failed"
        : "completed",
    })
    .eq("id", batchId);
}
