import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { loadSettings } from "@/lib/settings";
import { buildPayload } from "@/lib/shopify/payload";
import { createDraftProduct, testConnection } from "@/lib/shopify/admin-api";
import type { Product, ProductImage } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/** GET /api/export/shopify — 認証疎通テスト */
export async function GET() {
  try {
    const result = await testConnection();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}

/**
 * POST /api/export/shopify  body: { productIds: string[] }
 * 選択商品を Admin API (productSet) で draft 作成。1件ずつ処理し結果を返す
 */
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

    const results: {
      productId: string;
      sku: string;
      ok: boolean;
      shopifyProductId?: string;
      error?: string;
      warnings: string[];
    }[] = [];

    for (const p of products) {
      const payload = buildPayload(p, images.filter((i) => i.product_id === p.id), settings);
      try {
        const created = await createDraftProduct(payload);
        await sb
          .from("products")
          .update({
            shopify_product_id: created.productGid,
            shopify_handle: created.handle,
            export_status: "api_created",
          })
          .eq("id", p.id);
        await sb.from("shopify_export_logs").insert({
          product_id: p.id,
          export_type: "api",
          result: "success",
          detail: { gid: created.productGid, warnings: payload.warnings },
        });
        results.push({
          productId: p.id, sku: p.sku, ok: true,
          shopifyProductId: created.productGid, warnings: payload.warnings,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await sb.from("products").update({ export_status: "api_failed" }).eq("id", p.id);
        await sb.from("shopify_export_logs").insert({
          product_id: p.id,
          export_type: "api",
          result: "failed",
          detail: { error: message, warnings: payload.warnings },
        });
        results.push({ productId: p.id, sku: p.sku, ok: false, error: message, warnings: payload.warnings });
      }
    }

    return NextResponse.json({
      created: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
