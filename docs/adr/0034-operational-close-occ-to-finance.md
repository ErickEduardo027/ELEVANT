# ADR-0034: Cierre operacional OCC → Finanzas con recargos automáticos y reglas de Finanzas

## Estado

Accepted — 2026-11-05.

## Contexto

Fase 3 del ciclo operativo, bloque 5: el cierre de la operación entre OCC y Finanzas.

**Lo que faltaba**

- **Recargos.** El agente marcaba a mano el nocturno y el festivo, y nada detectaba los demás. El formulario de AVIAM describe cuatro:
  - **Nocturno:** 15 % entre las 22:00 y las 05:59.
  - **Domingo o festivo:** 15 % entre las 06:00 y las 21:59.
  - **Paquete excedido:** cuando el tiempo en tierra supera el del paquete (por tipo de avión, ~1 h–1 h 15 en estrechos y ~2 h–2 h 15 en anchos, según Pillier).
  - **Demora** frente a lo programado.

  El seed de Development tenía 25 % y 50 %, no existía un calendario de festivos y ningún contrato guardaba el tiempo en tierra.
- **Revisión de OCC.**
  - El supervisor no veía hitos, tiempos ni recargos y no podía corregirlos.
  - Al aprobar, la escala nunca pasaba a `Completed` y las incidencias quedaban abiertas.
  - El detalle devolvía como fin real la hora de entrega.
- **Finanzas** revisa con una semana de retraso, de domingo a sábado, y no veía los recargos de cada servicio.
- **Cierre operacional del día.** OCC lo armaba a mano.

## Decisión

**1. Reglas de cierre de Finanzas** (decisión de Erick: configurables por categoría).

- **Tiempo en tierra permitido por categoría de avión.**
  - Tabla `commercial.ground_time_allowances`: estrecho y ancho, de 15 a 720 minutos, con versión optimista.
  - Valores del seed de Development: 75 y 135.
- **Calendario de festivos.**
  - Tabla `commercial.finance_holidays`: una fecha activa única con su nombre; quitar un festivo lo marca como quitado, sin borrarlo.
- **Acceso.** Módulo «Reglas de cierre», con los permisos `finance.close_rules.read` y `.update`. Cada cambio queda auditado.

**2. Recargos automáticos al entregar.**

- **Cuándo se calculan.** Justo antes de congelar la evidencia que revisa OCC, `AutomaticSurchargeApplier` marca los recargos en los servicios completados. Cada marca guarda su origen: `Agent`, `Automatic` u `Occ`.
- **La política** (`AutomaticSurchargePolicy`) solo decide los códigos:
  - `NIGHT`: inicio entre 22:00 y 05:59, hora de la estación.
  - `HOLIDAY`: domingo o festivo entre 06:00 y 21:59. Nunca se suma al nocturno.
  - `OVERTIME`: de bloqueo a push-back por encima del tiempo permitido, más la tolerancia del recargo.
  - `DELAY`: llegada real tras la programada, más la tolerancia del recargo.
- **De dónde salen los tiempos.**
  - Inicio: el hito `BLOCK_ON`; si no se registró, el inicio real de la operación.
  - Fin: el hito `PUSHBACK`; si no se registró, el momento de la entrega.
- **Los porcentajes y tarifas** son los del tarifario de Finanzas y de cada contrato. El seed de Development usa 15 % para el nocturno y el festivo, como el formulario.
- **Cuántas marcas se agregan.**
  - El nocturno y el festivo se marcan en cada servicio elegible.
  - El tiempo extra y la demora, una sola vez por operación.
  - Se respetan las exclusiones del contrato.
  - No se duplican marcas existentes.
  - Lo que OCC quitó no se vuelve a marcar en una entrega posterior.
- **Evidencia v4.** Congela el tiempo en tierra, el permitido, la categoría del avión y la demora. El exceso que valora el recargo `OVERTIME` se mide contra el tiempo permitido; si no se conoce, contra el fin planificado.
- **En la tablet.** El agente ve los recargos automáticos y los de OCC, pero solo puede quitar los suyos.

**3. Revisión de OCC.**

- **El detalle** suma un bloque de cierre:
  - hitos registrados;
  - tiempo en tierra frente al permitido;
  - demora;
  - daños del walk-around;
  - recargos con su origen;
  - códigos IATA de las incidencias.
- **Ajustes.** Mientras la entrega está pendiente, OCC agrega o quita un recargo con un motivo de 8 a 500 caracteres.
  - Cada ajuste mueve la versión de la revisión. Una decisión preparada con los recargos anteriores se rechaza con 412.
  - Queda auditado como `occ.operation.charge.added` o `occ.operation.charge.removed`.
- **Al aprobar:**
  - `ops.review_decisions.approved_evidence_json` guarda lo aprobado: la evidencia entregada con los recargos ya ajustados. La evidencia de la entrega no se toca.
  - Las incidencias abiertas quedan resueltas.
  - La escala pasa a `Completed` cuando todas sus operaciones están aprobadas.
- **Finanzas valora la evidencia aprobada.** Los servicios aprobados, la prefactura y el portal de la aerolínea la usan, con la evidencia de la entrega como respaldo para aprobaciones anteriores a este bloque.

**4. Finanzas.**

- **Servicios aprobados:** atajos «Semana pasada» y «Esta semana» (de domingo a sábado) y los recargos de cada servicio con su origen.

**5. Cierre operacional del día.**

- Reporte nuevo de OCC, `daily-close`. Por vuelo muestra:
  - STA, ATA, STD y push-back;
  - posición inicial y final;
  - minutos entre el último cambio de posición y el bloqueo (negativos si el cambio llegó después del bloqueo);
  - tiempo en tierra frente al permitido;
  - demoras IATA, desviaciones y estado.
- Se exporta en CSV, Excel o PDF como los demás reportes.

**Endpoints**

| Ruta | Para qué |
|---|---|
| `POST occ/review/operations/{id}/charges` | OCC agrega un recargo (If-Match) |
| `POST occ/review/operations/{id}/charges/{markId}/removal` | OCC quita un recargo (If-Match) |
| `GET finance/close-rules` | Tiempos permitidos y festivos |
| `PUT finance/close-rules/ground-time/{category}` | Cambiar un tiempo permitido |
| `POST finance/close-rules/holidays` | Agregar un festivo |
| `DELETE finance/close-rules/holidays/{id}` | Quitar un festivo |

## Consecuencias

- El agente ya no tiene que acordarse del nocturno, el festivo, el tiempo extra ni la demora: llegan marcados y OCC los confirma o los corrige con motivo.
- Finanzas valora exactamente lo que OCC aprobó, y ve de dónde salió cada recargo.
- Un cambio de las reglas de Finanzas no revalora operaciones ya entregadas, porque el tiempo permitido queda congelado en su evidencia.

**Queda fuera de este bloque**
- **Tipo de avión de cada escala.** Hoy solo lo trae el seed de Development: ni el alta manual, ni la importación de AeroDataBox, ni la tablet lo registran. Sin tipo no hay categoría, así que el tiempo extra automático no aplica (el detalle de cierre lo indica como «Sin tiempo permitido para esta categoría») y OCC lo agrega a mano con motivo. Capturar el tipo de avión es el siguiente paso.

- **Corrección de datos capturados por OCC** (pasajeros, matrícula). Sigue siendo devolver la operación al agente, porque cambia formularios ya firmados.
- **Calendario de festivos por país o estación.** Hoy es uno solo, de República Dominicana.
- **Recalcular un recargo automático cuando el agente corrige tras una devolución.** Se agregan los que falten; los que ya no apliquen los quita OCC.
