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
import os
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import mss
import numpy as np
from PIL import Image, ImageDraw

GREEN, GREY, BOLD, RESET = "\033[32m", "\033[90m", "\033[1m", "\033[0m"
SPINNER = "|/-\\"


def enable_colour() -> None:
    """Turn on ANSI handling in the old Windows console; harmless elsewhere."""
    if os.name != "nt":
        return
    try:
        import ctypes

        kernel32 = ctypes.windll.kernel32
        kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7)
    except Exception:
        pass

# Fractions of the screen rather than pixels, so the same defaults work at any
# resolution with this UI layout. Measured from a 1920x1080 capture.
# The list box reaches well below the rows on purpose: clicking a member opens
# a social popup anchored to their row, and for members low down it extends
# past the last row. Cropping tighter loses the account number for exactly
# those members.
DEFAULT_REGIONS = {
    "list": (0.055, 0.130, 0.640, 0.930),
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
    parser.add_argument("--beep", action="store_true", help="also beep on each frame, to browse without looking")
    args = parser.parse_args()

    enable_colour()
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

        print(f"Monitor {args.monitor} ({monitor['width']}x{monitor['height']}) a {args.fps:g} fps")
        print(f"Guardando en {out_dir.resolve()}")
        print(f"\nNavega el gremio. Espera a ver {BOLD}SIGUIENTE{RESET} antes de cada paso.")
        print("Ctrl+C aqui para terminar.\n")

        # Per region: the last picture seen, how long it has held still, and
        # every picture already written out.
        last_seen: dict[str, np.ndarray] = {}
        still_for: dict[str, int] = {r.name: 0 for r in regions}
        saved: dict[str, list[np.ndarray]] = {r.name: [] for r in regions}
        counts: dict[str, int] = {r.name: 0 for r in regions}
        labels = {"list": "lista", "panel": "panel"}
        ticks = 0
        # Redirected to a file, the redrawn status line would pile up instead of
        # overwriting itself, so only draw it for a real terminal.
        live = sys.stdout.isatty()

        def status() -> str:
            if not live:
                return ""
            spin = SPINNER[(ticks // 3) % len(SPINNER)]
            return f"{GREY}  {spin} mirando...   lista {counts['list']} / panel {counts['panel']}{RESET}"

        def announce(line: str) -> None:
            """Replace the live status line with an event, then redraw it."""
            sys.stdout.write(("\r\033[K" if live else "") + line + "\n" + status())
            sys.stdout.flush()
            if args.beep:
                try:
                    import winsound

                    winsound.Beep(880, 60)
                except Exception:
                    pass

        sys.stdout.write(status())
        sys.stdout.flush()

        try:
            while True:
                started = time.monotonic()
                ticks += 1

                for region in regions:
                    image = grab(sct, region)
                    sig = signature(image)
                    name = labels[region.name]

                    previous = last_seen.get(region.name)
                    last_seen[region.name] = sig

                    if previous is None or differs(sig, previous, args.tolerance):
                        still_for[region.name] = 0
                        continue

                    still_for[region.name] += 1
                    # Act on the exact frame it settles, not on every frame after.
                    if still_for[region.name] != args.settle:
                        continue

                    stamp = datetime.now().strftime("%H:%M:%S")

                    # Say so out loud when nothing was written, otherwise a
                    # revisited screen looks like the tool has stopped working.
                    if any(not differs(sig, seen, args.tolerance) for seen in saved[region.name]):
                        announce(f"{GREY}  {stamp}  {name:5s}  ya lo tenia{RESET}      {BOLD}SIGUIENTE{RESET}")
                        continue

                    saved[region.name].append(sig)
                    counts[region.name] += 1
                    image.save(out_dir / f"{region.name}-{counts[region.name]:04d}.png")
                    announce(
                        f"  {stamp}  {name:5s}  {GREEN}#{counts[region.name]:03d} guardado{RESET}"
                        f"  {BOLD}SIGUIENTE{RESET}"
                    )

                if live:
                    sys.stdout.write("\r" + status())
                    sys.stdout.flush()
                time.sleep(max(0.0, interval - (time.monotonic() - started)))

        except KeyboardInterrupt:
            total = sum(counts.values())
            print(("\r\033[K" if live else "") + f"\n{total} fotogramas en {out_dir.resolve()}")
            print(f"  lista: {counts['list']}")
            print(f"  panel: {counts['panel']}")
            return 0


if __name__ == "__main__":
    raise SystemExit(main())
