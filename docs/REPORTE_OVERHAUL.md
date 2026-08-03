# Reporte del overhaul de interfaz — Zona Zero

Fase 7. Cierre de `feat/ui-mobile-overhaul`.
**22 commits · 49 archivos · +6.461 / −1.474 líneas.**

Documentos previos: [`DIAGNOSTICO_MOVIL.md`](./DIAGNOSTICO_MOVIL.md) · [`DIRECCION_VISUAL.md`](./DIRECCION_VISUAL.md)

---

## 1. Los números, medidos

Al cerrar la Fase 6 te dije que no habría comparación posible porque la línea base
de la Fase 1 nunca llegó a existir: sólo pude alcanzar la pantalla de login. Eso
se ha resuelto, y de la única forma que valía.

**Cómo.** Se creó un worktree en `fe85b8a` —el commit anterior al primero de la
rama— y se le copió el mismo banco de pruebas. Se pudo hacer precisamente porque
una de las reglas del encargo era no cambiar los contratos de la API: los mismos
datos falsos alimentan las dos versiones. Así que lo de abajo no son dos medidas
de cosas distintas, son la misma pantalla con los mismos datos, dos veces.

### Estabilidad visual

| | Antes | Después |
|---|---|---|
| **CLS acumulado** recorriendo Roster, Mi perfil y Sala de Guerra | **0,8163** | **0** |

El umbral de Google para «deficiente» es 0,25. La versión anterior lo triplicaba.
La causa era la que apuntó el diagnóstico: una rueda de carga en una caja de 384 px
sustituida después por contenido de otra altura, sin `font-display`, sin reserva de
espacio. Ahora los esqueletos ocupan el sitio que va a ocupar el contenido.

### Lo que sale por la red

| | Antes | Después |
|---|---|---|
| Terceros | **376,9 KB** en 7 peticiones | **73,0 KB** en 3 |
| Orígenes de terceros | 3 (cdnjs, googleapis, gstatic) | 1 |
| Compilador de Tailwind ejecutándose en el teléfono | sí | **no** |
| Iconos en el camino crítico | 302 KB | **17,1 KB** gzip |

Font Awesome eran 302 KB de los 377: una hoja de estilos y tres ficheros de fuente
para dibujar iconos. Ahora son máscaras CSS generadas desde los paquetes oficiales,
así que **el dibujo es idéntico** y no se tocó ninguna de las ~200 llamadas del
marcado. Los 170 del catálogo elegible se cargan después de la primera pintura.

El tamaño del script del CDN de Tailwind lo oculta el navegador por ser origen
cruzado, así que no aparece en los 376,9 KB. Era un **compilador de CSS
ejecutándose en un teléfono de gama media en cada visita**; su coste real es mayor
que el que esta tabla puede acreditar.

### El paquete

| | Antes | Después |
|---|---|---|
| JS | 503,05 KB (143,60 gzip) | **526,83 KB (150,86 gzip)** |
| CSS propio | **ninguno** — lo compilaba el CDN | 98,11 KB (**25,81 gzip**) |
| CSS diferido (catálogo de iconos) | — | 127,55 KB (38,60 gzip) |

**El JS creció 23,8 KB (+4,7%), y es un empeoramiento.** Lo pagan siete piezas
nuevas: `Sheet`, `Seccion`, `Esqueleto`, `TablaAncha`, `ThemeToggle`, el servicio
de tema y el del teclado, más la reescritura de `MisGuerras`. A cambio, lo que
llega por red en total baja de ~880 KB a ~250 KB. Es un intercambio favorable pero
no es gratis, y no lo voy a presentar como si lo fuera.

### Geometría, en las tres pantallas más usadas

| | Antes | Después |
|---|---|---|
| Roster · desborde horizontal a 375 px | **71 px** | **0** |
| Roster · elementos interactivos bajo 44 px | **217** | **0** |
| Mi perfil · bajo 44 px | 3 | **0** |
| Mi perfil · alto de página | 3.837 px | **1.869 px** |
| Sala de Guerra · bajo 44 px | 15 | **0** |
| Sala de Guerra · scroll hasta el banquillo | 2.625 px | **un toque** |

### Barrido completo

