import { supabaseAdmin } from "@/lib/supabase/server";
import { loadEnrichContext } from "@/lib/settings";
import { enrichProduct } from "@/lib/enrich";
import { descriptionToHtml, generateHandle } from "./clean";
import { parseCostFile, parseProductFile } from "./parse";
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

/** (A) 商品データ xlsx の取込 (Shopeeテンプレート/汎用ヘッダー両対応) */
export async function ingestProductData(
  buf: ArrayBuffer,
  fileName: string
): Promise<ImportResult> {
  const sb = supabaseAdmin();
  const parsed = parseProductFile(buf);
  const issues: IssueDraft[] = [...parsed.issues];
  let okCount = 0;

  const { data: batch, error: batchErr } = await sb
    .from("import_batches")
    .insert({ file_type: "product_data", file_name: fileName, row_count: parsed.rowCount })
    .select()
    .single();
  if (batchErr || !batch) throw new Error(`import_batches作成失敗: ${batchErr?.message}`);

  const aborted = issues.some((i) => i.severity === "error" && i.issue_type === "missing_required" && i.row_number === null);
  if (aborted) {
    await finalizeBatch(batch.id, issues, 0);
    return { batchId: batch.id, fileType: "product_data", rowCount: parsed.rowCount, okCount: 0, issues };
  }

  const ctx = await loadEnrichContext();

  for (const rec of parsed.records) {
    if (rec.title.length > SHOPIFY_TITLE_MAX) {
      issues.push({
        sku: rec.sku, row_number: rec.rowNumber,
        issue_type: "shopify_constraint_violation", field: "title",
        message: `商品名が${SHOPIFY_TITLE_MAX}文字を超過 (${rec.title.length}文字)。Shopifyインポートで失敗します`,
        severity: "error",
      });
    }

    // 既存行を取得して(B)由来の実測値を保持しつつupsert
    const { data: existing } = await sb
      .from("products")
      .select("id, purchase_price_jpy, inventory_qty, weight_g, weight_source, length_cm, width_cm, height_cm, dimension_source")
      .eq("sku", rec.sku)
      .maybeSingle();

    const keepMeasuredWeight = existing?.weight_source === "measured";
    const keepMeasuredDims = existing?.dimension_source === "measured";

    const base = {
      sku: rec.sku,
      title: rec.title,
      description_raw: rec.description,
      description_html: descriptionToHtml(rec.description),
      category: rec.category,
      ip_name: rec.ipName,
      character_name: rec.characterName,
      tags: buildTags(rec.ipName, rec.characterName, rec.category),
      current_listed_price: rec.price,
      purchase_price_jpy: existing?.purchase_price_jpy ?? null,
      inventory_qty: rec.stock ?? existing?.inventory_qty ?? 0,
      weight_g: keepMeasuredWeight ? existing!.weight_g : rec.weightG,
      weight_source: keepMeasuredWeight ? ("measured" as const) : null,
      length_cm: keepMeasuredDims ? existing!.length_cm : rec.lengthCm,
      width_cm: keepMeasuredDims ? existing!.width_cm : rec.widthCm,
      height_cm: keepMeasuredDims ? existing!.height_cm : rec.heightCm,
      dimension_source: keepMeasuredDims ? ("measured" as const) : null,
      shopify_handle: generateHandle(rec.title, rec.sku),
    };

    const patch = enrichProduct(base as Partial<Product> as Parameters<typeof enrichProduct>[0], ctx);
    const { data: upserted, error: upErr } = await sb
      .from("products")
      .upsert({ ...base, ...patch }, { onConflict: "sku" })
      .select("id")
      .single();

    if (upErr || !upserted) {
      issues.push({
        sku: rec.sku, row_number: rec.rowNumber, issue_type: "db_error", field: null,
        message: `保存失敗: ${upErr?.message}`, severity: "error",
      });
      continue;
    }

    // 画像は (product_id, source_url) 一意でupsert。位置を更新
    for (let pos = 0; pos < rec.imageUrls.length; pos++) {
      await sb.from("product_images").upsert(
        {
          product_id: upserted.id,
          source_url: rec.imageUrls[pos],
          position: pos + 1,
          role: pos === 0 ? "main" : "sub",
        },
        { onConflict: "product_id,source_url", ignoreDuplicates: false }
      );
    }
    okCount++;
  }

  await finalizeBatch(batch.id, issues, okCount);
  return { batchId: batch.id, fileType: "product_data", rowCount: parsed.rowCount, okCount, issues };
}

/** (B) 仕入原価データ xlsx の取込 (SKU突合) */
export async function ingestCostData(
  buf: ArrayBuffer,
  fileName: string
): Promise<ImportResult> {
  const sb = supabaseAdmin();
  const parsed = parseCostFile(buf);
  const issues: IssueDraft[] = [...parsed.issues];
  let okCount = 0;

  const { data: batch, error: batchErr } = await sb
    .from("import_batches")
    .insert({ file_type: "cost_data", file_name: fileName, row_count: parsed.rowCount })
    .select()
    .single();
  if (batchErr || !batch) throw new Error(`import_batches作成失敗: ${batchErr?.message}`);

  const aborted = issues.some((i) => i.severity === "error" && i.issue_type === "missing_required" && i.row_number === null);
  if (aborted) {
    await finalizeBatch(batch.id, issues, 0);
    return { batchId: batch.id, fileType: "cost_data", rowCount: parsed.rowCount, okCount: 0, issues };
  }

  const ctx = await loadEnrichContext();

  for (const rec of parsed.records) {
    // SKU突合: (A)側が先に取込済みであることが前提
    const { data: product } = await sb
      .from("products")
      .select("*")
      .eq("sku", rec.sku)
      .maybeSingle();

    if (!product) {
      issues.push({
        sku: rec.sku, row_number: rec.rowNumber, issue_type: "sku_unmatched_cost", field: "sku",
        message: "商品データ(A)に存在しないSKUです。先に(A)を取込むか、SKUを確認してください",
        severity: "error",
      });
      continue;
    }

    const base = {
      ...product,
      purchase_price_jpy: rec.purchasePriceJpy,
      weight_g: rec.weightG ?? product.weight_g,
      weight_source: rec.weightG !== null ? ("measured" as const) : product.weight_source,
      length_cm: rec.lengthCm ?? product.length_cm,
      width_cm: rec.widthCm ?? product.width_cm,
      height_cm: rec.heightCm ?? product.height_cm,
      dimension_source: rec.lengthCm !== null ? ("measured" as const) : product.dimension_source,
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
        sku: rec.sku, row_number: rec.rowNumber, issue_type: "db_error", field: null,
        message: `保存失敗: ${upErr.message}`, severity: "error",
      });
      continue;
    }
    okCount++;
  }

  await finalizeBatch(batch.id, issues, okCount);
  return { batchId: batch.id, fileType: "cost_data", rowCount: parsed.rowCount, okCount, issues };
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
