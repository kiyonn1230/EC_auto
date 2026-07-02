import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { loadEnrichContext } from "@/lib/settings";
import { enrichProduct } from "@/lib/enrich";
import type { Product } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/** POST /api/recalculate — 全商品の重量補正・粗利・コンプラを再計算 (設定変更後に実行) */
export async function POST() {
  try {
    const sb = supabaseAdmin();
    const ctx = await loadEnrichContext();

    const { data: products, error } = await sb.from("products").select("*");
    if (error) throw new Error(error.message);

    let updated = 0;
    for (const p of (products ?? []) as Product[]) {
      const patch = enrichProduct(p, ctx);
      const { error: upErr } = await sb.from("products").update(patch).eq("id", p.id);
      if (!upErr) updated++;
    }

    return NextResponse.json({ updated, total: products?.length ?? 0 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
