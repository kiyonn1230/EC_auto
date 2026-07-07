import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { Market, MarketListing, Product, ProductImage } from "@/lib/types";
import { ProductDetail } from "./detail";

export const dynamic = "force-dynamic";

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sb = supabaseAdmin();
  const [productRes, imagesRes, listingsRes, marketsRes] = await Promise.all([
    sb.from("products").select("*").eq("id", id).maybeSingle(),
    sb.from("product_images").select("*").eq("product_id", id).order("position"),
    sb.from("market_listings").select("*").eq("product_id", id),
    sb.from("markets").select("*").order("code"),
  ]);

  if (productRes.error || !productRes.data) notFound();

  return (
    <ProductDetail
      product={productRes.data as Product}
      images={(imagesRes.data ?? []) as ProductImage[]}
      listings={(listingsRes.data ?? []) as MarketListing[]}
      markets={(marketsRes.data ?? []) as Market[]}
    />
  );
}
