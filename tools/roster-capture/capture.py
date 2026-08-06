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
import json
import os
import queue
import sys
import threading
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


class Identifier:
    """Names each frame in the background while you keep browsing.

    Recognising a frame costs a couple of seconds, far too long to hold up the
    capture loop, so frames are queued and reported as their answers arrive --
    usually while the next click is still happening. The point is to catch a
    member whose account number failed to read now, when going back is one
    click, instead of at the end of a sweep of seventy-six.

    Lo que lee se guarda en el mismo archivo de cache que parse.py consulta,
    con el nombre del fotograma por clave. Antes se tiraba: la captura
    reconocia los setenta y seis paneles para poder avisar por consola, y al
    terminar parse.py volvia a reconocer exactamente los mismos pixeles desde
    cero. Escribirlo cuesta nada y convierte el parseo en casi instantaneo.
    """

    def __init__(self, announce, cache_path: Path):
        self.announce = announce
        self.queue: queue.Queue = queue.Queue()
        self.uids: dict[str, str] = {}
        self.panels: dict[str, int] = {}
        self.fields: dict[str, set] = {}
        self.parse = None
        self.wanted: set = set()
        self.ready = threading.Event()
        self.cache_path = cache_path
        self.cache: dict = {}
        self.dirty = 0
        # Lo encolado mas lo que se este reconociendo ahora mismo.
        self.pending = 0
        self.lock = threading.Lock()
        threading.Thread(target=self._run, daemon=True).start()

    def save_cache(self) -> None:
        """Vuelca lo leido. Un fallo aqui no puede costar la captura: los PNG
        estan en disco y parse.py sabe reconocerlos por su cuenta."""
        if not self.cache:
            return
        try:
            self.cache_path.write_text(json.dumps(self.cache), encoding="utf-8")
            self.dirty = 0
        except Exception:
            pass

    def missing(self, name: str) -> list:
        return sorted(self.wanted - self.fields.get(name, set()))

    def _where(self, absent: list) -> str:
        """Turn a set of missing fields into which way to scroll."""
        if self.parse is None:
            return ""
        order = [key for key, _ in self.parse.FIELDS.values()]
        places = [order.index(k) for k in absent if k in order]
        if not places or len(places) != len(absent):
            return ""
        if min(places) >= len(order) - 3:
            return f"   {BOLD}baja mas{RESET}"
        if max(places) <= 2:
            return f"   {BOLD}sube al principio{RESET}"
        return ""

    def submit(self, kind: str, image: Image.Image, filename: str) -> None:
        with self.lock:
            self.pending += 1
        self.queue.put((kind, image, filename))

    def drain(self, timeout: float = 20.0) -> None:
        """Espera a que no quede nada por leer, ni en la cola ni en la mano.

        Miraba solo la cola, y el fotograma que se esta reconociendo ya salio
        de ella: al terminar la captura se perdia el aviso del ultimo miembro
        -- justo el que uno acaba de mirar -- y ahora tambien su lectura."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            with self.lock:
                if self.pending == 0:
                    return
            time.sleep(0.2)

    def _run(self) -> None:
        try:
            from rapidocr_onnxruntime import RapidOCR

            import parse
        except Exception as err:  # noqa: BLE001 - capture must not depend on this
            self.announce(f"{GREY}  (identificacion no disponible: {err}){RESET}")
            self.ready.set()
            return

        engine = RapidOCR()
        self.parse = parse
        self.wanted = {key for key, _ in parse.FIELDS.values()} | {"level", "sect"}
        self.ready.set()

        while True:
            kind, image, filename = self.queue.get()
            try:
                readings = parse.run_ocr(engine, image, self.cache, filename)
                # Cada pocos fotogramas, por si la sesion acaba de mala manera:
                # un corte de luz no deberia costar el reconocimiento entero.
                self.dirty += 1
                if self.dirty >= 10:
                    self.save_cache()
                if kind == "list":
                    self._report_popup(parse.read_popup(readings, image.width, image.height))
                else:
                    self._report_panel(
                        parse.read_header(readings, image.width, image.height),
                        readings,
                        image.width,
                        image.height,
                    )
            except Exception as err:  # noqa: BLE001
                self.announce(f"{GREY}       (no se pudo leer: {err}){RESET}")
            finally:
                with self.lock:
                    self.pending -= 1

    def _report_popup(self, found) -> None:
        # A list frame without a popup is just a scroll; saying so every time
        # would bury the reports that matter.
        if not found:
            return
        self.uids[found["nameAsRead"]] = found["uid"]
        self.announce(
            f"       {GREEN}UID de {found['nameAsRead']}{RESET}: {found['uid']}"
            f"{GREY}   ({len(self.uids)} identificados){RESET}"
        )

    def _report_panel(self, header, readings, width: int, height: int) -> None:
        name = (header or {}).get("name")
        if not name:
            return

        self.panels[name] = self.panels.get(name, 0) + 1
        got = self.fields.setdefault(name, set())
        got.update(key for key in ("level", "sect") if key in header)
        got.update(self.parse.FIELDS[label][0] for label, _, _ in self.parse.pair_fields(readings, width, height))

        # Naming what is still missing is the whole point: it says how much
        # further to scroll, while going back is still one click away. Which way
        # to scroll matters as much as how much, so the fields are read in the
        # order the panel lists them and turned into a direction.
        absent = self.missing(name)
        if absent:
            shown = ", ".join(absent[:3]) + ("..." if len(absent) > 3 else "")
            progress = f"{len(got)}/{len(self.wanted)}   {GREY}faltan: {shown}{RESET}{self._where(absent)}"
        else:
            progress = f"{GREEN}{len(got)}/{len(self.wanted)} completo{RESET}"

        warning = "" if name in self.uids else f"   {BOLD}<- sin UID todavia{RESET}"
        self.announce(f"       {name}   {progress}{warning}")


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
    parser.add_argument(
        "--no-identify",
        action="store_true",
        help="skip naming frames as they are captured (faster startup, no live report)",
    )
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

        # The recogniser reports from its own thread, so writing is serialised.
        printing = threading.Lock()

        def announce(line: str, beep: bool = False) -> None:
            """Replace the live status line with an event, then redraw it."""
            with printing:
                sys.stdout.write(("\r\033[K" if live else "") + line + "\n" + status())
                sys.stdout.flush()
            if beep and args.beep:
                try:
                    import winsound

                    winsound.Beep(880, 60)
                except Exception:
                    pass

        identifier = None if args.no_identify else Identifier(announce, out_dir / ".ocr-cache-v2.json")

        sys.stdout.write(status())
        sys.stdout.flush()

        begun = time.monotonic()
        manifest = (out_dir / "frames.jsonl").open("w", encoding="utf-8")

        try:
            while True:
                started = time.monotonic()
                elapsed = started - begun
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
                        announce(f"{GREY}  {stamp}  {name:5s}  ya lo tenia{RESET}      {BOLD}SIGUIENTE{RESET}", beep=True)
                        continue

                    saved[region.name].append(sig)
                    counts[region.name] += 1
                    filename = f"{region.name}-{counts[region.name]:04d}.png"
                    image.save(out_dir / filename)

                    # Clicking a portrait changes both regions at once, so the
                    # times are what later pairs a social popup with the detail
                    # panel beside it. That pairing is the only way to learn the
                    # real name of a member whose sect lets them show an alias.
                    manifest.write(
                        json.dumps({"file": filename, "kind": region.name, "t": round(elapsed, 3)}) + "\n"
                    )
                    manifest.flush()

                    announce(
                        f"  {stamp}  {name:5s}  {GREEN}#{counts[region.name]:03d} guardado{RESET}"
                        f"  {BOLD}SIGUIENTE{RESET}",
                        beep=True,
                    )
                    if identifier is not None:
                        identifier.submit(region.name, image.copy(), filename)

                if live:
                    sys.stdout.write("\r" + status())
                    sys.stdout.flush()
                time.sleep(max(0.0, interval - (time.monotonic() - started)))

        except KeyboardInterrupt:
            manifest.close()
            if identifier is not None:
                sys.stdout.write("\r\033[K  terminando de leer los ultimos fotogramas...\n")
                sys.stdout.flush()
                identifier.drain()
                identifier.save_cache()
            total = sum(counts.values())
            print(("\r\033[K" if live else "") + f"\n{total} fotogramas en {out_dir.resolve()}")
            print(f"  lista: {counts['list']}")
            print(f"  panel: {counts['panel']}")

            if identifier is not None and identifier.panels:
                sin_uid = sorted(set(identifier.panels) - set(identifier.uids))
                incompletos = {n: identifier.missing(n) for n in identifier.panels}
                incompletos = {n: m for n, m in incompletos.items() if m}

                print(f"\n{len(identifier.uids)} miembros con UID, {len(identifier.panels)} con datos")
                if sin_uid:
                    print(f"  sin UID: {', '.join(sin_uid)}")
                if incompletos:
                    print(f"  con datos incompletos ({len(incompletos)}):")
                    for n, m in sorted(incompletos.items()):
                        print(f"    {n}: faltan {', '.join(m)}")
            return 0


if __name__ == "__main__":
    raise SystemExit(main())
