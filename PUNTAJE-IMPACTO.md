# Puntaje de Impacto

Cómo la plataforma mide lo que cada quien aportó en una guerra de gremio, sin mirar qué rol tenía asignado en el roster.

Este documento describe la versión actual del cálculo, tal y como vive en [`server/impact.js`](server/impact.js). Si el peso de una estadística cambia, este archivo debe actualizarse con él — es la explicación oficial que se le da al gremio.

Hay un solo cálculo y está en ese archivo. La web lo importa a través de [`services/impact.ts`](services/impact.ts), que es sólo la envoltura con los tipos, y el bot de Discord lo importa directamente para contestar `/impacto`. Vive en `server/` por una razón de empaquetado y no de diseño: la imagen de la API se construye con ese directorio como contexto y no alcanza nada de fuera, mientras que la web se construye desde la raíz y sí llega ahí. Es el único sitio que ven los dos lados, y que lo vean los dos es lo que impide que a alguien le salga un 74 en la web y un 71 en Discord.

## El problema que resuelve

El marcador del propio juego ordena por Derrotados. Eso deja a los sanadores en cero y no dice nada de quien jugó una build híbrida entre daño, curación o tanqueo — que es exactamente cómo juega buena parte del gremio en GvG.

Un ejemplo real, de la guerra del 26 de julio de 2026: **Naoomiii** terminó con 4 Derrotados. Por esa sola cifra quedaría penúltima. Pero curó 23.455.162 — más que nadie esa noche. Su Puntaje de Impacto fue **83**, en la mitad alta de la tabla.

El Puntaje de Impacto existe para medir lo que se hizo, no lo que el marcador del juego sabe contar.

## Cómo se calcula

Cuatro pasos, por cada guerra:

**1. Cada estadística se compara con la mejor de esa misma guerra.**
No con un tope fijo ni con guerras anteriores — con lo que de verdad se logró esa noche. Eso da un porcentaje de 0 a 100 % por estadística: quien la lideró saca 100 %, el resto en proporción.

**2. Ese porcentaje se curva.**
El porcentaje crudo no es tan justo como parece, porque las estadísticas no están igual de repartidas. En esa misma guerra el daño iba de 1,2 a 20,2 millones — 16 veces — mientras que el daño recibido iba de 1,9 a 6,7 — 3,6 veces. "La mitad del mejor" era barato en una columna y durísimo en la otra, así que la columna más dispersa decidía la tabla ella sola.

La corrección es elevar el porcentaje a 0,7 (`x^0.7`). Eso sube mucho la parte baja de una columna dispersa y apenas toca el centro de una columna apretada, que es justo lo que hacía falta. El 100 % sigue siendo 100 % y la magnitud sigue contando: quien curó 21 M sigue por encima de quien curó 11 M.

De paso, esto premia a los híbridos todavía más: dos trabajos a medias suman 1,28 donde uno completo suma 1,00.

**3. Cada porcentaje curvado se multiplica por el peso de su estadística.**

| Estadística | Peso | Por qué |
|---|---:|---|
| Daño | 1.0 | Una de las dos formas de decidir un combate. |
| Curación | 1.0 | La otra. Vale exactamente lo mismo que el daño. |
| Kills | 0.8 | Columna propia. Ver más abajo. |
| Daño recibido | 0.7 | Aguantar el frente es un trabajo, no un accidente. |
| Daño de asedio | 0.6 | Solo cuenta para quien fue desplegado en **ataque**. Ver más abajo. |
| Asistencias | 0.35 | Estar donde caen los kills, que no es lo mismo que rematarlos. |
| Monedas | 0.2 | La más lejana al resultado del combate. |
| Muertes | −0.3 | Resta, y menos cuanto más estabas aguantando. Ver más abajo. |

**4. Los ocho resultados se suman — no se promedian — y el total más alto entre quienes tuvieron el mismo tipo de despliegue pasa a valer 100 puntos.**
Ataque se compara contra ataque, defensa contra defensa. Todos los demás quedan en proporción al máximo de su propio bando.

### Por qué las kills van aparte de las asistencias

Antes iban sumadas en una sola columna. El problema es que esa columna era, en la práctica, la de asistencias: en la guerra del 26 de julio las asistencias iban de 38 a 123 y las kills de 1 a 30, así que la suma se movía con las asistencias y 30 kills casi no la cambiaban. **Subâru** terminó con las kills más altas de toda la guerra y quedaba 11.º, por debajo de alguien con 1 kill.

