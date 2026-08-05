"""Read captured frames into one record per guild member.

    python parse.py frames/20260728-130959

Every detail-panel frame carries the member's name in its sticky header, so
frames group themselves and the order they were taken in does not matter.

The header also clips whatever row is scrolling underneath it, which produces
the occasional mangled read. Rather than model that, each field is collected
from every frame that shows it and the readings vote -- the scroll positions
overlap, so a clipped row is always outnumbered by clean ones.

Accented names come back stripped (Subaru for Subâru) because the recogniser's
alphabet has no diacritics. That is left alone on purpose: the reading is
identical every time, which is all that matching a known roster needs. The
canonical spelling is confirmed once, by a person, not guessed here.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path

import numpy as np
from PIL import Image

# Labels exactly as the game writes them, paired with the key each becomes.
# Matching is fuzzy, so near-misses from the recogniser still land.
FIELDS = {
    "Region": ("region", "text"),
    "Language": ("language", "text"),
    "Days Joined": ("days_joined", "int"),
    "Week Activity Point": ("week_activity", "int"),
    "Treasure Tokens earned this week": ("treasure_tokens_week", "int"),
    "Treasure Token Obtained": ("treasure_tokens_total", "int"),
    "Weekly Clears": ("weekly_clears", "int"),
    "Last Week's Clears": ("last_week_clears", "int"),
    "Highest Floor": ("highest_floor", "int"),
    "League Participations": ("league_participations", "int"),
    "Ranked Match Participations": ("ranked_participations", "int"),
    "Duel Participations": ("duel_participations", "int"),
    "Martial Mastery": ("martial_mastery", "int"),
    "Exploration Mastery": ("exploration_mastery", "int"),
    "Profession Mastery": ("profession_mastery", "int"),
}

# El panel puede venir en español: una sesión real llegó mezclada tras cambiar
# el idioma del juego a mitad de barrido, y sus fotogramas eran ilegibles para
# un lector que sólo sabía inglés. Cada etiqueta española apunta a su inglesa y
# el resto del programa sigue hablando una sola lengua. Las marcadas (inferida)
# no se han visto en un fotograma real todavía: si el juego las escribe
# distinto, el emparejado difuso probablemente las coja igual, y si no, se
# corrigen aquí al primer barrido que las enseñe.
TRANSLATIONS = {
    "Región": "Region",
    "Idioma": "Language",
    "Días Unido": "Days Joined",
    "Puntos de Actividad Semanal": "Week Activity Point",
    "Fichas del tesoro obtenidas esta semana": "Treasure Tokens earned this week",
    "Ficha del Tesoro Obtenida": "Treasure Token Obtained",
    "Despejes Semanales": "Weekly Clears",
    "Despejes de la Semana Pasada": "Last Week's Clears",
    "Piso Más Alto": "Highest Floor",
    "Participaciones en Liga": "League Participations",
    "Participaciones en Partida Clasificatoria": "Ranked Match Participations",  # (inferida)
    "Participaciones en Duelo": "Duel Participations",  # (inferida)
    "Maestría Marcial": "Martial Mastery",  # (inferida)
    "Maestría de Exploración": "Exploration Mastery",  # (inferida)
    "Maestría de Profesión": "Profession Mastery",  # (inferida)
}

# Headings that introduce a section and carry no value of their own.
SECTIONS = {
    "Personal Info", "Guild Hero's Realm", "Skyward Bond", "Guild War", "Mastery",
    "Información personal", "Reino del Héroe de la Hermandad", "Vínculo Celestial",
    "Guerra de Hermandad", "Maestría",
}

# Labels hug the left edge; values are right-aligned. A value is recognised by
# where it ends, not where it starts: "Espanol(Latino)" begins at 0.60 of the
# width and "2" at 0.92, so a rule about left edges is really a rule about how
# long the text is, and loses the long ones.
LABEL_MAX_X = 0.45
VALUE_MIN_RIGHT = 0.75

# The sticky header, which never scrolls: avatar and level, then the name with
# the rank badge beside it, then the sect. The rank is deliberately not read --
# it is assigned in the app instead -- but the badge still shares a line with
# the name and has to be told apart from it.
HEADER_TOP, HEADER_BOTTOM = 0.12, 0.28
LEVEL_MAX_X = 0.26

# How far apart two readings may sit vertically and still be the same line.
HEADER_LINE_TOLERANCE = 0.03

OCR_SCALE = 3
MIN_LABEL_RATIO = 0.72

# Below this a "member" is a frame caught mid-load, not a person.
MIN_FIELDS_FOR_MEMBER = 3

# Two panel readings this alike are the same member read twice, not two people.
NEAR_DUPLICATE = 0.85


@dataclass
class Reading:
    text: str
    confidence: float
    x0: float
    y0: float
    y1: float
    x1: float = 0.0

    @property
    def y_mid(self) -> float:
        return (self.y0 + self.y1) / 2


@dataclass
class Member:
    name: str
    frames: list[str] = field(default_factory=list)
    # key -> list of (value, confidence), one entry per frame that showed it
    votes: dict[str, list[tuple[str, float]]] = field(default_factory=dict)

    def record(self, key: str, value: str, confidence: float) -> None:
        self.votes.setdefault(key, []).append((value, confidence))


def similarity(a: str, b: str) -> float:
    clean = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())
    return SequenceMatcher(None, clean(a), clean(b)).ratio()


def run_ocr(engine, image: Image.Image, cache: dict, key: str) -> list[Reading]:
    if key in cache:
        return [Reading(**r) for r in cache[key]]

    big = image.resize((image.width * OCR_SCALE, image.height * OCR_SCALE), Image.LANCZOS)
    raw, _ = engine(np.array(big))
    readings = [
        Reading(
            text=text.strip(),
            confidence=float(conf),
            x0=min(p[0] for p in box) / OCR_SCALE,
            x1=max(p[0] for p in box) / OCR_SCALE,
            y0=min(p[1] for p in box) / OCR_SCALE,
            y1=max(p[1] for p in box) / OCR_SCALE,
        )
        for box, text, conf in (raw or [])
    ]
    cache[key] = [r.__dict__ for r in readings]
    return readings


def read_header(readings: list[Reading], width: int, height: int) -> dict:
    band = [r for r in readings if HEADER_TOP * height <= r.y_mid <= HEADER_BOTTOM * height]
    if not band:
        return {}

    is_level = lambda r: r.x0 < LEVEL_MAX_X * width and r.text.strip().isdigit()
    level = [r for r in band if is_level(r)]
    rest = sorted((r for r in band if not is_level(r)), key=lambda r: r.y_mid)
    if not rest:
        return {}

    tolerance = HEADER_LINE_TOLERANCE * height

    def leftmost_of_line(candidates: list[Reading]) -> str:
        top = min(r.y_mid for r in candidates)
        line = [r for r in candidates if r.y_mid - top <= tolerance]
        return min(line, key=lambda r: r.x0).text

    # The name shares its line with the rank badge, which sits to its right --
    # but a long badge like "Reclutadores" starts further left than a short one,
    # and can even measure a pixel higher. Reading the line left to right is the
    # only rule that holds for every badge; height is not.
    header = {"name": leftmost_of_line(rest)}

    top = min(r.y_mid for r in rest)
    below = [r for r in rest if r.y_mid - top > tolerance]
    if below:
        header["sect"] = leftmost_of_line(below)
    if level:
        header["level"] = int(level[0].text)
    return header


def pair_fields(
    readings: list[Reading],
    width: int,
    height: int,
    misses: list | None = None,
) -> list[tuple[str, str, float]]:
    """Match left-column labels to the right-column value beside them.

    `misses` recoge las etiquetas conocidas que quedaron sin valor al lado,
    con su geometría, para que quien llama pueda darles la segunda mirada de
    rescue_value. Es opcional porque al identificador en vivo de capture.py
    le vale la firma de siempre.
    """
    # The sticky header is not part of the list: its name and sect sit in the
    # label column and its rank badge in the value column, where they compete
    # with real fields for the pairing.
    body = [r for r in readings if r.y_mid > HEADER_BOTTOM * height]
    labels = sorted((r for r in body if r.x0 < LABEL_MAX_X * width), key=lambda r: r.y_mid)
    values = sorted((r for r in body if r.x1 >= VALUE_MIN_RIGHT * width), key=lambda r: r.y_mid)

    found: list[tuple[str, str, float]] = []
    used_values: set[int] = set()
    i = 0

    while i < len(labels):
        if any(similarity(labels[i].text, s) > 0.85 for s in SECTIONS):
            i += 1
            continue

        # A label can wrap onto a second or third line. Try each length and keep
        # whichever reads closest to a label we know, longest wins on a tie.
        best = (0.0, 1, None)
        for span in (1, 2, 3):
            if i + span > len(labels):
                break
            joined = " ".join(l.text for l in labels[i : i + span])
            for known in (*FIELDS, *TRANSLATIONS):
                ratio = similarity(joined, known)
                if ratio > best[0] + 1e-9:
                    best = (ratio, span, known)

        ratio, span, known = best
        if known is None or ratio < MIN_LABEL_RATIO:
            i += 1
            continue
        # De vuelta al inglés canónico: quien nos llama indexa FIELDS con esto.
        known = TRANSLATIONS.get(known, known)

        # The value sits level with the label's first line, not its middle.
        anchor = labels[i].y_mid
        candidates = [
            (abs(v.y_mid - anchor), j) for j, v in enumerate(values) if j not in used_values
        ]
        paired = False
        if candidates:
            distance, j = min(candidates)
            if distance < (labels[i].y1 - labels[i].y0) * 1.5:
                used_values.add(j)
                found.append((known, values[j].text, values[j].confidence))
                paired = True
        if not paired and misses is not None:
            misses.append((known, labels[i]))

        i += span

    return found


def rescue_value(engine, image: Image.Image, label: Reading):
    """Una segunda mirada, sólo a la franja donde faltó el valor.

    El reconocedor pierde de vez en cuando un dígito suelto -- un «4» solo
    contra la textura del papel -- y como la captura omite los fotogramas
    repetidos, volver a esa posición de scroll no lo arregla nunca: el mismo
    fotograma con el mismo fallo es el único testigo. Recortar la franja
    derecha de esa línea y mirarla al doble de aumento rescata lo que la
    pasada general no vio. Sólo números: los dos campos de texto son palabras
    largas que la pasada general no pierde.
    """
    pad = label.y1 - label.y0
    box = (
        int(image.width * 0.45),
        max(0, int(label.y0 - pad * 0.5)),
        image.width,
        min(image.height, int(label.y1 + pad * 1.5)),
    )
    crop = image.crop(box)
    big = crop.resize((crop.width * OCR_SCALE * 2, crop.height * OCR_SCALE * 2), Image.LANCZOS)
    raw, _ = engine(np.array(big))
    best = None
    for item in raw or []:
        text = str(item[1]).strip().replace(",", "")
        confidence = float(item[2])
        if re.fullmatch(r"\d+", text) and (best is None or confidence > best[1]):
            best = (text, confidence)
    return best


# The social popup, opened by clicking a member's portrait. It lands inside the
# member-list region, so it is already in the list-*.png frames and needs no
# extra capturing -- only recognising.
UID_PATTERN = re.compile(r"UID\s*[::]?\s*(\d{5,})", re.IGNORECASE)
ONLINE_ID_PATTERN = re.compile(r"Online\s*ID\s*[::]?\s*(\S+)", re.IGNORECASE)

# The popup comes in two shapes. Your own account labels the number "UID:" and
# adds an Online ID; everyone else's shows the number bare beside a "More"
# link. What both always carry is a Profile button, so that is the anchor: the
# name sits above it, the account number below.
PROFILE_LABEL = "Profile"
UID_DIGITS = re.compile(r"^\d{8,12}$")

# Bounds relative to the Profile button, as shares of the frame. The horizontal
# one matters as much as the vertical: the popup covers only part of the member
# list, and the rows still visible beside it are otherwise candidates.
POPUP_BESIDE_PROFILE = (-0.14, 0.30)

# Every layout stacks the same three lines at the top: the name, then the level
# and combat role, then the sect and guild. So the role line locates the name,
# which picking the largest text does not: an all-caps name like GIANNAA has no
# descenders and measures shorter than the sect beneath it.
POPUP_ROLES = ("DPS", "Tank", "Healer")

# The popup covers only part of the member list, so the list's own furniture is
# still on screen around it. A column heading accepted as a name hands one
# member's account number to whoever the detail panel happened to be showing,
# which is worse than reading no name at all.
LIST_CHROME = (
    "Member Name",
    "Positions",
    "Level",
    "Online Status",
    "Week Activity",
    "Realm Clear",
    "This Week's Hero's",
    "Search member by Name",
    "Members",
    "Apprentice",
    "Offline",
    "Online",
)
NAME_ABOVE_ROLE = (0.03, 0.12)
NAME_ABOVE_PROFILE = 0.45
# The popup grows extra action buttons -- request to join a team, invite to
# co-op -- depending on the member, which pushes the account number anywhere
# from 60 to 240 pixels below the button. Reach far enough for the tallest
# variant; nothing else in this narrow column runs to eight digits, so the
# generous window costs no precision.
UID_BELOW_PROFILE = 0.55


def read_popup(readings: list[Reading], width: int, height: int) -> dict | None:
    """Pull the account number out of a frame showing the social popup."""
    anchor = next(
        (r for r in readings if similarity(r.text, PROFILE_LABEL) > 0.85),
        None,
    )
    if anchor is None:
        return None

    left = anchor.x0 + POPUP_BESIDE_PROFILE[0] * width
    right = anchor.x0 + POPUP_BESIDE_PROFILE[1] * width
    inside = [r for r in readings if left <= r.x0 <= right]

    # A labelled "UID: 123..." if this is your own account, otherwise the bare
    # run of digits below the buttons. Length alone separates it from the level
    # and from the activity numbers showing through from the list.
    uid = None
    for reading in inside:
        found = UID_PATTERN.search(reading.text)
        if found:
            uid = found.group(1)
            break
    if uid is None:
        below = [
            r
            for r in inside
            if anchor.y_mid < r.y_mid <= anchor.y_mid + UID_BELOW_PROFILE * height
            and UID_DIGITS.match(r.text.strip())
        ]
        if below:
            uid = min(below, key=lambda r: r.y_mid).text.strip()
    if uid is None:
        return None

    online_id = None
    for reading in inside:
        found = ONLINE_ID_PATTERN.search(reading.text)
        if found:
            online_id = found.group(1)
            break

    name = read_popup_name(inside, anchor, height)
    if name is None:
        return None
    return {"nameAsRead": name, "uid": uid, "onlineId": online_id}


def is_list_chrome(text: str) -> bool:
    return any(similarity(text, label) > 0.8 for label in LIST_CHROME)


def read_popup_name(inside: list[Reading], anchor: Reading, height: float) -> str | None:
    """The line above the combat role, or failing that the biggest above the buttons."""
    usable = [
        r
        for r in inside
        if len(r.text.strip()) > 1 and not r.text.strip().isdigit() and not is_list_chrome(r.text)
    ]

    role = next(
        (
            r
            for r in inside
            if any(similarity(r.text, known) > 0.85 for known in POPUP_ROLES)
        ),
        None,
    )
    if role is not None:
        near = [
            r
            for r in usable
            if NAME_ABOVE_ROLE[0] * height <= role.y_mid - r.y_mid <= NAME_ABOVE_ROLE[1] * height
        ]
        if near:
            # Closest above wins: the sect sits below the role, never between.
            return min(near, key=lambda r: role.y_mid - r.y_mid).text.strip()

    above = [
        r
        for r in usable
        if anchor.y_mid - NAME_ABOVE_PROFILE * height <= r.y_mid < anchor.y_mid
    ]
    if not above:
        return None
    return max(above, key=lambda r: r.y1 - r.y0).text.strip()


# Time alone cannot say whether a pairing is real: a wrong one was measured at
# 0.77s and a right one at 2.55s. What separates them is that a nickname belongs
# to nobody, so the name check below does the deciding and this only bounds how
# far to look for the member wearing it.
SAME_CLICK_SECONDS = 3.0


def load_timeline(folder: Path) -> dict[str, float]:
    """When each frame was written, from the manifest the capture tool keeps."""
    path = folder / "frames.jsonl"
    if not path.exists():
        return {}

    timeline = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            row = json.loads(line)
            timeline[row["file"]] = float(row["t"])
        except (ValueError, KeyError):
            continue
    return timeline


def beside_in_time(timeline: dict[str, float], frame: str, panel_names: dict[str, str]) -> str | None:
    """The member showing in the detail panel when this frame was taken."""
    when = timeline.get(frame)
    if when is None:
        return None

    nearby = [
        (abs(timeline[name] - when), name)
        for name in panel_names
        if name in timeline and abs(timeline[name] - when) <= SAME_CLICK_SECONDS
    ]
    if not nearby:
        return None
    return panel_names[min(nearby)[1]]


SESSION_NAME = re.compile(r"^\d{8}-\d{6}$")


def folder_size(folder: Path) -> int:
    return sum(f.stat().st_size for f in folder.rglob("*") if f.is_file())


def cleanup_older(folders: list[Path]) -> None:
    """Offer to delete capture folders from earlier sweeps.

    Only ever offers folders beside the ones just read, never those themselves,
    and never deletes without being told to: the frames are the only copy of a
    sweep until its roster.json has been imported, so the confirmation lists
    which folders were never parsed at all.
    """
    keep = {f.resolve() for f in folders}
    candidates = sorted(
        {
            child
            for folder in folders
            for child in folder.parent.iterdir()
            if child.is_dir() and SESSION_NAME.match(child.name) and child.resolve() not in keep
        }
    )
    if not candidates:
        print("\nNo hay capturas de semanas anteriores que borrar.")
        return

    total = sum(folder_size(c) for c in candidates)
    print(f"\nCapturas anteriores que se pueden borrar ({total / 1e6:.0f} MB):")
    for folder in candidates:
        parsed = "" if (folder / "roster.json").exists() else "   SIN PARSEAR"
        print(f"  {folder.name}   {folder_size(folder) / 1e6:5.0f} MB{parsed}")

    if any(not (c / "roster.json").exists() for c in candidates):
        print("\n  Ojo: las marcadas SIN PARSEAR nunca se leyeron. Sus datos se perderian.")

    try:
        answer = input("\nBorrar estas carpetas? [s/N] ").strip().lower()
    except EOFError:
        print("Sin confirmacion posible; no se borra nada.")
        return

    if answer not in ("s", "si", "sí", "y", "yes"):
        print("No se borro nada.")
        return

    import shutil

    for folder in candidates:
        shutil.rmtree(folder)
        print(f"  borrada {folder.name}")


def merge_near_duplicates(
    members: dict[str, Member], identities: dict[str, dict]
) -> list[tuple[str, str, int, int]]:
    """Fold two readings of one member into the spelling the frames agree on.

    Runs of similar strokes are where the recogniser slips -- Naoomiii comes
    back as Naoomili -- and each spelling then collects its own frames. The
    majority reading wins, exactly as competing values do. Two account numbers
    that differ mean two people, however alike their names read, so a uid
    always overrules the resemblance.
    """
    merged: list[tuple[str, str, int, int]] = []
    order = sorted(members, key=lambda n: (-len(members[n].frames), n))

    for keep in order:
        if keep not in members:
            continue
        for other in order:
            if other == keep or other not in members:
                continue
            if similarity(keep, other) < NEAR_DUPLICATE:
                continue

            kept_uid = (identities.get(keep) or {}).get("uid")
            other_uid = (identities.get(other) or {}).get("uid")
            if kept_uid and other_uid and kept_uid != other_uid:
                continue

            merged.append((other, keep, len(members[other].frames), len(members[keep].frames)))
            members[keep].frames.extend(members[other].frames)
            for key, votes in members[other].votes.items():
                members[keep].votes.setdefault(key, []).extend(votes)

            if other_uid and not kept_uid:
                identities[keep] = {**identities[other], "nameAsRead": keep}
            identities.pop(other, None)
            del members[other]

    return merged


def scanned_at(folder: Path) -> str:
    """Date the sweep was taken, from the folder name the capture tool made."""
    from datetime import datetime

    try:
        return datetime.strptime(folder.name, "%Y%m%d-%H%M%S").astimezone().isoformat()
    except ValueError:
        return datetime.now().astimezone().isoformat()


def to_value(raw: str, kind: str) -> str | int | None:
    if kind == "int":
        digits = re.sub(r"[^0-9]", "", raw)
        return int(digits) if digits else None
    return raw or None


def settle(votes: list[tuple[str, float]], kind: str) -> tuple[object, float, int]:
    """Pick the reading the frames agree on; confidence breaks a tie."""
    tally: dict[object, list[float]] = {}
    for raw, confidence in votes:
        value = to_value(raw, kind)
        if value is not None:
            tally.setdefault(value, []).append(confidence)

    if not tally:
        return None, 0.0, 0

    value = max(tally, key=lambda v: (len(tally[v]), max(tally[v])))
    return value, max(tally[value]), len(tally[value])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "folders",
        type=Path,
        nargs="+",
        help="one or more frames/<date>-<time> folders; several are merged into one sweep",
    )
    parser.add_argument("--out", type=Path, default=None, help="where to write the JSON (default: <first folder>/roster.json)")
    parser.add_argument("--no-cache", action="store_true", help="ignore any cached recognition")
    parser.add_argument(
        "--cleanup",
        action="store_true",
        help="after parsing, offer to delete capture folders from earlier sweeps",
    )
    args = parser.parse_args()

    total_panels = sum(len(list(folder.glob("panel-*.png"))) for folder in args.folders)
    if not total_panels:
        print(f"No panel-*.png in {', '.join(str(f) for f in args.folders)}", file=sys.stderr)
        return 1

    from rapidocr_onnxruntime import RapidOCR

    engine = RapidOCR()

    members: dict[str, Member] = {}
    identities: dict[str, dict] = {}
    aliases: list[tuple[str, str]] = []
    skipped = 0
    read_panels = 0
    read_lists = 0
    without_timeline = False

    # Each folder is one sitting at the keyboard. A sweep of seventy-six rarely
    # fits in one, so several are merged here rather than landing in the history
    # as separate scans -- but the frame times inside each restart from zero, so
    # the popup pairing has to stay within its own folder.
    for folder in args.folders:
        cache_path = folder / ".ocr-cache-v2.json"
        cache = {} if args.no_cache or not cache_path.exists() else json.loads(cache_path.read_text())
        timeline = load_timeline(folder)
        panel_headers: dict[Path, str] = {}

        frames = sorted(folder.glob("panel-*.png"))
        for n, path in enumerate(frames, 1):
            print(f"\r  {folder.name}: leyendo {n}/{len(frames)}", end="", flush=True)
            image = Image.open(path)
            readings = run_ocr(engine, image, cache, path.name)

            header = read_header(readings, image.width, image.height)
            if not header.get("name"):
                skipped += 1
                continue

            panel_headers[path] = header["name"]
            member = members.setdefault(header["name"], Member(name=header["name"]))
            member.frames.append(path.name)
            for key in ("level", "sect"):
                if key in header:
                    member.record(key, str(header[key]), 1.0)

            misses: list = []
            for known, raw, confidence in pair_fields(readings, image.width, image.height, misses):
                key, _ = FIELDS[known]
                member.record(key, raw, confidence)

            # Las etiquetas que se quedaron sin valor: se mira su franja de
            # cerca antes de darlas por no capturadas. El voto de después se
            # encarga de que un rescate dudoso no gane a una lectura limpia.
            for known, label in misses:
                key, kind = FIELDS[known]
                if kind != "int":
                    continue
                rescued = rescue_value(engine, image, label)
                if rescued:
                    member.record(key, rescued[0], rescued[1] * 0.9)

        read_panels += len(frames)

        # Account numbers come from the social popup, which lands in list frames.
        panel_names = {path.name: name for path, name in panel_headers.items()}
        list_frames = sorted(folder.glob("list-*.png"))
        for n, path in enumerate(list_frames, 1):
            print(f"\r  {folder.name}: buscando UIDs {n}/{len(list_frames)}", end="", flush=True)
            image = Image.open(path)
            found = read_popup(run_ocr(engine, image, cache, path.name), image.width, image.height)
            if not found:
                continue

            # Members of some sects display a changeable alias in the popup
            # instead of their name. Clicking the portrait also selects them, so
            # the detail panel captured at that same moment carries the real one.
            # A nickname is a name that belongs to nobody: if the popup shows a
            # name the detail panel has produced for somebody, it is that member
            # being browsed, not an alias, however close the two frames sit.
            real = beside_in_time(timeline, path.name, panel_names)
            if real and real != found["nameAsRead"] and found["nameAsRead"] not in members:
                aliases.append((found["nameAsRead"], real))
                found = {**found, "aliasAsRead": found["nameAsRead"], "nameAsRead": real}
            identities[found["nameAsRead"]] = found

        read_lists += len(list_frames)
        without_timeline = without_timeline or (not timeline and bool(list_frames))
        cache_path.write_text(json.dumps(cache))

    frames = [f for folder in args.folders for f in sorted(folder.glob("panel-*.png"))]
    list_frames = [f for folder in args.folders for f in sorted(folder.glob("list-*.png"))]

    print(f"\r  {read_panels} fotogramas leidos, {skipped} sin cabecera reconocible")
    print(f"  {len(identities)} UID encontrados en {read_lists} fotogramas de lista")
    for shown, real in aliases:
        print(f"    '{shown}' es el mote de {real}")
    if without_timeline:
        print("    (sin frames.jsonl: los motes de secta no se pueden resolver)")
    print()

    kinds = {key: kind for key, kind in FIELDS.values()}
    kinds.update({"level": "int", "position": "text", "sect": "text"})

    # A frame caught while the panel was still loading, or mid-transition,
    # yields a "member" with a name and nothing behind it. Requiring either an
    # account number or a few real fields separates those from someone genuinely
    # captured in a hurry, and what gets dropped is listed rather than vanishing.
    discarded = [
        name
        for name, member in members.items()
        if name not in identities and len(member.votes) < MIN_FIELDS_FOR_MEMBER
    ]
    for name in discarded:
        del members[name]

    folded = merge_near_duplicates(members, identities)

    roster = []
    for member in sorted(members.values(), key=lambda m: m.name):
        fields, quality = {}, {}
        for key, votes in member.votes.items():
            value, confidence, agreeing = settle(votes, kinds.get(key, "text"))
            fields[key] = value
            quality[key] = {
                "confidence": round(confidence, 3),
                "framesAgreeing": agreeing,
                "framesSeen": len(votes),
            }
        entry = {
            "nameAsRead": member.name,
            "frames": len(member.frames),
            "fields": fields,
            "quality": quality,
        }
        identity = identities.get(member.name)
        if identity:
            entry["uid"] = identity["uid"]
            if identity.get("onlineId"):
                entry["onlineId"] = identity["onlineId"]
        roster.append(entry)

    # Shaped for POST /api/scans/preview, so the file goes straight into the app.
    document = {
        "scannedAt": scanned_at(args.folders[0]),
        "source": ", ".join(f.name for f in args.folders),
        "entries": roster,
    }

    out = args.out or args.folders[0] / "roster.json"
    out.write_text(json.dumps(document, indent=2, ensure_ascii=False), encoding="utf-8")

    expected = len(FIELDS) + 2
    print(f"{'miembro':16s} {'frames':>7s} {'campos':>8s} {'UID':>12s}   faltantes")
    print("-" * 86)
    for record in roster:
        got = {k for k, v in record["fields"].items() if v is not None}
        missing = sorted(({key for key, _ in FIELDS.values()} | {"level", "sect"}) - got)
        print(
            f"{record['nameAsRead']:16s} {record['frames']:7d} {len(got):5d}/{expected:<2d} "
            f"{record.get('uid', '-'):>12s}   {', '.join(missing) if missing else 'ninguno'}"
        )

    if discarded:
        print(f"\nDescartados por venir vacios ({len(discarded)}): {', '.join(sorted(discarded))}")

    if folded:
        print("\nLecturas unificadas (gano la que mas fotogramas repiten):")
        for dropped, kept, n_drop, n_keep in folded:
            print(f"  {dropped} ({n_drop}) -> {kept} ({n_keep})")

    names = [r["nameAsRead"] for r in roster]
    pairs = [
        (a, b)
        for i, a in enumerate(names)
        for b in names[i + 1 :]
        if similarity(a, b) >= NEAR_DUPLICATE
    ]
    if pairs:
        print("\nNombres casi identicos, probablemente la misma persona leida de dos formas:")
        for a, b in pairs:
            print(f"  {a}  /  {b}")

    without_uid = [r["nameAsRead"] for r in roster if "uid" not in r]
    if without_uid:
        print(
            f"\nSin UID ({len(without_uid)}): {', '.join(without_uid)}"
            "\n  Abre el panel social de cada uno (clic en su retrato) durante la captura."
        )

    print(f"\nEscrito {out}")

    if args.cleanup:
        cleanup_older(args.folders)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
