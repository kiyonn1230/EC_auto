import { NextRequest, NextResponse } from "next/server";
import { ingestProductData } from "@/lib/import/ingest";

export const runtime = "nodejs";
export const maxDuration = 300;

/** POST /api/import  (multipart: file = Amazon仕入れリストxlsx) */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "fileがありません" }, { status: 400 });
    }
    const buf = await file.arrayBuffer();
    const result = await ingestProductData(buf, file.name);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
