import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { loadSettings } from "@/lib/settings";

export const runtime = "nodejs";

/**
 * POST /api/image-jobs
 * body: { productIds?: string[], imageIds?: string[], force?: boolean }
 * 対象画像を queued にして image_jobs を積む。
 * force=false: pending/failed/manual_required のみ / force=true: success も再処理
 */
export async function POST(req: NextRequest) {
  try {
    const sb = supabaseAdmin();
    const body = await req.json().catch(() => ({}));
    const productIds: string[] = Array.isArray(body.productIds) ? body.productIds : [];
    const imageIds: string[] = Array.isArray(body.imageIds) ? body.imageIds : [];
    const force: boolean = body.force === true;

    if (productIds.length === 0 && imageIds.length === 0) {
      return NextResponse.json(
        { error: "productIds か imageIds を指定してください" },
        { status: 400 }
      );
    }

    let query = sb.from("product_images").select("id, status");
    if (imageIds.length > 0) {
      query = query.in("id", imageIds);
    } else {
      query = query.in("product_id", productIds);
    }
    if (!force) {
      query = query.in("status", ["pending", "failed", "manual_required"]);
    }
    const { data: images, error } = await query;
    if (error) throw new Error(error.message);
    if (!images || images.length === 0) {
      return NextResponse.json({ enqueued: 0, message: "対象画像がありません" });
    }

    const settings = await loadSettings();
    const payload = settings.image_settings; // 設定スナップショットをジョブに固定

    const ids = images.map((i) => i.id);
    const { error: jobErr } = await sb.from("image_jobs").insert(
      ids.map((product_image_id) => ({ product_image_id, payload }))
    );
    if (jobErr) throw new Error(jobErr.message);

    await sb.from("product_images").update({ status: "queued", error_message: null }).in("id", ids);

    return NextResponse.json({ enqueued: ids.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
