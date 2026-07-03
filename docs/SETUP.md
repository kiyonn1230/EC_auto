# セットアップ手順 (非エンジニア向け・クリック単位)

所要時間の目安: 30〜45分。上から順にやれば動きます。
進み具合はダッシュボードの「**セットアップ**」ページが自動でチェックしてくれます。

必要なもの:
- Supabaseアカウント (無料) — データベースと画像置き場
- Railwayアカウント (月$5程度〜) — 画像加工の常駐プログラム置き場
- Shopifyストア (既存のもの)
- パソコンに Node.js (v20以上) — ダッシュボードをローカルで動かす場合

---

## Step 1. Supabase (データベース) — 約10分

1. https://supabase.com にアクセスして Sign up (GitHubアカウントでOK)
2. 「**New project**」をクリック
   - Name: `ec-auto` など好きな名前
   - Database Password: 適当な強いパスワード (メモ不要、使いません)
   - Region: `Northeast Asia (Tokyo)`
   - 「Create new project」を押して1〜2分待つ
3. 左メニューの「**SQL Editor**」→「New query」
4. このリポジトリの **`supabase/setup.sql`** をまるごとコピーして貼り付け →「**Run**」
   - 「Success. No rows returned」と出れば成功
5. 左メニュー下の「**Project Settings**」→「**API**」を開いて、次の2つをコピーしておく:
   - **Project URL** (例: `https://abcd1234.supabase.co`)
   - **service_role** の secret キー (「Reveal」を押すと表示される長い文字列)
   ⚠️ service_roleキーは絶対に人に見せない・コミットしないこと

## Step 2. ダッシュボードを動かす — 約10分

### ローカルで動かす場合 (まずはこちらがおすすめ)

1. このリポジトリをPCにclone (GitHub Desktopでも可)
2. ターミナルで:
   ```bash
   cd EC_auto/apps/web
   cp .env.example .env.local
   ```
3. `.env.local` をメモ帳等で開き、Step 1-5でコピーした値を貼る:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://abcd1234.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...(長いやつ)
   ```
   (Shopifyの2行はStep 4の後でOK)
4. 起動:
   ```bash
   npm install
   npm run dev
   ```
5. ブラウザで http://localhost:3000 を開く →「セットアップ」ページで
   1〜4がOKになっていることを確認

### Vercelにデプロイする場合 (後からでOK)

1. https://vercel.com にGitHubでログイン → Add New → Project → このリポジトリをImport
2. **Root Directory** を `apps/web` に設定
3. Environment Variables に `.env.local` と同じ4つを登録 → Deploy

## Step 3. 画像ワーカー (Railway) — 約10分

背景除去は重い処理なので、Railwayという別サービスで常時動かします。

1. https://railway.app にGitHubでログイン
2. 「**New Project**」→「**Deploy from GitHub repo**」→ `kiyonn1230/EC_auto` を選択
3. 作成されたサービスをクリック → 「**Settings**」タブ:
   - **Root Directory**: `apps/image-worker`
4. 「**Variables**」タブで以下を追加:
   ```
   SUPABASE_URL=https://abcd1234.supabase.co   ← Step1-5と同じ
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...      ← Step1-5と同じ
   STORAGE_BUCKET=product-images
   POLL_INTERVAL_SEC=3
   ```
5. 「Deploy」される (初回はrembgのAIモデルをダウンロードするので数分かかる)
6. 「Deployments」→ログに `ワーカー起動` と出ていれば成功

## Step 4. Shopify カスタムアプリ — 約5分

1. Shopify管理画面 → 「**設定**」→「**アプリと販売チャネル**」
2. 「**アプリを開発**」(Develop apps) → 「**アプリを作成**」
   - 名前: `EC-Auto連携` など
3. 「**Admin API統合を設定**」(Configure Admin API scopes) で
   **`write_products`** と **`read_products`** にチェック → 保存
4. 「**アプリをインストール**」→ 表示される **Admin APIアクセストークン** (`shpat_...`) をコピー
   ⚠️ トークンは一度しか表示されません
5. `apps/web/.env.local` に追記して、ダッシュボードを再起動:
   ```
   SHOPIFY_STORE_DOMAIN=あなたのストア.myshopify.com
   SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_...
   ```
6. ダッシュボードの「設定」→「接続テスト」でストア名が出ればOK

## Step 5. 設定の調整 — 約3分

ダッシュボードの「**設定**」ページで:

- **ストア通貨**: Shopifyストアの通貨に合わせる (例: SGD / USD)
- **為替**: 1ストア通貨あたりの円 (例: SGDなら 115 前後)
- **決済手数料率 / 目標粗利率 / 国内送料**: 実態に合わせる
- 変えたら「**保存して全件再計算**」を押す

## Step 6. 使ってみる

1. 「**取込・検証**」→ (A)商品データxlsx (Shopeeエクスポート形式そのままでOK) をアップロード
2. 続けて (B)仕入原価xlsx をアップロード (SKU / 仕入価格JPY / 実重量g の列があるもの)
3. 「**商品一覧**」→ 全選択 → 「**選択行の画像を処理**」→ 数分待つと画像ステータスが「成功」に
4. 出品したい行を選択 → 「**Shopifyへdraft作成**」(または「CSVエクスポート」)
5. Shopify管理画面の「商品」に下書きとして入っているので、内容確認して公開

## 困ったら

- まず「**セットアップ**」ページを見る (何が足りないか具体的に出ます)
- 画像処理が「失敗」→ 商品詳細ページの「再処理」ボタン。3回失敗すると「要手動対応」になります
- Railwayのログにエラーが出ていたらその文面をClaudeに貼って相談
