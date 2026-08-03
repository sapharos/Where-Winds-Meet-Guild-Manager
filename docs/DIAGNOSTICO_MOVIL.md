# Diagnóstico móvil — Zona Zero

Fase 1 del overhaul de interfaz. **Ningún archivo de la aplicación ha sido modificado.**
Rama: `feat/ui-mobile-overhaul`. Base: `fe85b8a` (master).

Cómo leer las cifras de este documento:

- **[medido]** — leído del navegador contra el servidor de desarrollo real, viewport 375×812, con
  el Tailwind y las fuentes reales de la aplicación cargadas.
- **[calculado]** — derivado de forma determinista de las clases del código (`p-2` = 8px,
  `text-sm` = 14px/20px, `w-4` = 16px…). No es estimación: es aritmética sobre CSS.
- **[leído]** — hecho estructural presente en el código, sin cifra asociada.

Limitación conocida: no hay backend en este entorno (`/api/auth/me` → 404), así que las pantallas
tras el login no se pudieron fotografiar. Las mediciones de geometría se hicieron inyectando en la
página viva **las cadenas de clases exactas copiadas del código fuente**, que se compilan con el
mismo Tailwind y las mismas fuentes que en producción. Lo que se mide es el CSS, que es donde vive
la falla.

---

## a) Mapa del sistema

### Stack detectado

| Pieza | Qué es | Nota relevante para el overhaul |
|---|---|---|
| React 19.2 + TypeScript 5.8 | SPA sin router | La navegación es `useState` en `App.tsx:22`. No hay URLs por pantalla. |
| Vite 6.4 | build | Un solo chunk, sin code-splitting |
| **Tailwind vía CDN** (`index.html:16`) | `cdn.tailwindcss.com` | Es el **compilador JIT ejecutándose en el navegador**: no hay `tailwind.config.js`, no hay CSS build, no hay purge. Todo el CSS se genera en el teléfono en cada carga. |
| **Font Awesome 6.4 vía CDN** (`index.html:17`) | iconografía completa | 102 KB de CSS + 150 KB de webfont para ~45 iconos usados |
| **Google Fonts** (`index.html:18`) | Cinzel 400/700 + Inter 300–700 | Sin `preload`, sin `font-display`, sin subset |
| PeerJS 1.5.4 | colaboración P2P (`App.tsx:205-286`) | ~50 KB en el bundle; solo se usa desde el panel de colaboración |
| Node + Express + Postgres | `server/` | Fuera del alcance de este trabajo |

**Consecuencia para Fase 3:** no existe ninguna hoja de estilos propia donde poner tokens.
`index.html:19-64` es el único CSS del proyecto (45 líneas). Los tokens habrá que crearlos desde
cero, y el CDN de Tailwind tendrá que dejar paso a un build local para que las variables CSS y el
tema oscuro/claro funcionen sin recompilar en el cliente. Esto es una decisión que necesita tu visto
bueno y la propongo en el cierre.

### Rutas / pantallas existentes

No hay router. Cinco pestañas en `App.tsx:409-415`, filtradas por permisos:

| Pestaña | Estado | Componente raíz | Visible para |
|---|---|---|---|
| `roster` | por defecto | `MemberManager` (`App.tsx:641`) | todos |
| `me` | se abre sola si la cuenta tiene `playerId` (`App.tsx:180-182`) | `MyProfile` (`App.tsx:620`) | miembros enlazados |
| `war-room` | — | `WarBoard` (`App.tsx:659`) | todos |
| `scan` | — | `ScanImport` (`App.tsx:631`) | `roster.edit` |
| `admin` | — | `AdminPanel` (`App.tsx:633`) | `users.manage` ∪ `permissions.manage` ∪ `builds.manage` |

Fuera de las pestañas: `LoginScreen`, `DiscordClaim` (`App.tsx:433-440`), y dos superposiciones
globales, `MemberHistory` (`App.tsx:663`) y `BuildEditor` (`App.tsx:665`).

### Componentes compartidos y quién los consume

Esta es la tabla que decide el rendimiento de cada arreglo.

| Componente | Consumido por | Pantallas alcanzadas | Rinde |
|---|---|---|---|
| **`PlayerCard`** (`components/PlayerCard.tsx`) | `MemberManager:423`, `WarPlanner:157,463`†, y por reexportación `ROLE_NAMES`/`buildColours` en `WarBoard:21`, `MyProfile:13`, `BuildEditor:4` | **Roster** (toda la lista) | ⭐⭐⭐ El arreglo de mayor rendimiento del proyecto |
| **Patrón de modal** (11 copias literales del mismo bloque, ver §b-6) | `BuildEditor:90`, `MemberHistory:64`, `FinishWarModal:52`, `ResultsReader:457`, `MemberManager:441`, `StartWarModal:47`, `WeaponSets:25`, `WarHistory:325`, `StrategyPlanner:148` | **9 superposiciones reales** | ⭐⭐⭐ No es un componente: es copiar-pegar. Extraerlo arregla 9 pantallas de golpe |
| **Patrón de input** (`bg-slate-950 border … p-2 text-sm`) | ~40 apariciones en 14 archivos | **todas las que tienen formulario** | ⭐⭐⭐ Un solo cambio elimina el zoom de iOS en toda la app |
| **Patrón de tabla** (`overflow-x-auto` + `<table>`) | `MyWars:191`, `WarHistory:560`, `MemberHistory:89`, `AdminPanel:201,336`, `ScanImport:223` | **6 tablas en 5 pantallas** | ⭐⭐ |
| `SetBadge` (`BuildEditor.tsx`) | `WeaponSets:4`, `MemberManager:5`, `WarHistory:16`, `MyProfile:14` | 4 | ⭐ decorativo, sin falla |
| `FigureCell` | `ResultsReader:3`, `WarHistory:15` | 2 | ⭐ celda editable de cifras |
| `WarTimers` | `WarBoard:23` | 1 (Sala de Guerra) | ⭐⭐ es lo que un miembro abre para ver la hora |
| `IconPicker` (`WeaponSets.tsx`) | `StrategyPlanner:12` | 1 | — |
| `constants.tsx` (`ROLE_ICONS`, `ROLE_COLORS`, `STATUS_COLORS`, `PLATFORM_ICONS`) | `PlayerCard:4`, `WarBoard:20` | 2 | ⭐⭐ 8 colores literales, entra en Fase 3 |

