# アーキテクチャ (Amazon→Shopee 無在庫物販)

## 全体像

```
[ASIN Pick エクスポート xlsx/csv]
        ↓ 取込 (列自動マッピング)
Next.js → Supabase (Postgres + Storage)
  ├ products          商品 (SKU=ASIN, Amazon価格=仕入原価, Amazon在庫状況)
  ├ markets           市場マスタ (SG/TW..., 為替・手数料・目標粗利率・送料キャリア)
  ├ market_listings   商品×市場 (推奨売値・粗利率・赤字警告・出品状態)
  └ image_jobs        画像加工ジョブキュー (任意)
        ↓
利益率で選別 (目標粗利率以上をワンクリック選択、真贋/禁制品/在庫切れ除外)
        ↓
Shopee一括アップロード形式xlsxを生成 → Seller Centreへ手動アップロード
```

## 取込 (lib/import)

- ASIN Pickのエクスポート列を自動マッピング (エイリアス方式。実サンプル受領後に微調整)
- ランキング・レビュー数・参考価格などの指標列は無視リストで除外
  (「参考価格」が仕入価格に誤マップされるのを防ぐ)
- 必須はASIN+商品名のみ。空セル・不正値でも落ちず、検証結果に警告を出す
- 同一ASINの再取込で価格・在庫が更新され、出品済みの行は「要更新」になる

## 市場別粗利 (lib/pricing)

```
総原価(市場通貨) = (Amazon価格 + 国内費用 + 国際送料) / 為替
  国際送料 = max(実重量, 容積重量) → キャリア別料金表 (SLS-SG / SLS-TW)
推奨売値 = 総原価 / (1 - Shopee手数料率 - 目標粗利率)
粗利率   = (売値×(1-手数料率) - 総原価) / 売値
```

市場ごとの設定 (為替・手数料・目標粗利・DTS・表示在庫) は markets テーブルで管理し
設定画面から編集。ASIN Pickに重量が無いため、カテゴリ別デフォルト重量で補完し
補完フラグを付ける (lib/weight)。

## Shopee出力 (lib/shopee/listing.ts)

Shopee公式の一括アップロードテンプレートはバージョンハッシュ入りで自前生成すると
弾かれるため、**Templateシートと同じ列順のデータ行xlsx**を生成し、ユーザーが
公式テンプレの7行目以降にコピペしてアップロードする運用。
説明文には発送目安の定型文を自動付加、重量はkgに変換、DTS(発送日数)も出力する。

※Shopee Open Platform API での自動出品・価格在庫同期は将来拡張
(shopee_shops テーブルはそのために予約済み。過去実装はgit履歴 344f450 以降参照)。

## 画像パイプライン (任意, apps/image-worker)

rembgが重いためPython常駐ワーカーに分離 (Railway等)。Next.jsは image_jobs に
積むだけで、`claim_image_job()` RPC (FOR UPDATE SKIP LOCKED) をポーリングして
DL→背景除去→1:1白背景→Storage保存。未使用でもAmazonの画像URLがそのまま出力される。

## データ制約 (厳守)

- Amazonのスクレイピングは実装しない。入力はASIN Pick等がエクスポートした
  ファイルのみ (ASINからのURL推測収集もしない)
- 秘匿情報 (Supabase service key) は .env のみ。DBには置かない
