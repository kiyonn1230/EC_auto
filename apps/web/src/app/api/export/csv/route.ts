import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { loadSettings } from "@/lib/settings";
import { buildPayload } from "@/lib/shopify/payload";
import { payloadsToCsv } from "@/lib/shopify/csv";
import type { Product, ProductImage } from "@/lib/types";

export const runtime = "nodejs";

/** POST /api/export/csv  body: { productIds: string[] } → Shopify商品CSVダウンロード */
export async function POST(req: NextRequest) {
  try {
    const sb = supabaseAdmin();
    const body = await req.json().catch(() => ({}));
    const productIds: string[] = Array.isArray(body.productIds) ? body.productIds : [];
    if (productIds.length === 0) {
      return NextResponse.json({ error: "productIdsを指定してください" }, { status: 400 });
    }

    const [settings, productsRes, imagesRes] = await Promise.all([
      loadSettings(),
      sb.from("products").select("*").in("id", productIds),
      sb.from("product_images").select("*").in("product_id", productIds),
    ]);
    if (productsRes.error) throw new Error(productsRes.error.message);
    if (imagesRes.error) throw new Error(imagesRes.error.message);

    const products = (productsRes.data ?? []) as Product[];
    const images = (imagesRes.data ?? []) as ProductImage[];

    const payloads = products.map((p) =>
      buildPayload(p, images.filter((i) => i.product_id === p.id), settings)
    );
    const csv = payloadsToCsv(payloads);

    // 出力ログ + ステータス更新 (api_created 済みのものは保持)
    await sb.from("shopify_export_logs").insert(
      products.map((p) => ({
        product_id: p.id,
        export_type: "csv",
        result: "success",
        detail: { warnings: payloads.find((pl) => pl.variant.sku === p.sku)?.warnings ?? [] },
      }))
    );
    await sb
      .from("products")
      .update({ export_status: "csv_exported" })
      .in("id", productIds)
      .eq("export_status", "not_exported");

    const filename = `shopify-products-${new Date().toISOString().slice(0, 10)}.csv`;
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
