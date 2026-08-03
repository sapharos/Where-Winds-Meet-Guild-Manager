# Dirección visual — Zona Zero

Fase 2 del overhaul. **Propuesta. No hay código escrito.**
Depende de: [`DIAGNOSTICO_MOVIL.md`](./DIAGNOSTICO_MOVIL.md).

---

## 0. Antes de la propuesta: lo que descarté

Me pediste revisar la propuesta y tirar lo que habría producido para cualquier otro proyecto. Esto
es lo que quedó fuera, y por qué. Lo pongo primero porque explica todo lo demás.

| Descartado | Por qué |
|---|---|
| **Papel de arroz crema + tinta negra + acento bermellón** | Lo prohibiste, y con razón: es el reflejo de todo modelo ante «wuxia elegante». Además es literalmente *papel* — un material de escritorio quieto, para un producto que se usa de pie, a oscuras, veinte segundos antes de una guerra. |
| **Casi-negro + acento verde ácido** | Prohibido, y ya lo tenéis a medias: el `#0c0d0e` actual con ámbar. Repetirlo sería no haber hecho nada. |
| **Reglas de 1px, radio cero, retícula de periódico** | Prohibido. Y es cerámica lo que voy a proponer: una pieza torneada no tiene esquinas de 90°. |
| **Caligrafía como textura de fondo** | El recurso «pon unos trazos ated 5% de opacidad detrás». Es lo que se hace cuando no se tiene una idea. Cuesta ancho de banda, no comunica nada y en un teléfono de gama media es una capa de composición más. |
| **Oro brillante, degradados metálicos, brillos** | Estética de gacha, no del periodo. Y el degradado metálico es lo primero que se rompe en tema claro. |
| **Kintsugi (reparación con oro)** | Encaja con el concepto, pero es **japonés**. Aplicarlo a un juego ambientado en las Cinco Dinastías chinas sería exactamente el error de leer «Asia» como una sola cosa. Existe el equivalente chino y es mejor (§5). |
| **Cinzel** (la display actual) | Es una tipografía de capital romana imperial, derivada de la columna Trajana. No tiene nada que ver con este mundo; es la que se elige por reflejo para «fantasía épica». La cambio, y es el único cambio tipográfico que propongo. |
| **Cambiar Inter** | Funciona, tiene cifras tabulares reales, ya está cargada y el código ya usa `tabular-nums` en 20 sitios. Cambiarla sería churn: riesgo sin beneficio. **Se queda.** |

---

## 1. Concepto en una frase

> **La pieza de cerámica agrietada que sigue entera porque alguien la grapó: superficie serena,
> fractura visible, y una grapa de latón en el único punto que ahora mismo aguanta.**

Qué debe sentir un miembro al abrirlo en el teléfono: **que llega tarde a nada.** Una superficie
quieta, fría, sin ruido, donde lo único que brilla es lo que le toca a él. No un panel de control de
guerra: un objeto que le dice en dos segundos si está dentro y a qué hora.

### De dónde sale, exactamente

*Where Winds Meet* transcurre en las **Cinco Dinastías y los Diez Reinos** (907–979), el interregno
roto entre Tang y Song. No es un fondo genérico de wuxia: es un periodo con nombre propio cuya
característica es la **fractura** — el imperio partido en diez.

De ese mismo momento histórico, y del inmediatamente posterior, sale el material más refinado que
produjo China: la **cerámica Ru (汝窑)**. Dos rasgos suyos son la propuesta entera:

1. **雨过天青 — «el azul del cielo cuando pasa la lluvia».** Es el nombre real del vidriado Ru: un
   azul-verde pálido, frío, casi sin saturación. Es la superficie.
2. **开片 — el craquelado.** La red de grietas finísimas del vidriado. Empezó siendo un defecto de
   cocción y acabó siendo lo más valorado de la pieza más valorada. **Es el borde.** Un producto
   sobre un gremio que aguanta guerras dibujado con el material cuya virtud es la grieta.

Y el acento no es bermellón, es **锔钉 (jùdīng): la grapa**. 锔瓷 es el oficio chino de reparar
porcelana rota con grapas metálicas visibles, documentado desde Song. Latón mate, no oro.

Por qué la grapa y no otra cosa: **es la mecánica del producto dibujada.** Las cuatro acciones reales
de esta aplicación son marcar titular, fijar bando, bloquear formación y desplegar en una línea. Las
cuatro son *sujetar a alguien en su sitio*. La grapa no decora nada: significa lo que hace el botón.