† **`WarPlanner.tsx` (33.777 bytes) no lo importa nadie.** Verificado: la única referencia a la
cadena `WarPlanner` fuera del propio archivo no existe. Es código muerto, junto con el flujo
`GuildWarSession`/`TacticalGroup`/`DEFAULT_GROUPS` que lo alimenta y que `App.tsx` todavía carga y
persiste (`App.tsx:137-150`, `App.tsx:417-422`). **No lo toco** (regla 2). Lo anoto aquí: son 33 KB
de bundle y 8 de las 12 fallas de hover que aparecen en el grep salen de ahí. Si confirmas que
sobra, borrarlo baja el bundle y quita ruido del diagnóstico futuro; es tu decisión, no la mía.

### Jerarquía real de lo que un miembro usa

Contrastado con lo que me dijiste: sesiones de menos de dos minutos, confirmar guerra, ver la hora,
ver quién asistió, ver resultados.

```
1. Mi perfil (MyProfile)        ← se abre sola para todo miembro enlazado. Es la portada real.
   ├── cabecera con actividad semanal
   ├── Mis builds
   ├── Mis estadísticas
   ├── GearSheet          (componente de 49 KB, el más grande del proyecto)
   └── MyWars             ← "mis resultados": tabla + medidores de impacto

2. Sala de Guerra (WarBoard)    ← la hora, el despliegue, el historial
   ├── WarTimers          ← "¿a qué hora es?" — lo que más se consulta y menos ocupa
   ├── tablero de 3 líneas + banquillo
   ├── WarHistory (modal) ← "¿quién asistió? ¿cómo quedó?"
   └── StrategyPlanner / StartWarModal / FinishWarModal (solo mando)

3. Roster (MemberManager)       ← pestaña por defecto de oficiales y líder
4. Escaneo (ScanImport)         ← operación de mantenimiento, poco frecuente
5. Administración (AdminPanel)  ← rara
```

---

## b) Fallas móviles concretas

### 1. Desbordes horizontales por debajo de 400px

| # | Archivo:línea | Qué se rompe | Ancho | Pantallas |
|---|---|---|---|---|
| 1.1 | `MemberHistory.tsx:90` | `<table className="… min-w-[640px]">` dentro de un modal con `p-6`: el viewport útil es **327px** a 375px de pantalla. Además **cada escaneo añade una columna**, así que la tabla crece sin techo. La columna «Métrica» no está fijada: al desplazar a la derecha se pierden las etiquetas de fila y quedan números sin nombre. | <640px | Roster → «Ver evolución» |
| 1.2 | `ScanImport.tsx:224` | `min-w-[720px]` — 2,2× el ancho disponible | <720px | Escaneo |
| 1.3 | `AdminPanel.tsx:202` | `min-w-[640px]`, matriz de permisos | <640px | Administración |
| 1.4 | `AdminPanel.tsx:337` | `min-w-[560px]`, tabla de usuarios | <560px | Administración |
| 1.5 | `MyWars.tsx:192` | tabla sin `min-w` pero con `3 + FIGURES.length` columnas numéricas; desborda por contenido, no por declaración | <~500px | **Mi perfil** |
| 1.6 | `WarHistory.tsx:561` | igual que 1.5, tabla de participantes | <~500px | Sala de Guerra → Historial |

Todas viven dentro de `overflow-x-auto`, así que **no rompen el layout de la página** — no hay
scroll horizontal del body. Lo que rompen es la lectura: son cajas que se desplazan lateralmente sin
indicación visible de que se pueden desplazar, sin columna fija y sin cabecera pegajosa.

*Verificado [medido]: en la pantalla de login, `scrollWidth == clientWidth == 375`. El body no
desborda. El problema está contenido dentro de las tablas.*

### 2. Targets táctiles por debajo de 44×44 y acciones pegadas

Todas las cifras de esta tabla son **[medido]** salvo donde se indica.

| # | Archivo:línea | Elemento | Tamaño real | Separación | Pantallas |
|---|---|---|---|---|---|
| **2.1** | `PlayerCard.tsx:195-260` | **Seis botones de icono en fila**, sin padding: dar de baja, titular, bando, builds, evolución, editar | **20×24 px** el más ancho, **12,5×24 px** la estrella | `gap-2` = **8 px** | **Roster (toda la lista)** |
| 2.2 | `PlayerCard.tsx:196-206` | El primero de esos seis es **destructivo** («marcar como fuera del gremio», con `confirm()` en `App.tsx:362`) y está pegado a la estrella de titular, la acción más frecuente | 20×24 | 8 px | Roster |
| 2.3 | `WarBoard.tsx:675-686` | Botones «mover a otra línea» — el comentario del código los llama *«para pantallas táctiles»* | `w-4 h-4` = **16×16 px** [calculado] | `gap-1` = 4 px | Sala de Guerra |
| 2.4 | `WarBoard.tsx:687-693` | Quitar de la línea: un `<i>` sin caja | ~16×16 [calculado] | 6 px | Sala de Guerra |
| 2.5 | `WarBoard.tsx:851-866` | Botones de línea del banquillo, tres por tarjeta | **55,3×17 px** | `gap-1` = 4 px | Sala de Guerra |
| 2.6 | `WarBoard.tsx:730-746` | Chips de unidad táctica | **45,4×17 px** | `gap-1` = 4 px | Sala de Guerra |
| 2.7 | `WarHistory.tsx:542` | Borrar captura: `w-7 h-7` = 28×28 **y además invisible sin hover** (§4.2) | 28×28 | — | Sala de Guerra → Historial |
| 2.8 | `AdminPanel.tsx:229` | Casillas de la matriz de permisos, `w-4 h-4` | 16×16 [calculado] | celda de tabla | Administración |
| 2.9 | `MemberManager.tsx:305-312` | Entradas del menú de armas, `text-[11px] py-1.5` | ~26 px de alto [calculado] | 0 | Roster |
| 2.10 | `App.tsx:493`, `App.tsx:564-577` | Menú «⋯», cambiar contraseña, cerrar sesión: `p-2` sobre icono de 16px | 32×32 [calculado] | 4 px | Todas |
| 2.11 | `WarHistory.tsx:495-517` | «Leer resultados» y «Subir imagen» son texto de 12px sin caja | ~17 px de alto | 12 px | Sala de Guerra → Historial |

