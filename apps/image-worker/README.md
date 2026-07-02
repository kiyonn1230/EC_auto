# 画像処理ワーカー

Supabase の `image_jobs` キューをポーリングし、
DL → 背景除去 (rembg / 外部API) → 1:1整形 → Supabase Storage 保存 を行う常駐プロセス。

## ローカル実行

```bash
cp .env.example .env   # Supabase接続情報を記入
pip install -r requirements.txt
python worker.py
```

初回ジョブ時に rembg のモデル (数十〜数百MB) が自動ダウンロードされる。

## Railway デプロイ

1. Railway で New Project → Deploy from GitHub repo → Root Directory を `apps/image-worker` に設定
2. Variables に `.env.example` と同じ環境変数を設定
3. (推奨) Volume を `/data/models` にマウントするとモデルDLが初回のみになる

複数レプリカで動かしても `claim_image_job()` の `FOR UPDATE SKIP LOCKED` により
ジョブが重複処理されることはない。

## 失敗時の挙動

- ジョブは自動で最大3回リトライ (`image_jobs.max_attempts`)
- 上限に達すると `product_images.status = manual_required` になり、
  ダッシュボードの商品詳細画面から「再処理」で手動再投入できる