**320 / 375 / 390 / 430 / 768 / 1280 px × tema claro y oscuro × 4 pantallas = 48
combinaciones.** En todas: **0 px de desborde horizontal y 0 elementos
interactivos por debajo de 44 px.**

### Contraste

Los **52 pares** de la paleta pasan AA en los dos temas, comprobado por
[`docs/tools/contraste.js`](./tools/contraste.js), que se ejecuta y falla con
código de salida 1 si algún par baja del umbral.

### Indicadores en el código

| | Antes | Después |
|---|---|---|
| Superposiciones copiadas a mano | 9 | 1 (el visor de imágenes, que no es un diálogo) |
| `aria-label` | 0 | 37 |
| `min-h-tap` / `min-w-tap` | 0 | 63 |
| `inputMode` | 3 | 7 |
| `focus-visible` | 0 | 2 reglas, aplicadas a todo |
| `env(safe-area-inset-*)` | 0 | 14 |

---

## 2. La lista de la Fase 1, repasada

### Resueltas

| # | Falla | Cómo |
|---|---|---|
| 1 | Desbordes por debajo de 400 px | `min-w-0` en hijos de rejilla, `grid-cols-1` explícito, `overflow-x: clip` en el contenedor de rutas |
| 2 | Targets bajo 44×44 | Suelo en la base del CSS, con excepción declarada (`.tap-suelto`) |
| 3 | Inputs bajo 16 px | Suelo en la base, con `input[class]` para ganar a `text-sm` |
| 4 | Interacciones sólo con hover | El borrar-captura de `opacity-0 group-hover` y los seis iconos de `PlayerCard` |
| 5 | Tablas que no degradan | Tres a tarjetas; tres siguen siendo tabla con columna fija y aviso de deslizamiento |
| 6 | Modales centrados | Componente `Sheet`: hoja abajo en móvil, diálogo desde `sm` |
| 7 | Contenido tapado por barras y teclado | `env(safe-area-inset-*)`, y `services/teclado.ts` midiendo `visualViewport` |
| 8 | `100vh` en lugar de `100dvh` | `minHeight.screen` redefinido; ningún componente editado |
| 9 | Acciones fuera del alcance del pulgar | Navegación a la barra inferior; menús de acción en hojas |
| 10 | Formularios sin agrupación | `StrategyPlanner`; el de miembro se resolvió solo al pasar a hoja |
| 11 | Densidad de escritorio | Filtros del roster tras un botón: 735 px de cromo → 399 |
| 12 | Deuda de estilos | 793 clases de paleta fija repuntadas a tokens sin editar componentes |

### Vivas

| # | Qué | Por qué sigue ahí |
|---|---|---|
| 1 | **`ResultsReader` sin verificar en navegador** | Llegar a ese componente exige capturas reales de guerra sobre las que correr OCR; el banco no puede falsificarlas. El marcado es el mismo patrón ya verificado en el historial, pero **eso es un argumento, no una medición** |
| 2 | **Bundle de 526 KB en un solo chunk** | Sin code-splitting. `GearSheet` (49 KB) y `ResultsReader` (23 KB) son candidatos obvios a carga diferida |
| 3 | **Fuentes desde Google** | Aplazado de común acuerdo: autoalojarlas exige descargar binarios al repositorio |
| 4 | **Lighthouse** | No se ejecutó. El banco corre sobre un servidor de desarrollo, y una puntuación de Lighthouse ahí mide Vite, no el producto |
| 5 | **Los nombres de las rampas** | `slate`, `amber` siguen siendo nombres de color y no de función. Es limpieza, no bloquea nada |
| 6 | **`.cinzel` y `.pulse-gold`** | Ya no apuntan a Cinzel ni son doradas. Renombrarlas son ~20 ediciones de riesgo para no cambiar nada visible |
| 7 | **`GearSheet` casi sin tocar** | 49 KB, el componente más grande. Hereda el suelo de 44 px y los tokens, pero su maqueta interna no se revisó pantalla a pantalla |

---

## 3. Decisiones que tomé, y por qué

