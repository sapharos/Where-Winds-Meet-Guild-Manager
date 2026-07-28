# Roster capture

Collects screenshots of the in-game guild panel so the roster can be read from
them, without recording video and without sending anything to the game. It only
reads pixels; you drive the interface yourself.

## Install

```bash
pip install -r requirements.txt
```

## Calibrate once

With the guild panel open in game:

```bash
python capture.py --calibrate
```

That writes `frames/calibration.png` with two red boxes drawn on it. The first
should cover the member list on the left, the second the detail panel on the
right. If they are off, edit `DEFAULT_REGIONS` at the top of `capture.py` --
the numbers are fractions of the screen, so they hold at any resolution with
this layout.

Capturing tightly matters for two reasons: the FPS counter in the corner would
otherwise change every frame and defeat the duplicate check, and cropping keeps
the frames small.

## Capture

```bash
python capture.py
```

Leave it running and browse the guild normally: pick a member, scroll the
detail panel through its three positions, move to the next. A frame is written
only once the picture has held still, so scrolling never leaves a smeared
half-frame, and anything already seen is skipped -- revisiting a member, going
back, or pausing costs nothing. The running count tells you it is working.

Ctrl+C in the console when you are done. Frames land in
`frames/<date>-<time>/`, named `panel-0001.png` and `list-0001.png`.

Expect roughly three panel frames per member plus a handful of list frames.
For a guild of 76 that is around 240 files and a few tens of megabytes.

## Notes

Every detail-panel frame carries the member's name, level, position and sect in
its header, so the frames identify themselves. Browsing order does not matter
and you can stop and resume across several sessions.

Capture at the game's native resolution, and prefer borderless or windowed
fullscreen so the console stays reachable on a second monitor.

## Si tu terminal no acepta `&&`

Windows PowerShell 5.1 no admite `&&` como separador. Usa `;`, o el lanzador
`capture.bat`, que se situa solo en esta carpeta y funciona desde cualquier
shell y tambien haciendo doble clic.

## Leer las capturas

```bash
python parse.py frames/20260728-130959
```

Agrupa los fotogramas por miembro usando el nombre de la cabecera fija, empareja
cada etiqueta con su valor y escribe `roster.json` en la misma carpeta. La tabla
final indica que campos falta por capturar de cada miembro, si te saltaste
alguna posicion de scroll.

Los nombres con acentos vuelven sin ellos (Subaru por Subâru): el alfabeto del
reconocedor no los tiene. No se corrige aqui a proposito, porque la lectura es
identica siempre y eso es lo unico que necesita el emparejado contra un roster
ya conocido. La ortografia correcta se confirma una vez, a mano.
