"""画像DL: 入力データに含まれるURLのみ取得する (メルカリページ/APIへのアクセスは行わない)。

- URLはクエリ付きのまま使用
- リダイレクト追従
- リトライ (指数バックオフ)
"""
import io
import time

import requests
from PIL import Image

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
TIMEOUT = 30
MAX_RETRIES = 3


class DownloadError(Exception):
    pass


def download_image(url: str) -> Image.Image:
    last_err: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.get(
                url,
                headers={"User-Agent": UA},
                timeout=TIMEOUT,
                allow_redirects=True,
            )
            if resp.status_code in (429, 500, 502, 503, 504):
                raise DownloadError(f"HTTP {resp.status_code}")
            if resp.status_code != 200:
                # 4xx系はリトライしても無駄なので即時失敗
                raise DownloadError(f"HTTP {resp.status_code} (リトライ対象外)")
            content_type = resp.headers.get("Content-Type", "")
            if content_type and not content_type.startswith("image/"):
                raise DownloadError(f"画像ではないContent-Type: {content_type} (リトライ対象外)")
            img = Image.open(io.BytesIO(resp.content))
            img.load()
            return img
        except DownloadError as e:
            last_err = e
            if "リトライ対象外" in str(e):
                break
        except (requests.RequestException, OSError) as e:
            last_err = e
        time.sleep(2**attempt)
    raise DownloadError(f"DL失敗 ({MAX_RETRIES}回試行): {url} — {last_err}")
