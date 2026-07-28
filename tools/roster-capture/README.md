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

## Identificacion en vivo

Mientras capturas, cada fotograma se lee en segundo plano y la consola informa
de quien es:

```
  14:51:44  lista  #012 guardado  SIGUIENTE
       UID de Muerte: 1087315722   (7 identificados)
  14:51:52  panel  #031 guardado  SIGUIENTE
       Muerte   13/18   faltan: martial_mastery, exploration_mastery...
  14:51:58  panel  #032 guardado  SIGUIENTE
       Muerte   18/18 completo
```

El contador dice cuanto falta por bajar: si tras el ultimo scroll no pone
`completo`, los campos que nombra siguen mas abajo en el panel. Al terminar se
listan los miembros que quedaron incompletos y que campos les faltan.

Leer un fotograma cuesta un par de segundos, asi que se hace en un hilo aparte
y el aviso llega mientras haces el clic siguiente; la captura nunca se detiene.

Si aparecen datos de alguien cuyo panel social todavia no se ha leido, se marca
`<- sin UID todavia`. Eso significa que te saltaste su retrato: vuelve a el
antes de seguir, que en ese momento cuesta un clic. Al terminar se listan los
que quedaron sin UID.

Con `--no-identify` se desactiva, y el arranque es inmediato.

## Motes de secta

Algunos miembros pueden mostrar un mote temporal en su panel social en vez de su
nombre (KaelithRen por maskmango). Al pulsar el retrato tambien se selecciona al
miembro, asi que el panel derecho capturado en ese mismo instante lleva el
nombre real. `frames.jsonl` guarda cuando se escribio cada fotograma y `parse.py`
los empareja por tiempo, de modo que el UID acaba bajo el nombre real y no bajo
un mote que puede cambiar manana.

## El barrido en varias sesiones

Nada se envia al servidor mientras capturas: `capture.py` solo escribe PNG en
disco. Puedes parar con Ctrl+C y seguir otro dia; cada sesion crea su propia
carpeta.

Para que las dos cuenten como un solo escaneo y no como dos, pasa todas las
carpetas a la vez:

```bash
python parse.py frames/20260728-130959 frames/20260729-101500
```

Se fusionan por nombre de miembro: quien aparezca en ambas suma sus campos, y un
UID capturado en la segunda se une a los datos de la primera. El `roster.json`
sale con la fecha de la primera carpeta.
