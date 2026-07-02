import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { loadEnrichContext } from "@/lib/settings";
import { enrichProduct } from "@/lib/enrich";
import type { Product } from "@/lib/types";

export const runtime = "nodejs";

const EDITABLE_FIELDS = [
  "inventory_qty",
  "purchase_status",
  "restock_recheck_flag",
  "current_listed_price",
  "purchase_price_jpy",
  "weight_g",
  "length_cm",
  "width_cm",
  "height_cm",
  "category",
  "status",
] as const;

/** PATCH /api/products/[id] — UIからの手動更新。数値・重量系を触ったら再計算 */
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

    const { data: updated, error } = await sb
      .from("products")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error || !updated) throw new Error(error?.message ?? "商品が見つかりません");

    // 価格・重量関連を触った場合は粗利等を再計算
    const needsRecalc = [
      "current_listed_price", "purchase_price_jpy",
      "weight_g", "length_cm", "width_cm", "height_cm", "category",
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
    }

    return NextResponse.json({ product: finalProduct });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
