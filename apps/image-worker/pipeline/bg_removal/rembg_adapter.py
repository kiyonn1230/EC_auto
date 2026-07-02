"""rembg によるローカル背景除去。モデルは設定で選択可。"""
from PIL import Image
from rembg import new_session, remove

from .base import RemoveBackgroundAdapter

# UIで選択できるモデル (rembgのモデル名)
SUPPORTED_MODELS = {"u2net", "isnet-general-use", "birefnet-general"}

_sessions: dict[str, object] = {}


def _get_session(model: str):
    """モデルのロードは重いのでプロセス内でキャッシュ"""
    if model not in _sessions:
        _sessions[model] = new_session(model)
    return _sessions[model]


class RembgAdapter(RemoveBackgroundAdapter):
    def __init__(self, model: str = "isnet-general-use"):
        if model not in SUPPORTED_MODELS:
            raise ValueError(
                f"未対応のrembgモデル: {model} (対応: {', '.join(sorted(SUPPORTED_MODELS))})"
            )
        self.model = model
        self.name = f"rembg/{model}"

    def remove_background(self, image: Image.Image) -> Image.Image:
        result = remove(image.convert("RGBA"), session=_get_session(self.model))
        return result.convert("RGBA")