---

## 2. Paleta

Once tokens semánticos, **definidos simultáneamente** para los dos temas. El tema oscuro **no es el
claro oscurecido**: es la misma pieza vidriada vista de noche con una luz cálida lateral. Por eso las
grietas se invierten — en el claro el craquelado es más oscuro que el vidriado; de noche atrapa la
luz y es **más claro** que la superficie. Es una inversión con causa física, no una resta.

| Token | Claro | Oscuro | De dónde sale |
|---|---|---|---|
| `surface` | `#E9EDEA` | `#0F1614` | El vidriado. En oscuro conserva el verde-azul: nunca es gris neutro. |
| `surface-raised` | `#F5F7F4` | `#16201D` | El vidriado fino del borde, donde asoma la pasta. Tarjetas, hojas. |
| `surface-sunken` | `#E1E7E3` | `#0A0F0E` | El vidriado encharcado en el hueco. Fondo de página, campos, fondos de tabla. |
| `text-primary` | `#17211F` | `#E4EAE6` | El punteado de óxido de hierro del vidriado. **No es negro ni blanco.** |
| `text-muted` | `#57655F` | `#93A29C` | El mismo óxido, diluido. |
| `border` | `#C6CFC9` | `#2A3733` | **开片, la grieta.** Trazo de reposo. |
| `border-strong` | `#75837C` | `#5F7069` | La grieta abierta. Bordes de control interactivo. |
| `accent` | `#1F6B84` | `#64B6CE` | **天青, el cielo tras la lluvia.** Azul, no verde. Navegación, enlaces, foco, estado activo. |
| `success` | `#2F6B4F` | `#6FBF93` | 豆青, el vidriado verde. Victoria, confirmado. |
| `warning` | `#8A5A16` | `#D3A155` | **锔钉, el latón de la grapa.** Falta gente, te toca a ti, cuenta atrás. |
| `danger` | `#9B3324` | `#E4796A` | 铁红, el rojo de óxido de hierro del horno. **No bermellón.** Destructivo. |

**`warning` y el elemento firma son el mismo latón, a propósito.** «Faltan dos tanques» y «eres
titular» significan lo mismo: *aquí hay algo sujeto a ti*. Que compartan color no es una colisión,
es la regla.

### Contraste — medido, no prometido

Ratios WCAG calculados sobre los valores de arriba (script en el commit de esta fase):

| Par | Claro | Oscuro |
|---|---|---|
| `text-primary` / `surface` | **13,95** | **15,03** |
| `text-muted` / `surface` | **5,18** | **6,89** |
| `accent` / `surface` | **5,08** | **7,97** |
| `success` / `surface` | **5,32** | **8,34** |
| `warning` / `surface` | **5,00** | **7,86** |
| `danger` / `surface` | **6,14** | **6,32** |
| peor caso de todos (sobre `surface-sunken`, claro) | **4,54** | — |
| `border-strong` / `surface` (WCAG 1.4.11, mínimo 3) | **3,36** | **3,50** |
| Texto sobre `accent` relleno | 6,01 | 7,97 |
| Texto sobre `danger` relleno | 7,26 | 6,32 |

**Todo pasa AA en los dos temas**, incluido el peor caso. `border-strong` fallaba el 3:1 de
componente no textual en la primera versión (`#9FACA5` → 1,99) y lo corregí antes de escribir esto.

### El problema que esta paleta no resuelve sola

En el diagnóstico (§d) señalé el color-como-dato: `WeaponSet.color`, `GuildRank.color`,
`WarLane.colour`, `unit.color`, `impactShade()`. Son colores que **elige el usuario y viven en la
base de datos**, y hoy se componen con opacidad hexadecimal sobre un fondo oscuro fijo
(`${color}66` sobre `#0b1120` en `PlayerCard.tsx:86` y `WarBoard.tsx:66`).

**En tema claro esas mezclas se rompen todas.** Un verde lima al 15% sobre blanco es invisible.

No se arregla con tokens. Propuesta para la Fase 3: una función `onSurface(color, intensidad)` que
mezcle contra el `surface` **vigente** en lugar de contra un negro fijo, y que baje la luminosidad
del color de usuario en tema claro y la suba en oscuro. La lógica de qué color corresponde a cada
cosa **no se toca**: solo cómo se pinta contra el fondo. Es el trabajo más delicado de la Fase 3 y lo
quiero señalado antes de empezarlo.

---

## 3. Tipografía

