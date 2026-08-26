# VODs de guerra

Grabaciones de las guerras, subidas por los miembros, servidas desde la
plataforma, y a futuro reproducibles varias a la vez y sincronizadas para ver qué
hacía cada uno en el mismo instante.

Este documento recoge las decisiones y por qué se tomaron. Las cifras salen de lo
que el gremio hace de verdad: **8-10 guerras por semana**, **hasta 4 VODs por
guerra** (2 de ataque, 2 de defensa), **35 minutos máximo** cada uno (5 de
preparación + 30 de partida).

---

## 1. Dónde viven los bytes

**En el Synology, no en el contenedor y no en la nube.**

El LXC 180 (DockerApps) tiene ~18 GiB libres en su disco de arranque. Un solo VOD
son ~2 GB. Si algo del pipeline escribe ahí por descuido, la primera subida
grande llena el contenedor y **se cae Portainer con todo lo que tiene dentro**.
Es el fallo más probable de todo el proyecto y se evita con una línea de
configuración.

El reparto es:

```
navegador → [LXC 180: ingesta, ffmpeg, nginx, firma] ──SMB/LAN──→ [DS713+ : sólo bytes]
```

El NAS **no habla con internet nunca**. Es un DS713+ de 2013, fuera de soporte y
clavado en DSM 6.2.4 sin parches de seguridad; exponerlo sería un error. Sirve
ficheros por la LAN y nada más.

### Por qué no la nube

Se evaluó. Con retención de 3 meses el almacenamiento se estabiliza en ~1,2 TB, y
ahí las cifras quedan así (aproximadas, y planas en el tiempo):

| | Coste mensual |
|---|---|
| AWS (S3 + CloudFront + MediaConvert) | ~$60 |
| Cloudflare R2 | ~$17 |
| Bunny Stream (llave en mano) | ~$15-20 |
| Backblaze B2 | ~$7 |
| **Synology** | **0** |

AWS es la peor de las opciones de nube aquí: su coste dominante no es el disco
sino MediaConvert (~$80/mes por transcodificar lo que el 7700K hace gratis) y el
egress, que **se multiplica por el número de mosaicos del multistream** — una
funcionalidad cuyo coste crecería con lo mucho que guste.

La puerta a la nube queda abierta y barata: el origen es una variable de
configuración, no una decisión de arquitectura. Si algún día cansa depender de un
NAS de 2013, migrar a B2 son unas horas y ~7 $/mes.

---

## 2. Retención: 3 meses

Sin retención esto crece ~375 GB/mes, **4,5 TB al año, para siempre**. Con
borrado a los 90 días se estabiliza en **~1,2 TB constantes**.

Dos consecuencias que hay que respetar:

- **El historial sobrevive a sus vídeos.** Las guerras son permanentes (el
  puntaje de impacto lee guerras de hace un año). Al caducar se borran **los
  bytes, no la fila**: `war_vods` conserva quién lo subió, la duración y el
  offset, y el acta dice «hubo VOD, caducó» en vez de dar un enlace roto.
- **Válvula de escape.** Permiso `war.vod.pin` para que un oficial marque unos
  pocos como permanentes — la final, la remontada. Veinte VODs fijados son 40 GB,
  ruido frente a 1,2 TB, y evita perder lo irrepetible.

Aviso por DM del bot **7 días antes de caducar** al que lo subió, por si quiere
bajárselo. La infraestructura ya está en pie.

---

## 3. Transcodificado: copiar, no recodificar

**Techo de 1080p.** Lo que llegue más grande se reduce, encajándolo en 1920×1080
sin deformar (`force_original_aspect_ratio=decrease`, para que un ultrapanorámico
de 3440×1440 no salga aplastado). Esto se mira para repasar una guerra —quién
estaba dónde, quién llegó tarde a la puerta— y para eso 1080p sobra; lo que de
verdad se paga es el almacén.

**Tope de subida: 10 GiB.** Quien graba en 4K se planta en ocho o nueve gigas sin
hacer nada raro, y ésa era la razón por la que no podía subir. Sube el tope, no lo
que se guarda: el original se recodifica a 1080p y **se borra**, así que lo que
queda en la retención de tres meses son las dos copias de siempre, un par de gigas
por guerra. El tope acota lo que pasa por `entrada/` mientras se prepara.

> `VODS_MAX_BYTES` lo leen **dos** servicios: la API, para contestar al gancho
> `pre-create` antes de aceptar el primer byte, y tusd, con `-max-size`. Cambiar
> sólo uno deja el tope efectivo en el más bajo de los dos. nginx no tiene tope
> propio (`client_max_body_size 0`) a propósito: el que manda es tusd.

**Lo que cuesta.** Un 4K de treinta y cinco minutos hay que decodificarlo entero y
recodificarlo, y este Proxmox lo hace por software con `nice -n 15`. Eso son horas,
no minutos. Con el porcentaje y el latido de §8 la espera al menos se ve, en vez de
parecer que se colgó — pero si el 4K se vuelve costumbre, QuickSync (fase 5) deja
de ser opcional.

Por eso la copia de 360p se saca de **la principal recién hecha** y no del
original. Con una grabación normal da igual; con un 4K es la diferencia entre
decodificarlo dos veces o una.

