import { NextRequest, NextResponse } from "next/server";
import { ingestCostData, ingestProductData } from "@/lib/import/ingest";

export const runtime = "nodejs";
export const maxDuration = 300;

/** POST /api/import  (multipart: file, fileType=product_data|cost_data) */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const fileType = form.get("fileType");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "fileがありません" }, { status: 400 });
    }
    if (fileType !== "product_data" && fileType !== "cost_data") {
      return NextResponse.json(
        { error: "fileTypeは product_data | cost_data を指定してください" },
        { status: 400 }
      );
    }

    const buf = await file.arrayBuffer();
    const result =
      fileType === "product_data"
        ? await ingestProductData(buf, file.name)
        : await ingestCostData(buf, file.name);

    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