| Rol | Familia | Por qué |
|---|---|---|
| **Display** | **Newsreader** (variable, eje óptico) | Sustituye a Cinzel. Serifas en cuña con entrada afilada y remates que engordan: lee como **entintado**, no como tallado en piedra — que es justo la diferencia con la capital romana de Cinzel. Su eje óptico deja que una cuenta atrás a 40px y un título a 20px tengan el peso correcto **con un solo archivo variable**. |
| **Cuerpo / UI** | **Inter** (se queda) | Funciona, ya está, tiene `tnum` real. Cambiarla sería riesgo sin beneficio. |
| **Cifras** | Inter con `font-variant-numeric: tabular-nums` en línea; **Newsreader** para las cifras heroicas | Este producto **es** cifras: `12:04`, `28/30`, `10/10`, impacto `71`, actividad semanal. |

**Decisión deliberada: la voz display de este producto son los números, no los titulares.** Un
miembro no viene a leer encabezados; viene a leer una hora y un marcador. Por eso Newsreader se
reserva casi entera para figuras grandes, y los títulos de sección son Inter en versalitas
espaciadas. Esto evita además el otro default: elegir una serif con carácter y esparcirla por todas
partes hasta que la interfaz parezca una revista.

### Escala

| Token | Tamaño / interlineado | Peso | Tracking | Uso |
|---|---|---|---|---|
| `--type-figure-xl` | 40 / 40 | Newsreader 500 | −0.02em | Cuenta atrás, impacto en cabecera |
| `--type-figure-lg` | 28 / 30 | Newsreader 500 | −0.01em | Actividad semanal, marcador de guerra |
| `--type-title` | 20 / 26 | Inter 600 | 0 | Título de pantalla |
| `--type-section` | 12 / 16 | Inter 700 | **0.12em**, versalita | Título de sección |
| `--type-body` | **16** / 24 | Inter 400 | 0 | Cuerpo, **y todo input** |
| `--type-body-strong` | 16 / 24 | Inter 600 | 0 | Nombres, valores en línea |
| `--type-meta` | 13 / 18 | Inter 400 | 0 | Metadatos, fechas |
| `--type-micro` | 11 / 14 | Inter 700 | 0.08em, versalita | Insignias. **Nunca para información que no esté en otro sitio.** |

**Suelo duro: 16px en todo `input`, `select` y `textarea`.** Es la falla #1 del ranking y se
resuelve aquí, en el token, no pantalla por pantalla.

Y un límite que hoy no existe: **el escalón `micro` de 11px solo puede usarse para etiquetas
redundantes.** El diagnóstico encontró 280 usos de `text-xs`/`text-[10px]`/`text-[8px]` y varios
llevan información única (§b-13.4: siete insignias de 8–10px por tarjeta de miembro). Eso deja de
estar permitido.

### Carga (Fase 3)

- Ambas variables, `woff2`, subset `latin` + puntuación española.
- `font-display: swap` — hoy no hay ninguno, y es una de las causas de CLS identificadas.
- `<link rel="preload">` solo para Inter 400 (la crítica). Newsreader carga después: si tarda, un
  título en Inter es aceptable; un cuerpo sin fuente, no.
- **Font Awesome se va.** 169 KB medidos por ~45 iconos. Se sustituye por un sprite SVG en línea de
  los iconos realmente usados. Esto lo detallo como propuesta con su justificación en §8.

---

## 4. Espaciado, radios, elevación, bordes

### Espaciado — base 4

`--sp-1: 4` · `--sp-2: 8` · `--sp-3: 12` · `--sp-4: 16` · `--sp-6: 24` · `--sp-8: 32` · `--sp-12: 48`

Reglas duras que salen del diagnóstico:

- `--tap-min: 44px`. Alto mínimo de todo lo pulsable, sin excepción.
- `--tap-gap: 8px` entre acciones del mismo grupo; **`--tap-gap-danger: 16px`** antes de una
  destructiva. (Hoy: 8px entre «dar de baja» y «titular», §b-2.2.)
- Margen lateral de página en móvil: **16px**, no 24 (§b-13.2 — hoy se pierde el 12,8% del ancho).

### Radios — cerámica torneada

`--r-sm: 6` (insignias, chips) · `--r-md: 10` (controles, campos) · `--r-lg: 16` (tarjetas,
secciones) · `--r-vessel: 22` (hojas inferiores, **solo las dos esquinas superiores**)