Al ingerir:

- **Si llega en H.264/AAC** (lo que sueltan ShadowPlay, OBS, Steam, Medal y Game
  Bar por defecto) se segmenta a HLS con `-c copy`. Es copiar, no recodificar:
  segundos, y ya da búsqueda precisa y reproducción independiente por mosaico.
- **La copia de 360p** para los mosaicos se genera aparte, en cola de
  concurrencia 1 y con el contenedor acotado a 2 CPUs. Hay otros servicios en ese
  Proxmox y no pueden quedarse sin CPU cada vez que alguien sube algo.
- **HEVC/AV1** (iPhone reciente, sobre todo) sí necesitan recodificado completo.
  Se recomienda H.264 al subir para que sea la excepción.

### El nombre del códec no basta para decidir si se copia

Durante un tiempo la decisión fue `codec_name === 'h264'`, y eso deja pasar
vídeos que un navegador **no puede reproducir**:

| Lo que trae | `codec_name` | ¿Lo decodifica un navegador? |
|---|---|---|
| H.264 8 bits 4:2:0 (`yuv420p`) | `h264` | sí |
| H.264 **10 bits** (`yuv420p10le`, Hi10P) | `h264` | **no** |
| H.264 croma **4:2:2 / 4:4:4** | `h264` | **no** |

Copiados tal cual, esos dos últimos producen exactamente este síntoma: **el
audio suena y la imagen se queda congelada en uno de los primeros fotogramas**.
El decodificador no puede con el primer cuadro y la pista de sonido sigue su
camino. En el ordenador de quien grabó se ve perfectamente —VLC y el reproductor
de Windows los decodifican sin pestañear—, que es lo que hace el fallo tan
confuso de diagnosticar.

Así que se mira el **formato de píxel**, no el nombre: se copia sólo si es
`yuv420p` o `yuvj420p`. Y las dos pistas se deciden por separado, porque quien
graba en H.264 con audio Opus no tiene por qué pagar un recodificado de vídeo
entero por una pista de sonido que se convierte en segundos.

### El recodificado tenía el mismo defecto

Peor que lo anterior: `-c:v libx264` sin `-pix_fmt` **conserva el formato de la
entrada**. Es decir, el camino que existe precisamente para arreglar lo que no se
puede copiar convertía un HEVC de 10 bits en un H.264 de 10 bits — veinte minutos
de CPU para acabar igual de imposible de reproducir. Ahora lleva
`-pix_fmt yuv420p -profile:v high`, y también `-fps_mode cfr`, que normaliza las
grabaciones a tasa variable (Game Bar, algunas configuraciones de OBS) cuyas
marcas de tiempo atascan la imagen mientras el audio corre.

> `-fps_mode` necesita ffmpeg ≥ 5.1. La imagen (`node:22-alpine`) trae la 6.x.
> Para confirmarlo en un despliegue concreto:
> `docker exec wwm-guild-manager-api ffmpeg -version | head -1`.

### Se comprueba lo que sale, no que ffmpeg terminara bien

Nada comprobaba nunca que lo producido se pudiera reproducir. Se marcaba
«listo», se borraban los 2 GB de original, y el fallo lo encontraba un miembro
días después con la única copia buena ya en la papelera.

Ahora, después de cada pase y **antes de borrar nada**, se le pregunta a ffprobe
por la salida: que el formato de píxel sea de los reproducibles, y que
decodifique fotogramas de verdad en los primeros cuatro segundos (un vídeo con
marcas de tiempo rotas pasa la primera prueba y falla ésta). Si algo no cuadra se
lanza, lo recoge la cola, el motivo queda escrito en la fila (§8) y **el fichero
de entrada se conserva**, así que basta con «Reintentar» sin volver a subir 2 GB.

Cuatro segundos y no el vídeo entero porque decodificar media hora para saber si
el decodificador arranca sería pagar el precio del recodificado otra vez. La
contrapartida honesta: un corte que aparezca en el minuto veinte no lo detecta.

**HLS y no MP4 progresivo**, porque es lo que permite que N reproductores salten a
un instante exacto de forma independiente. Sin eso no hay multistream.

El 7700K tiene QuickSync (HD 630). Aprovecharlo desde un LXC no privilegiado es un
bind mount de `/dev/dri` más el mapeo del GID de `render` — fácil comparado con
una VM, pero **fase posterior**: por software ya sale a bastante más que tiempo
real y no conviene atascar el arranque en permisos de dispositivo.

---

## 4. Recorte y sincronía

### Recorte

Recortar en el navegador con ffmpeg-en-WASM no es viable con ficheros de 2 GB. Lo
que se hace:

1. El navegador abre el fichero **local** (`URL.createObjectURL`) — se reproduce
   al instante, sin subir nada — y el miembro marca entrada y salida.
2. Se sube entero.
3. **El corte se aplica en el remux que ya se iba a hacer**: `-ss X -to Y -c copy`.

No añade ni un paso al pipeline. Y es lo que sostiene la estimación de 1,2 TB: sin
recorte, la gente sube grabaciones con el antes y el después y se va al doble.

### Sincronía

