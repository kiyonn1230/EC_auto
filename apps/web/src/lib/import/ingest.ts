import { supabaseAdmin } from "@/lib/supabase/server";
import { loadEnrichContext } from "@/lib/settings";
import { computeListingPatch, enrichProduct } from "@/lib/enrich";
import { descriptionToHtml } from "./clean";
import { parseProductFile } from "./parse";
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
  rowCount: number;
  okCount: number;
  issues: IssueDraft[];
}

const SHOPEE_TITLE_MAX = 255;
const SHOPEE_TITLE_MIN = 10;

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

/** Amazon仕入れリスト xlsx の取込 → products + market_listings をupsert */
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

  const aborted = issues.some(
    (i) => i.severity === "error" && i.issue_type === "missing_required" && i.row_number === null
  );
  if (aborted) {
    await finalizeBatch(batch.id, issues, 0);
    return { batchId: batch.id, rowCount: parsed.rowCount, okCount: 0, issues };
  }

  const ctx = await loadEnrichContext();
  const enabledMarkets = ctx.markets.filter((m) => m.enabled);
  if (enabledMarkets.length === 0) {
    issues.push({
      sku: null, row_number: null, issue_type: "no_enabled_market", field: null,
      message: "有効な市場がありません。設定画面で市場 (SG/TW等) を有効化してください",
      severity: "warning",
    });
  }

  for (const rec of parsed.records) {
    // Shopee制約チェック (警告のみ)
    if (rec.title.length > SHOPEE_TITLE_MAX) {
      issues.push({
        sku: rec.asin, row_number: rec.rowNumber,
        issue_type: "shopee_constraint_violation", field: "title",
        message: `商品名が${SHOPEE_TITLE_MAX}文字を超過 (${rec.title.length}文字)。Shopee出品で失敗します`,
        severity: "error",
      });
    } else if (rec.title.length < SHOPEE_TITLE_MIN) {
      issues.push({
        sku: rec.asin, row_number: rec.rowNumber,
        issue_type: "shopee_constraint_violation", field: "title",
        message: `商品名が${SHOPEE_TITLE_MIN}文字未満 (${rec.title.length}文字)。Shopeeでは10文字以上が必要です`,
        severity: "warning",
      });
    }
    if (rec.shopeeCategoryId === null) {
      issues.push({
        sku: rec.asin, row_number: rec.rowNumber,
        issue_type: "missing_shopee_category", field: "shopee_category_id",
        message: "ShopeeカテゴリIDが未設定。API出品時に必要です (一括xlsx出力は可)",
        severity: "warning",
      });
    }

    // 既存の手動実測値を保持しつつupsert
    const { data: existing } = await sb
      .from("products")
      .select("id, weight_g, weight_source, length_cm, width_cm, height_cm, dimension_source")
      .eq("sku", rec.asin)
      .maybeSingle();

    const keepMeasuredWeight = existing?.weight_source === "measured";
    const keepMeasuredDims = existing?.dimension_source === "measured";

    const base = {
      sku: rec.asin,
      asin: rec.asin,
      amazon_url: rec.amazonUrl,
      title: rec.title,
      description_raw: rec.description,
      description_html: descriptionToHtml(rec.description),
      category: rec.category,
      shopee_category_id: rec.shopeeCategoryId,
      ip_name: rec.ipName,
      character_name: rec.characterName,
      tags: buildTags(rec.ipName, rec.characterName, rec.category),
      note: rec.note,
      purchase_price_jpy: rec.purchasePriceJpy,
      source_stock_status: rec.stockStatus,
      source_checked_at: new Date().toISOString(),
      weight_g: keepMeasuredWeight ? existing!.weight_g : rec.weightG,
      weight_source: keepMeasuredWeight ? ("measured" as const) : null,
      length_cm: keepMeasuredDims ? existing!.length_cm : rec.lengthCm,
      width_cm: keepMeasuredDims ? existing!.width_cm : rec.widthCm,
      height_cm: keepMeasuredDims ? existing!.height_cm : rec.heightCm,
      dimension_source: keepMeasuredDims ? ("measured" as const) : null,
    };

    const patch = enrichProduct(base as Parameters<typeof enrichProduct>[0], ctx);
    const merged = { ...base, ...patch };
    const { data: upserted, error: upErr } = await sb
      .from("products")
      .upsert(merged, { onConflict: "sku" })
      .select("id")
      .single();

    if (upErr || !upserted) {
      issues.push({
        sku: rec.asin, row_number: rec.rowNumber, issue_type: "db_error", field: null,
        message: `保存失敗: ${upErr?.message}`, severity: "error",
      });
      continue;
    }

    // 画像 (product_id, source_url) 一意でupsert
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

    // 有効な全市場の出品行を作成/再計算 (Amazon在庫切れは表示在庫0)
    for (const market of enabledMarkets) {
      const { data: existingListing } = await sb
        .from("market_listings")
        .select("id, listed_price, stock, status")
        .eq("product_id", upserted.id)
        .eq("market_code", market.code)
        .maybeSingle();

      const listingPatch = computeListingPatch(
        merged as Pick<Product, "purchase_price_jpy" | "weight_g" | "length_cm" | "width_cm" | "height_cm">,
        market,
        existingListing ?? null,
        ctx
      );
      const stock =
        rec.stockStatus === "out_of_stock" ? 0 : existingListing?.stock ?? market.default_stock;
      // 出品済みで価格/在庫の再計算が入ったら要更新フラグ
      const status =
        existingListing?.status === "listed" ? "update_required" : existingListing?.status ?? "draft";

      await sb.from("market_listings").upsert(
        {
          product_id: upserted.id,
          market_code: market.code,
          stock,
          status,
          ...listingPatch,
        },
        { onConflict: "product_id,market_code" }
      );
    }
    okCount++;
  }

  await finalizeBatch(batch.id, issues, okCount);
  return { batchId: batch.id, rowCount: parsed.rowCount, okCount, issues };
}

async function finalizeBatch(batchId: string, issues: IssueDraft[], okCount: number) {
  const sb = supabaseAdmin();
  if (issues.length > 0) {
    await sb.from("import_issues").insert(issues.map((i) => ({ ...i, batch_id: batchId })));
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