Sin radio 0 y sin píldoras. Una pieza torneada tiene el labio redondeado y el pie recto: por eso la
hoja se redondea arriba y se apoya recta abajo.

### Elevación — profundidad de vidriado, no sombra

Una pieza de cerámica no proyecta sombra dramática; tiene **profundidad de esmalte**. La jerarquía
se expresa con superficie + grieta, y la sombra se reserva para lo que de verdad flota.

| Nivel | Cómo se dibuja | Para qué |
|---|---|---|
| `flat` | `surface`, sin borde | Fondo de página |
| `raised` | `surface-raised` + 1px `border` | Tarjetas, secciones. **Sin sombra.** |
| `floating` | `surface-raised` + 1px `border` + `--shadow-1` | Hojas inferiores, menús |
| `alert` | `surface-raised` + 1px `border-strong` + `--shadow-2` | Aviso de guerra, toasts |

**Solo dos sombras en todo el sistema.** `--shadow-1: 0 2px 12px rgb(0 0 0 / .10)` (claro) /
`.45` (oscuro). `--shadow-2` con el doble de radio. Nada más. En gama media, cada sombra distinta es
una capa de composición.

### Bordes

`--bw: 1px` siempre. El grosor no comunica: lo hace el color (`border` en reposo,
`border-strong` en control interactivo, `accent` en foco).

Foco visible, y esto no es opcional — el diagnóstico encontró **0** `focus-visible` en el proyecto:

```
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: inherit; }
```

---

## 5. Elemento firma: 锔钉, la grapa

**Uno solo, y con tres usos. Ni uno más.**

Una grapa de reparación de porcelana: dos cabezas y un puente. En SVG son tres primitivas, pesa
nada, y escala de 12 a 40px sin perder la lectura.

```
     ●━━━●          reposo          ●━━━━━━●        extendida (pestaña activa)
```

| Dónde | Qué dice | Sustituye a |
|---|---|---|
| **Bajo la pestaña activa**, puenteando la navegación con el contenido | «estás sujeto aquí» | El fondo ámbar relleno de `App.tsx:591` |
| **Marca de titular** en un miembro | «te han fijado a la alineación» | La estrella genérica de `PlayerCard.tsx:215` |
| **Formación bloqueada** en la Sala de Guerra | «esto ya está cerrado» | El candado de `WarBoard.tsx:446` |

Siempre en `warning` (latón). Nunca en otro color, nunca decorativa, nunca más de dos por pantalla.

Por qué esta y no el craquelado: la grieta ya está trabajando como token de borde en toda la
interfaz. Repetirla como firma sería subrayar lo que ya se lee. La grapa es su contrario exacto —
lo que sujeta la grieta — y por eso destaca sobre ella sin competir. Y semánticamente es el producto:
todo lo que hace esta aplicación es fijar gente a un sitio.

---

## 6. Tokens de movimiento

Nombres del material. Detalle completo en la Fase 6; aquí solo el vocabulario, porque la Fase 3 tiene
que cablearlo desde el principio.

| Token | Valor | Para qué |
|---|---|---|
| `--dur-tap` | **100ms** | Respuesta al dedo. Techo, no objetivo. |
| `--dur-micro` | **180ms** | Estado de un control, insignia, chip |
| `--dur-sheet` | **280ms** | Hoja inferior entrando |
| `--dur-route` | **300ms** | Cambio de pestaña |
| `--ease-glaze` | `cubic-bezier(.2,0,0,1)` | Entrada, asentarse. El esmalte fluye y se para. |
| `--ease-lift` | `cubic-bezier(.4,0,1,1)` | Salida, irse. |
| `--ease-staple` | `cubic-bezier(.34,1.4,.64,1)` | **Solo la grapa.** Un rebote mínimo al fijar algo: es la única cosa del sistema que se permite pasarse de largo, porque es la única que representa un golpe seco. |

Techo absoluto 400ms. Solo `transform` y `opacity`.

`prefers-reduced-motion` se cablea en la Fase 3, no en la 6: **a cambio instantáneo, nunca a
ausencia de respuesta.** La grapa sigue apareciendo; deja de rebotar.

---

## 7. Maquetas ASCII a 375px

Estructura actual respetada: mismas secciones, mismo orden, mismos nombres. **Es un cambio de piel.**
Ancho de caja = 375px. Alturas anotadas al margen.