Cada VOD guarda `offset_ms`: milisegundos desde **el arranque de la partida**
hasta su primer fotograma. **Negativo** si empezó a grabar antes —lo normal,
porque casi todo el mundo graba desde la preparación, que en esta escala es
tiempo negativo— y **positivo** si empezó tarde (hay quien se acuerda de grabar
en el minuto 20). `war_marcas.t_ms` usa exactamente la misma referencia.

#### Por qué el cero está ahí y no al empezar la preparación

Estuvo al comienzo de la preparación, y la cuenta que salía no se parecía a nada
de lo que se ve en pantalla. Un fotograma con el reloj del juego en
`0:47 · Fase de preparación` se anunciaba como **«el minuto 4:13 de la guerra»**
—5:00 menos 0:47—: cierto bajo aquel cero, y contrario a como lo lee cualquiera,
porque un reloj que va hacia atrás no invita a pensar en lo transcurrido. Dentro
de la partida era peor: el minuto 10 salía como **15:00**, con la preparación
sumada, una cifra que no coincide con ningún reloj del juego.

La migración vive al pie del bloque de VODs en `schema.sql`: resta 5:00 a
`war_vods.offset_ms` y a `war_marcas.t_ms`, **a las dos a la vez**. La posición
de una marca dentro de un vídeo es `t_ms - offset_ms`, así que desplazando ambas
por igual no se movió nada de lo ya anotado, y el multistream —que alinea por la
diferencia entre offsets— tampoco se enteró. Cambió lo que se dice, no dónde está
nada.

Lleva guarda en `app_settings` y **no es opcional**: este fichero se ejecuta
entero en cada arranque, así que un `UPDATE` aritmético sin marca restaría otros
cinco minutos en cada despliegue hasta desalinearlo todo.

Cómo se dice ahora, según dónde caiga el primer fotograma:

| `offset_ms` | Se lee |
|---|---|
| antes de la preparación | «empieza 4:41 antes de la preparación» |
| dentro de la preparación | «empieza en la preparación, 0:47 antes de la partida» |
| exactamente 0 | «empieza justo al arrancar la partida» |
| dentro de la partida | «empieza en el minuto 10:00 de la partida» |

Se habla en fases y no en un tiempo corrido porque en fases es como se ve la
guerra desde dentro: hay una cuenta atrás y luego una partida, y ningún reloj de
la pantalla enseña nunca los dos sumados.

Cuatro vías, de menos a más esfuerzo:

**1. OCR del cronómetro** — el método principal. Ya se usa tesseract.js en
`ResultsReader.tsx` y `gearReader.ts`. El reloj está arriba al centro, en dígitos
grandes blancos sobre fondo oscuro: con `tessedit_char_whitelist = '0123456789:'`
es mucho más fácil que la tabla de resultados que ya se lee hoy. Se hace **en el
navegador sobre el fichero local, antes de subir nada**.

- **Autoverificación:** leer dos fotogramas separados 10 segundos. El cronómetro
  tiene que haber bajado exactamente 10. Si cuadra, la lectura está verificada; si
  no, se pregunta ahí mismo.
- **Desambiguar la fase:** la preparación cuenta 5:00→0:00 y la partida
  30:00→0:00, así que un mismo `4:21` aparece dos veces separado por media hora.
  Se lee la etiqueta `Preparation Phase` de debajo. Atajo: **si el valor supera
  5:00 es partida con certeza**; sólo por debajo hace falta comprobar.
- Recortar **por proporción del fotograma, no por píxeles**, para aguantar 720p y
  ultrapanorámico.

**2. Nombre del fichero** — comprobación cruzada, nunca fuente única. ShadowPlay
usa `Juego YYYY.MM.DD - HH.MM.SS.NN`, pero OBS lleva plantilla configurable, Game
Bar usa formato local con AM/PM y Medal el título del clip. Si el OCR y el nombre
coinciden, se marca como confianza alta y no se pregunta nada.

**3. Leer el reloj a mano** — fase + `mm:ss`, cuando el OCR no se ve seguro.

**4. Arrastrar para alinear** — último recurso, contra otro VOD ya alineado.

#### Corregirla después: «Aplicar» ES guardar

El mismo formulario (`MarcaDeReloj`) sale en dos sitios: al subir y, después, en
el reproductor bajo «corregir». **No hay botón de guardar aparte, y no debe
haberlo**: en el reproductor, «Aplicar» manda el `PUT /api/vods/:id/sync` en el
acto. Un segundo paso para confirmar lo que ya se ve escrito arriba sólo añadiría
otra forma de irse sin haberlo hecho.

Lo que sí faltaba era la respuesta, y era la pregunta que se hacía todo el mundo:
aplicar cerraba el panel y ya. Si el valor nuevo se parecía al viejo no cambiaba
nada en pantalla, y **un rechazo del servidor se veía exactamente igual que un
acierto** — se llamaba y se olvidaba, así que un 403 dejaba a quien lo había
corregido convencido de haberlo arreglado. Ahora el reproductor espera la
respuesta: el panel sólo se cierra si de verdad se guardó, y en cualquier caso se
dice qué pasó.

