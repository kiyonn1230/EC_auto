import { supabaseAdmin } from "@/lib/supabase/server";
import type { ImportBatch, ImportIssue } from "@/lib/types";
import { ImportForm } from "./form";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  let batches: ImportBatch[] = [];
  let issues: ImportIssue[] = [];
  let loadError: string | null = null;

  try {
    const sb = supabaseAdmin();
    const batchesRes = await sb
      .from("import_batches")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);
    if (batchesRes.error) throw new Error(batchesRes.error.message);
    batches = (batchesRes.data ?? []) as ImportBatch[];

    if (batches.length > 0) {
      const issuesRes = await sb
        .from("import_issues")
        .select("*")
        .in("batch_id", batches.map((b) => b.id))
        .order("created_at", { ascending: false });
      if (issuesRes.error) throw new Error(issuesRes.error.message);
      issues = (issuesRes.data ?? []) as ImportIssue[];
    }
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="max-w-5xl space-y-6">
      <h2 className="text-lg font-bold">取込・検証</h2>
      <ImportForm />

      {loadError ? (
        <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          履歴の取得に失敗しました: {loadError}
        </div>
      ) : (
        <>
          <section>
            <h3 className="text-sm font-bold mb-2">取込履歴 (直近10件)</h3>
            <div className="overflow-x-auto rounded border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 text-left text-xs text-gray-600">
                  <tr>
                    <th className="p-2">日時</th>
                    <th className="p-2">種別</th>
                    <th className="p-2">ファイル</th>
                    <th className="p-2">行数</th>
                    <th className="p-2">成功</th>
                    <th className="p-2">問題</th>
                    <th className="p-2">状態</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.id} className="border-t border-gray-100">
                      <td className="p-2 text-xs">{new Date(b.created_at).toLocaleString("ja-JP")}</td>
                      <td className="p-2">{b.file_type === "product_data" ? "(A) 商品" : "(B) 原価"}</td>
                      <td className="p-2 text-xs">{b.file_name}</td>
                      <td className="p-2 tabular-nums">{b.row_count}</td>
                      <td className="p-2 tabular-nums text-emerald-700">{b.ok_count}</td>
                      <td className="p-2 tabular-nums text-amber-700">{b.issue_count}</td>
                      <td className="p-2 text-xs">
                        {b.status === "completed" ? "完了" : b.status === "failed" ? "失敗" : "処理中"}
                      </td>
                    </tr>
                  ))}
                  {batches.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-gray-400">
                        まだ取込がありません
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-bold mb-2">検証結果 (突合失敗・必須欠損・Shopify制約違反)</h3>
            <div className="overflow-x-auto rounded border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 text-left text-xs text-gray-600">
                  <tr>
                    <th className="p-2">重要度</th>
                    <th className="p-2">SKU</th>
                    <th className="p-2">行</th>
                    <th className="p-2">種類</th>
                    <th className="p-2">フィールド</th>
                    <th className="p-2">内容</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.map((i) => (
                    <tr
                      key={i.id}
                      className={`border-t border-gray-100 ${i.severity === "error" ? "bg-red-50" : ""}`}
                    >
                      <td className="p-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs ${
                            i.severity === "error"
                              ? "bg-red-100 text-red-700"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {i.severity === "error" ? "エラー" : "警告"}
                        </span>
                      </td>
                      <td className="p-2 font-mono text-xs">{i.sku ?? "—"}</td>
                      <td className="p-2 tabular-nums">{i.row_number ?? "—"}</td>
                      <td className="p-2 text-xs">{i.issue_type}</td>
                      <td className="p-2 text-xs">{i.field ?? "—"}</td>
                      <td className="p-2 text-xs">{i.message}</td>
                    </tr>
                  ))}
                  {issues.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-gray-400">
                        検証エラーはありません
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
