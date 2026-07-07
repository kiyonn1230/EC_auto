import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { loadEnrichContext } from "@/lib/settings";
import { computeListingPatch, enrichProduct } from "@/lib/enrich";
import type { MarketListing, Product } from "@/lib/types";

export const runtime = "nodejs";

const EDITABLE_FIELDS = [
  "purchase_price_jpy",
  "source_stock_status",
  "weight_g",
  "length_cm",
  "width_cm",
  "height_cm",
  "category",
  "shopee_category_id",
  "note",
  "status",
] as const;

/** PATCH /api/products/[id] — 手動更新。価格・重量系を触ったら市場別出品も再計算 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sb = supabaseAdmin();
    const body = await req.json();

    const patch: Record<string, unknown> = {};
    for (const f of EDITABLE_FIELDS) {
      if (f in body) patch[f] = body[f];
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "更新可能なフィールドがありません" }, { status: 400 });
    }

    // 手動で重量・寸法を入れた場合は実測扱い
    if ("weight_g" in patch && patch.weight_g !== null) patch.weight_source = "measured";
    if ("length_cm" in patch && patch.length_cm !== null) patch.dimension_source = "measured";
    if ("source_stock_status" in patch) patch.source_checked_at = new Date().toISOString();

    const { data: updated, error } = await sb
      .from("products")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error || !updated) throw new Error(error?.message ?? "商品が見つかりません");

    const needsRecalc = [
      "purchase_price_jpy", "weight_g", "length_cm", "width_cm", "height_cm",
      "category", "source_stock_status",
    ].some((f) => f in patch);

    let finalProduct = updated as Product;
    if (needsRecalc) {
      const ctx = await loadEnrichContext();
      const enriched = enrichProduct(finalProduct, ctx);
      const { data: after } = await sb
        .from("products")
        .update(enriched)
        .eq("id", id)
        .select("*")
        .single();
      if (after) finalProduct = after as Product;

      const { data: listingRows } = await sb
        .from("market_listings")
        .select("*")
        .eq("product_id", id);
      for (const market of ctx.markets.filter((m) => m.enabled)) {
        const existing =
          ((listingRows ?? []) as MarketListing[]).find((l) => l.market_code === market.code) ?? null;
        const listingPatch = computeListingPatch(finalProduct, market, existing, ctx);
        const stock =
          finalProduct.source_stock_status === "out_of_stock"
            ? 0
            : existing?.stock ?? market.default_stock;
        await sb.from("market_listings").upsert(
          {
            product_id: id,
            market_code: market.code,
            stock,
            status:
              existing?.status === "listed" ? "update_required" : existing?.status ?? "draft",
            ...listingPatch,
          },
          { onConflict: "product_id,market_code" }
        );
      }
    }

    return NextResponse.json({ product: finalProduct });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
