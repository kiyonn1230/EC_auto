"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Product } from "@/lib/types";

export type ProductRow = Product & {
  image_total: number;
  image_success: number;
  image_failed: number;
  image_processing: number;
};

type SortKey = "sku" | "title" | "purchase_price_jpy" | "recommended_price" | "gross_margin_rate" | "inventory_qty";
type FilterKey = "all" | "margin_alert" | "flagged" | "image_failed" | "recheck";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "margin_alert", label: "赤字のみ" },
  { key: "flagged", label: "コンプラフラグ" },
  { key: "image_failed", label: "画像失敗" },
  { key: "recheck", label: "在庫要再確認" },
];

export function ProductsTable({ rows, currency }: { rows: ProductRow[]; currency: string }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sortKey, setSortKey] = useState<SortKey>("sku");
  const [sortAsc, setSortAsc] = useState(true);
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
          (r.ip_name ?? "").toLowerCase().includes(q) ||
          (r.character_name ?? "").toLowerCase().includes(q)
      );
    }
    switch (filter) {
      case "margin_alert":
        list = list.filter((r) => r.margin_alert);
        break;
      case "flagged":
        list = list.filter(
          (r) => r.compliance_ip_caution || r.compliance_bootleg_suspect || r.compliance_restricted_item
        );
        break;
      case "image_failed":
        list = list.filter((r) => r.image_failed > 0);
        break;
      case "recheck":
        list = list.filter((r) => r.restock_recheck_flag);
        break;
    }
    return [...list].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
      return sortAsc ? cmp : -cmp;
    });
  }, [rows, search, filter, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((r) => r.id)));
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const withSelection = async (
    label: string,
    fn: (ids: string[]) => Promise<string>
  ) => {
    if (selected.size === 0) {
      setMessage("行を選択してください");
      return;
    }
    setBusy(label);
    setMessage(null);
    try {
      const result = await fn([...selected]);
      setMessage(result);
      router.refresh();
    } catch (e) {
      setMessage(`エラー: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const enqueueImages = () =>
    withSelection("enqueue", async (ids) => {
      const res = await fetch("/api/image-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: ids }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      return `画像処理ジョブを${json.enqueued}件投入しました`;
    });

  const exportCsv = () =>
    withSelection("csv", async (ids) => {
      const res = await fetch("/api/export/csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: ids }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `shopify-products-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      return `CSVを${ids.length}商品分ダウンロードしました`;
    });

  const exportApi = () =>
    withSelection("api", async (ids) => {
      const res = await fetch("/api/export/shopify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: ids }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      const failures = (json.results ?? []).filter((r: { ok: boolean }) => !r.ok);
      let msg = `Shopifyにdraft作成: 成功${json.created}件 / 失敗${json.failed}件`;
      if (failures.length > 0) {
        msg += ` — ${failures.map((f: { sku: string; error: string }) => `${f.sku}: ${f.error}`).join(" | ")}`;
      }
      return msg;
    });

  const recalculate = async () => {
    setBusy("recalc");
    setMessage(null);
    try {
      const res = await fetch("/api/recalculate", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setMessage(`${json.updated}/${json.total}件を再計算しました`);
      router.refresh();
    } catch (e) {
      setMessage(`エラー: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const fmtMoney = (v: number | null, unit: string) =>
    v === null ? "—" : `${unit}${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const fmtRate = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="SKU / 商品名 / 作品 / キャラで検索"
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

      <div className="flex flex-wrap gap-2">
        <button
          onClick={enqueueImages}
          disabled={busy !== null}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy === "enqueue" ? "投入中..." : "選択行の画像を処理"}
        </button>
        <button
          onClick={exportCsv}
          disabled={busy !== null}
          className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy === "csv" ? "生成中..." : "CSVエクスポート (6a)"}
        </button>
        <button
          onClick={exportApi}
          disabled={busy !== null}
          className="rounded bg-purple-600 px-3 py-1.5 text-sm text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {busy === "api" ? "作成中..." : "Shopifyへdraft作成 (6b)"}
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
              {(
                [
                  ["sku", "SKU"],
                  ["title", "商品名"],
                  ["purchase_price_jpy", "仕入(JPY)"],
                  ["recommended_price", `推奨売値(${currency})`],
                  ["gross_margin_rate", "粗利率"],
                  ["inventory_qty", "在庫"],
                ] as [SortKey, string][]
              ).map(([key, label]) => (
                <th
                  key={key}
                  className="p-2 cursor-pointer select-none hover:text-gray-900"
                  onClick={() => toggleSort(key)}
                >
                  {label}
                  {sortKey === key ? (sortAsc ? " ▲" : " ▼") : ""}
                </th>
              ))}
              <th className="p-2">画像</th>
              <th className="p-2">フラグ</th>
              <th className="p-2">要再確認</th>
              <th className="p-2">出力</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const flagged =
                r.compliance_ip_caution || r.compliance_bootleg_suspect || r.compliance_restricted_item;
              return (
                <tr
                  key={r.id}
                  className={`border-t border-gray-100 ${
                    r.margin_alert ? "bg-red-50" : flagged ? "bg-amber-50" : ""
                  }`}
                >
                  <td className="p-2">
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </td>
                  <td className="p-2 font-mono text-xs">{r.sku}</td>
                  <td className="p-2 max-w-64">
                    <Link href={`/products/${r.id}`} className="text-blue-700 hover:underline line-clamp-2">
                      {r.title}
                    </Link>
                  </td>
                  <td className="p-2 tabular-nums">{fmtMoney(r.purchase_price_jpy, "¥")}</td>
                  <td className="p-2 tabular-nums">{fmtMoney(r.recommended_price, "")}</td>
                  <td className={`p-2 tabular-nums ${r.margin_alert ? "font-bold text-red-600" : ""}`}>
                    {fmtRate(r.gross_margin_rate)}
                    {r.margin_alert && " ⚠"}
                  </td>
                  <td className="p-2 tabular-nums">{r.inventory_qty}</td>
                  <td className="p-2 text-xs">
                    {r.image_total === 0 ? (
                      <span className="text-gray-400">なし</span>
                    ) : (
                      <span>
                        <span className="text-emerald-700">{r.image_success}</span>
                        {"/"}
                        {r.image_total}
                        {r.image_processing > 0 && (
                          <span className="ml-1 text-blue-600">処理中{r.image_processing}</span>
                        )}
                        {r.image_failed > 0 && (
                          <span className="ml-1 rounded bg-red-100 px-1 text-red-700">
                            失敗{r.image_failed}
                          </span>
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
                  <td className="p-2 text-center">{r.restock_recheck_flag ? "✔" : ""}</td>
                  <td className="p-2 text-xs">
                    {r.export_status === "api_created" && <span className="text-purple-700">API済</span>}
                    {r.export_status === "csv_exported" && <span className="text-emerald-700">CSV済</span>}
                    {r.export_status === "api_failed" && <span className="text-red-600">API失敗</span>}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={11} className="p-8 text-center text-gray-400">
                  商品がありません。「取込・検証」からxlsxを取り込んでください
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500">
        ※真贋要確認フラグ付き商品の出品は Shopify AUP 違反・決済停止リスクがあります。出品前に必ず現物確認してください。
      </p>
    </div>
  );
}
