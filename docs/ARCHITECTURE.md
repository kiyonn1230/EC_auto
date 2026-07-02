# アーキテクチャ (Phase 1)

## 全体像

```
[xlsx 取込] → Next.js (取込・突合・検証) → Supabase (Postgres + Storage)
                                              ↑↓ image_jobs (ジョブキュー)
                                        Python 画像ワーカー (Railway / Docker常駐)
                                              ↓
                                     Supabase Storage (加工済み画像, 公開URL)
                                              ↓
Next.js: 粗利計算・重量補正・コンプラ検証 → (6a) CSV出力 / (6b) Shopify Admin API
```

## 画像ワーカーの分離とジョブ連携

rembg はモデルが重く Vercel サーバレスに載らないため、画像処理は
`apps/image-worker` の Python 常駐プロセスに完全分離する。

1. Next.js は `POST /api/image-jobs` で `product_images` 行ごとに `image_jobs`
   (status=queued, payload=画像設定スナップショット) を積むだけ。
2. ワーカーは Postgres RPC `claim_image_job()` をポーリング。
   `FOR UPDATE SKIP LOCKED` で複数ワーカーでも競合しない。
3. 処理中は `product_images.status` を
   `downloading → removing_bg → composing → uploading → success/failed` と更新し、
   UI はこれをそのまま表示する。失敗時は `error_message` と `retries` を記録、
   `max_attempts` 超過で `manual_required` に落として人間に渡す。
4. 成果物 (白背景1:1 / 透過PNG) は Supabase Storage `product-images` バケットへ
   アップロードし、公開URLを `processed_url` / `transparent_url` に保存。

### 背景除去のアダプタ層

`pipeline/bg_removal/base.py` の `RemoveBackgroundAdapter` (ABC) に対して:

- `RembgAdapter` — u2net / isnet-general-use / birefnet-general を設定で選択
- `ExternalApiAdapter` — remove.bg 互換API (将来 Photoroom 差し替え可)

どちらを使うかは `app_settings.image_settings.bg_removal_provider` で切替。
ジョブ payload に設定スナップショットを入れるため、処理途中の設定変更に影響されない。

### ライフスタイル背景 (任意, 既定OFF)

`pipeline/lifestyle.py`。`image_settings.lifestyle_enabled=true` のときのみ、
切り抜き済み透過PNGを生成系画像APIで背景合成する。背景"除去"には生成AIを使わない。

## Shopify出力の CSV / API 両対応

`apps/web/src/lib/shopify/payload.ts` が DB (products + product_images) から
中間モデル `ShopifyProductPayload` を組み立て、両系統はそれを消費するだけ:

- `csv.ts` (6a): Shopify標準インポートCSVへ展開。複数画像は同一Handleの
  追加行 + Image Position。**ヘッダーは現行標準仕様の仮実装**であり、
  ユーザーのストアからエクスポートしたサンプルCSVを受領したら厳密に合わせる。
- `admin-api.ts` (6b, 推奨経路): GraphQL `productSet` で draft 作成。
  画像は Storage の公開URLを `media.originalSource` に渡し Shopify 側に取得させる
  (加工済み画像が既に公開URLを持つため staged upload は不要)。

共通ルール: Status=draft 既定 / Inventory Policy=continue (予約販売) /
Cost per item=仕入原価のストア通貨換算 / 説明文は `_x000d_` 除去済みHTML +
発送目安の定型文を付加。

## 粗利再計算

```
総原価JPY = 仕入価格 + 国内送料 + 国際送料(max(実重量, 容積重量) → 料金表lookup)
総原価Store = 総原価JPY / fx_rate_jpy_per_store
推奨売値 = 総原価Store / (1 - 決済手数料率 - 目標粗利率)
現状粗利率 = (現状売値 × (1-手数料率) - 総原価Store) / 現状売値
```

`pricing_breakdown` に内訳を保存し UI に表示。売値・設定変更後は
`POST /api/recalculate` で一括再計算。

## 入力ファイル (A) の実仕様: Shopee一括アップロードテンプレート

実サンプル (shopeesingaporeproducts_*.xlsx) は Shopee のマスアップロード形式:

- 実データは `Template` シート (先頭シートは `Guidance`)。シートはヘッダーの
  マッピング成立数と「必須フィールドが埋まった行数」のスコアで自動選択する
- ヘッダーは `ps_product_name|1|0` 形式のフィールドコード (1行目)。
  2〜6行目は メタ/英語ヘッダー/Mandatory表/ガイダンス文 のため、
  「価格・在庫・重量・画像がどれも解釈できない行」をデータ外として除外する
- 主なマッピング: `ps_sku_parent_short`→SKU / `ps_product_name`→商品名 /
  `ps_price`→現状売値 (Shopee側通貨) / `ps_stock`→在庫 / `ps_category`→カテゴリID
  (`SHOPEE_CATEGORY_MAP` で内部名へ変換, 例 101392→フィギュア)
- **重量はkg単位** → g へ変換。`1` (=1000g) はダミー値として扱う
- 寸法 `1x1x1` はダミーとして検知しカテゴリ既定値で補完
- `ps_item_cover_image` + `ps_item_image_1..8` が画像列。
  `dummyimage.com` 等のプレースホルダURLは除外して警告を出す

## データ制約 (厳守)

- メルカリの item URL / 商品ページ / 内部API へのアクセスは実装しない。
  画像は入力xlsxに含まれるURL文字列のみ。IDからのURL推測もしない。
- 秘匿情報 (Supabase service key, Shopify token) は .env のみ。
  DB の app_settings には非秘匿設定のみ置く。