**Ninguno de los controles auditados llega a 44×44.** El más grande de la aplicación es el botón de
pestaña de la navegación: **130,2×36 px** [medido]. El estándar de 44×44 no se cumple en ningún
punto del producto.

### 3. Inputs con `font-size` menor a 16px → zoom automático en iOS

**[medido] en la pantalla de login viva: `font-size` calculado = `14px`, altura = `38px`.**
Es decir, ya en la primera pantalla que ve cualquier usuario, tocar el campo de usuario provoca el
zoom de Safari.

El patrón `p-2 text-sm` está copiado en ~40 inputs/selects. Muestra representativa:

| Archivo:línea | Tamaño |
|---|---|
| `LoginScreen.tsx:61`, `:73` | 14px |
| `MemberManager.tsx:275`, `:282`, `:367`, `:381`, `:462`, `:472`, `:487`, `:497`, `:521` | 14px |
| `WarBoard.tsx:381`, `:779`, `:786`, `:798` | 14px |
| `GearSheet.tsx:407`, `:412`, `:425`, `:544` | 14px |
| `AdminPanel.tsx:302`, `:310`, `:317` | 14px |
| `BuildEditor.tsx:150`, `:330` · `StrategyPlanner.tsx:204`, `:328` · `WeaponSets.tsx:245` · `WarHistory.tsx:424` | 14px |
| `AdminPanel.tsx:359` · `ScanImport.tsx:295` · `GearSheet.tsx:696`, `:1055`, `:1065` · `CollaborationPanel.tsx:94` · `MemberManager.tsx:568` | **12px** |
| `WarBoard.tsx:705` (selector de build dentro de la tarjeta de línea) | **11px** |

Relacionado: solo hay **3** `inputMode` en todo el proyecto (`FigureCell:49`, `ScanImport:270`,
`DiscordClaim:90`) y **9** `autoComplete`, de los cuales 6 son `"off"` en `GearSheet`. Los campos
numéricos de `MemberManager:486` (nivel) y de `ResultsReader`/`WarHistory` (cifras de guerra) abren
el teclado alfabético. No hay ningún `enterKeyHint`.

### 4. Interacciones que solo existen en hover

| # | Archivo:línea | Qué se pierde en táctil |
|---|---|---|
| **4.1** | `PlayerCard.tsx:199,210,221,240,249,256` | Los **seis** botones de la tarjeta de miembro son iconos sin etiqueta cuyo único significado está en `title=`. En un teléfono, seis iconos idénticos en tamaño y sin texto: no hay forma de saber qué hace ninguno sin pulsarlo. Uno de ellos da de baja a alguien. |
| **4.2** | `WarHistory.tsx:542` | `opacity-0 group-hover:opacity-100` — **borrar una captura es imposible en táctil**, el botón nunca se hace visible. |
| 4.3 | `WarBoard.tsx:633` | El número de gente que falta en una línea (`Faltan N`) está solo en el `title`. En el teléfono se ve `Tanques 2/4` pero no cuánto falta ni de qué. |
| 4.4 | `WarBoard.tsx:410` | El reparto ataque/defensa del total desplegado, solo en `title`. |
| 4.5 | `WarBoard.tsx:433,680,856` · `PlayerCard.tsx:117,123,173` · `MemberManager.tsx:391` · `GearSheet` (5) · `StrategyPlanner` (4) · `BuildEditor` (2) | 71 atributos `title=` en total (40 literales + 31 dinámicos) en 14 archivos. Cada uno es información que en el móvil no existe. |
| 4.6 | `WarPlanner.tsx:402,407,428,469,486` | 5 revelados por hover más — **en código muerto**, no cuentan para el alcance. |

### 5. Tablas y grillas que no degradan a formato vertical

Ninguna de las 6 tablas tiene versión de tarjetas. Ninguna tiene cabecera pegajosa ni primera
columna fija. El único mecanismo es `overflow-x-auto`, sin señal visual de que hay más a la derecha.

Las dos que importan de verdad, porque son «quién asistió» y «cómo quedé»:

- `MyWars.tsx:191-236` — dentro de **Mi perfil**, la pantalla que se abre sola. Columnas:
  `# · Miembro · Impacto · {FIGURES}`. La fila propia se resalta en ámbar (`:212`), que es lo único
  que salva la lectura; encontrarla exige desplazar verticalmente entre 30 filas y horizontalmente
  entre las columnas de cifras.
- `WarHistory.tsx:560-620` — misma estructura, además **editable** (`FigureCell`), dentro de un
  modal. Anotar las cifras de una guerra desde el teléfono es hoy la operación más incómoda de la
  aplicación.

Grillas que sí degradan bien y **no hay que tocar** (regla 4): `MemberManager:421` (roster
`sm:2 / lg:3 / xl:4` → 1 columna en móvil, correcto), `MyProfile:129,196`, `WarBoard:516`,
`GearSheet:338`.

### 6. Modales centrados donde debería haber bottom sheets

**El mismo bloque, copiado literalmente 9 veces** (11 contando el código muerto):

```
fixed inset-0 z-[NN] bg-black/70 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto
  └── bg-slate-900 border border-slate-800 rounded-xl w-full max-w-{lg|4xl|5xl} my-8
```

