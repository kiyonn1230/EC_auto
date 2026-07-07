# セットアップ手順 (非エンジニア向け・クリック単位)

所要時間の目安: 20〜30分。上から順にやれば動きます。
進み具合はダッシュボードの「**セットアップ**」ページが自動でチェックしてくれます。

必要なもの:
- Supabaseアカウント (無料) — データベースと画像置き場
- Chrome拡張「ASIN Pick」 — Amazonの商品リスト取得に使用
- Shopeeセラーアカウント (SG/TW等)
- パソコンに Node.js (v20以上)
- (任意) Railwayアカウント — 画像の白背景化を使う場合のみ

---

## Step 1. Supabase (データベース) — 約10分

1. https://supabase.com にアクセスして Sign up (GitHubアカウントでOK)
2. 「**New project**」をクリック
   - Name: `ec-auto` など / Region: `Northeast Asia (Tokyo)`
3. 左メニューの「**SQL Editor**」→「New query」
4. このリポジトリの **`supabase/setup.sql`** をまるごとコピーして貼り付け →「**Run**」
5. 「**Project Settings**」→「**API**」で次の2つをコピー:
   - **Project URL** / **service_role** キー (Revealで表示)
   ⚠️ service_roleキーは人に見せない・コミットしない

## Step 2. ダッシュボードを動かす — 約10分

1. このリポジトリをPCにclone
2. ターミナルで:
   ```bash
   cd EC_auto/apps/web
   cp .env.example .env.local
   ```
3. `.env.local` にStep 1-5の値を貼る:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJ...(長いやつ)
   ```
4. 起動して http://localhost:3000 を開く:
   ```bash
   npm install
   npm run dev
   ```
5. 「セットアップ」ページで 1〜4 がOKになっていることを確認
   (5の画像ワーカーは任意なのでNGのままでも使えます)

## Step 3. 使ってみる — 日々の運用フロー

1. Chromeの **ASIN Pick** でAmazonの検索結果・カテゴリページから
   商品リストをエクスポート (xlsx/csv)
2. ダッシュボードの「**取込・検証**」にそのファイルをアップロード
   - 列は自動で対応付けされます。警告が出た列は検証結果で確認
3. 「**商品一覧**」を開く — 選択中の市場(SG/TW)の**粗利率が高い順**に並びます
4. 「**利益率が目標以上を全選択**」ボタン → 儲かる商品だけが選択される
   (真贋要確認・禁制品・Amazon在庫切れは自動で除外)
5. (任意) 「選択行の画像を処理」で白背景画像に加工
6. 「**一括アップ用xlsx**」ボタン → ファイルがダウンロードされる
7. Shopee Seller Centre → 商品 → 一括アップロード → **公式テンプレートをダウンロード**
   → ダウンロードしたxlsxのデータ行(3行目以降)を公式テンプレの**7行目以降にコピペ**
   → Seller Centreにアップロード
8. 売れたらAmazonで購入して発送

### 価格・在庫の更新 (重要!)

無在庫はAmazon側の値上がり・在庫切れを放置するとキャンセル率が上がり
**Shopeeアカウント停止に直結**します。週2〜3回はASIN Pickで同じ商品を
再エクスポート→再取込してください。価格が変わった商品は自動で再計算され、
出品済みのものは「要更新/エラー」フィルタでハイライトされます。

## Step 4. 設定の調整 — 約3分

「**設定**」ページで:
- **市場**: 為替(1SGD=何円か等) / Shopee手数料率(合計) / 目標粗利率 / DTS(発送日数)
- **国際送料テーブル**: SLS-SG / SLS-TW の実際の料金に合わせて調整
- **カテゴリ別デフォルト重量**: ASIN Pickに重量が無いため、ここの値で送料が決まります
- 変えたら「**保存して全件再計算**」

## Step 5. (任意) 画像ワーカー — Railway

Amazonの画像をそのまま使わず白背景に統一したい場合のみ:

1. https://railway.app にGitHubでログイン → New Project → Deploy from GitHub repo
2. Settings → **Root Directory**: `apps/image-worker`
3. Variables:
   ```
   SUPABASE_URL=...(Step1と同じ)
   SUPABASE_SERVICE_ROLE_KEY=...(Step1と同じ)
   STORAGE_BUCKET=product-images
   ```

## 困ったら

- まず「**セットアップ**」ページを見る (何が足りないか具体的に出ます)
- ASIN Pickの列がうまく取り込めない → エクスポートファイルをClaudeに渡して
  「列マッピングを合わせて」と頼む
- エラー文・スクショをそのままClaudeに貼って相談