Eso golpeaba en concreto a las armas de objetivo único — Vinculación de Seda, Cortebambú y los híbridos montados sobre ellas — porque producen exactamente esa forma: pocas kills grandes, daño normal. Se les medía por la única cifra que sus armas no generan.

Con columna propia y peso 0.8, matar vuelve a valer algo. Subâru pasó de 76 a 88 puntos y del 11.º al 7.º puesto.

### Por qué el daño recibido subió de 0.4 a 0.7

Aguantar el frente era el único trabajo cuyo rendimiento se medía en la columna más apretada de la tabla. Con los pesos viejos, en esa guerra:

- el mejor en daño le sacaba **0,74 puntos** a la mediana;
- el mejor en daño recibido le sacaba **0,17** a la suya.

Es decir: tanquear te costaba la columna de daño entera y te devolvía la cuarta parte. A 0.7 la cuenta ya cierra, y sigue sin poder desbocarse — como la columna está tan apretada, ni liderándola se sacan más de 0,22 puntos sobre la mediana. No se puede farmear daño recibido para subir en la tabla.

### Por qué morir cuenta menos si morías aguantando

Morir en primera línea absorbiendo el daño de la guerra es el trabajo funcionando. Morir varias veces sin haber absorbido nada es que te pillaron. A quien más daño recibió se le perdona la mitad de la penalización, en escala continua entre esos dos extremos.

### Por qué el daño de asedio es distinto

Derribar las puertas es un objetivo exclusivo de quien ataca. La defensa no tiene forma de generar esta cifra — no porque juegue peor, sino porque su trabajo esa noche fue otro. Por eso el daño de asedio se pone en cero para todo el mundo en defensa, sin excepción, y solo se compara entre quienes atacaron.

Eso resuelve la mitad del problema. La otra mitad está en contra de qué se compara el resultado final. Dos personas con exactamente el mismo daño, curación, kills y muertes — una en ataque, otra en defensa — deberían sacar el mismo puntaje. Pero si a las dos se les compara contra el total más alto de *toda* la guerra, y ese total más alto es de un atacante que además hizo mucho daño de asedio, la persona en defensa nunca podría llegar a 100 — no porque le faltara algo, sino porque se le medía contra un techo que su bando no puede alcanzar.

Por eso el paso 4 compara cada quien contra lo mejor de **su propio bando**.

Sumar en vez de promediar es la decisión que hace que esto funcione para los híbridos: alguien que reparte su esfuerzo entre daño y curación se beneficia de los dos ejes a la vez, en lugar de que uno le baje el promedio del otro. Y a nadie se le pregunta por qué su columna de daño está vacía: si nunca hizo daño, ese eje simplemente no suma ni resta.

## El ejemplo completo: Subâru

Guerra del 26 de julio de 2026, desplegado en **defensa**.

| Estadística | Su cifra | La mejor de la guerra | Crudo | Curvado | Peso | Aporta |
|---|---:|---:|---:|---:|---:|---:|
| Daño | 9.936.810 | 20.182.373 | 49 % | 61 % | ×1.0 | 0.609 |
| Curación | 0 | 23.455.162 | 0 % | 0 % | ×1.0 | 0.000 |
| Kills | 30 | 30 | **100 %** | **100 %** | ×0.8 | 0.800 |
| Daño recibido | 3.420.385 | 6.750.778 | 51 % | 62 % | ×0.7 | 0.435 |
| Daño de asedio | 0 (defensa) | 17.109.831 | 0 % | 0 % | ×0.6 | 0.000 |
| Asistencias | 107 | 123 | 87 % | 91 % | ×0.35 | 0.317 |
| Monedas | 1.980 | 4.620 | 43 % | 55 % | ×0.2 | 0.111 |
| Muertes | 4 | 8 | 50 % | 50 % | ×−0.3 | −0.103 |
| **Total** | | | | | | **2.168** |

El total más alto en defensa esa noche fue de **Ryu影**, que pasa a valer 100. Subâru queda en **88 puntos**.

Ninguna casilla pregunta si Subâru "debía" curar. Cada una mide lo que hizo, contra lo mejor que se hizo esa noche en esa misma cosa.