`BuildEditor:90` · `MemberHistory:64` · `FinishWarModal:52` · `ResultsReader:457` ·
`MemberManager:441` · `StartWarModal:47` · `WeaponSets:25` · `WarHistory:325` · `StrategyPlanner:148`

Problemas comunes a las nueve:

- `p-6` en el overlay + `p-6` en la cabecera + `p-6` en el cuerpo = **48px de los 375** se van en
  márgenes exteriores antes de dibujar nada.
- La cabecera **no es pegajosa**: en `WarHistory` (modal de 5 secciones con tabla de 30 filas) el
  botón de cerrar se va de la pantalla al primer desplazamiento y solo se recupera subiendo del todo.
- **Sin bloqueo del scroll del body**: `overflow-y-auto` en el overlay y `min-h-screen` en la página
  debajo. Al llegar al final del modal el gesto continúa desplazando la página de detrás.
- **Sin cierre con Escape** en ninguno de los nueve. El único `Escape` del proyecto está en
  `WarHistory.tsx:178`, y es para el visor de imágenes.
- **Sin trampa de foco** y sin `role="dialog"` / `aria-modal`.
- **Sin gesto de arrastrar para cerrar**, que es lo que un pulgar espera de una hoja.
- `items-start` + `my-8`: en pantallas cortas y con el teclado abierto, el modal empieza fuera de
  vista.

### 7. Contenido tapado por barras fijas, teclado virtual o safe areas

| # | Archivo:línea | Qué pasa |
|---|---|---|
| 7.1 | `App.tsx:444` | Cabecera `sticky top-0 z-50` de **120px de alto [medido]** en móvil — 16% del viewport de un iPhone, permanentemente. Sin `env(safe-area-inset-top)`: en un teléfono con notch la fila de identidad queda parcialmente bajo el recorte. |
| 7.2 | `WarTimers.tsx:264` | El aviso de jungla/boss se posiciona `fixed inset-x-0 top-6 z-[80]` — **a 24px del borde superior, es decir, encima de la cabecera pegajosa de 120px y dentro de la safe area**. Es el elemento más importante de la app en el momento en que aparece (avisa de un evento con minutos de margen) y es el peor colocado. |
| 7.3 | `App.tsx:678` | Pie fijo `fixed bottom-0` — está `hidden md:flex`, así que **no afecta al móvil**. Nota aparte: su contenido son tres indicadores con valores escritos a mano (`ÓPTIMO`, `EQUILIBRADO`, `ESTABLE`) que no se calculan de ningún dato. Lo anoto como posible sobrante, no lo toco. |
| 7.4 | Global | **Ningún `env(safe-area-inset-*)` en todo el proyecto.** 0 apariciones. |
| 7.5 | `MemberManager.tsx:455+`, `GearSheet` PieceEditor, `WarHistory` | Formularios largos dentro de modales con scroll propio. Sin `scrollIntoView` al enfocar: con el teclado abierto (≈290px en iOS, ≈36% del viewport) el campo activo queda tapado en la mitad inferior del formulario. No hay ningún manejo de `visualViewport` en el proyecto. |

### 8. Uso de `100vh` en lugar de `100dvh`

**0 apariciones de `dvh` en todo el proyecto.**

| Archivo:línea | Uso |
|---|---|
| `App.tsx:426`, `App.tsx:443` | `min-h-screen` — la pantalla de carga y el contenedor raíz |
| `LoginScreen.tsx:36` | `min-h-screen` con `flex items-center` → el formulario se centra contra una altura que la barra de Safari desmiente; al aparecer/desaparecer la barra, el contenido salta |
| `DiscordClaim.tsx:43` | igual |
| `WarPlanner.tsx:135` | `h-[calc(100vh-180px)]` — código muerto |

También: **0 apariciones de `overscroll-behavior`**. Los cuatro contenedores con scroll anidado
(§9) propagan el rebote a la página.

### 9. Trampas de scroll anidado

| Archivo:línea | Contenedor |
|---|---|
| `WarBoard.tsx:808` | Banquillo, `max-h-[520px] overflow-y-auto` — a 375px el banquillo es la cuarta caja de una columna, así que hay una lista con scroll propio de 520px dentro de una página que también se desplaza. Encontrar a alguien exige desplazar el contenedor correcto. |
| `MemberManager.tsx:304` | Menú de armas, `max-h-80 overflow-y-auto`, dentro de un `<details>` posicionado en `absolute` con `max-w-[calc(100vw-3rem)]` |
| `WarPlanner.tsx:208,454` | código muerto |

### 10. Acciones frecuentes fuera del alcance del pulgar

No hay navegación inferior. Todo lo primario está en el tercio superior:

| Acción | Dónde está | Alcance |
|---|---|---|
| Cambiar de pestaña | `App.tsx:585-602`, y = 60-96px | fuera |
| Cerrar sesión / contraseña | `App.tsx:564-577`, esquina superior derecha | fuera |
| Nuevo miembro | `MemberManager.tsx:257`, y ≈ 170px | fuera |
| Iniciar / finalizar guerra | `WarBoard.tsx:472-493` | fuera |
| Bloquear formación | `WarBoard.tsx:430` | fuera |
| Cerrar cualquier modal | esquina superior derecha, ×9 | fuera |
| Marcar titular / bando | `PlayerCard.tsx:207-236`, esquina superior derecha de cada tarjeta | variable |

**[medido]** La franja de la pantalla que el pulgar alcanza cómodamente en un teléfono de 812px de
alto sujeto con una mano es aproximadamente `y > 450px`. En el Roster, a 375px, lo que hay por
encima de esa línea es: cabecera (120) + `main p-6` (24) + título y botón (≈60) + **bloque de
filtros de 226px [medido]** = **430px de cromo antes de la primera tarjeta de miembro**. La primera
acción tocable de contenido real aparece justo en el límite del alcance.

