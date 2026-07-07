"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ImportForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const upload = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
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
      setBusy(false);
    }
  };

  return (
    <section className="rounded border border-gray-200 bg-white p-4 space-y-3">
      <div>
        <p className="text-sm font-bold mb-1">Amazon仕入れリスト (ASIN Pickエクスポート / xlsx / csv)</p>
        <p className="text-xs text-gray-500 mb-2">
          ASIN Pickでエクスポートしたファイルをそのままアップロードできます (列は自動マッピング)。
          必須列: ASIN / 商品名。任意列: Amazon価格(JPY) / URL / 画像URL / ShopeeカテゴリID /
          カテゴリ / 重量g / 寸法 / 在庫 / メモ。手入力する場合は{" "}
          <a href="/templates/amazon-products-template.xlsx" className="text-blue-700 underline">
            テンプレート
          </a>
          をどうぞ。
        </p>
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          disabled={busy}
          onChange={(e) => upload(e.target.files?.[0] ?? null)}
          className="block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-white file:text-sm hover:file:bg-blue-700"
        />
        {busy && <p className="mt-1 text-xs text-blue-600">取込中...</p>}
      </div>
      {message && (
        <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          {message}
        </div>
      )}
      <p className="text-xs text-gray-500">
        同じASINを再取込すると価格・在庫が更新され、市場別の粗利も再計算されます
        (Amazon在庫切れにした行はShopee表示在庫0で計算)。
        列名が合わない場合は検証結果に警告が出ます。
      </p>
    </section>
  );
}
