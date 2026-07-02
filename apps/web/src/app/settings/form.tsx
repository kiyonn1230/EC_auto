"use client";

import { useState } from "react";
import type {
  AppSettings,
  CategoryDefault,
  ComplianceKeyword,
  ShippingRate,
} from "@/lib/types";

export function SettingsForm({
  settings,
  categoryDefaults,
  shippingRates,
  keywords,
}: {
  settings: AppSettings;
  categoryDefaults: CategoryDefault[];
  shippingRates: ShippingRate[];
  keywords: ComplianceKeyword[];
}) {
  const [s, setS] = useState(settings);
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

  const testShopify = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/export/shopify");
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "接続失敗");
      setMessage(`Shopify接続OK: ${json.shopName} (${json.domain})`);
    } catch (e) {
      setMessage(`Shopify接続エラー: ${e instanceof Error ? e.message : String(e)}`);
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
        <h3 className="text-sm font-bold mb-3">価格計算</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          <Field label="ストア通貨">
            <input
              value={s.store_currency}
              onChange={(e) => setS({ ...s, store_currency: e.target.value.toUpperCase() })}
              className="input"
            />
          </Field>
          <Field label={`為替 (JPY / 1 ${s.store_currency})`}>
            <input
              type="number" step="0.01"
              value={s.fx_rate_jpy_per_store}
              onChange={(e) => setS({ ...s, fx_rate_jpy_per_store: num(e.target.value) })}
              className="input"
            />
          </Field>
          <Field label="決済手数料率 (0.044 = 4.4%)">
            <input
              type="number" step="0.001"
              value={s.payment_fee_rate}
              onChange={(e) => setS({ ...s, payment_fee_rate: num(e.target.value) })}
              className="input"
            />
          </Field>
          <Field label="目標粗利率 (0.30 = 30%)">
            <input
              type="number" step="0.01"
              value={s.target_margin_rate}
              onChange={(e) => setS({ ...s, target_margin_rate: num(e.target.value) })}
              className="input"
            />
          </Field>
          <Field label="国内送料 (JPY)">
            <input
              type="number"
              value={s.domestic_shipping_jpy}
              onChange={(e) => setS({ ...s, domestic_shipping_jpy: num(e.target.value) })}
              className="input"
            />
          </Field>
          <Field label="容積重量係数 (cm3/kg)">
            <input
              type="number"
              value={s.volumetric_divisor}
              onChange={(e) => setS({ ...s, volumetric_divisor: num(e.target.value) })}
              className="input"
            />
          </Field>
          <Field label="既定キャリア">
            <input
              value={s.default_carrier}
              onChange={(e) => setS({ ...s, default_carrier: e.target.value })}
              className="input"
            />
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
        </div>
      </section>

      <section className="rounded border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-bold mb-3">画像処理</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          <Field label="背景除去プロバイダ">
            <select
              value={s.image_settings.bg_removal_provider}
              onChange={(e) =>
                setS({
                  ...s,
                  image_settings: {
                    ...s.image_settings,
                    bg_removal_provider: e.target.value as "rembg" | "external_api",
                  },
                })
              }
              className="input bg-white"
            >
              <option value="rembg">rembg (ローカル)</option>
              <option value="external_api">外部API (remove.bg互換)</option>
            </select>
          </Field>
          <Field label="rembgモデル">
            <select
              value={s.image_settings.bg_removal_model}
              onChange={(e) =>
                setS({
                  ...s,
                  image_settings: { ...s.image_settings, bg_removal_model: e.target.value },
                })
              }
              className="input bg-white"
            >
              <option value="u2net">u2net</option>
              <option value="isnet-general-use">isnet-general-use</option>
              <option value="birefnet-general">birefnet-general</option>
            </select>
          </Field>
          <Field label="キャンバスサイズ (px)">
            <input
              type="number"
              value={s.image_settings.canvas_size}
              onChange={(e) =>
                setS({
                  ...s,
                  image_settings: { ...s.image_settings, canvas_size: num(e.target.value) },
                })
              }
              className="input"
            />
          </Field>
          <Field label="余白率 (0.06 = 6%)">
            <input
              type="number" step="0.01"
              value={s.image_settings.margin_ratio}
              onChange={(e) =>
                setS({
                  ...s,
                  image_settings: { ...s.image_settings, margin_ratio: num(e.target.value) },
                })
              }
              className="input"
            />
          </Field>
          <Check
            label="サブ画像は透過PNGも生成"
            checked={s.image_settings.sub_transparent}
            onChange={(v) =>
              setS({ ...s, image_settings: { ...s.image_settings, sub_transparent: v } })
            }
          />
          <Check
            label="ウォーターマーク"
            checked={s.image_settings.watermark_enabled}
            onChange={(v) =>
              setS({ ...s, image_settings: { ...s.image_settings, watermark_enabled: v } })
            }
          />
          <Field label="ウォーターマーク文字列">
            <input
              value={s.image_settings.watermark_text}
              onChange={(e) =>
                setS({
                  ...s,
                  image_settings: { ...s.image_settings, watermark_text: e.target.value },
                })
              }
              className="input"
            />
          </Field>
          <Check
            label="ライフスタイル背景生成 (生成AI, 既定OFF)"
            checked={s.image_settings.lifestyle_enabled}
            onChange={(v) =>
              setS({ ...s, image_settings: { ...s.image_settings, lifestyle_enabled: v } })
            }
          />
        </div>
      </section>

      <section className="rounded border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-bold mb-3">Shopify出力</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          <Field label="Vendor">
            <input
              value={s.shopify_settings.vendor}
              onChange={(e) =>
                setS({ ...s, shopify_settings: { ...s.shopify_settings, vendor: e.target.value } })
              }
              className="input"
            />
          </Field>
          <Field label="既定Type">
            <input
              value={s.shopify_settings.default_product_type}
              onChange={(e) =>
                setS({
                  ...s,
                  shopify_settings: { ...s.shopify_settings, default_product_type: e.target.value },
                })
              }
              className="input"
            />
          </Field>
          <Field label="既定Status">
            <select
              value={s.shopify_settings.default_status}
              onChange={(e) =>
                setS({
                  ...s,
                  shopify_settings: {
                    ...s.shopify_settings,
                    default_status: e.target.value as "draft" | "active",
                  },
                })
              }
              className="input bg-white"
            >
              <option value="draft">draft (推奨)</option>
              <option value="active">active</option>
            </select>
          </Field>
          <Field label="在庫ポリシー">
            <select
              value={s.shopify_settings.inventory_policy}
              onChange={(e) =>
                setS({
                  ...s,
                  shopify_settings: {
                    ...s.shopify_settings,
                    inventory_policy: e.target.value as "continue" | "deny",
                  },
                })
              }
              className="input bg-white"
            >
              <option value="continue">continue (予約販売: 在庫切れでも販売)</option>
              <option value="deny">deny</option>
            </select>
          </Field>
          <Field label="出力モード既定">
            <select
              value={s.shopify_settings.output_mode}
              onChange={(e) =>
                setS({
                  ...s,
                  shopify_settings: {
                    ...s.shopify_settings,
                    output_mode: e.target.value as "csv" | "api",
                  },
                })
              }
              className="input bg-white"
            >
              <option value="api">Admin API (推奨)</option>
              <option value="csv">CSV</option>
            </select>
          </Field>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={testShopify}
            disabled={busy}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-100 disabled:opacity-50"
          >
            接続テスト
          </button>
          <p className="text-xs text-gray-500">
            ストアドメイン・アクセストークンは .env で管理します (この画面では変更できません)
          </p>
        </div>
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
                  <input
                    value={c.category}
                    onChange={(e) => setCats(cats.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))}
                    className="input"
                  />
                </td>
                {(["default_weight_g", "default_length_cm", "default_width_cm", "default_height_cm"] as const).map(
                  (f) => (
                    <td key={f} className="p-1">
                      <input
                        type="number"
                        value={c[f] ?? ""}
                        onChange={(e) =>
                          setCats(
                            cats.map((x, j) =>
                              j === i ? { ...x, [f]: e.target.value === "" ? null : Number(e.target.value) } : x
                            )
                          )
                        }
                        className="input w-20"
                      />
                    </td>
                  )
                )}
                <td className="p-1">
                  <button
                    onClick={() => setCats(cats.filter((_, j) => j !== i))}
                    className="text-xs text-red-600 hover:underline"
                  >
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          onClick={() =>
            setCats([...cats, { category: "", default_weight_g: 500, default_length_cm: null, default_width_cm: null, default_height_cm: null }])
          }
          className="mt-2 text-xs text-blue-700 hover:underline"
        >
          + 行を追加
        </button>
      </section>

      <section className="rounded border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-bold mb-3">国際送料テーブル</h3>
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
                  <input
                    value={r.carrier}
                    onChange={(e) => setRates(rates.map((x, j) => (j === i ? { ...x, carrier: e.target.value } : x)))}
                    className="input w-24"
                  />
                </td>
                {(["weight_from_g", "weight_to_g", "price_jpy"] as const).map((f) => (
                  <td key={f} className="p-1">
                    <input
                      type="number"
                      value={r[f]}
                      onChange={(e) =>
                        setRates(rates.map((x, j) => (j === i ? { ...x, [f]: Number(e.target.value) } : x)))
                      }
                      className="input w-28"
                    />
                  </td>
                ))}
                <td className="p-1">
                  <button
                    onClick={() => setRates(rates.filter((_, j) => j !== i))}
                    className="text-xs text-red-600 hover:underline"
                  >
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          onClick={() =>
            setRates([...rates, { carrier: s.default_carrier, weight_from_g: 0, weight_to_g: 0, price_jpy: 0 }])
          }
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
                  <input
                    value={k.keyword}
                    onChange={(e) => setKws(kws.map((x, j) => (j === i ? { ...x, keyword: e.target.value } : x)))}
                    className="input"
                  />
                </td>
                <td className="p-1">
                  <select
                    value={k.flag_type}
                    onChange={(e) =>
                      setKws(
                        kws.map((x, j) =>
                          j === i ? { ...x, flag_type: e.target.value as ComplianceKeyword["flag_type"] } : x
                        )
                      )
                    }
                    className="input bg-white"
                  >
                    <option value="ip_caution">IP注意</option>
                    <option value="bootleg_suspect">真贋要確認</option>
                    <option value="restricted_item">禁制品</option>
                  </select>
                </td>
                <td className="p-1">
                  <input
                    value={k.note ?? ""}
                    onChange={(e) => setKws(kws.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))}
                    className="input"
                  />
                </td>
                <td className="p-1">
                  <button
                    onClick={() => setKws(kws.filter((_, j) => j !== i))}
                    className="text-xs text-red-600 hover:underline"
                  >
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