### 11. Formularios largos sin agrupación ni progreso

| Archivo:línea | Formulario | Campos |
|---|---|---|
| `MemberManager.tsx:455-600` | Nuevo/editar miembro | nombre, rol, nivel, secta, rango (+ editor de rangos desplegable anidado con su propio formulario en `:562-580`), plataforma, estado, UID… en un `space-y-4` plano, con el botón de guardar al final |
| `GearSheet.tsx:955-1090` | Editor de pieza | nombre, nivel, días, casilla, y **N filas** de `valor + unidad + afinación + radio`, cada fila con 4 controles de 12px |
| `StrategyPlanner.tsx:190-350` | Estrategia + unidades | anidado, sin progreso |
| `WarHistory.tsx:412-620` | Anotar cifras de guerra | 30 filas × `FIGURES` celdas editables |

Ninguno tiene agrupación por secciones, indicador de progreso, guardado parcial ni barra de acción
fija al pie. En todos, el botón de confirmar está al final de un scroll largo.

### 12. Gráficos con tooltips inaccesibles por tap

Poco afectado, y conviene decirlo: la aplicación casi no tiene gráficos.

- `MyWars.tsx:151-169` — medidores de barra por eje de impacto. **Bien resueltos**: el porcentaje se
  imprime en texto al lado (`:155-157`), no depende de hover. No tocar.
- `MemberHistory.tsx:127` — `<Spark>`, minigráfico en la última columna de la tabla. Vive en la
  columna más a la derecha de una tabla de `min-w-[640px]`: en móvil hay que desplazar hasta el final
  para verlo, y para entonces se ha perdido la etiqueta de la fila (§1.1).
- `MemberHistory.tsx:116` — los huecos de datos se explican solo por `title` («No capturado en este
  escaneo»).

### 13. Densidad pensada para pantalla ancha

| # | Archivo:línea | Evidencia |
|---|---|---|
| **13.1** | `MemberManager.tsx:267` | `grid sm:grid-cols-2 lg:grid-cols-7` — siete controles de filtro. Por debajo de 640px colapsan a **una sola columna: 226px de alto [medido]**, apilados, antes del primer miembro. Un diseño de 7 columnas metido en un teléfono. |
| 13.2 | `App.tsx:612` | `<main className="… p-6">` — 24px por lado también en móvil; 48 de 375 px (12,8%) son margen |
| 13.3 | `PlayerCard.tsx:113,150` | `max-w-[140px]` sobre el nombre y sobre el nombre de la build: en móvil sobra ancho y aun así se trunca |
| 13.4 | `PlayerCard.tsx:129-179` | Hasta **7 insignias** por tarjeta (`Nv.`, estado, rango, build, baja, bando, armas huérfanas) en `flex-wrap` a 8–10px |
| 13.5 | `WarBoard.tsx:572` | `grid gap-4 lg:grid-cols-3/4` — en móvil, cuatro secciones (3 líneas + banquillo) en columna. Con 10 por línea, llegar al banquillo son ~1.400px de scroll |
| 13.6 | `MyProfile.tsx:54-229` | Una sola columna con 5 secciones, incluido `GearSheet` (49 KB de componente) y `MyWars` completo. Sin acordeón, sin anclas, sin pestañas internas. Es el scroll más largo del producto y es la pantalla que se abre sola. |
| 13.7 | Global | **36 usos de prefijos responsivos** (`sm:`/`md:`/`lg:`/`xl:`) frente a **793 clases de color fijas**. La proporción describe el producto: un diseño de escritorio con unos pocos parches de adaptación. |

### 14. Solo 36 puntos de adaptación en toda la aplicación

Distribución de prefijos responsivos: `App.tsx` 11 · `WarPlanner` 8 (muerto) · `GearSheet` 4 ·
`MemberManager` 2 · `WarTimers` 2 · `MyProfile` 2 · `WarBoard` 2 · resto 1 cada uno.
`PlayerCard.tsx`, el componente más repetido de la aplicación, tiene **0**.

---

## c) Ranking de impacto

Criterio: `frecuencia de la pantalla × severidad × nº de pantallas que arregla el mismo cambio`.

### C1 — Se resuelven en la capa de componentes (Fase 4)

Una corrección, muchas pantallas. Este es el trabajo rentable.

| # | Arreglo | Falla | Pantallas | Por qué primero |
|---|---|---|---|---|
| **1** | **Input base ≥16px** con `inputmode`/`autocomplete`/`enterkeyhint` | §3 | **todas** | Es la falla más barata de arreglar y la que todo el mundo sufre en cada sesión. El zoom de iOS rompe el layout entero y obliga a un pellizco para recuperarlo, en una sesión de dos minutos. Cambio mecánico sobre un patrón repetido. |
| **2** | **Barra de acciones de `PlayerCard`** a 44×44, con etiqueta visible, y la acción destructiva separada del resto | §2.1, §2.2, §4.1 | Roster (toda la lista) | Seis objetivos de 20×24 a 8px, uno de ellos destructivo, sin etiqueta. Es el mayor riesgo de error del producto y está en la pantalla por defecto. |
| **3** | **Componente de hoja/modal** único, con cabecera pegajosa, bloqueo de scroll, Escape, foco atrapado, safe area y arrastrar para cerrar | §6 | **9 superposiciones** | Es copiar-pegar hoy. Extraerlo arregla nueve pantallas con un archivo. Rendimiento máximo por línea escrita. |
| **4** | **Componente de tabla** con degradación a tarjetas + primera columna fija + cabecera pegajosa + indicación de desplazamiento | §1, §5 | 6 tablas / 5 pantallas | Incluye «quién asistió» y «cómo quedé», que son dos de los cuatro motivos de uso que describiste. |
| **5** | **Toque mínimo global** para botones e iconos (`WarBoard` líneas/banquillo/chips, cabecera, menús) | §2.3-2.11 | **todas** | 16×16 y 55×17 no son pulsables. Afecta a la única acción de escritura frecuente de la Sala de Guerra. |
| **6** | **Etiquetas visibles en lugar de `title`** (o `title` + texto) | §4 | 14 archivos | 71 tooltips que en móvil no existen. Incluye información que no está en ningún otro sitio (§4.2, §4.3). |
| **7** | **Fundaciones de viewport**: `100dvh`, `env(safe-area-inset-*)`, `overscroll-behavior`, `color-scheme` | §7, §8 | **todas** | Va en Fase 3, pero se lista aquí porque el beneficio es global. |
| **8** | **Reubicación del aviso de `WarTimers`** fuera de la cabecera pegajosa y de la safe area | §7.2 | Sala de Guerra | Un aviso que llega tapado no es un aviso. Cambio pequeño, consecuencia grande. |

