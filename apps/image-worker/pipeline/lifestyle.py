"""任意モジュール (既定OFF): 切り抜き済み画像を生成系画像APIでライフスタイル背景に合成。

背景"除去"には生成AIを使わない方針のため、このモジュールは
「白抜き後の透過PNGに映える背景を生成して合成する」用途に限定する。
lifestyle_enabled=true かつプロバイダ設定済みのときのみ呼ばれる。
"""
from PIL import Image


class LifestyleNotConfigured(Exception):
    pass


def compose_lifestyle(subject_rgba: Image.Image, settings: dict) -> Image.Image:
    """生成背景との合成。プロバイダ未実装のため現状は明示的に未設定エラーを返し、
    ワーカー側は lifestyle_url を空のままスキップする (処理自体は失敗にしない)。

    実装時は ここで生成画像APIを呼び、背景画像に subject_rgba を合成して返す。
    """
    raise LifestyleNotConfigured(
        "ライフスタイル背景生成プロバイダが未実装です (image_settings.lifestyle_enabled をOFFにするか、実装を追加してください)"
    )
