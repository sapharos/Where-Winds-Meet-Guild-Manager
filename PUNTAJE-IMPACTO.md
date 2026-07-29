# Puntaje de Impacto

Cómo la plataforma mide lo que cada quien aportó en una guerra de gremio, sin mirar qué rol tenía asignado en el roster.

Este documento describe la versión actual del cálculo, tal y como vive en [`services/impact.ts`](services/impact.ts). Si el peso de una estadística cambia, este archivo debe actualizarse con él — es la explicación oficial que se le da al gremio.

## El problema que resuelve

El marcador del propio juego ordena por Derrotados. Eso deja a los sanadores en cero y no dice nada de quien jugó una build híbrida entre daño, curación o tanqueo — que es exactamente cómo juega buena parte del gremio en GvG.

Un ejemplo real, tomado de una guerra jugada por el gremio: **Naoomiii** terminó con 6 Derrotados. Por esa sola cifra, quedaría 17.ª de 24 combatientes. Pero curó 29.255.994 — más que nadie esa noche — y absorbió el 85 % del daño recibido que absorbió quien más recibió. Su Puntaje de Impacto fue **91**, la 3.ª posición de esa guerra.

El Puntaje de Impacto existe para medir lo que se hizo, no lo que el marcador del juego sabe contar.

## Cómo se calcula

Tres pasos, por cada guerra:

**1. Cada estadística se compara con la mejor de esa misma guerra.**
No con un tope fijo ni con guerras anteriores — con lo que de verdad se logró esa noche. Eso da un porcentaje de 0 a 100 % por estadística: quien la lideró saca 100 %, el resto en proporción.

**2. Ese porcentaje se multiplica por el peso de la estadística.**

| Estadística | Peso | Por qué |
|---|---:|---|
| Daño | 1.0 | Una de las dos formas de decidir un combate. |
| Curación | 1.0 | La otra. Vale exactamente lo mismo que el daño. |
| Kills y asistencias | 0.8 | Se cuentan juntas: una asistencia es como se ve el kill de un sanador. |
| Daño de asedio | 0.6 | Cuenta, pero no decide un combate cuerpo a cuerpo. |
| Daño recibido | 0.4 | Suele ser el costo de tanquear, no un logro en sí mismo. |
| Monedas | 0.2 | La más lejana al resultado del combate. |
| Muertes | −0.3 | Resta un poco. Nunca decide el ranking por sí sola. |

**3. Los siete resultados se suman — no se promedian — y el total más alto de la guerra pasa a valer 100 puntos.**
Todos los demás quedan en proporción a ese máximo.

Sumar en vez de promediar es la decisión que hace que esto funcione para los híbridos: alguien que reparte su esfuerzo entre daño y curación se beneficia de los dos ejes a la vez, en lugar de que uno le baje el promedio del otro. Y a nadie se le pregunta por qué su columna de daño está vacía: si nunca hizo daño, ese eje simplemente no suma ni resta.

## El ejemplo completo: Naoomiii

| Estadística | Su cifra | La mejor de la guerra | % | Peso | Aporta |
|---|---:|---:|---:|---:|---:|
| Daño | 4.915.466 | 20.835.081 | 24 % | ×1.0 | 0.236 |
| Curación | 29.255.994 | 29.255.994 | **100 %** | ×1.0 | 1.000 |
| Kills + asistencias | 72 | 135 | 53 % | ×0.8 | 0.427 |
| Daño de asedio | 1.956.853 | 20.348.816 | 10 % | ×0.6 | 0.058 |
| Daño recibido | 9.219.138 | 10.835.551 | 85 % | ×0.4 | 0.340 |
| Monedas | 0 | 3.960 | 0 % | ×0.2 | 0.000 |
| Muertes | 9 | 19 | 47 % | ×−0.3 | −0.142 |
| **Total** | | | | | **1.919** |

El total más alto de esa guerra fue **2.100** (Meruem's, con el mejor daño y el mejor recuento de kills+asistencias). Naoomiii queda en 1.919 / 2.100 = **91 puntos**.

Ninguna casilla pregunta si Naoomiii "debía" hacer daño. Cada una mide lo que hizo, contra lo mejor que se hizo esa noche en esa misma cosa.

## Por qué no lee el rol asignado

Nada en el cálculo consulta el rol del roster ni la build activa. Es deliberado: un rol es una etiqueta que alguien escribió antes de la guerra, y la guerra la juega la build que de verdad se llevó puesta.

- Un tanque que terminó curando no es juzgado por el daño que no hizo.
- Un híbrido de daño y tanque saca crédito en los dos ejes en los que participó, no solo en uno.
- Un sanador puro puede terminar por encima de un DPS, y eso es correcto: esa noche, curar decidió más combates que atacar.

## Cómo se ajustará a futuro

Esta primera versión trata a todo el mundo por igual, sin importar el rol o el conjunto de armas — a propósito, para tener una base simple y verificable antes de afinarla. Dos direcciones ya identificadas para cuando haga falta:

- **Pesos por conjunto de armas.** El despliegue de guerra ya sabe qué build llevó cada quien. Se podría, por ejemplo, subir el peso del daño recibido para builds de tanqueo específicas, en vez de aplicar el mismo 0.4 a todo el mundo.
- **Comparar dentro del mismo grupo, no contra todos.** En estadísticas donde tiene sentido (curación, por ejemplo), comparar solo contra quienes cumplieron ese papel esa guerra, en vez de contra los 30 desplegados.

Ninguna de las dos está activa todavía. Cuando se implemente una, este documento se actualiza con ella — la tabla de pesos de arriba es siempre la que está corriendo en producción.