El formulario además **enseña el resultado antes de pulsar**: «Con el vídeo en
0:00, esta grabación empieza en el minuto 4:13 de la guerra». Es lo único que lo
hace comprobable, porque el número que se guarda no es ninguna de las dos cifras
que se escriben sino la resta de ambas — y porque es donde se ve, sin haber
guardado nada todavía, el error de media hora del interruptor de fase: `0:47` da
4:13 en preparación y **34:13** en partida.

Un VOD sin confirmar se marca **«sincronía sin verificar»** para que el
multistream avise en vez de mentir.

> `wars.started_at` se escribe cuando alguien pulsa un botón, así que puede ir
> desviado del inicio real. No importa para la sincronía **relativa** entre VODs,
> que es lo que necesita el multistream; sólo afecta a las etiquetas de la línea
> de tiempo, y se corrige con una sola lectura por guerra.

---

## 5. Multistream

Decisiones que condicionan el diseño desde el principio aunque se implemente al
final:

- **Un reloj maestro con corrección de deriva**: los vídeos se desincronizan
  solos. Se empuja `currentTime` si la deriva pasa de ~250 ms y se ajusta
  `playbackRate` (0,97-1,03) para lo pequeño.
- **Un solo audio sin silenciar**, que además es lo que exigen los navegadores
  para autoreproducir.
- **4 mosaicos como máximo.** Los navegadores tienen tope de decodificaciones
  simultáneas y en móvil es peor.
- **El mosaico enfocado a calidad alta, el resto a 360p.** Con 900 Mbps
  simétricos hay margen, pero cuatro mosaicos a 1080p son ~30 Mbps por espectador
  y no hace falta.
- **El reloj manda, no el vídeo.** La hora de la guerra la lleva el mosaico
  enfocado, pero **sólo mientras está reproduciendo**. Leerla siempre parecía lo
  natural y es un error: si el maestro no puede moverse --cargando, red
  atascada, o fuera de su tramo-- su posición se queda quieta y publicarla en
  cada fotograma deshace el salto que acaba de pedir quien mira. Se pulsa la
  línea de tiempo y no pasa nada, sin ninguna pista de por qué.
- **Y si el enfocado no cubre el instante, manda otro.** A un vídeo que no llega
  a ese momento no se le puede preguntar la hora. Pasa en cuanto alguien se
  mueve fuera del tramo del que está oyendo, que con cobertura desigual es a
  cada rato.
- **Lo que decide va en una referencia, no en el estado de React.** El estado
  sólo se refresca al repintar, así que dos pulsaciones seguidas de «marca
  siguiente» leerían el mismo instante y saltarían las dos al mismo sitio. Vale
  para el mosaico y para el reproductor de una sola: los dos se cobraron el
  mismo fallo.
- **Cobertura desigual.** No todos los VODs cubren el mismo tramo. La línea de
  tiempo dibuja **la cobertura de cada uno como una barra**, y al saltar a un
  instante que un VOD no grabó, su mosaico dice **«aún no grababa»** en vez de
  quedarse en negro.

---

## 6. Datos

Dos tablas nuevas, ningún cambio en las existentes:

```
war_vods            id, war_id, player_id, estado, offset_ms, offset_confianza,
                    duracion_ms, recorte_ini_ms, recorte_fin_ms, bytes,
                    fijado, expira_en, aprobado_por, subido_en

war_vod_renditions  vod_id, calidad, ruta_playlist
```

`war_vod_renditions` va aparte porque el 360p llega minutos después que el
original y necesita fila propia.

Permisos, sobre el `permissions.js` que ya existe:

- `war.vod.upload` — subir, y **sólo a guerras donde figures en
  `war_participants`**
- `war.vod.approve` — publicar; nada se ve hasta que un oficial lo aprueba
- `war.vod.pin` — marcar como permanente
- `war.vod.delete` — borrar del acta. Por defecto **sólo administración y
  liderazgo**

Los dos primeros resuelven el «suben cualquier cosa»: entra en estado
*pendiente*, con tope de tamaño y duración, y no existe para nadie hasta que
alguien lo mira.

### Tres formas de que una grabación deje de verse, y sólo una borra la fila

| | Qué queda | Quién |
|---|---|---|
| **Rechazar** | la fila, en estado `rechazado` | `war.vod.approve` |
| **Caducar** (retención) | la fila, en estado `caducado` | la barrida, sola |
| **Borrar** | **nada** | `war.vod.delete` |

Las dos primeras conservan el registro a propósito: `rechazado` dice «se miró y
no valía» y `caducado` dice «hubo grabación, se fue con la retención», que es lo
que permite al acta contarlo en vez de dar un enlace roto.

Borrar es para lo que **no debería constar en absoluto**: una subida que salió
inservible, la guerra equivocada, un duplicado. Casos donde dejar rastro no
documenta nada y sólo ensucia la lista con algo que nadie va a poder abrir.

Permiso propio y no `war.vod.approve` porque son decisiones distintas: rechazar
es revisar algo que está a revisión —y por eso ese botón sólo sale en estado
`listo`—, mientras que borrar quita del registro algo que ya existía. Ésa es
justamente la carencia que lo trajo aquí: una grabación ya publicada, o una que
se preparó y quedó inservible, no había forma de quitarla. El botón de borrar
sale en **cualquier estado**.