### C2 — Exigen tocar una vista concreta (Fase 5)

| # | Vista | Falla | Frecuencia | Nota |
|---|---|---|---|---|
| **9** | **`MemberManager` — bloque de filtros** (`:267`) | §13.1 | alta | 226px de filtros antes del primer miembro. Necesita decisión de diseño (¿hoja de filtros? ¿colapsable?), no es un arreglo de componente. **Requiere tu criterio: es lo más cerca que este trabajo pasa de la arquitectura de información.** |
| **10** | **`WarBoard` — tablero y banquillo** | §2.3-2.6, §9, §13.5 | alta | El arrastrar-y-soltar (`:253-271`, `:585-599`) es HTML5 puro: **no existe en táctil**. Hay atajos, pero de 14×26 y 55×17 px. Es la acción central de la pantalla y hoy solo se hace bien desde un ordenador. Vista compleja: si al llegar a Fase 5 resulta más grande de lo estimado, paro y renegociamos. |
| **11** | **`MyProfile` — longitud** | §13.6 | **la más alta** | Se abre sola para cada miembro. Cinco secciones, `GearSheet` completo dentro. Cualquier reordenación toca la arquitectura de información → **te lo propongo aparte, no lo decido yo** (regla 3). Lo que sí es capa de presentación: colapsar `GearSheet` y `MyWars` por defecto. |
| **12** | **`WarHistory` — anotar cifras** | §5, §6, §2.7, §2.11 | media-alta | La tabla editable dentro de un modal. Además, el texto del estado vacío (`:525`) dice «pulsa Ctrl+V» a alguien que está en un teléfono — el `<input type="file">` sí existe (`:507`), solo que se anuncia mal. |
| 13 | `MemberHistory` | §1.1, §12 | media | Tabla que crece una columna por escaneo, sin columna fija |
| 14 | `AdminPanel` | §1.3, §1.4, §2.8 | baja | Matriz de permisos con casillas de 16px |
| 15 | `ScanImport` | §1.2 | baja | Tabla de 720px |
| 16 | `GearSheet` | §11, §3 | baja-media | El componente más grande; formularios de 4 controles de 12px por fila |

### C3 — Fuera de alcance salvo que lo pidas

- `WarPlanner.tsx` — código muerto (33 KB)
- `App.tsx:678` — pie decorativo con datos escritos a mano, oculto en móvil
- `LoginScreen`, `DiscordClaim` — **[medido] no desbordan a 375px**; su única falla es el input de
  14px, que cae bajo el arreglo #1. Regla 4: no se tocan más allá de eso.

---

## d) Deuda de estilos

Esto es lo que determina cuánto cuesta el tema claro/oscuro.

### Colores

| Tipo | Cuenta | Dónde |
|---|---|---|
| **Clases de paleta Tailwind fijas** (`bg-slate-900`, `text-amber-500`, `border-red-800`…) | **793 en 24 archivos** | `GearSheet` 99 · `WarPlanner` 98 (muerto) · `MemberManager` 61 · `WarBoard` 55 · `WarHistory` 47 · `AdminPanel` 46 · `ScanImport` 42 · `App` 36 · `BuildEditor` 36 · `WeaponSets` 35 · `MyProfile` 27 · `StrategyPlanner` 27 · `MyWars` 23 · `MemberHistory` 23 · `PlayerCard` 21 · `CollaborationPanel` 20 · `DiscordClaim` 18 · `LoginScreen` 17 · `ResultsReader` 16 · `FinishWarModal` 14 · `StartWarModal` 13 · `WarTimers` 8 · `constants` 8 · `FigureCell` 3 |
| **Literales hexadecimales** | **42 en 17 archivos** | `index.html` 7 · `WarTimers` 7 · `StrategyPlanner` 4 · `App` 4 · `WarPlanner` 3 · `types` 3 · `LoginScreen` 2 (`#5865F2` de Discord) · `PlayerCard` 2 (`UNSET = '#475569'`) · `MemberManager` 2 · resto 1 |

**Estas 835 apariciones son la carga real de la Fase 3.** Cada `slate-900` es una decisión de tema
oscuro escrita a mano en 24 sitios. No hay ni una variable CSS en el proyecto.

Hay además una tercera categoría, más delicada: **color como dato**, que no debe convertirse en token
porque procede de la base de datos y lo elige el usuario.

| Origen | Uso |
|---|---|
| `WeaponSet.color` | `PlayerCard:86` (degradado de la tarjeta), `WarBoard:66,655`, `BuildEditor`, `MyProfile:137,169`, `WeaponSets:248` (`<input type="color">`) |
| `GuildRank.color` | `PlayerCard:144`, `MemberManager:554` |
| `WarLane.colour` (`types.ts`) | `WarBoard:604,610,682,862` |
| `unit.color` (estrategia) | `WarBoard:531,534,740` |
| `impactShade()` (`services/impact.ts`) | `MyWars:106,112,164,223` |

Estos colores se componen hoy con opacidad hexadecimal (`${color}66`, `${color}0f`, `${color}26`)
sobre un fondo oscuro fijo (`#0b1120` en `PlayerCard:86` y `WarBoard:66`). **En tema claro esas
mezclas se rompen todas**: un `#a3e635` al 15% de opacidad sobre blanco es invisible. Es el problema
más difícil de la Fase 3 y hay que resolverlo con una función de mezcla dependiente del tema, no
con tokens. Lo señalo ahora porque condiciona la Fase 2.