Elegí estas tres por lo que dije al cerrar la Fase 1 y no me corregiste: **Mi perfil** y **Sala de
Guerra** son dos de las tres más usadas según el código, y la tercera es el **Historial**, que es un
modal y no una pantalla — pero es donde viven «quién asistió» y «qué resultado», dos de los cuatro
motivos de uso que describiste. Añado el **Roster** como cuarta, abreviada, para que no falte.

### 7.1 Mi perfil — la que se abre sola

```
┌───────────────────────────────────────────────┐
│ ▚  ZONA ZERO                          ⌄  ☰   │ 56  ← cabecera de 120px → 56px
├───────────────────────────────────────────────┤
│  MI PERFIL   Roster   Sala de Guerra   Admin  │ 44  ← desliza; 44 de alto
│  ●━━━━━━●                                     │  4  ← la grapa marca dónde estás
├───────────────────────────────────────────────┤
│                                               │
│  Jinwei Zhao                                  │
│  Wudang · Nivel 71                            │
│                                               │
│  ●━━●  TITULAR      ⟡ ATAQUE                  │ 32  ← grapa = titular
│                                               │
│           ACTIVIDAD SEMANAL                   │
│                    2 480            +140      │ 40  ← Newsreader, tabular
│                                               │
├───────────────────────────────────────────────┤
│  MIS BUILDS                          ⌄        │ 44  ← plegable, abierta
│  ┌─────────────────────────────────────────┐  │
│  │▏ Doble hoja            ●━━● PRINCIPAL   │  │ 72
│  │▏ DPS · Tanque                           │  │
│  │▏ ⬗ Espada larga   ⬗ Abanico             │  │
│  └─────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────┐  │
│  │▏ Soporte de línea                       │  │ 72
│  │▏ Sanador                                │  │
│  │▏ ⬗ Laúd   ⬗ Sombrilla                   │  │
│  └─────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────┐  │
│  │        Editar mis builds                │  │ 48  ← acción al pie, alcanzable
│  └─────────────────────────────────────────┘  │
├───────────────────────────────────────────────┤
│  MIS ESTADÍSTICAS                    ⌄        │ 44
│  Del escaneo del 28/07 · cambio vs. anterior  │
│  ┌──────────────────┐ ┌──────────────────┐    │
│  │ MAESTRÍA         │ │ CONTRIBUCIÓN     │    │ 68
│  │ 12 940     +310  │ │ 8 120      −40   │    │
│  └──────────────────┘ └──────────────────┘    │
│  ┌──────────────────┐ ┌──────────────────┐    │
│  │ DÍAS ACTIVO      │ │ RANGO SEMANAL    │    │ 68
│  │ 63          +7   │ │ 4.º         +2   │    │
│  └──────────────────┘ └──────────────────┘    │
├───────────────────────────────────────────────┤
│  MI EQUIPO                           ›        │ 56  ← GearSheet, PLEGADA
│  4 sets · Guerra de gremio activo             │
├───────────────────────────────────────────────┤
│  MIS GUERRAS                         ›        │ 56  ← MyWars, PLEGADA
│  12 libradas · impacto medio 64               │
└───────────────────────────────────────────────┘
```

Qué cambia y qué no:

- **Las cinco secciones son las mismas y en el mismo orden.** Nada se renombra, nada se fusiona.
- Las dos últimas (`GearSheet`, `MyWars`) llegan **plegadas** con su resumen visible. Hoy se
  despliegan enteras y hacen de esta la pantalla con más scroll del producto (§b-13.6). Plegar no es
  esconder: el titular sigue diciendo qué hay dentro.
- Las cifras suben a Newsreader tabular. El delta ya no depende del color: lleva signo.
- Ninguna insignia por debajo de 11px, y ninguna con información única.
- La grapa aparece **dos veces**: pestaña activa y titular.

> **Esto toca la regla 3.** Plegar dos secciones cambia lo que se ve al abrir. Creo que es piel —
> el contenido, el orden y los nombres son idénticos— pero es tu llamada, no la mía. Si prefieres
> que lleguen desplegadas, se hace y esta pantalla se queda como está.

### 7.2 Sala de Guerra — con guerra en curso