**Las marcas no se van con ella.** `war_marcas.vod_id` es `ON DELETE SET NULL`
por diseño: una marca está en tiempo de guerra y vale para cualquier grabación de
esa noche, así que sobrevive a la que la originó —«`vod_id` es de dónde salió, no
dónde vive»—. Quien anotó «cae la puerta del medio» no pierde su nota porque se
borre el vídeo desde el que la escribió.

Se borra de los dos sitios del almacén: los segmentos de `hls/` y, por si estaba
a medio preparar, el original de `entrada/`. Lo segundo importa —son 2 GB— porque
si no, borrar algo atascado en «Preparando» dejaría el fichero grande huérfano
sin ninguna fila que lo mencione.

> Un permiso nuevo llega a un despliegue que ya existe por `seedPermissions`, que
> aplica el valor por defecto **sólo a los nombres que nunca ha visto** y no
> repone nada que un líder haya revocado a mano. No hay que tocar la matriz
> después de desplegar.

**Servido protegido:** la API firma URLs con caducidad usando el mismo secreto de
`app_settings` que ya firma `wwm_session`, y nginx las valida con `secure_link`.
Sólo reproduce un miembro con sesión y `war.view`.

---

## 7. Fases

| | Qué | Estado |
|---|---|---|
| **1** | Infraestructura: NAS montado y visible desde el LXC 180 | **hecha 2026-08-23** |
| **2** | Subida + aprobación + reproductor simple | **hecha 2026-08-23** |
| **3** | Recorte, OCR del cronómetro, sincronía | **hecha 2026-08-23** |
| **4** | Multistream sincronizado | **hecha 2026-08-23** |
| **5** | QuickSync, correlación de audio, respaldo a B2 | ← opcional, lo que queda |

---

## 8. Cómo va la preparación

`estado` es un estado plano: dice *que* está preparando y nada más. Eso no bastaba. Un remux con `-c copy` tarda segundos y un recodificado de HEVC tarda una hora, y desde la interfaz se veían exactamente igual — igual que se veía un trabajo que ya no existía porque la API se había reiniciado con la cola en memoria. La única forma de averiguar cuál de las tres cosas estaba pasando era entrar por SSH y leer `docker logs`.

Cinco columnas en `war_vods` lo cuentan, y las escribe la propia cola:

| Columna | Qué dice |
|---|---|
| `proceso_fase` | `cola`, `origen`, `360p`, o vacío si no hay nada en marcha |
| `proceso_pct` | 0–100 sobre la duración de salida. Vacío si `ffprobe` no supo la duración |
| `proceso_desde` | cuándo empezó, para poder decir «lleva 40 min» |
| `proceso_latido` | último signo de vida |
| `proceso_error` | el motivo, cuando falla |

**`proceso_latido` es lo que distingue lento de muerto**, que era justo lo que no se podía distinguir. ffmpeg informa de su avance cada segundo (`-progress pipe:1`); si el latido se quedó atrás, no es que vaya despacio, es que ya no hay nadie trabajando. La API lo resuelve en SQL y manda `procesoParado` ya decidido: restar el latido del reloj *del navegador* convertiría un ordenador con la hora mal puesta en «todas tus grabaciones están colgadas».

Estar **en la cola no cuenta como parado**: es esperar turno detrás de otro, y ahí nadie late.

Del `-progress` se lee `out_time` y no `out_time_ms`. Pese al nombre, `out_time_ms` viene en **microsegundos** en buena parte de las compilaciones de ffmpeg — un viejo desliz que ya no se corrige por no romper a quien lo compensa. `out_time` es `HH:MM:SS.ffffff` y no admite dos lecturas.

### La fase `360p` existe porque el estado mentía por omisión

La copia de los mosaicos corre **después** de que el estado pase a `listo`. Sin fase propia, quien miraba leía «Esperando revisión» mientras la máquina seguía media hora ocupada. Ahora el vídeo se puede ver y además se ve que el trabajo sigue.

Lo mismo por el otro extremo: la fila sólo nace en el gancho `post-finish`, así que un `estado = 'subiendo'` significa que los bytes están enteros y sólo falta el turno. Con `proceso_fase = 'cola'`, la interfaz dice «En cola» y se calla el estado, que ahí sobra.

### Recuperar lo que se llevó un reinicio

La cola vive en la memoria del proceso, que es lo correcto para lo que hace — de uno en uno, con `nice`, sin una tabla de trabajos ni un Redis para cuatro vídeos a la semana — y tiene un precio que antes no se pagaba: al reiniciar la API, lo que estuviera preparándose desaparecía de la cola **sin desaparecer de la tabla**. La fila se quedaba en `procesando` para siempre; la barrida de abandonados no la tocaba (sólo mira `subiendo`) y nadie la volvía a encolar.

`recuperarPendientes()` corre al arrancar, **antes que la barrida**, y devuelve a la cola todo lo que siga en `subiendo` o `procesando` y conserve su fichero en `entrada/`. El original no se borra hasta que la preparación termina del todo, así que casi siempre lo único que hacía falta era que alguien volviera a arrancar el trabajo. Lo que ya no tiene origen pasa a `error` con el motivo escrito, que al menos es accionable: vuelve a subirla.

