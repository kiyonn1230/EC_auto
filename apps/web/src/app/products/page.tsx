import { supabaseAdmin } from "@/lib/supabase/server";
import type { Market, MarketListing, Product, ProductImage } from "@/lib/types";
import { ProductsTable, type ProductRow } from "./table";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  let rows: ProductRow[] = [];
  let markets: Market[] = [];
  let loadError: string | null = null;

  try {
    const sb = supabaseAdmin();
    const [productsRes, listingsRes, imagesRes, marketsRes] = await Promise.all([
      sb.from("products").select("*").order("created_at", { ascending: false }),
      sb.from("market_listings").select("*"),
      sb.from("product_images").select("id, product_id, status"),
      sb.from("markets").select("*").eq("enabled", true).order("code"),
    ]);
    if (productsRes.error) throw new Error(productsRes.error.message);
    if (listingsRes.error) throw new Error(listingsRes.error.message);
    if (imagesRes.error) throw new Error(imagesRes.error.message);
    if (marketsRes.error) throw new Error(marketsRes.error.message);

    markets = (marketsRes.data ?? []) as Market[];
    const listings = (listingsRes.data ?? []) as MarketListing[];
    const images = (imagesRes.data ?? []) as Pick<ProductImage, "id" | "product_id" | "status">[];

    rows = ((productsRes.data ?? []) as Product[]).map((p) => {
      const imgs = images.filter((i) => i.product_id === p.id);
      const byMarket: ProductRow["listings"] = {};
      for (const l of listings.filter((l) => l.product_id === p.id)) {
        byMarket[l.market_code] = l;
      }
      return {
        ...p,
        listings: byMarket,
        image_total: imgs.length,
        image_success: imgs.filter((i) => i.status === "success").length,
        image_failed: imgs.filter((i) => i.status === "failed" || i.status === "manual_required").length,
        image_processing: imgs.filter((i) =>
          ["queued", "downloading", "removing_bg", "composing", "uploading"].includes(i.status)
        ).length,
      };
    });
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
  }

  return (
    <div>
      <h2 className="text-lg font-bold mb-4">商品一覧 (Amazon仕入れ → Shopee)</h2>
      {loadError ? (
        <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          データ取得に失敗しました: {loadError}
          <br />
          「セットアップ」ページで接続とマイグレーション適用状況を確認してください。
        </div>
      ) : (
        <ProductsTable rows={rows} markets={markets} />
      )}
    </div>
  );
}
