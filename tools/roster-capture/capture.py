"""Capture the guild panel while you browse it.

Watches the screen and writes one PNG per distinct thing it sees. Nothing is
sent to the game -- this only reads pixels, the same as a screen recorder,
so you drive the interface yourself at whatever pace you like.

    python capture.py --calibrate     # check the regions line up, once
    python capture.py                 # then leave this running and browse

Frames are only kept once the picture has held still for a moment, so
scrolling never leaves a smeared half-frame behind, and anything already
captured is skipped. Browsing the same member twice costs nothing.

Press Ctrl+C in this window when you are done.
"""

from __future__ import annotations

import argparse
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import mss
import numpy as np
from PIL import Image, ImageDraw

# Fractions of the screen rather than pixels, so the same defaults work at any
# resolution with this UI layout. Measured from a 1920x1080 capture.
DEFAULT_REGIONS = {
    "list": (0.060, 0.140, 0.630, 0.820),
    "panel": (0.665, 0.140, 0.940, 0.870),
}

# Downscale before comparing: enough detail to tell two members apart, cheap
# enough to run every frame, and blind to one-pixel antialiasing noise.
SIGNATURE_SIZE = 64

# Newer mss deprecates the lowercase factory; older releases lack the class.
open_capture = getattr(mss, "MSS", None) or mss.mss


@dataclass(frozen=True)
class Region:
    name: str
    left: int
    top: int
    width: int
    height: int

    @property
    def box(self) -> dict:
        return {"left": self.left, "top": self.top, "width": self.width, "height": self.height}


def build_regions(monitor: dict, fractions: dict[str, tuple]) -> list[Region]:
    regions = []
    for name, (x0, y0, x1, y1) in fractions.items():
        left = monitor["left"] + int(monitor["width"] * x0)
        top = monitor["top"] + int(monitor["height"] * y0)
        regions.append(
            Region(
                name=name,
                left=left,
                top=top,
                width=int(monitor["width"] * (x1 - x0)),
                height=int(monitor["height"] * (y1 - y0)),
            )
        )
    return regions


def signature(image: Image.Image) -> np.ndarray:
    small = image.convert("L").resize((SIGNATURE_SIZE, SIGNATURE_SIZE), Image.BILINEAR)
    return np.asarray(small, dtype=np.float32)


def differs(a: np.ndarray, b: np.ndarray, tolerance: float) -> bool:
    return float(np.abs(a - b).mean()) > tolerance


def grab(sct, region: Region) -> Image.Image:
    shot = sct.grab(region.box)
    return Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")


def calibrate(sct, monitor: dict, regions: list[Region], out_dir: Path) -> Path:
    shot = sct.grab(monitor)
    full = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
    draw = ImageDraw.Draw(full)

    for region in regions:
        x = region.left - monitor["left"]
        y = region.top - monitor["top"]
        draw.rectangle([x, y, x + region.width, y + region.height], outline=(255, 0, 0), width=4)
        draw.text((x + 8, y + 8), region.name, fill=(255, 0, 0))

    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "calibration.png"
    full.save(path)
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=Path("frames"), help="where to write frames (default: ./frames)")
    parser.add_argument("--monitor", type=int, default=1, help="monitor number, 1 is primary (default: 1)")
    parser.add_argument("--fps", type=float, default=10.0, help="how often to look at the screen (default: 10)")
    parser.add_argument(
        "--settle",
        type=int,
        default=3,
        help="frames the picture must hold still before it counts (default: 3)",
    )
    parser.add_argument(
        "--tolerance",
        type=float,
        default=1.5,
        help="how different two pictures must be to count as new, 0-255 (default: 1.5)",
    )
    parser.add_argument("--calibrate", action="store_true", help="write one annotated screenshot and exit")
    args = parser.parse_args()

    interval = 1.0 / args.fps
    session = datetime.now().strftime("%Y%m%d-%H%M%S")

    with open_capture() as sct:
        if args.monitor >= len(sct.monitors):
            print(f"No monitor {args.monitor}; this machine has {len(sct.monitors) - 1}.", file=sys.stderr)
            return 1

        monitor = sct.monitors[args.monitor]
        regions = build_regions(monitor, DEFAULT_REGIONS)

        if args.calibrate:
            path = calibrate(sct, monitor, regions, args.out)
            print(f"Wrote {path}")
            print("Open it and check the two red boxes sit over the member list and the detail panel.")
            return 0

        out_dir = args.out / session
        out_dir.mkdir(parents=True, exist_ok=True)

        print(f"Watching monitor {args.monitor} ({monitor['width']}x{monitor['height']}) at {args.fps:g} fps")
        print(f"Writing to {out_dir.resolve()}")
        print("Browse the guild panel now. Ctrl+C here when you are done.\n")

        # Per region: the last picture seen, how long it has held still, and
        # every picture already written out.
        last_seen: dict[str, np.ndarray] = {}
        still_for: dict[str, int] = {r.name: 0 for r in regions}
        saved: dict[str, list[np.ndarray]] = {r.name: [] for r in regions}
        counts: dict[str, int] = {r.name: 0 for r in regions}

        try:
            while True:
                started = time.monotonic()

                for region in regions:
                    image = grab(sct, region)
                    sig = signature(image)

                    previous = last_seen.get(region.name)
                    last_seen[region.name] = sig

                    if previous is None or differs(sig, previous, args.tolerance):
                        still_for[region.name] = 0
                        continue

                    still_for[region.name] += 1
                    # Save on the exact frame it settles, not on every frame after.
                    if still_for[region.name] != args.settle:
                        continue

                    if any(not differs(sig, seen, args.tolerance) for seen in saved[region.name]):
                        continue

                    saved[region.name].append(sig)
                    counts[region.name] += 1
                    image.save(out_dir / f"{region.name}-{counts[region.name]:04d}.png")
                    print(
                        f"\r  list: {counts['list']:4d}   panel: {counts['panel']:4d}",
                        end="",
                        flush=True,
                    )

                time.sleep(max(0.0, interval - (time.monotonic() - started)))

        except KeyboardInterrupt:
            total = sum(counts.values())
            print(f"\n\nStopped. {total} frames in {out_dir.resolve()}")
            print(f"  member list: {counts['list']}")
            print(f"  detail panel: {counts['panel']}")
            return 0


if __name__ == "__main__":
    raise SystemExit(main())