Y a mano: `POST /api/vods/:id/retry`. La tuya, quien la subió; la de otro, quien aprueba. Se niega si sigue viva en la cola, porque quien mira la pantalla no puede distinguir un recodificado lento de un trabajo muerto y va a darle al botón.

---

## 9. Avisos por privado

Dos, en direcciones contrarias, y los dos existen por lo mismo: entre subir y publicar hay una persona esperando a que otra entre a la web **sin motivo para entrar**. Nadie recarga un acta por si acaso, así que esa espera era de días.

| Cuándo | A quién | Qué dice |
|---|---|---|
| Una grabación queda **lista** | A todo el que puede publicar | quién la subió, de qué guerra, tipo, fecha y duración |
| Alguien la **publica** | A quien la subió | que ya se ve, quién la publicó, y gracias |

Viven en `server/vodAvisos.js`, aparte de `vods.js` **por dónde pueden fallar**: Discord se cae, limita el ritmo y contesta 403 a quien tiene los privados cerrados. Nada de eso puede tumbar un remux ni impedir que se publique una grabación, así que se llaman sin esperarlos y ninguno lanza.

### Al quedar lista, no al terminar de subir

Es la única decisión de diseño que hay aquí. Avisar en el gancho `post-finish` mandaría a un oficial a abrir un vídeo que todavía se está preparando — segundos si es un remux, media hora si hay que recodificar HEVC. Un aviso que lleva a una pantalla donde no se puede hacer nada es la forma más rápida de que se deje de hacer caso a estos avisos. Se manda cuando **hay algo que mirar**.

### A quién: por permiso, no por rango

Se pregunta por `war.vod.approve` contra `role_permissions`, no por una lista de rangos escrita a mano. La matriz de permisos existe para moverse, y una lista fija se quedaría avisando según un reparto que ya no es el del gremio. Así se avisa exactamente a quien puede hacer algo con el aviso, hoy.

Se consulta `role_permissions` en crudo, lo cual **sólo vale porque `war.vod.approve` no está en `LOCKED`** — los permisos que `permissionsFor` añade por su cuenta. No generaliza a `users.manage`.

Quedan fuera tres, a propósito: las cuentas deshabilitadas, las que no tienen Discord vinculado (no hay a dónde escribir) y **quien acaba de subirla**, aunque sea oficial — ya sabe que la subió, y decírselo sólo lo convierte en ruido para el único que no lo necesita.

### Una vez y no más

`aviso_revision_en` y `aviso_aprobada_en` marcan que ya se avisó. Hace falta marca, y no basta con mirar el estado, porque las dos cosas que disparan un aviso se repiten sin que haya nada nuevo que contar: una grabación vuelve a pasar por `listo` cada vez que se reprepara — un reintento, o la recuperación al arrancar (§8) — y «Publicar» se puede pulsar dos veces sobre algo ya publicado. Un privado repetido no es un fallo cosmético: es la clase de cosa por la que la gente silencia al bot.

Se marca **también cuando no se pudo entregar** — privados cerrados, sin Discord vinculado, nadie con el permiso. Reintentarlo en la siguiente repreparación no va a encontrar a nadie tampoco.

### Al rechazar no se avisa

Deliberado. Un rechazo se explica en persona o no se explica; un bot dando una mala noticia sin poder decir por qué es peor que el silencio.

### Qué hace falta configurado

`DISCORD_BOT_TOKEN` y `DISCORD_GUILD_ID` — los mismos del resto del bot. Sin ellos no se manda nada y todo lo demás sigue igual. `PUBLIC_URL` sólo pone el enlace del embed; sin ella el aviso llega sin enlace, que es mejor que llegar con uno roto.

---

# Fase 2 — Puesta en marcha

El código está desplegable, pero **la funcionalidad nace apagada**: sin
`VODS_HOOK_SECRET` el gancho responde 503 y no se puede subir nada. Para
encenderla, en las variables del stack de Portainer:

```
VODS_HOOK_SECRET=<openssl rand -hex 32>
VODS_HOST_DIR=/mnt/vods
VODS_MAX_BYTES=10737418240
VODS_RETENTION_DAYS=90
```

> Si el stack ya trae `VODS_MAX_BYTES=6442450944` de antes, **hay que cambiarlo
> ahí**: el valor de las variables del stack gana al de `docker-compose.yml`, así
> que subir el defecto del fichero no levanta un tope ya fijado a mano.

Y después del redespliegue, comprobar por este orden:

1. `docker ps` — tiene que aparecer un contenedor `wwm-guild-manager-tusd`
   nuevo. Si entra en bucle de reinicio, `docker logs` de ese contenedor.
2. `curl -s <PUBLIC_URL>/api/health` — la API sigue en pie.
3. `curl -o /dev/null -w '%{http_code}' -X POST <PUBLIC_URL>/api/vods/hook/x`
   → **404**. Cualquier otra cosa significa que nginx no está tapando el gancho.
4. Abrir un acta de guerra en la web: tiene que salir la sección
   «Grabaciones» con el botón de subir.
