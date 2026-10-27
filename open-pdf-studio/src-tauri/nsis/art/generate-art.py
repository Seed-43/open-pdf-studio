"""Generates the installer artwork (sidebar and header bitmaps) from the app icon.

Run from anywhere:  python generate-art.py
Requires Pillow and the Segoe UI fonts of Windows (C:\\Windows\\Fonts).

The installer is DPI-aware, so it picks the bitmap made for the DPI of its
window (see SelectArtwork in ../ui.nsh) and shows it unscaled, centred in its
control. The sizes below are the pixel sizes of those controls with the
installer's dialog font (Segoe UI 9 pt) at 100, 125, 150, 175 and 200 %.
Both bitmaps have a solid background in the colour the installer paints
behind them, so a control that ends up a few pixels larger shows no edge.

The output BMPs are committed; run this script again only when the icon,
the brand colours or the dialog font change.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ICON = HERE.parent.parent / "icons" / "icon.png"
FONTS = Path("C:/Windows/Fonts")

# Brand colours, from styles/themes.css (default theme).
DARK = (0x36, 0x36, 0x3E)  # --theme-bg
ACCENT = (0xD9, 0x77, 0x06)  # --theme-accent
WHITE = (0xFF, 0xFF, 0xFF)
MUTED = (0xB4, 0xB4, 0xBA)

PRODUCT = "Open PDF Studio"

# DPI -> (sidebar width, sidebar height, header width, header height) in px.
SIZES = {
    96: (191, 362, 175, 66),
    120: (218, 483, 200, 88),
    144: (273, 603, 250, 109),
    168: (327, 724, 300, 131),
    192: (354, 772, 325, 140),
}


def icon_at(size):
    icon = Image.open(ICON).convert("RGBA")
    return icon.resize((size, size), Image.LANCZOS)


def paste_icon(canvas, size, x, y):
    icon = icon_at(size)
    canvas.paste(icon, (x, y), icon)


def text_width(draw, text, font):
    left, _, right, _ = draw.textbbox((0, 0), text, font=font)
    return right - left


def sidebar(dpi, width, height):
    s = dpi / 96
    img = Image.new("RGB", (width, height), DARK)
    draw = ImageDraw.Draw(img)

    icon_size = round(96 * s)
    name_font = ImageFont.truetype(str(FONTS / "seguisb.ttf"), round(19 * s))
    tag_font = ImageFont.truetype(str(FONTS / "segoeui.ttf"), round(12 * s))

    gap_icon = round(14 * s)
    name_h = round(26 * s)
    gap_rule = round(10 * s)
    rule_w, rule_h = round(40 * s), max(2, round(3 * s))
    gap_tag = round(12 * s)
    tag_h = round(16 * s)
    block = icon_size + gap_icon + name_h + gap_rule + rule_h + gap_tag + tag_h

    # The block sits a little above the middle, where the eye starts.
    top = round(height * 0.42 - block / 2)
    paste_icon(img, icon_size, (width - icon_size) // 2, top)

    y = top + icon_size + gap_icon
    w = text_width(draw, PRODUCT, name_font)
    draw.text(((width - w) / 2, y), PRODUCT, font=name_font, fill=WHITE)

    y += name_h + gap_rule
    draw.rectangle(
        [(width - rule_w) // 2, y, (width - rule_w) // 2 + rule_w - 1, y + rule_h - 1],
        fill=ACCENT,
    )

    y += rule_h + gap_tag
    tag = "OpenAEC Foundation"
    w = text_width(draw, tag, tag_font)
    draw.text(((width - w) / 2, y), tag, font=tag_font, fill=MUTED)
    return img


def header(dpi, width, height):
    s = dpi / 96
    img = Image.new("RGB", (width, height), WHITE)
    icon_size = round(44 * s)
    margin = round(14 * s)
    paste_icon(img, icon_size, width - icon_size - margin, (height - icon_size) // 2)
    return img


def main():
    for dpi, (sw, sh, hw, hh) in SIZES.items():
        sidebar(dpi, sw, sh).save(HERE / f"sidebar-{dpi}.bmp")
        header(dpi, hw, hh).save(HERE / f"header-{dpi}.bmp")
        print(f"{dpi} dpi: sidebar {sw}x{sh}, header {hw}x{hh}")


if __name__ == "__main__":
    main()
