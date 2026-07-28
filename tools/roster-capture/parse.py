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

# Headings that introduce a section and carry no value of their own.
SECTIONS = {"Personal Info", "Guild Hero's Realm", "Skyward Bond", "Guild War", "Mastery"}

# Column boundaries as fractions of the panel width. Labels hug the left edge,
# values are right-aligned, and nothing legitimate lands in between.
LABEL_MAX_X = 0.45
VALUE_MIN_X = 0.60

# The sticky header, which never scrolls: avatar and level, name, position, sect.
HEADER_TOP, HEADER_BOTTOM = 0.12, 0.28
LEVEL_MAX_X = 0.26
POSITION_MIN_X = 0.78

OCR_SCALE = 3
MIN_LABEL_RATIO = 0.72


@dataclass
class Reading:
    text: str
    confidence: float
    x0: float
    y0: float
    y1: float

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

    level = [r for r in band if r.x0 < LEVEL_MAX_X * width and r.text.isdigit()]
    position = [r for r in band if r.x0 >= POSITION_MIN_X * width]
    middle = sorted(
        (r for r in band if LEVEL_MAX_X * width <= r.x0 < POSITION_MIN_X * width),
        key=lambda r: r.y_mid,
    )
    if not middle:
        return {}

    header = {"name": middle[0].text}
    if len(middle) > 1:
        header["sect"] = middle[1].text
    if level:
        header["level"] = int(level[0].text)
    if position:
        header["position"] = position[0].text
    return header


def pair_fields(readings: list[Reading], width: int) -> list[tuple[str, str, float]]:
    """Match left-column labels to the right-column value beside them."""
    labels = sorted((r for r in readings if r.x0 < LABEL_MAX_X * width), key=lambda r: r.y_mid)
    values = sorted((r for r in readings if r.x0 >= VALUE_MIN_X * width), key=lambda r: r.y_mid)

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
            for known in FIELDS:
                ratio = similarity(joined, known)
                if ratio > best[0] + 1e-9:
                    best = (ratio, span, known)

        ratio, span, known = best
        if known is None or ratio < MIN_LABEL_RATIO:
            i += 1
            continue

        # The value sits level with the label's first line, not its middle.
        anchor = labels[i].y_mid
        candidates = [
            (abs(v.y_mid - anchor), j) for j, v in enumerate(values) if j not in used_values
        ]
        if candidates:
            distance, j = min(candidates)
            if distance < (labels[i].y1 - labels[i].y0) * 1.5:
                used_values.add(j)
                found.append((known, values[j].text, values[j].confidence))

        i += span

    return found


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


def read_popup_name(inside: list[Reading], anchor: Reading, height: float) -> str | None:
    """The line above the combat role, or failing that the biggest above the buttons."""
    usable = [r for r in inside if len(r.text.strip()) > 1 and not r.text.strip().isdigit()]

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


# How far apart two frames may be and still count as the same click. Both
# regions settle within a frame or two of each other, so this is generous.
SAME_CLICK_SECONDS = 4.0


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
    parser.add_argument("folder", type=Path, help="a frames/<date>-<time> folder")
    parser.add_argument("--out", type=Path, default=None, help="where to write the JSON (default: <folder>/roster.json)")
    parser.add_argument("--no-cache", action="store_true", help="ignore any cached recognition")
    args = parser.parse_args()

    frames = sorted(args.folder.glob("panel-*.png"))
    if not frames:
        print(f"No panel-*.png in {args.folder}", file=sys.stderr)
        return 1

    from rapidocr_onnxruntime import RapidOCR

    engine = RapidOCR()
    cache_path = args.folder / ".ocr-cache.json"
    cache = {} if args.no_cache or not cache_path.exists() else json.loads(cache_path.read_text())

    members: dict[str, Member] = {}
    panel_headers: dict[Path, str] = {}
    skipped = 0

    for n, path in enumerate(frames, 1):
        print(f"\r  leyendo {n}/{len(frames)}  {path.name}", end="", flush=True)
        image = Image.open(path)
        readings = run_ocr(engine, image, cache, path.name)

        header = read_header(readings, image.width, image.height)
        if not header.get("name"):
            skipped += 1
            continue

        panel_headers[path] = header["name"]
        member = members.setdefault(header["name"], Member(name=header["name"]))
        member.frames.append(path.name)
        for key in ("level", "position", "sect"):
            if key in header:
                member.record(key, str(header[key]), 1.0)

        for known, raw, confidence in pair_fields(readings, image.width):
            key, _ = FIELDS[known]
            member.record(key, raw, confidence)

    # Account numbers come from the social popup, which lands in the list frames.
    timeline = load_timeline(args.folder)
    panel_names = {path.name: name for path, name in panel_headers.items()}
    identities: dict[str, dict] = {}
    aliases: list[tuple[str, str]] = []

    list_frames = sorted(args.folder.glob("list-*.png"))
    for n, path in enumerate(list_frames, 1):
        print(f"\r  buscando UIDs {n}/{len(list_frames)}", end="", flush=True)
        image = Image.open(path)
        found = read_popup(run_ocr(engine, image, cache, path.name), image.width, image.height)
        if not found:
            continue

        # Members of some sects display a changeable alias in the popup instead
        # of their name. Clicking the portrait also selects them, so the detail
        # panel captured at that same moment carries the real one.
        real = beside_in_time(timeline, path.name, panel_names)
        if real and real != found["nameAsRead"]:
            aliases.append((found["nameAsRead"], real))
            found = {**found, "aliasAsRead": found["nameAsRead"], "nameAsRead": real}
        identities[found["nameAsRead"]] = found

    cache_path.write_text(json.dumps(cache))
    print(f"\r  {len(frames)} fotogramas leidos, {skipped} sin cabecera reconocible")
    print(f"  {len(identities)} UID encontrados en {len(list_frames)} fotogramas de lista")
    for shown, real in aliases:
        print(f"    '{shown}' es el mote de {real}")
    if not timeline and list_frames:
        print("    (sin frames.jsonl: los motes de secta no se pueden resolver)")
    print()

    kinds = {key: kind for key, kind in FIELDS.values()}
    kinds.update({"level": "int", "position": "text", "sect": "text"})

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
        "scannedAt": scanned_at(args.folder),
        "source": args.folder.name,
        "entries": roster,
    }

    out = args.out or args.folder / "roster.json"
    out.write_text(json.dumps(document, indent=2, ensure_ascii=False), encoding="utf-8")

    expected = len(FIELDS) + 3
    print(f"{'miembro':16s} {'frames':>7s} {'campos':>8s} {'UID':>12s}   faltantes")
    print("-" * 86)
    for record in roster:
        got = {k for k, v in record["fields"].items() if v is not None}
        missing = sorted(({key for key, _ in FIELDS.values()} | {"level", "position", "sect"}) - got)
        print(
            f"{record['nameAsRead']:16s} {record['frames']:7d} {len(got):5d}/{expected:<2d} "
            f"{record.get('uid', '-'):>12s}   {', '.join(missing) if missing else 'ninguno'}"
        )

    without_uid = [r["nameAsRead"] for r in roster if "uid" not in r]
    if without_uid:
        print(
            f"\nSin UID ({len(without_uid)}): {', '.join(without_uid)}"
            "\n  Abre el panel social de cada uno (clic en su retrato) durante la captura."
        )

    print(f"\nEscrito {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
