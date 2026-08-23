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

Al ingerir:

- **Si llega en H.264/AAC** (lo que sueltan ShadowPlay, OBS, Steam, Medal y Game
  Bar por defecto) se segmenta a HLS con `-c copy`. Es copiar, no recodificar:
  segundos, y ya da búsqueda precisa y reproducción independiente por mosaico.
- **La copia de 360p** para los mosaicos se genera aparte, en cola de
  concurrencia 1 y con el contenedor acotado a 2 CPUs. Hay otros servicios en ese
  Proxmox y no pueden quedarse sin CPU cada vez que alguien sube algo.
- **HEVC/AV1** (iPhone reciente, sobre todo) sí necesitan recodificado completo.
  Se recomienda H.264 al subir para que sea la excepción.

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

Cada VOD guarda `offset_ms`: milisegundos desde el inicio de la guerra hasta su
primer fotograma. **Negativo** si empezó a grabar antes, **positivo** si empezó
tarde (hay quien se acuerda de grabar en el minuto 20).

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

Los dos primeros resuelven el «suben cualquier cosa»: entra en estado
*pendiente*, con tope de tamaño y duración, y no existe para nadie hasta que
alguien lo mira.

**Servido protegido:** la API firma URLs con caducidad usando el mismo secreto de
`app_settings` que ya firma `wwm_session`, y nginx las valida con `secure_link`.
Sólo reproduce un miembro con sesión y `war.view`.

---

## 7. Fases

| | Qué | Estado |
|---|---|---|
| **1** | Infraestructura: NAS montado y visible desde el LXC 180 | **hecha 2026-08-23** |
| **2** | Subida + aprobación + reproductor simple | ← siguiente |
| **3** | Recorte, OCR del cronómetro, retención automática | |
| **4** | Multistream sincronizado | |
| **5** | QuickSync, correlación de audio, respaldo a B2 | opcional |

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
mount -t cifs //192.168.1.200/vods /mnt/vods -o credentials=/etc/cifs-vods.cred,uid=100000,gid=100000,file_mode=0770,dir_mode=0770,vers=3.0,iocharset=utf8
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
//192.168.1.200/vods /mnt/vods cifs credentials=/etc/cifs-vods.cred,uid=100000,gid=100000,file_mode=0770,dir_mode=0770,vers=3.0,iocharset=utf8,_netdev,nofail 0 0
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