**La piel se propaga por configuración, no por ediciones.** Las rampas de Tailwind
apuntan a variables CSS, así que `bg-slate-900` sigue escrito igual en los 24
archivos que lo tienen. Fueron **1.470 apariciones que no toqué** — 1.470 ocasiones
de romper algo que no corrí. El precio es el punto 5 de la lista viva: los nombres
mienten sobre su función. Me pareció el intercambio correcto.

**El tema oscuro no es el claro restado.** Los dos se escribieron a la vez, uno al
lado del otro en `tokens.css`. La grieta del craquelado se invierte —más oscura que
el vidriado de día, más clara de noche— porque una grieta atrapa la luz, no porque
convenga al contraste.

**El suelo de 44 px va en la base y la excepción se declara.** Arreglarlo sitio por
sitio dejaba cuarenta parches que se torcerían al escribir el siguiente botón.

**Los 261 iconos se conservan.** Sólo ~45 aparecen en el marcado; el resto es el
catálogo que un miembro elige y que vive en la base de datos. Quitarlos habría sido
quitar funcionalidad. Van aparte y se cargan después.

**El banco de pruebas existe porque las capturas no podían depender de ti.** Monta
la aplicación entera contra un gremio inventado, poniéndose delante de `fetch` en
vez de montar componentes con props falsas — lo segundo mide la maqueta, no el
producto. Los datos son incómodos a propósito: el nombre que no cabe, la línea
llena a 10/10, quien no registró ninguna build, la guerra de treinta.

**El puesto sigue al impacto aunque ordenes por daño.** Alguien puede ser primero en
daño y séptimo de la guerra; renumerar contradiría en silencio el «10.º de 30» de
arriba.

---

## 4. Errores que cometí, y cómo salieron

Los pongo porque cambian lo que conviene creerse del resto.

1. **La línea base de terceros de la Fase 1 estaba mal.** La medí cuando el login
   sólo había pedido `fa-solid`; `fa-regular` y `fa-brands`, 133 KB entre las dos,
   nunca entraron en la cifra. La corregí en la Fase 3.
2. **Di por rota una pantalla que ya estaba arreglada.** El formulario de miembro
   figuraba como falla viva al entrar en la Fase 5; al medirlo, cabía en una
   pantalla desde la Fase 4.
3. **El suelo de 44 px empeoró el roster antes de mejorarlo.** El cromo pasó de
   430 a 735 px y la primera tarjeta quedó fuera de la pantalla. Lo detecté
   midiendo, no mirando, y adelanté la hoja de filtros.
4. **La dirección de las transiciones siempre decía «adelante».** Comparaba contra
   un ref que actualizaba durante el render; React renderiza dos veces en
   desarrollo y la diferencia salía cero.
5. **Animé `box-shadow`** en el latido del anfitrión, que repinta en cada
   fotograma durante toda la sesión, y **la regla de la fase decía que no**.
6. **Al desmontar el worktree de comparación borré recursivamente una unión que
   apuntaba al `node_modules` real.** El borrado falló pronto sobre binarios
   bloqueados y no hubo daño —138 paquetes intactos, build con hashes idénticos—
   pero fue suerte, no cuidado.

---

## 5. Donde necesito tu criterio

1. **`ResultsReader` sin verificar.** La próxima vez que entres al despliegue,
   abre una guerra con capturas y mira esa pantalla en el teléfono. Es lo único
   que he entregado sin medir.
2. **El JS creció 23,8 KB.** Si te importa, el siguiente paso obvio es diferir
   `GearSheet` y `ResultsReader` (72 KB de fuente entre los dos). Dime si lo hago.
3. **Lighthouse contra el despliegue real.** Sobre el servidor de desarrollo no
   significa nada. Si quieres la cifra, hay que correrlo contra `zonazero`.
4. **Autoalojar las fuentes.** Sigue pendiente de tu visto bueno para descargar
   los `.woff2` al repositorio. Quitaría el último origen de terceros.
5. **`GearSheet`.** Es el componente más grande y el menos revisado. No estaba en
   la lista de fallas de la Fase 1, así que no lo toqué por la regla 4 — pero
   tampoco puedo afirmar que esté bien.
6. **Los nombres que mienten.** `.cinzel`, `.pulse-gold` y las rampas `slate`/
   `amber`. Limpieza barata en riesgo pero aburrida; dime si la quieres antes de
   que se convierta en folklore del proyecto.
