import { supabaseAdmin } from "@/lib/supabase/server";
import { loadSettings } from "@/lib/settings";
import type { Product, ProductImage } from "@/lib/types";
import { ProductsTable, type ProductRow } from "./table";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  let rows: ProductRow[] = [];
  let currency = "USD";
  let loadError: string | null = null;

  try {
    const sb = supabaseAdmin();
    const [productsRes, imagesRes, settings] = await Promise.all([
      sb.from("products").select("*").order("created_at", { ascending: false }),
      sb.from("product_images").select("id, product_id, status"),
      loadSettings(),
    ]);
    if (productsRes.error) throw new Error(productsRes.error.message);
    if (imagesRes.error) throw new Error(imagesRes.error.message);
    currency = settings.store_currency;

    const images = (imagesRes.data ?? []) as Pick<ProductImage, "id" | "product_id" | "status">[];
    rows = ((productsRes.data ?? []) as Product[]).map((p) => {
      const imgs = images.filter((i) => i.product_id === p.id);
      return {
        ...p,
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
      <h2 className="text-lg font-bold mb-4">商品一覧</h2>
      {loadError ? (
        <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          データ取得に失敗しました: {loadError}
          <br />
          Supabase接続設定 (.env.local) とマイグレーション適用を確認してください。
        </div>
      ) : (
        <ProductsTable rows={rows} currency={currency} />
      )}
    </div>
  );
}