```
┌───────────────────────────────────────────────┐
│ ▚  ZONA ZERO                          ⌄  ☰   │ 56
├───────────────────────────────────────────────┤
│  Mi perfil   Roster   SALA DE GUERRA   Admin  │ 44
│                       ●━━━━━━━━━━●            │  4
├───────────────────────────────────────────────┤
│                                               │
│   EN GUERRA        JUNGLA          BOSS       │ 20
│    12:04            03:41         09:58       │ 44  ← Newsreader 40px, tabular
│   termina 17:56                               │ 18
│                                    ┌────────┐ │
│                                    │ 🔔 Avi.│ │ 44
│                                    └────────┘ │
├───────────────────────────────────────────────┤
│  ┌──────────────────┐┌──────────────────┐     │
│  │     ATAQUE       ││     Defensa      │     │ 44  ← segmentado, 44 de alto
│  └──────────────────┘└──────────────────┘     │
│                                               │
│  Estrategia de referencia                     │ 18
│  ┌─────────────────────────────────────────┐  │
│  │ Vanguardia Sombría                    ⌄ │  │ 48  ← select 16px
│  └─────────────────────────────────────────┘  │
│                                               │
│   28/30 desplegados · 15 aquí                 │ 20
│                                               │
│  ┌───────────────────┐ ┌───────────────────┐  │
│  │ ●━━●  BLOQUEADO   │ │    Historial      │  │ 44
│  └───────────────────┘ └───────────────────┘  │
│  ┌───────────────────┐ ┌───────────────────┐  │
│  │    Estrategias    │ │  Finalizar guerra │  │ 44
│  └───────────────────┘ └───────────────────┘  │
├───────────────────────────────────────────────┤
│  UNIDADES TÁCTICAS      3 sin unidad          │ 44
│  ┌─────────────────────────────────────────┐  │
│  │ ⬗ Punta de lanza                   4/5  │  │ 64
│  │   Tanques 2/2  Sanadores 1/1  DPS 1/2   │  │     ← el que falta, en latón
│  └─────────────────────────────────────────┘  │
├───────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────┐  │
│  │▎LÍNEA CENTRAL                    8/10   │  │ 48
│  │▎Tanques 2/3 · Sanadores 2/2 · DPS 4/5   │  │ 24  ← "falta 1" ya no es tooltip
│  │▎                                        │  │
│  │▎┌─────────────────────────────────────┐ │  │
│  │▎│▏Jinwei Zhao              ⠿    ⋮    │ │  │ 64  ← ⠿ arrastre, ⋮ menú 44×44
│  │▎│▏DPS · Doble hoja                   │ │  │
│  │▎│▏ ⬗ Punta de lanza                  │ │  │
│  │▎└─────────────────────────────────────┘ │  │
│  │▎┌─────────────────────────────────────┐ │  │
│  │▎│▏Mei Lin                  ⠿    ⋮    │ │  │ 64
│  │▎│▏Sanador · Soporte de línea         │ │  │
│  │▎└─────────────────────────────────────┘ │  │
│  │▎              ⌄ ver 6 más               │  │ 44
│  └─────────────────────────────────────────┘  │
│                                               │
│  ┌─────────────────────────────────────────┐  │
│  │▎LÍNEA IZQUIERDA                  5/10   │  │ …
│  └─────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────┐  │
│  │▎LÍNEA DERECHA                    2/10   │  │ …
│  └─────────────────────────────────────────┘  │
│                                               │
│  ┌─────────────────────────────────────────┐  │
│  │ DISPONIBLES                        14   │  │ 44
│  │ ┌─────────────────────────────────────┐ │  │
│  │ │ Buscar por nombre…                  │ │  │ 48  ← 16px, sin zoom
│  │ └─────────────────────────────────────┘ │  │
│  │ ┌──────────────────┐┌─────────────────┐ │  │
│  │ │ Todos los roles ⌄││ Cualquier marca⌄│ │  │ 48
│  │ └──────────────────┘└─────────────────┘ │  │
│  │ ┌─────────────────────────────────────┐ │  │
│  │ │▏ ●━━● Wei Chen            ⠿    ⋮   │ │  │ 64
│  │ │▏ Tanque · Muro de hierro           │ │  │
│  │ └─────────────────────────────────────┘ │  │
│  └─────────────────────────────────────────┘  │
└───────────────────────────────────────────────┘
       ↑ el banquillo deja de tener scroll propio (§b-9)
```

Al pulsar `⋮` en cualquier miembro — hoja inferior, dentro del alcance del pulgar:

