import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/server";
import { loadSettings } from "@/lib/settings";
import type { Product, ProductImage } from "@/lib/types";
import { ProductDetail } from "./detail";

export const dynamic = "force-dynamic";

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = supabaseAdmin();
  const [productRes, imagesRes, settings] = await Promise.all([
    sb.from("products").select("*").eq("id", id).maybeSingle(),
    sb.from("product_images").select("*").eq("product_id", id).order("position"),
    loadSettings(),
  ]);

  if (productRes.error || !productRes.data) notFound();

  return (
    <ProductDetail
      product={productRes.data as Product}
      images={(imagesRes.data ?? []) as ProductImage[]}
      currency={settings.store_currency}
    />
  );
}
