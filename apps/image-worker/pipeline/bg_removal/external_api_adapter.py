"""外部API (remove.bg互換) による背景除去。将来 Photoroom 等への差し替え先。"""
import io

import requests
from PIL import Image

import config

from .base import RemoveBackgroundAdapter


class ExternalApiAdapter(RemoveBackgroundAdapter):
    name = "external_api/remove.bg"

    def __init__(self):
        if not config.REMOVE_BG_API_KEY:
            raise RuntimeError(
                "REMOVE_BG_API_KEY が未設定です。外部APIを使う場合は .env に設定してください"
            )

    def remove_background(self, image: Image.Image) -> Image.Image:
        buf = io.BytesIO()
        image.convert("RGB").save(buf, format="PNG")
        buf.seek(0)
        resp = requests.post(
            config.REMOVE_BG_ENDPOINT,
            files={"image_file": ("image.png", buf, "image/png")},
            data={"size": "auto", "format": "png"},
            headers={"X-Api-Key": config.REMOVE_BG_API_KEY},
            timeout=120,
        )
        if resp.status_code != 200:
            raise RuntimeError(
                f"外部背景除去API失敗: HTTP {resp.status_code} — {resp.text[:300]}"
            )
        return Image.open(io.BytesIO(resp.content)).convert("RGBA")
