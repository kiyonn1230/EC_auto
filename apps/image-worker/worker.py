"""画像処理ワーカー: image_jobs をポーリングして加工パイプラインを実行する常駐プロセス。

フロー: claim_image_job() RPC → DL → 背景除去 → 1:1整形 → Storageアップ →
product_images に公開URLとステータスを書き戻し。
複数ワーカーでも FOR UPDATE SKIP LOCKED で競合しない。
"""
import logging
import time
import traceback

from supabase import Client, create_client

import config
from pipeline.bg_removal.base import get_adapter
from pipeline.compose import add_watermark, compose_square, trim_to_subject
from pipeline.download import download_image
from pipeline.lifestyle import LifestyleNotConfigured, compose_lifestyle
from pipeline.storage import upload_image

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("image-worker")


def set_image_status(sb: Client, image_id: str, status: str, **extra):
    sb.table("product_images").update({"status": status, **extra}).eq("id", image_id).execute()


def process_job(sb: Client, job: dict):
    image_id = job["product_image_id"]
    settings = {**config.DEFAULT_IMAGE_SETTINGS, **(job.get("payload") or {})}

    row = (
        sb.table("product_images").select("*").eq("id", image_id).single().execute()
    ).data
    if row is None:
        raise RuntimeError(f"product_images {image_id} が見つかりません")

    product_id = row["product_id"]
    source_url = row["source_url"]
    is_main = row.get("role") == "main"

    # (a) DL
    set_image_status(sb, image_id, "downloading")
    original = download_image(source_url)
    log.info("DL完了 image=%s size=%s", image_id, original.size)

    # (b) 背景除去 (rembg / 外部API をアダプタで切替)
    set_image_status(sb, image_id, "removing_bg")
    adapter = get_adapter(settings)
    cutout = adapter.remove_background(original)
    log.info("背景除去完了 image=%s adapter=%s", image_id, adapter.name)

    # (c) 整形: 被写体トリム → 正方形キャンバス
    set_image_status(sb, image_id, "composing")
    subject = trim_to_subject(cutout)
    canvas_size = int(settings["canvas_size"])
    margin = float(settings["margin_ratio"])

    main_img = compose_square(subject, canvas_size, margin, background="white")
    if settings.get("watermark_enabled") and settings.get("watermark_text"):
        main_img = add_watermark(main_img, settings["watermark_text"])

    transparent_img = None
    if settings.get("sub_transparent") and not is_main:
        transparent_img = compose_square(subject, canvas_size, margin, background=None)

    # (e) 任意: ライフスタイル背景 (既定OFF。未設定なら黙ってスキップ)
    lifestyle_url = None
    if settings.get("lifestyle_enabled"):
        try:
            lifestyle_img = compose_lifestyle(
                compose_square(subject, canvas_size, margin, background=None), settings
            )
            lifestyle_url = upload_image(
                sb, lifestyle_img, f"{product_id}/{image_id}_lifestyle.jpg", "JPEG"
            )
        except LifestyleNotConfigured as e:
            log.warning("ライフスタイル背景をスキップ: %s", e)

    # (d) Storageへ保存して公開URL取得
    set_image_status(sb, image_id, "uploading")
    processed_url = upload_image(
        sb, main_img, f"{product_id}/{image_id}_main.jpg", "JPEG"
    )
    transparent_url = None
    if transparent_img is not None:
        transparent_url = upload_image(
            sb, transparent_img, f"{product_id}/{image_id}_transparent.png", "PNG"
        )

    set_image_status(
        sb,
        image_id,
        "success",
        processed_url=processed_url,
        transparent_url=transparent_url,
        lifestyle_url=lifestyle_url,
        bg_removal_model=adapter.name,
        error_message=None,
    )
    log.info("完了 image=%s → %s", image_id, processed_url)


def handle_failure(sb: Client, job: dict, err: Exception):
    image_id = job["product_image_id"]
    attempts = job.get("attempts", 1)
    max_attempts = job.get("max_attempts", 3)
    message = f"{type(err).__name__}: {err}"
    log.error("失敗 image=%s attempt=%s/%s: %s", image_id, attempts, max_attempts, message)

    if attempts < max_attempts:
        # 自動リトライ: ジョブをキューに戻す (attemptsはclaim時に加算される)
        sb.table("image_jobs").update(
            {"status": "queued", "last_error": message}
        ).eq("id", job["id"]).execute()
        sb.table("product_images").update(
            {"status": "failed", "error_message": message, "retries": attempts}
        ).eq("id", image_id).execute()
    else:
        # リトライ上限 → 要手動対応に落として人間に渡す
        sb.table("image_jobs").update(
            {"status": "failed", "last_error": message}
        ).eq("id", job["id"]).execute()
        sb.table("product_images").update(
            {
                "status": "manual_required",
                "error_message": f"{message} (リトライ{max_attempts}回失敗)",
                "retries": attempts,
            }
        ).eq("id", image_id).execute()


def main():
    config.validate()
    sb = create_client(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY)
    log.info("ワーカー起動 (bucket=%s, poll=%ss)", config.STORAGE_BUCKET, config.POLL_INTERVAL_SEC)

    while True:
        try:
            res = sb.rpc("claim_image_job").execute()
            jobs = res.data or []
            if not jobs:
                time.sleep(config.POLL_INTERVAL_SEC)
                continue
            job = jobs[0]
            log.info("ジョブ取得 job=%s image=%s attempt=%s", job["id"], job["product_image_id"], job["attempts"])
            try:
                process_job(sb, job)
                sb.table("image_jobs").update({"status": "succeeded"}).eq("id", job["id"]).execute()
            except Exception as e:  # noqa: BLE001 — 個別ジョブの失敗はワーカーを止めない
                traceback.print_exc()
                handle_failure(sb, job, e)
        except KeyboardInterrupt:
            log.info("停止します")
            break
        except Exception:  # noqa: BLE001 — DB接続断等。バックオフして再試行
            traceback.print_exc()
            time.sleep(min(config.POLL_INTERVAL_SEC * 5, 30))


if __name__ == "__main__":
    main()
