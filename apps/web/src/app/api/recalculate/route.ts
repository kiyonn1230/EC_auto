import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { loadEnrichContext } from "@/lib/settings";
import { computeListingPatch, enrichProduct } from "@/lib/enrich";
import type { MarketListing, Product } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/** POST /api/recalculate — 全商品の補正・コンプラ + 全市場出品の価格を再計算 */
export async function POST() {
  try {
    const sb = supabaseAdmin();
    const ctx = await loadEnrichContext();
    const enabledMarkets = ctx.markets.filter((m) => m.enabled);

    const [productsRes, listingsRes] = await Promise.all([
      sb.from("products").select("*"),
      sb.from("market_listings").select("*"),
    ]);
    if (productsRes.error) throw new Error(productsRes.error.message);
    if (listingsRes.error) throw new Error(listingsRes.error.message);
    const products = (productsRes.data ?? []) as Product[];
    const listings = (listingsRes.data ?? []) as MarketListing[];

    let updated = 0;
    for (const p of products) {
      const patch = enrichProduct(p, ctx);
      const merged = { ...p, ...patch };
      const { error: upErr } = await sb.from("products").update(patch).eq("id", p.id);
      if (upErr) continue;

      for (const market of enabledMarkets) {
        const existing = listings.find(
          (l) => l.product_id === p.id && l.market_code === market.code
        );
        const listingPatch = computeListingPatch(merged, market, existing ?? null, ctx);
        const stock =
          p.source_stock_status === "out_of_stock" ? 0 : existing?.stock ?? market.default_stock;
        await sb.from("market_listings").upsert(
          {
            product_id: p.id,
            market_code: market.code,
            stock,
            status:
              existing?.status === "listed" ? "update_required" : existing?.status ?? "draft",
            ...listingPatch,
          },
          { onConflict: "product_id,market_code" }
        );
      }
      updated++;
    }

    return NextResponse.json({ updated, total: products.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
