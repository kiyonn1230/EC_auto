import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import type { CategoryDefault, ComplianceKeyword, Market, ShippingRate } from "@/lib/types";

export const runtime = "nodejs";

/**
 * PUT /api/settings
 * body: {
 *   appSettings?: Record<string, unknown>,   // app_settings のkey-value
 *   markets?: Market[],                      // upsert (削除はしない)
 *   categoryDefaults?: CategoryDefault[],    // 全置換
 *   shippingRates?: ShippingRate[],          // 全置換
 *   keywords?: ComplianceKeyword[],          // 全置換
 * }
 * ※Shopee partner_key 等の秘匿情報はここでは扱わない (.env管理)
 */
export async function PUT(req: NextRequest) {
  try {
    const sb = supabaseAdmin();
    const body = await req.json();

    if (body.appSettings && typeof body.appSettings === "object") {
      const entries = Object.entries(body.appSettings as Record<string, unknown>).filter(
        ([k]) => k in DEFAULT_SETTINGS
      );
      for (const [key, value] of entries) {
        const { error } = await sb
          .from("app_settings")
          .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
        if (error) throw new Error(`app_settings(${key})保存失敗: ${error.message}`);
      }
    }

    if (Array.isArray(body.markets)) {
      const rows = (body.markets as Market[])
        .filter((m) => m.code && m.currency && Number.isFinite(Number(m.fx_rate_jpy)))
        .map((m) => ({
          code: m.code,
          name: m.name || `Shopee ${m.code}`,
          currency: m.currency,
          fx_rate_jpy: m.fx_rate_jpy,
          fee_rate: m.fee_rate,
          target_margin_rate: m.target_margin_rate,
          shipping_carrier: m.shipping_carrier,
          domestic_cost_jpy: m.domestic_cost_jpy,
          default_stock: m.default_stock,
          days_to_ship: m.days_to_ship,
          logistics_channel_id: m.logistics_channel_id,
          enabled: m.enabled,
        }));
      if (rows.length > 0) {
        const { error } = await sb.from("markets").upsert(rows, { onConflict: "code" });
        if (error) throw new Error(`markets保存失敗: ${error.message}`);
      }
    }

    if (Array.isArray(body.categoryDefaults)) {
      const rows = (body.categoryDefaults as CategoryDefault[]).filter(
        (r) => r.category && Number.isFinite(Number(r.default_weight_g))
      );
      const { error: delErr } = await sb.from("category_defaults").delete().neq("category", "");
      if (delErr) throw new Error(delErr.message);
      if (rows.length > 0) {
        const { error } = await sb.from("category_defaults").insert(rows);
        if (error) throw new Error(error.message);
      }
    }

    if (Array.isArray(body.shippingRates)) {
      const rows = (body.shippingRates as ShippingRate[])
        .filter((r) => r.carrier && Number.isFinite(Number(r.price_jpy)))
        .map(({ carrier, weight_from_g, weight_to_g, price_jpy }) => ({
          carrier, weight_from_g, weight_to_g, price_jpy,
        }));
      const { error: delErr } = await sb.from("shipping_rate_table").delete().neq("carrier", "");
      if (delErr) throw new Error(delErr.message);
      if (rows.length > 0) {
        const { error } = await sb.from("shipping_rate_table").insert(rows);
        if (error) throw new Error(error.message);
      }
    }

    if (Array.isArray(body.keywords)) {
      const rows = (body.keywords as ComplianceKeyword[])
        .filter((r) => r.keyword && r.flag_type)
        .map(({ keyword, flag_type, note }) => ({ keyword, flag_type, note }));
      const { error: delErr } = await sb.from("compliance_keywords").delete().neq("keyword", "");
      if (delErr) throw new Error(delErr.message);
      if (rows.length > 0) {
        const { error } = await sb.from("compliance_keywords").insert(rows);
        if (error) throw new Error(error.message);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
