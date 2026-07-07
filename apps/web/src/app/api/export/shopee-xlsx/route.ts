import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { loadEnrichContext } from "@/lib/settings";
import { buildBulkUploadXlsx } from "@/lib/shopee/listing";
import type { Market, MarketListing, Product, ProductImage } from "@/lib/types";

export const runtime = "nodejs";

/**
 * POST /api/export/shopee-xlsx  body: { productIds: string[], marketCode: string }
 * Shopee公式一括アップロードテンプレートに貼り付けるための行データxlsxを生成
 * (Open Platformの審査が下りるまでのつなぎ運用)
 */
export async function POST(req: NextRequest) {
  try {
    const sb = supabaseAdmin();
    const body = await req.json().catch(() => ({}));
    const productIds: string[] = Array.isArray(body.productIds) ? body.productIds : [];
    const marketCode: string = typeof body.marketCode === "string" ? body.marketCode : "";
    if (productIds.length === 0 || !marketCode) {
      return NextResponse.json(
        { error: "productIds と marketCode を指定してください" },
        { status: 400 }
      );
    }

    const ctx = await loadEnrichContext();
    const market = ctx.markets.find((m) => m.code === marketCode);
    if (!market) {
      return NextResponse.json({ error: `市場「${marketCode}」がありません` }, { status: 400 });
    }

    const [productsRes, listingsRes, imagesRes] = await Promise.all([
      sb.from("products").select("*").in("id", productIds),
      sb.from("market_listings").select("*").in("product_id", productIds).eq("market_code", marketCode),
      sb.from("product_images").select("*").in("product_id", productIds),
    ]);
    if (productsRes.error) throw new Error(productsRes.error.message);
    if (listingsRes.error) throw new Error(listingsRes.error.message);
    if (imagesRes.error) throw new Error(imagesRes.error.message);

    const products = (productsRes.data ?? []) as Product[];
    const listings = (listingsRes.data ?? []) as MarketListing[];
    const images = (imagesRes.data ?? []) as ProductImage[];

    const rows = products.flatMap((p) => {
      const listing = listings.find((l) => l.product_id === p.id);
      if (!listing) return [];
      return [{
        product: p,
        listing,
        market: market as Market,
        images: images.filter((i) => i.product_id === p.id),
      }];
    });

    const xlsx = buildBulkUploadXlsx(rows, ctx.settings);

    const listingIds = rows.map((r) => r.listing.id);
    if (listingIds.length > 0) {
      await sb
        .from("market_listings")
        .update({ status: "exported_xlsx" })
        .in("id", listingIds)
        .in("status", ["draft", "ready"]);
      await sb.from("export_logs").insert(
        listingIds.map((id) => ({
          listing_id: id, export_type: "shopee_xlsx" as const, result: "success" as const,
          detail: {},
        }))
      );
    }

    const filename = `shopee-${marketCode}-paste-rows-${new Date().toISOString().slice(0, 10)}.xlsx`;
    return new NextResponse(xlsx, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
