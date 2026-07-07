# Amazon→Shopee 無在庫物販ダッシュボード

Amazonで仕入れてShopee(SG/TW等)で販売する無在庫物販の社内オペツール。

フロー:
1. Chrome拡張 **ASIN Pick** でAmazonから商品リストをエクスポート
2. そのファイル(xlsx/csv)をダッシュボードに取込 → 市場別の推奨売値・粗利率を自動計算
3. **利益率がよい商品をワンクリック選別** (真贋・禁制品・在庫切れは自動除外)
4. **Shopee一括アップロード形式のxlsx**を出力 → Seller Centreへアップロード

- 画像の白背景化 (rembg) は任意機能。使わなければAmazonの画像URLがそのまま出力される
- Amazonへの直接スクレイピングは行わない (入力はASIN Pick等がエクスポートしたファイルのみ)

## 構成

```
apps/web/          Next.js (App Router) ダッシュボード
apps/image-worker/ Python 常駐ワーカー (rembg + Pillow, 任意)
supabase/          DDL マイグレーション + setup.sql (コピペ1発)
docs/              セットアップ手順・アーキテクチャ
```

## セットアップ

**👉 初めての人は [docs/SETUP.md](docs/SETUP.md) のクリック単位の手順に従ってください。**
起動後はダッシュボードの「セットアップ」ページが不足項目を自動チェックします。

```bash
cd apps/web
cp .env.example .env.local   # SupabaseのURL/service_roleキーを記入
npm install
npm run dev
```

## 運用上の注意 (無在庫モデルのリスク)

- **在庫・価格の監視が生命線**: Amazonで値上がり/在庫切れした商品を放置すると
  Shopeeの注文キャンセル率が上がりアカウント停止に直結します。定期的にASIN Pickで
  再エクスポート→再取込すると価格・在庫が更新され、要更新の出品がハイライトされます
- **Amazonの商品画像**は出品者・メーカーに権利があります。流用は権利者申告で
  削除・ペナルティの対象になり得ます
- 真贋要確認・禁制品フラグ付き商品の出品はアカウント停止リスクがあります