5. Subir una grabación de verdad. Es la única prueba que vale para el
   pipeline entero, porque el banco simula tusd y ffmpeg.

Si la subida falla con un error de permisos, revisar que `tusd` lleva
`user: "0:0"` — es el fallo esperado y el más despistante, porque la misma
ruta se escribe sin problema desde una consola del contenedor.

---

# Fase 1 — Preparar el almacén

Esto se teclea en el DSM y en el host de Proxmox. Al final de cada bloque hay una
comprobación: **si no da lo que dice, para y no sigas**.

Sustituye a lo largo de todo el documento:

- `192.168.1.200` — la IP del Synology en la LAN
- `USUARIO_VODS` — el usuario de DSM que se crea en el paso 1.2

## 1.0 — Espacio y cuota

**Medido el 2026-08-23:** 3,5 TB de capacidad, 1,9 TB usados, **1,6 TB libres**.

Entra, pero con poco margen: el régimen estable son ~1,2 TB, o sea unos 400 GB de
colchón, y esa cifra se duplica si la gente sube sin recortar. Por eso la cuota no
es opcional.

**Panel de control → Carpeta compartida → `vods` → Editar → Cuota: 1,3 TB.**

Si el borrado automático falla algún día, se llena *la cuota* y las subidas
empiezan a rechazarse, pero **los 1,9 TB que ya había en el NAS siguen intactos**
y nada más del Synology se rompe. Un volumen lleno del todo es mucho peor que un
servicio que deja de aceptar vídeos.

Si con datos reales se ve que va justo, bajar la retención a 2 meses deja el
régimen estable en ~800 GB.

## 1.1 — Carpeta compartida

DSM → **Panel de control → Carpeta compartida → Crear**:

- Nombre: `vods`
- Ubicación: el volumen con espacio
- **Desmarcar** la papelera de reciclaje (un VOD borrado que se queda en la
  papelera no libera nada, y la retención dejaría de funcionar sin avisar)
- Cifrado: no (el DS713+ no tiene potencia para ello y no hace falta en LAN)

## 1.2 — Usuario dedicado

DSM → **Panel de control → Usuario → Crear**: un usuario nuevo, p. ej.
`USUARIO_VODS`, con **permiso de lectura/escritura sólo sobre `vods`** y ningún
otro recurso. No usar `admin`.

> La contraseña la eliges y la escribes tú directamente en el fichero del paso
> 1.4. No hace falta que me la pases ni que aparezca en ningún sitio compartido.

## 1.3 — Activar SMB

DSM → **Panel de control → Servicios de archivos → SMB** → activar.

**Por qué SMB y no NFS:** el LXC 180 es **no privilegiado**, así que sus UIDs van
desplazados (root dentro = UID 100000 en el host). Con NFS eso obliga a pelearse
con `idmap` y con el *squash* del export, que es donde se atasca todo el mundo.
CIFS acepta `uid=` y `gid=` como opciones de montaje, o sea que **el problema
desaparece de un plumazo**. Es algo más lento que NFS, pero un stream son ~1 MB/s
y el cuello está muy lejos.

**Por qué `0664`/`0775` y no `0770`:** aquí escribe uno y lee otro. tusd y ffmpeg
escriben como root, pero **quien sirve los bytes es nginx, cuyos procesos de
trabajo corren como el usuario `nginx`**, no como root. Con `0770` nginx no puede
abrir los ficheros y devuelve **403** — que además despista, porque parece un
problema de permisos de la aplicación cuando es del sistema de ficheros. Lo que
se sirve tiene que poder leerlo cualquiera; escribirlo, sólo el dueño.

Se pagó el 2026-08-23, con el primer VOD real ya subido y remuxado. La firma en
los logs de `web` es inconfundible:

```
open() "/vods/hls/<id>/origen.m3u8" failed (13: Permission denied)
```

## 1.4 — Montar en el host de Proxmox

En la consola del **host** (no del contenedor):

```bash
apt update && apt install -y cifs-utils
```

Fichero de credenciales, para no dejar la contraseña en `/etc/fstab`:

```bash
install -m 600 /dev/null /etc/cifs-vods.cred
```

Editarlo con `nano /etc/cifs-vods.cred` y poner exactamente estas dos líneas, con
tus valores:

```
username=USUARIO_VODS
password=LA_QUE_ELEGISTE
```

Punto de montaje y prueba:

```bash
mkdir -p /mnt/vods
```

```bash
mount -t cifs //192.168.1.200/vods /mnt/vods -o credentials=/etc/cifs-vods.cred,uid=100000,gid=100000,file_mode=0664,dir_mode=0775,vers=3.0,iocharset=utf8
```

**Comprobación:**

```bash
touch /mnt/vods/prueba && ls -n /mnt/vods
```

Tiene que salir la línea de `prueba` con **`100000 100000`** en las columnas de
usuario y grupo. Si sale `0 0` o da error de permisos, el `uid=` no se aplicó:
párate ahí.

> Si `vers=3.0` falla, el DS713+ en DSM 6.2 puede necesitar `vers=2.1`. Pruébalo
> antes de dar nada por perdido.

Persistir en `/etc/fstab` (una sola línea):

