"""Pillowによる整形: 1:1正方形キャンバス・被写体中央配置・余白・白背景/透過・ウォーターマーク"""
from PIL import Image, ImageDraw, ImageFont


def trim_to_subject(img_rgba: Image.Image, alpha_threshold: int = 8) -> Image.Image:
    """アルファチャンネルから被写体のバウンディングボックスを切り出す"""
    alpha = img_rgba.getchannel("A")
    mask = alpha.point(lambda a: 255 if a > alpha_threshold else 0)
    bbox = mask.getbbox()
    if bbox is None:
        # 全透過 = 背景除去で被写体が消えた (要手動対応として扱う)
        raise ValueError("背景除去後に被写体が検出できませんでした (全透過)")
    return img_rgba.crop(bbox)


def compose_square(
    subject_rgba: Image.Image,
    canvas_size: int = 2048,
    margin_ratio: float = 0.06,
    background: str | None = "white",
) -> Image.Image:
    """被写体を正方形キャンバス中央に余白付きで配置。

    background="white" → RGB画像(主画像用) / None → 透過RGBA(サブ画像用)
    """
    margin_ratio = min(max(margin_ratio, 0.0), 0.4)
    inner = int(canvas_size * (1 - margin_ratio * 2))

    w, h = subject_rgba.size
    scale = min(inner / w, inner / h)
    new_size = (max(1, round(w * scale)), max(1, round(h * scale)))
    subject = subject_rgba.resize(new_size, Image.LANCZOS)

    if background == "white":
        canvas = Image.new("RGBA", (canvas_size, canvas_size), (255, 255, 255, 255))
    else:
        canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))

    offset = (
        (canvas_size - new_size[0]) // 2,
        (canvas_size - new_size[1]) // 2,
    )
    canvas.paste(subject, offset, subject)

    return canvas.convert("RGB") if background == "white" else canvas


def add_watermark(img: Image.Image, text: str, opacity: int = 90) -> Image.Image:
    """右下に半透明テキストのショップ用ウォーターマーク"""
    if not text:
        return img
    base = img.convert("RGBA")
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    font_size = max(16, base.width // 32)
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", font_size)
    except OSError:
        font = ImageFont.load_default()

    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    pad = base.width // 50
    pos = (base.width - tw - pad, base.height - th - pad * 2)
    draw.text(pos, text, font=font, fill=(120, 120, 120, opacity))

    merged = Image.alpha_composite(base, overlay)
    return merged.convert(img.mode) if img.mode != "RGBA" else merged