### Breakpoints

Solo 36 usos, todos con los valores por defecto de Tailwind (640/768/1024/1280). No hay
inconsistencia porque casi no hay breakpoints. El problema es el contrario: falta adaptación, no
sobra coherencia. `PlayerCard` tiene 0.

### z-index

Sin sistema. Escala inventada sobre la marcha, 7 niveles:

| Valor | Dónde |
|---|---|
| `z-10`, `z-20` | `WarPlanner` (muerto) |
| `z-30` | `MemberManager:304` (menú de armas) |
| `z-50` | `App:444` (cabecera), `App:496` (menú «⋯»), `App:678` (pie) |
| `z-[60]` | `BuildEditor`, `MemberHistory`, `MemberManager`, `WarHistory`, `StrategyPlanner` |
| `z-[70]` | `FinishWarModal`, `ResultsReader`, `StartWarModal`, `WeaponSets` |
| `z-[80]` | `WarTimers:264` (aviso) |
| `z-[90]` | `WarHistory:654` (visor de imágenes) |
| `z-[100]` | `WarPlanner:182` (muerto) |

Colisión real: el menú de armas del roster (`z-30`) queda **por debajo** de la cabecera pegajosa
(`z-50`). Al abrirlo cerca del borde superior, sus primeras opciones desaparecen detrás de la
cabecera.

### Estilos en línea

`style={{...}}` en **~45 puntos**. La mayoría son legítimos (color como dato, arriba). Los que no
lo son y deberían pasar a tokens en Fase 3:

- `PlayerCard.tsx:86` — `#0b1120` como base opaca del degradado
- `WarBoard.tsx:66` — el mismo `#0b1120`
- `WarTimers.tsx:239,243,250,270` — `#1e293b`, `#475569`, `#e2e8f0`, `#0b1120`
- `MyProfile.tsx:170` — `#475569` / `#94a3b8`
- `index.html:20-64` — `#0c0d0e`, `#e2e8f0`, `#1a1a1a`, `#333`, `#444`, `rgba(217,119,6,…)`

### Ausencias totales (0 apariciones, verificado)

`prefers-reduced-motion` · `env(safe-area-inset-*)` · `color-scheme` · `overscroll-behavior` ·
`dvh` · `focus-visible` · `aria-label` · `aria-modal` · `role="dialog"` · `tailwind.config.js` ·
cualquier archivo `.css` propio.

Hay **un** `role=` funcional en todo el proyecto (`FigureCell.tsx:71`).

---

## e) Línea base

Fecha de medición: 2026-08-03. Rama `feat/ui-mobile-overhaul` en el commit base `fe85b8a`.

### Bundle de la aplicación

```
vite v6.4.3 build
dist/index.html                  2,75 kB │ gzip:   1,06 kB
dist/assets/index-DsaEOa90.js  503,05 kB │ gzip: 143,60 kB
(!) Some chunks are larger than 500 kB after minification
```

Un único chunk. **Sin code-splitting**: `GearSheet` (49 KB de fuente), `WarPlanner` (33 KB, muerto),
`ResultsReader`, `WarHistory` y `gearCatalog.ts` (23 KB) se descargan siempre, incluso para un
miembro que solo quiere ver la hora de la guerra.

### Terceros — todos bloqueantes de renderizado, todos [medido]

| Recurso | Comprimido | Sin comprimir | Origen |
|---|---|---|---|
| Font Awesome CSS | **18,75 KB** | 102,03 KB | `cdnjs.cloudflare.com` |
| Font Awesome webfont `fa-solid-900.woff2` | **150,12 KB** | 150,12 KB | `cdnjs.cloudflare.com` |
| Google Fonts CSS | **0,86 KB** | 14,02 KB | `fonts.googleapis.com` |
| Cinzel `.woff2` | **25,90 KB** | 25,90 KB | `fonts.gstatic.com` |
| Inter `.woff2` | **48,26 KB** | 48,26 KB | `fonts.gstatic.com` |
| **Subtotal terceros medido** | **243,89 KB** | 340,33 KB | 4 orígenes distintos |
| Tailwind CDN JIT | *no medible en este entorno* | — | `cdn.tailwindcss.com` |

**Total verificado por carga: 143,60 + 243,89 ≈ 387,5 KB**, más Tailwind.

Sobre Tailwind: el CDN cargó correctamente (`typeof window.tailwind !== 'undefined'` → `true`
[medido]), pero su peso no se pudo leer en este entorno. Lo relevante no es solo el peso: **es el
compilador JIT de Tailwind ejecutándose en el navegador del usuario**. En cada carga, en el
teléfono, escanea el DOM y genera el CSS. En un teléfono de gama media eso es trabajo de CPU en el
camino crítico, justo lo que la restricción de rendimiento del proyecto no admite. Y con una
conexión inestable, **cuatro orígenes de terceros son cuatro handshakes TLS antes de que se pinte
nada**.

Estimación honesta y sin medir: eliminar Font Awesome en favor de SVGs en línea de los ~45 iconos
realmente usados ahorraría del orden de 165 KB comprimidos; pasar Tailwind a build local elimina la
compilación en cliente. Ambas son propuestas de Fase 3, con su justificación, no decisiones tomadas.

### Lighthouse mobile

**No ejecutado.** Motivo declarado: sin backend en este entorno, las únicas pantallas alcanzables
son `LoginScreen` y `DiscordClaim`, que no son las que hay que medir. Un Lighthouse del login sería
un número que no compara nada.

Para que la Fase 7 tenga contra qué medir necesito una de estas dos cosas de tu parte:

1. `API_PROXY` apuntando a un despliegue real — `vite.config.ts:14` ya lo contempla. Es la vía
   limpia: mido las tres pantallas reales con datos reales, ahora y al final.
