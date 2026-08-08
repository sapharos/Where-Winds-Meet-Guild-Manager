"""Capture the guild panel while you browse it.

Watches the screen and writes one PNG per distinct thing it sees. Nothing is
sent to the game -- this only reads pixels, the same as a screen recorder,
so you drive the interface yourself at whatever pace you like.

    python capture.py --calibrate     # check the regions line up, once
    python capture.py                 # then leave this running and browse

Se guarda un fotograma cada vez que la imagen cambia y se queda quieta, asi
que un scroll nunca deja media pantalla borrosa, y mirar sin tocar nada no
escribe nada. Volver a un miembro escribe otro PNG y no pasa nada: parse.py
ya vota entre fotogramas repetidos.

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
        # LIFO y no FIFO: reconocer cuesta un par de segundos y tu vas mas
        # rapido que eso, asi que cuando hay cola lo que sale por consola es de
        # hace varios miembros -- justo lo que se siente como que se ha colgado.
        # Atendiendo el ultimo, lo que lees es del que tienes delante. No se
        # descarta nada: los de atras se leen igual, solo despues, y el recuento
        # de campos es un conjunto, asi que el orden no cambia el resultado.
        self.queue: queue.LifoQueue = queue.LifoQueue()
        self.uids: dict[str, str] = {}
        self.panels: dict[str, int] = {}
        self.fields: dict[str, set] = {}
        # Cuando se capturo cada panel y de quien era, para poder poner el UID
        # bajo el nombre real y no bajo un mote de secta. Mismo criterio que
        # parse.py, que ya lo hacia al final; aqui faltaba, y por eso los avisos
        # de "sin UID" mentian con esos miembros.
        self.panel_times: list[tuple[float, str]] = []
        # Popups leidos cuyo panel todavia no ha llegado. Con la cola al reves
        # el panel de al lado puede leerse despues, asi que se reintenta.
        self.popups_sueltos: list[tuple[float, dict]] = []
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

    def submit(self, kind: str, image: Image.Image, filename: str, when: float) -> None:
        with self.lock:
            self.pending += 1
        self.queue.put((kind, image, filename, when))

    def waiting(self) -> int:
        """Cuantos fotogramas quedan por leer, para poder decirlo en pantalla.

        Una cola invisible es lo que convierte "va con retraso" en "se ha
        colgado": con el numero delante se ve que avanza y cuanto falta."""
        with self.lock:
            return self.pending

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
            kind, image, filename, when = self.queue.get()
            try:
                readings = parse.run_ocr(engine, image, self.cache, filename)
                # Cada pocos fotogramas, por si la sesion acaba de mala manera:
                # un corte de luz no deberia costar el reconocimiento entero.
                self.dirty += 1
                if self.dirty >= 10:
                    self.save_cache()
                if kind == "list":
                    self._report_popup(
                        parse.read_popup(readings, image.width, image.height), when
                    )
                else:
                    self._report_panel(
                        parse.read_header(readings, image.width, image.height),
                        readings,
                        image.width,
                        image.height,
                        when,
                    )
            except Exception as err:  # noqa: BLE001
                self.announce(f"{GREY}       (no se pudo leer: {err}){RESET}")
            finally:
                with self.lock:
                    self.pending -= 1

    # Lo mismo que SAME_CLICK_SECONDS en parse.py: pulsar el retrato cambia las
    # dos regiones a la vez, asi que el panel de ese instante lleva el nombre
    # real del que el popup puede estar enseñando un mote.
    MISMO_CLIC = 3.0

    def _al_lado(self, cuando: float) -> str | None:
        """De quien era el panel capturado en ese mismo momento."""
        cerca = [(abs(t - cuando), nombre) for t, nombre in self.panel_times
                 if abs(t - cuando) <= self.MISMO_CLIC]
        return min(cerca)[1] if cerca else None

    def _anotar_uid(self, found: dict, cuando: float) -> bool:
        """Guarda el UID bajo el nombre real. False si aun no se sabe cual es.

        Un mote es un nombre que no es de nadie: si lo que enseña el popup ya
        lo ha producido algun panel, es el miembro y no un mote, por cerca que
        esten los dos fotogramas. Misma regla que parse.py -- tenerla escrita
        dos veces distintas seria tener una que se contradice."""
        leido = found["nameAsRead"]
        real = self._al_lado(cuando)
        if leido in self.panels or real is None:
            self.uids[leido] = found["uid"]
            return True
        if real != leido:
            self.uids[real] = found["uid"]
            self.announce(f"{GREY}       '{leido}' es el mote de {real}{RESET}")
        else:
            self.uids[real] = found["uid"]
        return True

    def _report_popup(self, found, cuando: float) -> None:
        # A list frame without a popup is just a scroll; saying so every time
        # would bury the reports that matter.
        if not found:
            return

        # Con la cola al reves el panel de al lado puede no haberse leido
        # todavia. Se aparta y se reintenta en cuanto llegue uno, en vez de
        # apuntar el UID bajo un mote que luego no casa con nadie.
        if self._al_lado(cuando) is None and found["nameAsRead"] not in self.panels:
            self.popups_sueltos.append((cuando, found))
            return

        self._anotar_uid(found, cuando)
        self.announce(
            f"       {GREEN}UID de {found['nameAsRead']}{RESET}: {found['uid']}"
            f"{GREY}   ({len(self.uids)} identificados){RESET}"
        )

    def _resolver_sueltos(self) -> None:
        """Reintenta los popups que esperaban a que se leyera su panel."""
        quedan = []
        for cuando, found in self.popups_sueltos:
            if self._al_lado(cuando) is None and found["nameAsRead"] not in self.panels:
                quedan.append((cuando, found))
                continue
            self._anotar_uid(found, cuando)
            self.announce(
                f"       {GREEN}UID de {found['nameAsRead']}{RESET}: {found['uid']}"
                f"{GREY}   ({len(self.uids)} identificados){RESET}"
            )
        self.popups_sueltos = quedan

    def _report_panel(self, header, readings, width: int, height: int, cuando: float) -> None:
        name = (header or {}).get("name")
        if not name:
            return

        self.panels[name] = self.panels.get(name, 0) + 1
        self.panel_times.append((cuando, name))
        # Este panel puede ser el que le faltaba a un popup ya leido.
        if self.popups_sueltos:
            self._resolver_sueltos()
        got = self.fields.setdefault(name, set())
        # Lo que este fotograma aporta de nuevo, para poder enseñarlo. Los
        # repetidos se callan: al bajar el scroll las posiciones se solapan a
        # proposito, y volver a listar lo mismo tres veces entierra lo nuevo.
        nuevos = []
        for key in ("level", "sect"):
            if key in header and key not in got:
                nuevos.append((key, header[key]))
        got.update(key for key in ("level", "sect") if key in header)

        for label, value, _ in self.parse.pair_fields(readings, width, height):
            key = self.parse.FIELDS[label][0]
            if key not in got:
                nuevos.append((key, value))
            got.add(key)

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

        # Y lo leido, con su valor. Sirve para lo que ninguna cuenta puede: ver
        # que el 35336 de la pantalla se ha leido 35336 y no 3536, mientras el
        # panel sigue delante. Un campo mal leido descubierto aqui cuesta un
        # scroll; descubierto al importar, otro barrido.
        #
        # Separador ASCII a proposito, como el resto de lo que sale por consola:
        # la consola vieja de Windows escupe un rombo por cada caracter que no
        # entra en su pagina de codigos, y un valor ilegible no vale de nada.
        if nuevos:
            self.announce(
                "          "
                + f"{GREY} | {RESET}".join(f"{GREY}{k}{RESET} {v}" for k, v in nuevos)
            )


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
        help="cuanto puede moverse la imagen y seguir contando como quieta, 0-255 (default: 1.5)",
    )
    parser.add_argument("--calibrate", action="store_true", help="write one annotated screenshot and exit")
    parser.add_argument("--beep", action="store_true", help="also beep on each frame, to browse without looking")
    parser.add_argument(
        "--no-identify",
        action="store_true",
        help="skip naming frames as they are captured (faster startup, no live report)",
    )
    parser.add_argument(
        "--no-parse",
        action="store_true",
        help="no escribir roster.json al terminar; hazlo luego con parse.py",
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

        # Por region: la ultima imagen vista y cuanto lleva quieta. Ya no se
        # guarda la lista de todo lo escrito: comparar contra ella era lo que
        # descartaba fotogramas buenos.
        last_seen: dict[str, np.ndarray] = {}
        still_for: dict[str, int] = {r.name: 0 for r in regions}
        counts: dict[str, int] = {r.name: 0 for r in regions}
        labels = {"list": "lista", "panel": "panel"}
        ticks = 0
        # Enlazado antes que `status`, que lo consulta para enseñar la cola: el
        # hilo del reconocedor puede escribir en cuanto se construye.
        identifier = None
        # Redirected to a file, the redrawn status line would pile up instead of
        # overwriting itself, so only draw it for a real terminal.
        live = sys.stdout.isatty()

        def status() -> str:
            if not live:
                return ""
            spin = SPINNER[(ticks // 3) % len(SPINNER)]
            # La cola, cuando la hay. Leer un fotograma cuesta un par de
            # segundos y tu vas mas rapido, asi que a veces se acumula; sin
            # verlo parece que la herramienta se ha parado. Con el numero
            # delante se ve que baja solo, y no hay nada que esperar: lo que
            # queda en la cola ya esta guardado en disco.
            atras = identifier.waiting() if identifier is not None else 0
            cola = f"{GREY}   leyendo {atras}{RESET}" if atras > 1 else ""
            return (
                f"{GREY}  {spin} mirando...   lista {counts['list']} / panel {counts['panel']}"
                f"{RESET}{cola}"
            )

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

        if not args.no_identify:
            identifier = Identifier(announce, out_dir / ".ocr-cache-v2.json")

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

                    # Aqui se descartaba el fotograma si se parecia a CUALQUIER
                    # otro ya guardado de esa region, y por eso hacia falta
                    # repetir un scroll diez veces.
                    #
                    # No podia funcionar. Reducido a 64x64 en gris, un panel es
                    # casi todo etiquetas -- las mismas para todo el mundo -- y
                    # lo unico que cambia, las cifras, queda en manchas de dos
                    # pixeles. Medido sobre un barrido real: dos paneles de
                    # MIEMBROS DISTINTOS se separan entre 1.50 y 1.55, y el
                    # umbral era 1.50. Cero margen. Y como se comparaba contra
                    # todo lo guardado desde el principio, el riesgo crecia con
                    # el barrido: al 7% de fotogramas les pasaba rozando en el
                    # primer cuarto y al 35% en el tercero. De ahi salian 581
                    # fotogramas para 85 miembros donde bastaban 255.
                    #
                    # Lo peor no era guardar de menos, era que el fotograma
                    # descartado tampoco se leia: se tiraba entero, sin mirarlo.
                    #
                    # Ahora se guarda todo lo que se asiente. No es guardar de
                    # mas: `still_for` solo dispara en el fotograma exacto en
                    # que la imagen se queda quieta, asi que mirar una pantalla
                    # sin tocar nada no escribe nada, y volver a un miembro
                    # cuesta un PNG de 270 KB. Los repetidos de verdad los
                    # resuelve parse.py, que ya vota entre fotogramas.
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
                        identifier.submit(region.name, image.copy(), filename, elapsed)

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

            # Y el roster.json, aqui mismo. Eran dos ordenes y la segunda habia
            # que recordarla con el nombre exacto de la carpeta; ahora sale del
            # mismo comando. Se delega entero en parse.py en vez de repetir su
            # logica -- los votos entre fotogramas, los motes de secta, los
            # duplicados -- que es donde vive lo dificil. Con el cache que acaba
            # de escribirse no reconoce nada de nuevo: son unos segundos.
            if not args.no_parse and any(counts.values()):
                print("\n  escribiendo roster.json...")
                try:
                    import parse

                    argv = sys.argv
                    sys.argv = ["parse.py", str(out_dir)]
                    try:
                        parse.main()
                    finally:
                        sys.argv = argv
                except Exception as err:  # noqa: BLE001
                    # Los PNG estan a salvo: esto siempre se puede repetir a mano.
                    print(f"  no se pudo escribir roster.json ({err})")
                    print(f"  hazlo con:  python parse.py {out_dir}")
            return 0


if __name__ == "__main__":
    raise SystemExit(main())
