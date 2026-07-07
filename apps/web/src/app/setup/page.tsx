import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type CheckStatus = "ok" | "ng" | "skip";

interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
}

async function runChecks(): Promise<Check[]> {
  const checks: Check[] = [];

  // 1. Supabase 環境変数
  const hasUrl = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
  const hasKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  checks.push({
    name: "1. Supabase 接続情報 (.env.local)",
    status: hasUrl && hasKey ? "ok" : "ng",
    detail:
      hasUrl && hasKey
        ? "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 設定済み"
        : `未設定: ${[!hasUrl && "NEXT_PUBLIC_SUPABASE_URL", !hasKey && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean).join(", ")}`,
    fix: "apps/web/.env.example をコピーして .env.local を作り、SupabaseのSettings→APIの値を貼り付けて再起動",
  });
  if (!hasUrl || !hasKey) {
    checks.push(
      { name: "2. データベース (マイグレーション)", status: "skip", detail: "1を先に解決してください" },
      { name: "3. 市場マスタ (SG/TW)", status: "skip", detail: "—" },
      { name: "4. Storageバケット (product-images)", status: "skip", detail: "—" },
      { name: "5. 画像ワーカー", status: "skip", detail: "—" }
    );
    return checks;
  }

  const sb = supabaseAdmin();

  // 2. テーブル存在 (= setup.sql 0003まで実行済みか)
  const { error: tableErr } = await sb.from("market_listings").select("id").limit(1);
  checks.push({
    name: "2. データベース (マイグレーション)",
    status: tableErr ? "ng" : "ok",
    detail: tableErr
      ? `market_listingsテーブルにアクセスできません: ${tableErr.message}`
      : "テーブル作成済み (Amazon→Shopee版スキーマ)",
    fix: "SupabaseのSQL Editorで supabase/setup.sql の中身を貼り付けて Run (旧版から更新する場合は 0003_pivot_amazon_shopee.sql のみでも可)",
  });

  // 3. 市場マスタ
  if (!tableErr) {
    const { data: markets } = await sb.from("markets").select("code, enabled");
    const enabled = (markets ?? []).filter((m) => m.enabled);
    checks.push({
      name: "3. 市場マスタ (SG/TW)",
      status: enabled.length > 0 ? "ok" : "ng",
      detail:
        enabled.length > 0
          ? `有効な市場: ${enabled.map((m) => m.code).join(", ")}`
          : "有効な市場がありません",
      fix: "setup.sql でSG/TWがシードされます。設定画面で有効化・為替や手数料の調整もできます",
    });
  } else {
    checks.push({ name: "3. 市場マスタ (SG/TW)", status: "skip", detail: "2を先に解決してください" });
  }

  // 4. Storage バケット
  try {
    const { data: buckets, error: bErr } = await sb.storage.listBuckets();
    const found = !bErr && (buckets ?? []).some((b) => b.name === "product-images");
    checks.push({
      name: "4. Storageバケット (product-images)",
      status: found ? "ok" : "ng",
      detail: found ? "作成済み (public)" : "バケットが見つかりません",
      fix: "setup.sql に作成SQLが含まれます。手動の場合はSupabaseのStorageで public バケット「product-images」を作成",
    });
  } catch (e) {
    checks.push({
      name: "4. Storageバケット (product-images)",
      status: "ng",
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  // 5. 画像ワーカー (直近のジョブ処理実績で判定)
  if (!tableErr) {
    const { data: lastJob } = await sb
      .from("image_jobs")
      .select("status, updated_at")
      .in("status", ["succeeded", "processing"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    checks.push({
      name: "5. 画像ワーカー (Railway) ※任意",
      status: lastJob ? "ok" : "ng",
      detail: lastJob
        ? `直近のジョブ処理: ${new Date(lastJob.updated_at).toLocaleString("ja-JP")} (${lastJob.status})`
        : "ジョブ処理の実績がまだありません (未デプロイ、または一度も画像処理を実行していない)",
      fix: "画像の白背景化を使う場合のみ必要です。RailwayでこのリポジトリをデプロイしRoot Directoryをapps/image-workerに設定。使わない場合はAmazonの画像URLがそのまま出力されます",
    });
  } else {
    checks.push({ name: "5. 画像ワーカー", status: "skip", detail: "2を先に解決してください" });
  }

  return checks;
}

const BADGE: Record<CheckStatus, { label: string; cls: string }> = {
  ok: { label: "OK", cls: "bg-emerald-100 text-emerald-700" },
  ng: { label: "要対応", cls: "bg-red-100 text-red-700" },
  skip: { label: "保留", cls: "bg-gray-100 text-gray-500" },
};

export default async function SetupPage() {
  let checks: Check[];
  try {
    checks = await runChecks();
  } catch (e) {
    checks = [
      {
        name: "チェック実行エラー",
        status: "ng",
        detail: e instanceof Error ? e.message : String(e),
      },
    ];
  }
  const allOk = checks.every((c) => c.status === "ok");

  return (
    <div className="max-w-3xl space-y-4">
      <h2 className="text-lg font-bold">セットアップ状況</h2>
      {allOk ? (
        <div className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          ✅ すべて完了しています。<Link href="/import" className="underline">取込・検証</Link>から
          ASIN Pickのエクスポートファイルをアップロードして始められます。
        </div>
      ) : (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          「要対応」の項目を上から順に解決してください。詳しい手順は{" "}
          <code className="rounded bg-white px-1">docs/SETUP.md</code> にあります。
          対応後はこのページを再読み込みすると再チェックされます。
        </div>
      )}

      <div className="space-y-3">
        {checks.map((c) => (
          <div key={c.name} className="rounded border border-gray-200 bg-white p-3">
            <div className="flex items-center gap-2">
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${BADGE[c.status].cls}`}>
                {BADGE[c.status].label}
              </span>
              <span className="text-sm font-bold">{c.name}</span>
            </div>
            <p className="mt-1 text-sm text-gray-600">{c.detail}</p>
            {c.status === "ng" && c.fix && (
              <p className="mt-1 text-xs text-blue-800 bg-blue-50 rounded p-2">👉 {c.fix}</p>
            )}
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-500">
        ※画像ワーカーは任意です。5がNGでも取込→粗利計算→一括アップ用xlsx出力までは使えます。
      </p>
    </div>
  );
}