```
//192.168.1.200/vods /mnt/vods cifs credentials=/etc/cifs-vods.cred,uid=100000,gid=100000,file_mode=0664,dir_mode=0775,vers=3.0,iocharset=utf8,_netdev,nofail 0 0
```

`_netdev` espera a que haya red; `nofail` evita que el host se quede colgado en el
arranque si el NAS está apagado.

**Comprobación:**

```bash
umount /mnt/vods && mount -a && ls -n /mnt/vods
```

Tiene que volver a salir el fichero de prueba con `100000 100000`. `mount -a`
avisa de que systemd sigue con la versión vieja de `fstab`; el montaje ya
funciona, pero conviene ponerlo al día:

```bash
systemctl daemon-reload
```

## 1.5 — Entregarlo al LXC 180

Todavía en el **host**. Primero, comprobar que `mp0` está libre — asignarlo
encima de un punto de montaje existente machacaría la configuración de algo que
ya funciona:

```bash
pct config 180 | grep -E '^mp[0-9]'
```

Si no devuelve nada, adelante. **Esto reinicia el contenedor 180**, y ahí dentro
está la web, la API y el bot de Discord: hazlo cuando no haya guerra en marcha.

```bash
pct set 180 -mp0 /mnt/vods,mp=/mnt/vods
```

```bash
pct reboot 180
```

**Comprobación**, entrando al contenedor:

```bash
pct enter 180
```

```bash
touch /mnt/vods/prueba-lxc && ls -l /mnt/vods/prueba-lxc
```

`prueba-lxc` tiene que salir como **`root root`**. Ese es el momento en que el
desplazamiento de UID queda resuelto: el 100000 del host es el root del
contenedor.

Limpiar y salir:

```bash
rm /mnt/vods/prueba /mnt/vods/prueba-lxc && exit
```

## 1.6 — Estructura y prueba real

Dentro del 180:

```bash
mkdir -p /mnt/vods/entrada /mnt/vods/hls /mnt/vods/tmp
```

- `entrada/` — lo que sube tusd, sin procesar
- `hls/` — los segmentos servidos
- `tmp/` — scratch de ffmpeg

**Los tres van aquí, ninguno en el disco del contenedor.** Es la regla que evita
llenar el bootdisk.

Prueba de velocidad real, escribiendo 1 GB:

```bash
dd if=/dev/zero of=/mnt/vods/tmp/prueba.bin bs=1M count=1024 conv=fsync && rm /mnt/vods/tmp/prueba.bin
```

(`conv=fsync` y no `oflag=direct`: CIFS rechaza O_DIRECT salvo que se monte con
`cache=none`, y aquí no interesa.)

Anota la cifra. Por debajo de ~40 MB/s conviene revisar antes de seguir; el DS713+
debería acercarse a saturar su gigabit en escritura secuencial.

## 1.7 — Que Docker lo vea

Los contenedores de la fase 2 montarán `/mnt/vods` como volumen. Nada que hacer
ahora más que confirmarlo con un contenedor de usar y tirar:

```bash
docker run --rm -v /mnt/vods:/datos alpine sh -c 'touch /datos/prueba-docker && ls -l /datos/prueba-docker && rm /datos/prueba-docker'
```

Si eso escribe y borra sin quejarse, **la fase 1 está terminada**.

---

## Estado y referencia

Montado y verificado el **2026-08-23**. Escritura secuencial medida desde el LXC
180: **116 MB/s**, o sea saturando el gigabit (~125 MB/s teóricos). Sirve de
referencia: el día que esto vaya lento, la mitad del diagnóstico es saber cómo
iba cuando iba bien.

En números útiles: un VOD de 2 GB se escribe en ~18 s, y el enlace da para ~100
espectadores simultáneos a 8 Mbps antes de saturarse — muy por encima de lo que
un gremio de cien personas hará nunca a la vez.

## Aviso para la fase 2: los contenedores tienen que ir como root

El montaje es `0770` y pertenece a `root` dentro del 180. **Un contenedor que
corra como usuario no privilegiado no podrá escribir**, y la imagen oficial de
tusd hace justo eso (corre como el usuario `tusd`, UID 1000).

La solución es `user: "0:0"` en el compose de los servicios que tocan
`/mnt/vods`, no aflojar los permisos del montaje. Y no es la concesión que
parece: el 180 es un LXC **no privilegiado**, así que su root ya es un usuario
sin privilegios en el host (UID 100000). No hay escalada que ganar ahí.

Síntoma si se olvida: `permission denied` al escribir, con el montaje
funcionando perfectamente desde la consola del contenedor — que es justo la
combinación que más despista.

---

## Lo que NO hay que hacer

- **Nada del pipeline escribe en el disco del contenedor.** ~18 GiB libres; un VOD
  son 2 GB. Si tusd o ffmpeg apuntan a su ruta por defecto, la primera subida
  grande tira Portainer entero.
- **El NAS no se expone a internet.** Ni puertos, ni túnel, ni DDNS. Está fuera de
  soporte y sin parches. Todo sale por el LXC.
- **No hacer privilegiado el 180 para ahorrarse el `uid=`.** Ese contenedor lleva
  todos los servicios; degradar su aislamiento por un montaje no sale a cuenta.