```
                                                     ┌───────────────────────────────────────────────┐
                                                     │                  ────                         │ 20 ← asa, arrastrable
                                                     │                                               │
                                                     │  Jinwei Zhao                                  │ 28
                                                     │  DPS · Doble hoja · Línea central             │ 20
                                                     ├───────────────────────────────────────────────┤
                                                     │  ┌─────────────────────────────────────────┐  │
                                                     │  │  Mover a Línea izquierda        5/10   ›│  │ 56
                                                     │  ├─────────────────────────────────────────┤  │
                                                     │  │  Mover a Línea derecha          2/10   ›│  │ 56
                                                     │  ├─────────────────────────────────────────┤  │
                                                     │  │  Build en esta guerra                  ⌄│  │ 56
                                                     │  ├─────────────────────────────────────────┤  │
                                                     │  │  Unidades tácticas                     ⌄│  │ 56
                                                     │  └─────────────────────────────────────────┘  │
                                                     │                                               │
                                                     │  ┌─────────────────────────────────────────┐  │
                                                     │  │        Quitar de la línea               │  │ 48 ← danger, apartado 16px
                                                     │  └─────────────────────────────────────────┘  │
                                                     │                                    (safe area) │ 34
                                                     └───────────────────────────────────────────────┘
```

Esto responde a la falla más grave del diagnóstico: hoy esas acciones son botones de **16×16** y
**55×17** px, y el arrastrar-y-soltar de `WarBoard.tsx:253` **no existe en táctil**. El arrastre se
mantiene intacto para escritorio (`⠿`); la hoja es el camino del pulgar. Ninguna acción se añade ni
se quita: son exactamente las de `WarBoard.tsx:671-750`, con tamaño y con nombre.

### 7.3 Historial de guerras — hoja, no modal centrado

```
┌───────────────────────────────────────────────┐
│                  ────                         │ 20  ← arrastrar para cerrar
│  ‹ Volver          HISTORIAL              ✕   │ 56  ← cabecera PEGAJOSA (hoy no lo es)
├───────────────────────────────────────────────┤
│                                               │
│  Asedio del Paso Norte        ●━━● VICTORIA   │ 28
│  28 jul · 30 min · 30 en campo · 3 capturas   │ 20
│                                               │
│  CAPTURAS                                     │ 32
│  ┌────────────┐ ┌────────────┐ ┌───────────┐  │
│  │            │ │            │ │           │  │ 96
│  │    ▨   ✕   │ │    ▨   ✕   │ │    ▨   ✕  │  │  ← ✕ SIEMPRE visible (§b-4.2)
│  └────────────┘ └────────────┘ └───────────┘  │
│  ┌─────────────────────┐ ┌─────────────────┐  │
│  │   Subir imagen      │ │ Leer resultados │  │ 48  ← ya no es texto de 12px
│  └─────────────────────┘ └─────────────────┘  │
│                                               │
│  PARTICIPANTES (30)                           │ 32
│  el impacto se calcula contra esta guerra     │ 18
│  ┌─────────────────────────────────────────┐  │
│  │ 1.º  Mei Lin                        88  │  │ 56  ← tarjeta, no fila de tabla
│  │      Ataque · 412 k daño · 9 bajas   ⌄  │  │
│  ├─────────────────────────────────────────┤  │
│  │ 2.º  Wei Chen                       81  │  │ 56
│  │      Defensa · 380 k daño · 6 bajas  ⌄  │  │
│  ├─────────────────────────────────────────┤  │
│  │ ●━━● 4.º  Jinwei Zhao               71  │  │ 56  ← el tuyo, con grapa
│  │      Ataque · 355 k daño · 5 bajas   ⌄  │  │
│  └─────────────────────────────────────────┘  │
│                    ⌄ 27 más                   │ 44
│                                    (safe area) │ 34
└───────────────────────────────────────────────┘
```

Al desplegar `⌄` en una tarjeta, con permiso de edición, aparecen las celdas editables de
`FigureCell` en dos columnas de 16px — mismos campos, mismo guardado, sin tabla de 640px.

La tabla de `WarHistory.tsx:560` **sobrevive intacta a partir de 768px**. La degradación a tarjetas
es solo por debajo del breakpoint móvil.

### 7.4 Roster — abreviada

