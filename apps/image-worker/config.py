"""環境変数と既定値。秘匿情報は .env のみで管理する。"""
import os

from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
STORAGE_BUCKET = os.environ.get("STORAGE_BUCKET", "product-images")
POLL_INTERVAL_SEC = float(os.environ.get("POLL_INTERVAL_SEC", "3"))

REMOVE_BG_API_KEY = os.environ.get("REMOVE_BG_API_KEY", "")
REMOVE_BG_ENDPOINT = os.environ.get(
    "REMOVE_BG_ENDPOINT", "https://api.remove.bg/v1.0/removebg"
)

# ジョブpayloadに設定が無い場合のフォールバック (app_settings.image_settings と同値)
DEFAULT_IMAGE_SETTINGS = {
    "bg_removal_provider": "rembg",
    "bg_removal_model": "isnet-general-use",
    "canvas_size": 2048,
    "margin_ratio": 0.06,
    "main_background": "white",
    "sub_transparent": True,
    "watermark_enabled": False,
    "watermark_text": "",
    "lifestyle_enabled": False,
}


def validate():
    missing = []
    if not SUPABASE_URL:
        missing.append("SUPABASE_URL")
    if not SUPABASE_SERVICE_ROLE_KEY:
        missing.append("SUPABASE_SERVICE_ROLE_KEY")
    if missing:
        raise RuntimeError(f"環境変数が未設定です: {', '.join(missing)} (.env を確認)")
