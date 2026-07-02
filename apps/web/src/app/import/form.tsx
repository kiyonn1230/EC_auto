"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ImportForm() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const upload = async (fileType: "product_data" | "cost_data", file: File | null) => {
    if (!file) return;
    setBusy(fileType);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("fileType", fileType);
      const res = await fetch("/api/import", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setMessage(
        `取込完了: ${json.okCount}/${json.rowCount}行を保存、問題${json.issues.length}件 (下の検証結果を確認)`
      );
      router.refresh();
    } catch (e) {
      setMessage(`エラー: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded border border-gray-200 bg-white p-4 space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-sm font-bold mb-1">(A) 商品データ xlsx</p>
          <p className="text-xs text-gray-500 mb-2">
            商品名 / 説明 / SKU / 想定売値 / カテゴリ / 作品・キャラ / 画像URL / 重量・寸法
          </p>
          <input
            type="file"
            accept=".xlsx,.xls"
            disabled={busy !== null}
            onChange={(e) => upload("product_data", e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-white file:text-sm hover:file:bg-blue-700"
          />
          {busy === "product_data" && <p className="mt-1 text-xs text-blue-600">取込中...</p>}
        </div>
        <div>
          <p className="text-sm font-bold mb-1">(B) 仕入原価データ xlsx</p>
          <p className="text-xs text-gray-500 mb-2">
            SKU / 仕入価格JPY / 実重量g / 実寸法。(A)取込後にアップロードしてください
          </p>
          <input
            type="file"
            accept=".xlsx,.xls"
            disabled={busy !== null}
            onChange={(e) => upload("cost_data", e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-emerald-600 file:px-3 file:py-1.5 file:text-white file:text-sm hover:file:bg-emerald-700"
          />
          {busy === "cost_data" && <p className="mt-1 text-xs text-emerald-600">取込中...</p>}
        </div>
      </div>
      {message && (
        <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          {message}
        </div>
      )}
      <p className="text-xs text-gray-500">
        列名は自動マッピングされます。対応付けできない列は検証結果に警告として表示されるので、
        実ファイルの列構成が想定と違う場合は連絡してください (マッピング定義を調整します)。
      </p>
    </section>
  );
}
