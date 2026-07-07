"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Market, MarketListing, Product } from "@/lib/types";

export type ProductRow = Product & {
  listings: Record<string, MarketListing>;
  image_total: number;
  image_success: number;
  image_failed: number;
  image_processing: number;
};

type FilterKey = "all" | "margin_alert" | "flagged" | "image_failed" | "oos" | "update_required";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "margin_alert", label: "赤字のみ" },
  { key: "flagged", label: "コンプラフラグ" },
  { key: "image_failed", label: "画像失敗" },
  { key: "oos", label: "Amazon在庫切れ" },
  { key: "update_required", label: "要更新/エラー" },
];

const LISTING_STATUS: Record<MarketListing["status"], { label: string; cls: string }> = {
  draft: { label: "未出品", cls: "bg-gray-100 text-gray-600" },
  ready: { label: "準備OK", cls: "bg-blue-100 text-blue-700" },
  exported_xlsx: { label: "xlsx出力済", cls: "bg-emerald-50 text-emerald-700" },
  listed: { label: "出品中", cls: "bg-emerald-100 text-emerald-700" },
  update_required: { label: "要更新", cls: "bg-amber-100 text-amber-800" },
  delisted: { label: "取下げ", cls: "bg-gray-200 text-gray-600" },
  error: { label: "エラー", cls: "bg-red-100 text-red-700" },
};