## Por qué no lee el rol asignado

Nada en el cálculo consulta el rol del roster. Es deliberado: un rol es una etiqueta que alguien escribió antes de la guerra, y la guerra la juega la build que de verdad se llevó puesta.

- Un tanque que terminó curando no es juzgado por el daño que no hizo.
- Un híbrido de daño y tanque saca crédito en los dos ejes en los que participó, no solo en uno.
- Un sanador puro puede terminar por encima de un DPS, y eso es correcto: esa noche, curar decidió más combates que atacar.

## Holgura por conjunto de armas

Todo lo de arriba trata a todos los conjuntos por igual. Para los casos en que eso siga sin bastar, cada conjunto de armas puede llevar una **holgura por estadística**, configurable en *Administración → Conjuntos de armas → Puntaje de impacto*.

Una holgura dice qué se le pide a ese conjunto, como % del mejor de la guerra. Al 100 % — el valor por defecto — se mide contra el mejor sin más. Bajarlo al 60 % en Daño significa: *a este conjunto, llegar al 60 % del mejor daño de la noche ya es el máximo que sus armas dan*.

Detalles que importan:

- **Por defecto no hay ninguna holgura.** Un conjunto sin tocar se puntúa exactamente igual que siempre, y un arma nueva no cuesta nada hasta que alguien decida que la necesita.
- **No se puede pasar de 100.** Superar tu propia holgura no vale más que ser el mejor de la guerra a secas.
- **Si llevas armas de dos conjuntos, se promedian.** Una pareja que mezcla objetivo único con área se espera, con razón, en un punto intermedio.
- **Se puede subir de 100**, hasta 200 %. A un conjunto de área se le puede pedir más daño que al resto.
- **No todas las estadísticas son ajustables.** Monedas no, porque es cuestión de tomar objetivos y no de qué llevas puesto. Muertes tampoco, porque es una penalización y darle holgura sería pagar por morir.

### Cómo decidir los números

Sin datos, no se decide: se mide. Este es el rendimiento real por conjunto en la guerra del 26 de julio — la mediana de cada grupo como % del mejor de esa guerra:

| Conjunto | n | Daño | Curación | Kills | Asist. | Recibido | Asedio |
|---|---:|---:|---:|---:|---:|---:|---:|
| Golpecampana - Esplendor | 7 | 45 % | 0 % | 43 % | 69 % | 51 % | 13 % |
| Golpecampana - Umbra | 3 | 66 % | 0 % | 97 % | 85 % | 61 % | 12 % |
| Cortebambú - Viento | 2 | 13 % | 0 % | 30 % | 59 % | 31 % | 2 % |
| Vinculación de Seda - Diluvio | 8 | 16 % | 66 % | 13 % | 46 % | 58 % | 2 % |
| Vinculación de Seda - Jade | 2 | 15 % | 0 % | 20 % | 37 % | 28 % | 0 % |
| Partepiedra - Poder | 4 | 18 % | 1 % | 23 % | 75 % | 46 % | 2 % |
| Cortebambú - Polvo | 2 | 26 % | 0 % | 27 % | 45 % | 40 % | 2 % |
| Partepiedras - Fuerza | 3 | 36 % | 0 % | 37 % | 85 % | 71 % | 9 % |
| Cortebambú - Cometa | 1 | 26 % | 0 % | 27 % | 50 % | 49 % | 32 % |

**Advertencia sobre esta tabla: es una sola guerra, y varias filas tienen 1 o 2 jugadores.** Con esas muestras no se distingue el conjunto de la persona que lo llevaba. Sirve como método, no como respuesta. Lo sensato es acumular varias guerras antes de mover nada, y aun entonces empezar por lo menos discutible: los conjuntos con muestra grande y una carencia clara y explicable por sus armas.

## Qué queda por hacer

- **Comparar dentro del mismo rol, no solo del mismo bando.** En estadísticas como curación, comparar solo contra quienes cumplieron ese papel esa guerra — el mismo principio que ya se usa entre ataque y defensa, un nivel más fino.
- **Que la tabla de rendimiento por conjunto se calcule sola** dentro de la app, sobre todas las guerras registradas, en lugar de a mano como aquí.

Cuando se implemente una, este documento se actualiza con ella — la tabla de pesos de arriba es siempre la que está corriendo en producción.
