"use client";

import { useState } from "react";
import type {
  AppSettings,
  CategoryDefault,
  ComplianceKeyword,
  Market,
  ShippingRate,
} from "@/lib/types";

export function SettingsForm({
  settings,
  markets,
  categoryDefaults,
  shippingRates,
  keywords,
}: {
  settings: AppSettings;
  markets: Market[];
  categoryDefaults: CategoryDefault[];
  shippingRates: ShippingRate[];
  keywords: ComplianceKeyword[];
}) {
  const [s, setS] = useState(settings);
  const [mkts, setMkts] = useState(markets);
  const [cats, setCats] = useState(categoryDefaults);
  const [rates, setRates] = useState(shippingRates);
  const [kws, setKws] = useState(keywords);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const save = async (recalc: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appSettings: s,
          markets: mkts,
          categoryDefaults: cats,
          shippingRates: rates,
          keywords: kws,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      let msg = "設定を保存しました";
      if (recalc) {
        const r2 = await fetch("/api/recalculate", { method: "POST" });
        const j2 = await r2.json();
        if (!r2.ok) throw new Error(j2.error);
        msg += `。${j2.updated}件を再計算しました`;
      }
      setMessage(msg);
    } catch (e) {
      setMessage(`エラー: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const num = (v: string) => (v === "" ? 0 : Number(v));

  return (
    <div className="space-y-6">
      {message && (
        <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          {message}
        </div>
      )}

      <section className="rounded border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-bold mb-1">市場 (Shopeeマーケット)</h3>
        <p className="text-xs text-gray-500 mb-3">
          為替は「1通貨あたりの円」。手数料はShopeeの販売+決済+サービスの合計率。
          
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-600">
              <tr>
                <th className="p-1">コード</th>
                <th className="p-1">通貨</th>
                <th className="p-1">為替(JPY)</th>
                <th className="p-1">手数料率</th>
                <th className="p-1">目標粗利率</th>
                <th className="p-1">送料キャリア</th>
                <th className="p-1">国内費用¥</th>
                <th className="p-1">表示在庫</th>
                <th className="p-1">DTS日</th>
                <th className="p-1">物流ch ID</th>
                <th className="p-1">有効</th>
              </tr>
            </thead>
            <tbody>
              {mkts.map((m, i) => (
                <tr key={m.code}>
                  <td className="p-1 font-mono">{m.code}</td>
                  <td className="p-1">
                    <input value={m.currency} onChange={(e) => setMkts(mkts.map((x, j) => (j === i ? { ...x, currency: e.target.value.toUpperCase() } : x)))} className="input w-16" />
                  </td>
                  <td className="p-1">
                    <input type="number" step="0.01" value={m.fx_rate_jpy} onChange={(e) => setMkts(mkts.map((x, j) => (j === i ? { ...x, fx_rate_jpy: num(e.target.value) } : x)))} className="input w-20" />
                  </td>
                  <td className="p-1">
                    <input type="number" step="0.001" value={m.fee_rate} onChange={(e) => setMkts(mkts.map((x, j) => (j === i ? { ...x, fee_rate: num(e.target.value) } : x)))} className="input w-20" />
                  </td>
                  <td className="p-1">
                    <input type="number" step="0.01" value={m.target_margin_rate} onChange={(e) => setMkts(mkts.map((x, j) => (j === i ? { ...x, target_margin_rate: num(e.target.value) } : x)))} className="input w-20" />
                  </td>
                  <td className="p-1">
                    <input value={m.shipping_carrier} onChange={(e) => setMkts(mkts.map((x, j) => (j === i ? { ...x, shipping_carrier: e.target.value } : x)))} className="input w-24" />
                  </td>
                  <td className="p-1">
                    <input type="number" value={m.domestic_cost_jpy} onChange={(e) => setMkts(mkts.map((x, j) => (j === i ? { ...x, domestic_cost_jpy: num(e.target.value) } : x)))} className="input w-20" />
                  </td>
                  <td className="p-1">
                    <input type="number" value={m.default_stock} onChange={(e) => setMkts(mkts.map((x, j) => (j === i ? { ...x, default_stock: Math.round(num(e.target.value)) } : x)))} className="input w-16" />
                  </td>
                  <td className="p-1">
                    <input type="number" value={m.days_to_ship} onChange={(e) => setMkts(mkts.map((x, j) => (j === i ? { ...x, days_to_ship: Math.round(num(e.target.value)) } : x)))} className="input w-16" />
                  </td>
                  <td className="p-1">
                    <input type="number" value={m.logistics_channel_id ?? ""} onChange={(e) => setMkts(mkts.map((x, j) => (j === i ? { ...x, logistics_channel_id: e.target.value === "" ? null : Math.round(num(e.target.value)) } : x)))} className="input w-24" />
                  </td>
                  <td className="p-1 text-center">
                    <input type="checkbox" checked={m.enabled} onChange={(e) => setMkts(mkts.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <AddMarket onAdd={(m) => setMkts([...mkts, m])} existing={mkts.map((m) => m.code)} />
      </section>

      <section className="rounded border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-bold mb-3">共通設定</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          <Field label="容積重量係数 (cm3/kg)">
            <input type="number" value={s.volumetric_divisor} onChange={(e) => setS({ ...s, volumetric_divisor: num(e.target.value) })} className="input" />
          </Field>
          <Field label="Amazon側送料等 (JPY)">
            <input type="number" value={s.amazon_domestic_shipping_jpy} onChange={(e) => setS({ ...s, amazon_domestic_shipping_jpy: num(e.target.value) })} className="input" />
          </Field>
          <Field label="ダミー重量値 (カンマ区切り)">
            <input
              value={s.dummy_weight_values.join(",")}
              onChange={(e) =>
                setS({
                  ...s,
                  dummy_weight_values: e.target.value
                    .split(",")
                    .map((v) => Number(v.trim()))
                    .filter((v) => Number.isFinite(v)),
                })
              }
              className="input"
            />
          </Field>
          <Field label="発送目安の定型文 (説明文末尾に追加)">
            <textarea
              value={s.shipping_note_text}
              onChange={(e) => setS({ ...s, shipping_note_text: e.target.value })}
              rows={2}
              className="input"
            />
          </Field>
        </div>
      </section>

      <section className="rounded border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-bold mb-3">画像処理</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          <Field label="背景除去プロバイダ">
            <select
              value={s.image_settings.bg_removal_provider}
              onChange={(e) => setS({ ...s, image_settings: { ...s.image_settings, bg_removal_provider: e.target.value as "rembg" | "external_api" } })}
              className="input bg-white"
            >
              <option value="rembg">rembg (ローカル)</option>
              <option value="external_api">外部API (remove.bg互換)</option>
            </select>
          </Field>
          <Field label="rembgモデル">
            <select
              value={s.image_settings.bg_removal_model}
              onChange={(e) => setS({ ...s, image_settings: { ...s.image_settings, bg_removal_model: e.target.value } })}
              className="input bg-white"
            >
              <option value="u2net">u2net</option>
              <option value="isnet-general-use">isnet-general-use</option>
              <option value="birefnet-general">birefnet-general</option>
            </select>
          </Field>
          <Field label="キャンバスサイズ (px)">
            <input type="number" value={s.image_settings.canvas_size} onChange={(e) => setS({ ...s, image_settings: { ...s.image_settings, canvas_size: num(e.target.value) } })} className="input" />
          </Field>
          <Field label="余白率 (0.06 = 6%)">
            <input type="number" step="0.01" value={s.image_settings.margin_ratio} onChange={(e) => setS({ ...s, image_settings: { ...s.image_settings, margin_ratio: num(e.target.value) } })} className="input" />
          </Field>
          <Check label="サブ画像は透過PNGも生成" checked={s.image_settings.sub_transparent} onChange={(v) => setS({ ...s, image_settings: { ...s.image_settings, sub_transparent: v } })} />
          <Check label="ウォーターマーク" checked={s.image_settings.watermark_enabled} onChange={(v) => setS({ ...s, image_settings: { ...s.image_settings, watermark_enabled: v } })} />
          <Field label="ウォーターマーク文字列">
            <input value={s.image_settings.watermark_text} onChange={(e) => setS({ ...s, image_settings: { ...s.image_settings, watermark_text: e.target.value } })} className="input" />
          </Field>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          ※Amazonの商品画像は出品者・メーカーに権利があります。加工しても権利問題は消えないため、
          可能な限り自前で撮影した画像や権利者の許諾がある画像を使ってください。
        </p>
      </section>

      <section className="rounded border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-bold mb-3">国際送料テーブル (キャリア別)</h3>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-gray-600">
            <tr>
              <th className="p-1">キャリア</th>
              <th className="p-1">重量From(g)</th>
              <th className="p-1">重量To(g)</th>
              <th className="p-1">料金(JPY)</th>
              <th className="p-1"></th>
            </tr>
          </thead>
          <tbody>
            {rates.map((r, i) => (
              <tr key={i}>
                <td className="p-1">
                  <input value={r.carrier} onChange={(e) => setRates(rates.map((x, j) => (j === i ? { ...x, carrier: e.target.value } : x)))} className="input w-28" />
                </td>
                {(["weight_from_g", "weight_to_g", "price_jpy"] as const).map((f) => (
                  <td key={f} className="p-1">
                    <input type="number" value={r[f]} onChange={(e) => setRates(rates.map((x, j) => (j === i ? { ...x, [f]: Number(e.target.value) } : x)))} className="input w-28" />
                  </td>
                ))}
                <td className="p-1">
                  <button onClick={() => setRates(rates.filter((_, j) => j !== i))} className="text-xs text-red-600 hover:underline">
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          onClick={() => setRates([...rates, { carrier: "SLS-SG", weight_from_g: 0, weight_to_g: 0, price_jpy: 0 }])}
          className="mt-2 text-xs text-blue-700 hover:underline"
        >
          + 行を追加
        </button>
      </section>

      <section className="rounded border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-bold mb-3">カテゴリ別デフォルト重量・寸法</h3>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-gray-600">
            <tr>
              <th className="p-1">カテゴリ</th>
              <th className="p-1">重量g</th>
              <th className="p-1">長cm</th>
              <th className="p-1">幅cm</th>
              <th className="p-1">高cm</th>
              <th className="p-1"></th>
            </tr>
          </thead>
          <tbody>
            {cats.map((c, i) => (
              <tr key={i}>
                <td className="p-1">
                  <input value={c.category} onChange={(e) => setCats(cats.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))} className="input" />
                </td>
                {(["default_weight_g", "default_length_cm", "default_width_cm", "default_height_cm"] as const).map((f) => (
                  <td key={f} className="p-1">
                    <input
                      type="number"
                      value={c[f] ?? ""}
                      onChange={(e) => setCats(cats.map((x, j) => (j === i ? { ...x, [f]: e.target.value === "" ? null : Number(e.target.value) } : x)))}
                      className="input w-20"
                    />
                  </td>
                ))}
                <td className="p-1">
                  <button onClick={() => setCats(cats.filter((_, j) => j !== i))} className="text-xs text-red-600 hover:underline">
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          onClick={() => setCats([...cats, { category: "", default_weight_g: 500, default_length_cm: null, default_width_cm: null, default_height_cm: null }])}
          className="mt-2 text-xs text-blue-700 hover:underline"
        >
          + 行を追加
        </button>
      </section>

      <section className="rounded border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-bold mb-3">コンプラ・真贋キーワード</h3>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-gray-600">
            <tr>
              <th className="p-1">キーワード</th>
              <th className="p-1">種類</th>
              <th className="p-1">メモ</th>
              <th className="p-1"></th>
            </tr>
          </thead>
          <tbody>
            {kws.map((k, i) => (
              <tr key={i}>
                <td className="p-1">
                  <input value={k.keyword} onChange={(e) => setKws(kws.map((x, j) => (j === i ? { ...x, keyword: e.target.value } : x)))} className="input" />
                </td>
                <td className="p-1">
                  <select
                    value={k.flag_type}
                    onChange={(e) => setKws(kws.map((x, j) => (j === i ? { ...x, flag_type: e.target.value as ComplianceKeyword["flag_type"] } : x)))}
                    className="input bg-white"
                  >
                    <option value="ip_caution">IP注意</option>
                    <option value="bootleg_suspect">真贋要確認</option>
                    <option value="restricted_item">禁制品</option>
                  </select>
                </td>
                <td className="p-1">
                  <input value={k.note ?? ""} onChange={(e) => setKws(kws.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} className="input" />
                </td>
                <td className="p-1">
                  <button onClick={() => setKws(kws.filter((_, j) => j !== i))} className="text-xs text-red-600 hover:underline">
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          onClick={() => setKws([...kws, { keyword: "", flag_type: "ip_caution", note: "" }])}
          className="mt-2 text-xs text-blue-700 hover:underline"
        >
          + 行を追加
        </button>
      </section>

      <div className="flex gap-3">
        <button
          onClick={() => save(false)}
          disabled={busy}
          className="rounded bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {busy ? "保存中..." : "保存"}
        </button>
        <button
          onClick={() => save(true)}
          disabled={busy}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          保存して全件再計算
        </button>
      </div>
    </div>
  );
}

function AddMarket({ onAdd, existing }: { onAdd: (m: Market) => void; existing: string[] }) {
  const [code, setCode] = useState("");
  return (
    <div className="mt-2 flex items-center gap-2 text-xs">
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="MY"
        maxLength={3}
        className="input w-16"
      />
      <button
        onClick={() => {
          const c = code.trim();
          if (!c || existing.includes(c)) return;
          onAdd({
            code: c,
            name: `Shopee ${c}`,
            currency: c === "MY" ? "MYR" : c === "TH" ? "THB" : c === "PH" ? "PHP" : "USD",
            fx_rate_jpy: 30,
            fee_rate: 0.1,
            target_margin_rate: 0.3,
            shipping_carrier: `SLS-${c}`,
            domestic_cost_jpy: 0,
            default_stock: 1,
            days_to_ship: 7,
            logistics_channel_id: null,
            enabled: true,
          });
          setCode("");
        }}
        className="text-blue-700 hover:underline"
      >
        + 市場を追加
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-end gap-2 pb-1">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-xs">{label}</span>
    </label>
  );
}