2. O bien un juego de datos de prueba (export de `Exportar` desde tu instancia, anonimizado si
   quieres) para levantar el servidor local.

Sin una de las dos, la Fase 7 podrá comparar bundle y CLS del login, pero no Lighthouse ni CLS de
Roster / Sala de Guerra / Mi perfil. **Prefiero decírtelo ahora que entregarte una comparación falsa
al final.**

### CLS

Medible hoy solo en el login. Fuentes de desplazamiento identificadas en el código, para vigilarlas
en Fase 7:

- Fuentes sin `font-display: swap` ni `preload` → reflujo al llegar Cinzel e Inter
- Font Awesome llega después del primer pintado → todos los iconos aparecen de golpe y empujan
- `App.tsx:605-610` — la franja de error se inserta **entre** la cabecera y el contenido, empujando
  toda la página hacia abajo
- `App.tsx:613` — el estado de carga es un `h-96` fijo que se sustituye por contenido de otra altura
- `WarTimers.tsx:264` — el aviso se monta en `fixed`, no desplaza (correcto)
- `MyProfile.tsx:44-47` — dos `fetch` independientes que rellenan secciones distintas en momentos
  distintos, cada una empujando la siguiente

### Geometría medida — tabla de referencia para la Fase 7

Viewport 375×812, Tailwind y fuentes reales.

| Elemento | Hoy | Objetivo |
|---|---|---|
| `font-size` de input | **14 px** | ≥16 px |
| Altura de input | **38 px** | ≥44 px |
| Botón de `PlayerCard` (el más ancho) | **20 × 24 px** | 44 × 44 |
| Botón de `PlayerCard` (la estrella) | **12,5 × 24 px** | 44 × 44 |
| Separación entre acciones de `PlayerCard` | **8 px** | ≥8 px, con la destructiva apartada |
| Botón de línea del banquillo (`WarBoard`) | **55,3 × 17 px** | 44 × 44 |
| Chip de unidad táctica | **45,4 × 17 px** | 44 × 44 |
| Botón mover de línea (`WarBoard`) | **≈16 × 16 px** | 44 × 44 |
| Botón de pestaña (el mayor control del producto) | **130,2 × 36 px** | ≥44 de alto |
| Altura de la cabecera pegajosa | **120 px** (14,8% del viewport) | a decidir en Fase 2 |
| Alto del bloque de filtros del roster | **226 px** | a decidir en Fase 5 |
| Cromo antes de la primera tarjeta de miembro | **≈430 px** | a decidir en Fase 5 |
| Desborde horizontal del body en login | **0 px** ✓ | 0 px |

---

## Resumen ejecutivo

**Tres cosas explican casi toda la incomodidad:**

1. **Nada es pulsable.** El control más grande de la aplicación mide 36px de alto; el más usado, el
   de la tarjeta de miembro, mide 20×24. El estándar de 44×44 no se cumple en ningún punto del
   producto, y la acción destructiva está a 8px de la más frecuente.
2. **Cada campo de texto expulsa al usuario de la página.** 14px de `font-size` [medido] hace que
   iOS haga zoom al enfocar. En una sesión de dos minutos, eso es un pellizco de recuperación por
   cada campo tocado.
3. **La aplicación es un diseño de escritorio con parches.** 793 clases de color fijas frente a 36
   puntos de adaptación responsiva. `PlayerCard`, el componente más repetido, tiene cero.

**Y una que es peor de lo que parece:** el arrastrar-y-soltar del tablero de guerra (`WarBoard.tsx:253`)
es HTML5 puro. En un teléfono **no funciona en absoluto**. Existe una alternativa por pulsación, pero
sus botones miden 16×16 y 55×17 px. La acción central de la Sala de Guerra hoy solo se ejecuta bien
desde un ordenador — y me dijiste que nadie abre esto desde un ordenador.

---

## Lo que necesito de ti antes de la Fase 2

1. **Tailwind por CDN → build local.** Los tokens como variables CSS y el tema claro/oscuro no son
   viables con el JIT en el navegador sin un `tailwind.config.js`. Es un cambio de infraestructura de
   build, no de presentación, así que no lo doy por hecho. ¿Lo autorizas?
2. **Datos para medir.** `API_PROXY` a un despliegue, o un export anonimizado. Sin eso, la Fase 7 no
   tiene línea base real de Lighthouse ni de CLS (§e).
3. **`WarPlanner.tsx`** — código muerto, 33 KB. No lo toco. ¿Confirmas que sobra?
4. **`App.tsx:678`** — pie con tres indicadores escritos a mano. ¿Es un marcador de posición?
5. **Aviso previo de conflicto con la regla 3:** las fallas #9 (226px de filtros en el roster) y #11
   (`MyProfile` es el scroll más largo del producto y se abre sola) **no se pueden arreglar solo con
   piel**. Cualquier solución real reordena o esconde algo. Cuando llegue a la Fase 5 te lo
   propondré por separado y esperaré tu decisión, en lugar de resolverlo por mi cuenta.

**Contradicciones prompt ↔ repo, señaladas y no resueltas (regla 9):**

- Pediste tres pantallas más usadas para los mockups de la Fase 2. El código dice que son
  **Mi perfil**, **Sala de Guerra** y **Roster**; pero «revisar quién asistió» y «consultar
  resultados» —dos de los cuatro motivos de uso que describiste— viven dentro de `WarHistory`, que
  es un **modal**, no una pantalla. Propongo que la tercera maqueta sea esa hoja, y no el Roster.
  Dime si lo prefieres al revés.
- Hablaste de «calendario de eventos» y «convocatorias». En el repo no encuentro ninguna vista de
  calendario ni de convocatoria: lo más cercano son `WarTimers` (cuenta atrás dentro de una guerra en
  curso) y el marcado de bando en `PlayerCard`. Si existe y no la veo, dímelo; si no existe, la
  Fase 2 no la maquetará.
