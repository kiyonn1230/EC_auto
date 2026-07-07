import { loadEnrichContext } from "@/lib/settings";
import { SettingsForm } from "./form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  try {
    const ctx = await loadEnrichContext();
    return (
      <div className="max-w-5xl space-y-4">
        <h2 className="text-lg font-bold">設定</h2>
        <SettingsForm
          settings={ctx.settings}
          markets={ctx.markets}
          categoryDefaults={ctx.categoryDefaults}
          shippingRates={ctx.shippingRates}
          keywords={ctx.keywords}
        />
      </div>
    );
  } catch (e) {
    return (
      <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800">
        設定の取得に失敗しました: {e instanceof Error ? e.message : String(e)}
        <br />
        「セットアップ」ページでマイグレーション適用状況を確認してください。
      </div>
    );
  }
}
