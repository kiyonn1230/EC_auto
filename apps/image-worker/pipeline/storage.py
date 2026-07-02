"""Supabase Storage への加工済み画像アップロードと公開URL取得"""
import io

from PIL import Image
from supabase import Client

import config


def upload_image(
    sb: Client,
    image: Image.Image,
    path: str,
    fmt: str,
) -> str:
    """image をアップロードして公開URLを返す。fmt: 'JPEG' | 'PNG'"""
    buf = io.BytesIO()
    if fmt == "JPEG":
        image.convert("RGB").save(buf, format="JPEG", quality=90, optimize=True)
        content_type = "image/jpeg"
    else:
        image.save(buf, format="PNG", optimize=True)
        content_type = "image/png"
    data = buf.getvalue()

    sb.storage.from_(config.STORAGE_BUCKET).upload(
        path,
        data,
        file_options={"content-type": content_type, "upsert": "true"},
    )
    return sb.storage.from_(config.STORAGE_BUCKET).get_public_url(path)
