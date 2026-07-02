"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Product, ProductImage } from "@/lib/types";

const IMAGE_STATUS_LABEL: Record<ProductImage["status"], { label: string; cls: string }> = {
  pending: { label: "未処理", cls: "bg-gray-100 text-gray-600" },
  queued: { label: "キュー待ち", cls: "bg-blue-100 text-blue-700" },
  downloading: { label: "DL中", cls: "bg-blue-100 text-blue-700" },
  removing_bg: { label: "背景除去中", cls: "bg-blue-100 text-blue-700" },
  composing: { label: "整形中", cls: "bg-blue-100 text-blue-700" },
  uploading: { label: "アップ中", cls: "bg-blue-100 text-blue-700" },
  success: { label: "成功", cls: "bg-emerald-100 text-emerald-700" },
  failed: { label: "失敗", cls: "bg-red-100 text-red-700" },
  manual_required: { label: "要手動対応", cls: "bg-red-200 text-red-800" },
};

export function ProductDetail({
  product,
  images,
  currency,
}: {
  product: Product;
  images: ProductImage[];
  currency: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    inventory_qty: product.inventory_qty,
    purchase_status: product.purchase_status,
    restock_recheck_flag: product.restock_recheck_flag,
    current_listed_price: product.current_listed_price ?? "",
    purchase_price_jpy: product.purchase_price_jpy ?? "",
    weight_g: product.weight_g ?? "",
  });

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inventory_qty: Number(form.inventory_qty) || 0,
          purchase_status: form.purchase_status,
          restock_recheck_flag: form.restock_recheck_flag,
          current_listed_price: form.current_listed_price === "" ? null : Number(form.current_listed_price),
          purchase_price_jpy: form.purchase_price_jpy === "" ? null : Number(form.purchase_price_jpy),
          weight_g: form.weight_g === "" ? null : Number(form.weight_g),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setMessage("保存しました (粗利も再計算済み)");
      router.refresh();
    } catch (e) {
      setMessage(`エラー: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const retryImage = async (imageId: string) => {
    setBusy(true);
    try {
      const res = await fetch("/api/image-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageIds: [imageId], force: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setMessage("再処理ジョブを投入しました");
      router.refresh();
    } catch (e) {
      setMessage(`エラー: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const bd = product.pricing_breakdown;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/products" className="text-sm text-blue-700 hover:underline">
          ← 商品一覧へ戻る
        </Link>
        <h2 className="mt-1 text-lg font-bold">{product.title}</h2>
        <p className="font-mono text-xs text-gray-500">SKU: {product.sku}</p>
      </div>

      {message && (
        <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          {message}
        </div>
      )}

      {(product.compliance_notes?.length ?? 0) > 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-bold text-amber-900 mb-1">コンプラ・真贋の注意</p>
          <ul className="list-disc pl-5 space-y-0.5 text-amber-900">
            {product.compliance_notes.map((n, i) => (
              <li key={i}>
                [{n.flag_type === "ip_caution" ? "IP注意" : n.flag_type === "bootleg_suspect" ? "真贋要確認" : "禁制品?"}]
                「{n.keyword}」({n.field}) {n.note && `— ${n.note}`}
              </li>
            ))}
          </ul>
          {product.compliance_bootleg_suspect && (
            <p className="mt-2 text-xs text-red-700 font-medium">
              ⚠ 偽物・ブートレグの出品は Shopify AUP 違反であり、決済停止・アカウント凍結のリスクがあります。
            </p>
          )}
        </div>
      )}

      <section className="rounded border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-bold mb-3">在庫・価格 (手動編集)</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          <label className="block">
            <span className="text-xs text-gray-500">在庫数</span>
            <input
              type="number"
              value={form.inventory_qty}
              onChange={(e) => setForm({ ...form, inventory_qty: Number(e.target.value) })}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">仕入れ状態</span>
            <select
              value={form.purchase_status}
              onChange={(e) =>
                setForm({ ...form, purchase_status: e.target.value as Product["purchase_status"] })
              }
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 bg-white"
            >
              <option value="unpurchased">未仕入</option>
              <option value="ordered">発注済</option>
              <option value="in_stock">在庫あり</option>
            </select>
          </label>
          <label className="flex items-end gap-2 pb-1">
            <input
              type="checkbox"
              checked={form.restock_recheck_flag}
              onChange={(e) => setForm({ ...form, restock_recheck_flag: e.target.checked })}
            />
            <span className="text-xs">元メルカリ在庫の再確認が必要</span>
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">現状売値 ({currency})</span>
            <input
              type="number"
              step="0.01"
              value={form.current_listed_price}
              onChange={(e) => setForm({ ...form, current_listed_price: e.target.value })}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">仕入価格 (JPY)</span>
            <input
              type="number"
              value={form.purchase_price_jpy}
              onChange={(e) => setForm({ ...form, purchase_price_jpy: e.target.value })}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">実重量 (g)</span>
            <input
              type="number"
              value={form.weight_g}
              onChange={(e) => setForm({ ...form, weight_g: e.target.value })}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            />
          </label>
        </div>
        <button
          onClick={save}
          disabled={busy}
          className="mt-3 rounded bg-gray-900 px-4 py-1.5 text-sm text-white hover:bg-gray-700 disabled:opacity-50"
        >
          保存して再計算
        </button>
      </section>

      <section className="rounded border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-bold mb-3">粗利内訳</h3>
        {bd ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Stat label="仕入" value={`¥${bd.purchase_price_jpy.toLocaleString()}`} />
            <Stat label="国内送料" value={`¥${bd.domestic_shipping_jpy.toLocaleString()}`} />
            <Stat
              label={`国際送料 (${bd.carrier})`}
              value={`¥${bd.intl_shipping_jpy.toLocaleString()}`}
            />
            <Stat label="課金重量" value={`${bd.chargeable_weight_g}g`} />
            <Stat label="総原価" value={`${bd.total_cost_store} ${bd.store_currency}`} />
            <Stat
              label="推奨売値"
              value={
                product.recommended_price !== null
                  ? `${product.recommended_price} ${bd.store_currency}`
                  : "—"
              }
            />
            <Stat
              label="現状売値の粗利率"
              value={
                product.gross_margin_rate !== null
                  ? `${(product.gross_margin_rate * 100).toFixed(1)}%${product.margin_alert ? " ⚠赤字" : ""}`
                  : "—"
              }
            />
            <Stat
              label="売値乖離"
              value={
                product.recommended_price !== null && product.current_listed_price !== null
                  ? `${(product.current_listed_price - product.recommended_price).toFixed(2)}`
                  : "—"
              }
            />
          </div>
        ) : (
          <p className="text-sm text-gray-400">未計算 (一覧の「全件再計算」を実行)</p>
        )}
        {bd && bd.warnings.length > 0 && (
          <ul className="mt-3 list-disc pl-5 text-xs text-amber-700 space-y-0.5">
            {bd.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-gray-500">
          重量: {product.weight_g ?? "—"}g ({sourceLabel(product.weight_source)}) / 寸法:{" "}
          {product.length_cm ?? "—"}×{product.width_cm ?? "—"}×{product.height_cm ?? "—"}cm (
          {sourceLabel(product.dimension_source)})
        </p>
      </section>

      <section className="rounded border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-bold mb-3">画像 ({images.length}件)</h3>
        {images.length === 0 && (
          <p className="text-sm text-gray-400">画像URLがありません</p>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {images.map((img) => {
            const st = IMAGE_STATUS_LABEL[img.status];
            return (
              <div key={img.id} className="rounded border border-gray-200 p-2 space-y-2">
                {/* 加工済みがあれば表示、なければ元URL */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.processed_url ?? img.source_url}
                  alt={`position ${img.position}`}
                  className="aspect-square w-full rounded object-contain bg-gray-50"
                />
                <div className="flex items-center justify-between text-xs">
                  <span className={`rounded px-1.5 py-0.5 ${st.cls}`}>{st.label}</span>
                  <span className="text-gray-400">#{img.position}</span>
                </div>
                {img.error_message && (
                  <p className="text-xs text-red-600 break-all">{img.error_message}</p>
                )}
                <div className="flex gap-2 text-xs">
                  {(img.status === "failed" || img.status === "manual_required" || img.status === "success") && (
                    <button
                      onClick={() => retryImage(img.id)}
                      disabled={busy}
                      className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-100 disabled:opacity-50"
                    >
                      再処理
                    </button>
                  )}
                  {img.transparent_url && (
                    <a
                      href={img.transparent_url}
                      target="_blank"
                      className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-100"
                    >
                      透過PNG
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {product.description_html && (
        <section className="rounded border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-bold mb-3">説明文 (Body HTML プレビュー)</h3>
          <div
            className="prose prose-sm max-w-none text-sm"
            dangerouslySetInnerHTML={{ __html: product.description_html }}
          />
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="font-medium tabular-nums">{value}</p>
    </div>
  );
}

function sourceLabel(s: string | null): string {
  switch (s) {
    case "measured": return "実測";
    case "category_default": return "カテゴリ既定値で補完";
    case "dummy_detected": return "ダミー値を検知して補完";
    case "missing": return "不明";
    default: return "未補正";
  }
}
