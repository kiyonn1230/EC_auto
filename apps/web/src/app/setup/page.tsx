import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/server";
import { testConnection } from "@/lib/shopify/admin-api";

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
      { name: "3. 初期設定データ (シード)", status: "skip", detail: "—" },
      { name: "4. Storageバケット (product-images)", status: "skip", detail: "—" },
      { name: "5. Shopify Admin API", status: "skip", detail: "—" },
      { name: "6. 画像ワーカー", status: "skip", detail: "—" }
    );
    return checks;
  }

  const sb = supabaseAdmin();

  // 2. テーブル存在 (= setup.sql 実行済みか)
  const { error: tableErr } = await sb.from("products").select("id").limit(1);
  checks.push({
    name: "2. データベース (マイグレーション)",
    status: tableErr ? "ng" : "ok",
    detail: tableErr ? `productsテーブルにアクセスできません: ${tableErr.message}` : "テーブル作成済み",
    fix: "SupabaseのSQL Editorで supabase/setup.sql の中身を貼り付けて Run",
  });

  // 3. シード投入済みか
  if (!tableErr) {
    const { count } = await sb.from("app_settings").select("*", { count: "exact", head: true });
    const seeded = (count ?? 0) > 0;
    checks.push({
      name: "3. 初期設定データ (シード)",
      status: seeded ? "ok" : "ng",
      detail: seeded ? `app_settings ${count}件` : "app_settingsが空です",
      fix: "setup.sql を実行すればシードも入ります (再実行しても安全)",
    });
  } else {
    checks.push({ name: "3. 初期設定データ (シード)", status: "skip", detail: "2を先に解決してください" });
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

  // 5. Shopify
  const hasShopifyEnv =
    !!process.env.SHOPIFY_STORE_DOMAIN && !!process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (!hasShopifyEnv) {
    checks.push({
      name: "5. Shopify Admin API",
      status: "ng",
      detail: "SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_ACCESS_TOKEN が未設定",
      fix: "Shopify管理画面→設定→アプリと販売チャネル→アプリ開発→アプリを作成→Admin APIスコープでwrite_productsを許可→インストールしてトークンを.env.localへ (CSV出力だけなら未設定でも使えます)",
    });
  } else {
    try {
      const r = await testConnection();
      checks.push({
        name: "5. Shopify Admin API",
        status: "ok",
        detail: `接続OK: ${r.shopName} (${r.domain})`,
      });
    } catch (e) {
      checks.push({
        name: "5. Shopify Admin API",
        status: "ng",
        detail: e instanceof Error ? e.message : String(e),
        fix: "トークン・ドメイン・APIスコープ(write_products)を確認",
      });
    }
  }

  // 6. 画像ワーカー (直近のジョブ処理実績で判定)
  if (!tableErr) {
    const { data: lastJob } = await sb
      .from("image_jobs")
      .select("status, updated_at")
      .in("status", ["succeeded", "processing"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    checks.push({
      name: "6. 画像ワーカー (Railway)",
      status: lastJob ? "ok" : "ng",
      detail: lastJob
        ? `直近のジョブ処理: ${new Date(lastJob.updated_at).toLocaleString("ja-JP")} (${lastJob.status})`
        : "ジョブ処理の実績がまだありません (未デプロイ、または一度も画像処理を実行していない)",
      fix: "RailwayでこのリポジトリをデプロイしRoot Directoryをapps/image-workerに設定、環境変数を投入。その後、商品一覧から「選択行の画像を処理」を実行すると自動判定されます",
    });
  } else {
    checks.push({ name: "6. 画像ワーカー", status: "skip", detail: "2を先に解決してください" });
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
          ✅ すべて完了しています。<Link href="/import" className="underline">取込・検証</Link>からxlsxをアップロードして始められます。
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
        ※ Shopify未設定でも、取込・画像処理・粗利計算・CSV出力までは使えます (API出品のみ不可)。
      </p>
    </div>
  );
}
