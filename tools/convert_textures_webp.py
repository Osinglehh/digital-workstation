"""把参考 PBR 贴图从 PNG 转成 WebP（法线无损，albedo q92，其余 q90）。

原始 PNG 保留在 analysis/textures-source/（已列入 .gitignore），
public/textures/ 只保留部署用的 WebP。运行：python tools/convert_textures_webp.py
"""

from __future__ import annotations

from pathlib import Path
import shutil

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "analysis" / "textures-source"
TARGET = ROOT / "public" / "textures"


def archive_pngs() -> None:
    for png in TARGET.rglob("*.png"):
        rel = png.relative_to(TARGET)
        dest = SOURCE / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(png), dest)
        print(f"archived {rel.as_posix()}")


def encode_kwargs(name: str) -> dict[str, object]:
    lowered = name.lower()
    if "normal" in lowered:
        return {"lossless": True, "method": 6}
    if "albedo" in lowered:
        return {"quality": 92, "method": 6}
    return {"quality": 90, "method": 6}


def convert() -> None:
    total = 0
    count = 0
    for png in sorted(SOURCE.rglob("*.png")):
        rel = png.relative_to(SOURCE)
        out = (TARGET / rel).with_suffix(".webp")
        out.parent.mkdir(parents=True, exist_ok=True)
        image = Image.open(png)
        image.save(out, "WEBP", **encode_kwargs(png.name))
        size = out.stat().st_size
        total += size
        count += 1
        print(f"{rel.as_posix():50} {png.stat().st_size / 1024:>7.0f}K -> {size / 1024:>6.0f}K")
    print(f"converted {count} files, {total / 1024 / 1024:.2f} MB")


if __name__ == "__main__":
    archive_pngs()
    convert()
