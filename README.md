# 越境EC自動化ダッシュボード (Phase 1)

メルカリで仕入れたアニメグッズを Shopify で予約販売するための社内オペ用ダッシュボード。

- 商品データ xlsx + 仕入原価 xlsx を取り込み → SKU 突合 → products に upsert
- 画像を DL → 背景除去 (rembg) → 1:1 白背景整形 → Supabase Storage へ保存
- 粗利再計算 / 重量・寸法補正 / コンプラ・真贋チェック
- Shopify 商品 CSV 出力 or Admin API (GraphQL) で draft 出品作成

## 構成

```
apps/web/          Next.js (App Router) ダッシュボード。ジョブ投入と結果参照のみ
apps/image-worker/ Python 常駐ワーカー (rembg + Pillow)。Railway 等でDocker稼働
supabase/          DDL マイグレーション (ジョブキュー image_jobs 含む)
docs/              アーキテクチャ文書
```

詳細は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を参照。

## セットアップ

### 1. Supabase

新規プロジェクトを作成し、`supabase/migrations/` の SQL を順番に SQL Editor で実行
(または `supabase db push`)。Storage バケット `product-images`(public)は
マイグレーション内で作成される。

### 2. ダッシュボード (apps/web)

```bash
cd apps/web
cp .env.example .env.local   # Supabase / Shopify の接続情報を記入
npm install
npm run dev
```

### 3. 画像ワーカー (apps/image-worker)

```bash
cd apps/image-worker
cp .env.example .env
pip install -r requirements.txt
python worker.py
```

Railway へは Dockerfile ごとデプロイ。環境変数は `.env.example` と同じものを設定。

## 制約(厳守事項)

- メルカリの商品ページ/内部APIへのアクセスは一切実装しない。画像は入力 xlsx に
  含まれる URL のみ使用し、商品IDからの画像URL推測もしない。
- 背景除去は rembg 等の専用手法のみ。生成AIは任意のライフスタイル背景モジュール
  (既定OFF)に限定。
- APIキー/トークンは .env 管理。コミット禁止。
