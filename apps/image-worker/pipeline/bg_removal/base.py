"""背景除去のアダプタ層。

removeBackground(image) を抽象化し、rembg(ローカル)と外部API
(remove.bg / Photoroom 等)を設定で差し替え可能にする。
※背景"除去"に生成AIは使わない (専用手法のみ)。
"""
from abc import ABC, abstractmethod

from PIL import Image


class RemoveBackgroundAdapter(ABC):
    """入力: 任意モードのPIL Image / 出力: 被写体のみのRGBA画像"""

    name: str = "base"

    @abstractmethod
    def remove_background(self, image: Image.Image) -> Image.Image: ...


def get_adapter(settings: dict) -> RemoveBackgroundAdapter:
    """ジョブpayloadの設定スナップショットからアダプタを生成"""
    provider = settings.get("bg_removal_provider", "rembg")
    if provider == "rembg":
        from .rembg_adapter import RembgAdapter

        return RembgAdapter(model=settings.get("bg_removal_model", "isnet-general-use"))
    if provider == "external_api":
        from .external_api_adapter import ExternalApiAdapter

        return ExternalApiAdapter()
    raise ValueError(f"不明な背景除去プロバイダ: {provider}")