export function ProductsTable({ rows, markets }: { rows: ProductRow[]; markets: Market[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [marketCode, setMarketCode] = useState(markets[0]?.code ?? "SG");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = rows;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (r) =>
          r.sku.toLowerCase().includes(q) ||
          r.title.toLowerCase().includes(q) ||
          (r.ip_name ?? "").toLowerCase().includes(q)
      );
    }
    switch (filter) {
      case "margin_alert":
        list = list.filter((r) => Object.values(r.listings).some((l) => l.margin_alert));
        break;
      case "flagged":
        list = list.filter(
          (r) => r.compliance_ip_caution || r.compliance_bootleg_suspect || r.compliance_restricted_item
        );
        break;
      case "image_failed":
        list = list.filter((r) => r.image_failed > 0);
        break;
      case "oos":
        list = list.filter((r) => r.source_stock_status === "out_of_stock");
        break;
      case "update_required":
        list = list.filter((r) =>
          Object.values(r.listings).some((l) => l.status === "update_required" || l.status === "error")
        );
        break;
    }
    return list;
  }, [rows, search, filter]);

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((r) => r.id)));
  };
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  // 対象市場の粗利率で降順ソートした表示 (利益率がよいものから選ぶ)
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const ma = a.listings[marketCode]?.gross_margin_rate ?? -Infinity;
      const mb = b.listings[marketCode]?.gross_margin_rate ?? -Infinity;
      return mb - ma;
    });
  }, [filtered, marketCode]);

  const selectProfitable = () => {
    const ids = sorted
      .filter((r) => {
        const l = r.listings[marketCode];
        if (!l || l.gross_margin_rate === null || l.margin_alert) return false;
        const target = markets.find((m) => m.code === marketCode)?.target_margin_rate ?? 0;
        return l.gross_margin_rate >= target;
      })
      .filter(
        (r) =>
          !r.compliance_bootleg_suspect &&
          !r.compliance_restricted_item &&
          r.source_stock_status !== "out_of_stock"
      )
      .map((r) => r.id);
    setSelected(new Set(ids));
    setMessage(
      ids.length > 0
        ? `目標粗利率を満たす${ids.length}件を選択しました (真贋要確認・禁制品・Amazon在庫切れは除外)`
        : "目標粗利率を満たす商品がありません (取込後に「全件再計算」を実行したか確認)"
    );
  };

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label);
    setMessage(null);
    try {
      setMessage(await fn());
      router.refresh();
    } catch (e) {
      setMessage(`エラー: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const needSelection = () => {
    if (selected.size === 0) {
      setMessage("行を選択してください");
      return true;
    }
    return false;
  };

  const enqueueImages = () => {
    if (needSelection()) return;
    run("enqueue", async () => {
      const res = await fetch("/api/image-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: [...selected] }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      return `画像処理ジョブを${json.enqueued}件投入しました`;
    });
  };

  const exportXlsx = () => {
    if (needSelection()) return;
    run("xlsx", async () => {
      const res = await fetch("/api/export/shopee-xlsx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: [...selected], marketCode }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `shopee-${marketCode}-paste-rows.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      return `${marketCode}向けの貼り付け用xlsxをダウンロードしました (公式テンプレの7行目以降にコピペしてアップロード)`;
    });
  };

  const recalculate = () =>
    run("recalc", async () => {
      const res = await fetch("/api/recalculate", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      return `${json.updated}/${json.total}件を再計算しました`;
    });

  const fmt = (v: number | null | undefined) =>
    v === null || v === undefined ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="ASIN / 商品名 / 作品で検索"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 rounded border border-gray-300 px-3 py-1.5 text-sm bg-white"
        />
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded px-3 py-1.5 text-sm border ${
              filter === f.key
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white border-gray-300 hover:bg-gray-100"
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="text-sm text-gray-500 ml-auto">
          {filtered.length}件 / 選択{selected.size}件
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-gray-600">
          対象市場:
          <select
            value={marketCode}
            onChange={(e) => setMarketCode(e.target.value)}
            className="ml-1 rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
          >
            {markets.map((m) => (
              <option key={m.code} value={m.code}>
                {m.code} ({m.currency})
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={selectProfitable}
          disabled={busy !== null}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          利益率が目標以上を全選択
        </button>
        <button
          onClick={enqueueImages}
          disabled={busy !== null}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy === "enqueue" ? "投入中..." : "選択行の画像を処理"}
        </button>
        <button
          onClick={exportXlsx}
          disabled={busy !== null}
          className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy === "xlsx" ? "生成中..." : "一括アップ用xlsx"}
        </button>
        <button
          onClick={recalculate}
          disabled={busy !== null}
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-100 disabled:opacity-50"
        >
          {busy === "recalc" ? "再計算中..." : "全件再計算"}
        </button>
      </div>

      {message && (
        <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          {message}
        </div>
      )}

      <div className="overflow-x-auto rounded border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-left text-xs text-gray-600">
            <tr>
              <th className="p-2">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onChange={toggleAll}
                />
              </th>
              <th className="p-2">ASIN</th>
              <th className="p-2">商品名</th>
              <th className="p-2">Amazon価格</th>
              <th className="p-2">Amazon在庫</th>
              {markets.map((m) => (
                <th key={m.code} className="p-2">
                  {m.code} 推奨売値 / 粗利率 / 状態
                </th>
              ))}
              <th className="p-2">画像</th>
              <th className="p-2">フラグ</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const flagged =
                r.compliance_ip_caution || r.compliance_bootleg_suspect || r.compliance_restricted_item;
              const anyAlert = Object.values(r.listings).some((l) => l.margin_alert);
              return (
                <tr
                  key={r.id}
                  className={`border-t border-gray-100 ${
                    anyAlert ? "bg-red-50" : flagged ? "bg-amber-50" : ""
                  }`}
                >
                  <td className="p-2">
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </td>
                  <td className="p-2 font-mono text-xs">
                    {r.amazon_url ? (
                      <a href={r.amazon_url} target="_blank" className="text-blue-700 hover:underline">
                        {r.sku}
                      </a>
                    ) : (
                      r.sku
                    )}
                  </td>
                  <td className="p-2 max-w-64">
                    <Link href={`/products/${r.id}`} className="text-blue-700 hover:underline line-clamp-2">
                      {r.title}
                    </Link>
                  </td>
                  <td className="p-2 tabular-nums">
                    {r.purchase_price_jpy !== null ? `¥${r.purchase_price_jpy.toLocaleString()}` : "—"}
                  </td>
                  <td className="p-2 text-xs">
                    {r.source_stock_status === "in_stock" && <span className="text-emerald-700">あり</span>}
                    {r.source_stock_status === "out_of_stock" && (
                      <span className="rounded bg-red-100 px-1 py-0.5 text-red-700 font-medium">切れ</span>
                    )}
                    {r.source_stock_status === "unknown" && <span className="text-gray-400">不明</span>}
                  </td>
                  {markets.map((m) => {
                    const l = r.listings[m.code];
                    if (!l) {
                      return (
                        <td key={m.code} className="p-2 text-xs text-gray-400">
                          —
                        </td>
                      );
                    }
                    const st = LISTING_STATUS[l.status];
                    return (
                      <td key={m.code} className="p-2 text-xs whitespace-nowrap">
                        <span className="tabular-nums">{fmt(l.recommended_price)}</span>
                        <span
                          className={`ml-1 tabular-nums ${l.margin_alert ? "font-bold text-red-600" : "text-gray-500"}`}
                        >
                          {l.gross_margin_rate !== null ? `${(l.gross_margin_rate * 100).toFixed(0)}%` : ""}
                          {l.margin_alert && "⚠"}
                        </span>
                        <span className={`ml-1 rounded px-1 py-0.5 ${st.cls}`}>{st.label}</span>
                      </td>
                    );
                  })}
                  <td className="p-2 text-xs">
                    {r.image_total === 0 ? (
                      <span className="text-gray-400">なし</span>
                    ) : (
                      <span>
                        <span className="text-emerald-700">{r.image_success}</span>/{r.image_total}
                        {r.image_processing > 0 && (
                          <span className="ml-1 text-blue-600">処理中{r.image_processing}</span>
                        )}
                        {r.image_failed > 0 && (
                          <span className="ml-1 rounded bg-red-100 px-1 text-red-700">失敗{r.image_failed}</span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="p-2 text-xs space-x-1">
                    {r.compliance_ip_caution && (
                      <span className="rounded bg-amber-100 px-1 py-0.5 text-amber-800">IP注意</span>
                    )}
                    {r.compliance_bootleg_suspect && (
                      <span className="rounded bg-orange-100 px-1 py-0.5 text-orange-800">真贋要確認</span>
                    )}
                    {r.compliance_restricted_item && (
                      <span className="rounded bg-red-100 px-1 py-0.5 text-red-800">禁制品?</span>
                    )}
                    {(r.weight_source === "category_default" || r.weight_source === "dummy_detected") && (
                      <span className="rounded bg-gray-100 px-1 py-0.5 text-gray-600">重量補完</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8 + markets.length} className="p-8 text-center text-gray-400">
                  商品がありません。「取込・検証」からAmazon仕入れリストxlsxを取り込んでください
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500">
        ※一覧は選択中の市場の粗利率が高い順に並びます。Amazon在庫切れの商品はShopee表示在庫0で計算されます。
        真贋要確認フラグ付き商品の出品はアカウント停止リスクがあります。
      </p>
    </div>
  );
}