```
┌───────────────────────────────────────────────┐
│  Mi perfil   ROSTER   Sala de Guerra   Admin  │ 44
│              ●━━━●                            │  4
├───────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────┐  │
│  │  Buscar por nombre…                     │  │ 48
│  └─────────────────────────────────────────┘  │
│  ┌──────────────────┐  ┌───────────────────┐  │
│  │ ⚟ Filtros    (2) │  │  + Nuevo miembro  │  │ 48  ← 7 controles → 1 hoja
│  └──────────────────┘  └───────────────────┘  │
│   42 de 58 · 12 titulares                     │ 20
├───────────────────────────────────────────────┤     ← ~164px de cromo (hoy 430)
│  ┌─────────────────────────────────────────┐  │
│  │▏ ●━━● Mei Lin                   ⋮       │  │ 76
│  │▏ Sanador · Nv.73 · 14 210               │  │
│  │▏ ⬗ Laúd  ⬗ Sombrilla     ⟡ DEFENSA      │  │
│  └─────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────┐  │
│  │▏ Wei Chen                       ⋮       │  │ 76
│  │▏ Tanque · Nv.68 · 11 940                │  │
│  │▏ ⬗ Espada larga          ⟡ ATAQUE       │  │
│  └─────────────────────────────────────────┘  │
└───────────────────────────────────────────────┘
```

Los seis iconos de 20×24 de `PlayerCard.tsx:195` se convierten en **un** `⋮` de 44×44 que abre una
hoja con las seis acciones **con su nombre escrito**, y la destructiva («marcar fuera del gremio»)
separada abajo. Las siete insignias se reducen a las que no son redundantes. Los 226px de filtros
pasan a una hoja.

> **Esto también toca la regla 3**, y es la falla #9 del ranking. La hoja de filtros y el menú `⋮`
> cambian cuántos toques cuesta una acción: hoy marcar titular es un toque (sobre un objetivo de
> 12,5px que se falla la mitad de las veces), y pasaría a dos (sobre uno de 44px que no se falla).
> Creo que es la operación correcta y no me la salto sola. **Alternativa si la rechazas:** dejar
> titular y bando como dos botones de 44×44 en la tarjeta y meter solo las otras cuatro en la hoja.
> Dime cuál.

---

## 8. Consecuencias para la Fase 3

Con Tailwind local autorizado, esto es lo que la Fase 3 tiene que hacer para que la piel se propague
sola. Lo listo aquí para que veas el alcance antes de que empiece.

1. `tailwind.config.js` + una hoja propia con los tokens en `:root` y `[data-theme="dark"]`, y los
   colores de Tailwind apuntando a las variables. Los 793 usos de paleta fija se sustituyen por
   tokens. **A partir de ahí, cero colores literales.**
2. Tema `light` / `dark` / `system`, persistido, con script en línea antes de la hidratación y
   `color-scheme` declarado.
3. `100dvh`, `env(safe-area-inset-*)`, `overscroll-behavior`, viewport correcto.
4. `prefers-reduced-motion` cableado.
5. Fuentes autoalojadas con subset y `font-display`, `preload` solo de Inter.
6. **Font Awesome → sprite SVG en línea.** Justificación (regla 8): resuelve la iconografía;
   sustituye 169 KB medidos por ~4 KB de los ~45 iconos usados; alternativa nativa descartada
   (ninguna, hay que dibujarlos) — pero el CDN también es un origen de terceros menos en el camino
   crítico, con conexión inestable. **Es la mayor ganancia de rendimiento del proyecto y no cambia
   ni un icono de sitio.**
7. `onSurface()` para el color-como-dato (§2).
8. Borrar `WarPlanner.tsx` y el pie legado de `App.tsx:678` — autorizado por ti.

Dependencias nuevas: **ninguna en tiempo de ejecución.** Tailwind y sus herramientas pasan a
`devDependencies`; el sprite es un archivo del repositorio. El bundle solo baja.

---

## 9. Lo que sigue pendiente de ti

1. **¿Apruebas la dirección?** Si el concepto no te convence, dímelo ahora: la Fase 3 lo cablea en
   35 archivos y a partir de ahí cambiarlo es caro.
2. **Las dos marcas de regla 3** de §7.1 (plegar `GearSheet` y `MyWars`) y §7.4 (hoja de filtros y
   menú `⋮`). Son las únicas dos decisiones de esta propuesta que rozan la arquitectura de
   información. Necesito un sí o un no a cada una.
3. **Sigue abierto del cierre de la Fase 1:** `API_PROXY` a un despliegue, o un export anonimizado.
   Sin eso, al final de la Fase 3 podré enseñarte capturas del login y poco más, y la Fase 7 no
   tendrá línea base real de Lighthouse ni de CLS. No bloquea empezar; sí bloquea demostrar.
4. **Sin respuesta:** el «calendario de eventos» y las «convocatorias» que mencionaste no existen en
   el repositorio. Doy por hecho que no hay que maquetarlas. Corrígeme si me equivoco.
