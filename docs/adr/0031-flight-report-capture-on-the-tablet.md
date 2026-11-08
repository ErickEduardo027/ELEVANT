# ADR-0031: Reporte de Vuelo en la tablet, sin conexión y escrito una sola vez

## Estado

Accepted — 2026-11-04.

## Contexto

Fase 3 del ciclo operativo, bloque 3: la ejecución en la tablet.

**El problema de hoy.** El agente de operaciones de AVIAM completa a mano el «Reporte de Vuelo» (F-OCC-AVL-6.2.12/A9, rev. 2, junio 2023), que contiene:
- datos generales del vuelo;
- 10 puntos SÍ/NO de llegada;
- los tiempos de «Operación en posición» y de los servicios (desde bloqueo hasta push-back);
- el walk-around;
- 11 puntos SÍ/NO de retroempuje;
- IATA delays y observaciones.

Luego copia los mismos datos en otros documentos, un Excel y un correo («triple trabajo»).

**Restricciones del entorno**
- La señal en rampa es mala, y un tiempo perdido no se puede reconstruir.
- La radio va congestionada, así que las desviaciones deben llegar a OCC por otro camino.

**Huecos de ELEVANT**
- La tabla `ops.operation_milestones` existía, pero nada la usaba.
- No había pasajeros ni MTOW.
- No existía el concepto de código IATA de demora.
- Solo podía entregarse a OCC una operación con el servicio PASSENGER-BRIDGE, porque la entrega exige un checklist y este solo se creaba para el puente.

## Decisión

### Hitos del Reporte de Vuelo

**Catálogo.** `FlightReportMilestones` reproduce literalmente las filas con hora del formulario, en cuatro fases:

| Fase | Hitos |
|---|---|
| Llegada | Bloqueo, walk-around (inicio y término), escaleras/jetbridge, 2.ª escalera, equipo de descarga |
| En posición | Aduanas y los tiempos de la columna de servicios (hojas, make-up, subiendo, baños, agua, ambu-lift, D.N.C.D.) |
| Salida | Abordaje y cierres de puertas |
| Retroempuje | Retiro de escalera o JB, push-back |

El catálogo se replica en `packages/api-client` (`FLIGHT_REPORT_MILESTONES`), y el servidor rechaza cualquier código que no esté en él.

**Endpoint.** `PUT ramp/operations/{id}/milestones/{code}` con `{ occurredAt }`.
- Va con recibo idempotente por dispositivo, como todos los comandos de rampa.
- Lo ejecuta solo el agente asignado, con la operación iniciada y sin entregar.
- **Hora aceptada:** hasta 24 horas atrás, para que la cola sin conexión llegue tarde con la hora en que el agente tocó, y como mucho 2 minutos en el futuro, por desfase de reloj.
- Volver a enviar un hito corrige su hora.
- Se audita `ramp.operation.milestone.recorded`, y avisa `ramp_operations`, `occ_planning` y `occ_review` (ADR-0029).

> **Actualización (8 de noviembre de 2026).** La hora de un hito ya no se acepta por un límite fijo de 24 horas: debe caer en la ventana de la operación, desde el inicio o la llegada registrada, lo que ocurrió primero, hasta su cierre (ahora, la entrega mientras OCC revisa o la primera entrega en una ronda de corrección), con 2 minutos de tolerancia (`time_outside_operation_window`). El bloqueo nunca va después del push-back (`milestone_out_of_order`). La misma ventana vale para los daños, las incidencias y los servicios. Mientras OCC revisa, el servidor acepta los hitos, los daños y los datos del vuelo capturados antes de la entrega y recalcula la evidencia. Ver [ADR-0039](0039-operation-planning-coverage-offline-tablet-occ-review-and-reports.md).

### Datos del vuelo escritos una vez

**Campos.** `ops.ground_operations` gana `passengers_in`, `passengers_out` y `mtow_kg`, con restricciones de rango: 0–999 pasajeros y 1 000–700 000 kg.

**Endpoint.** `PUT ramp/operations/{id}/flight-data`. Su corrección de matrícula actualiza la del turnaround, de modo que todos los formularios la toman de un único sitio.

**Lectura.** La consulta de la tablet (`GET ramp/operations`) devuelve los hitos, en el orden del formulario, y los datos del vuelo.

> **Actualización (8 de noviembre de 2026).** «Datos del vuelo» captura también el tipo de avión, opcional (`aircraftTypeId`), de la lista `GET ramp/aircraft-types`. Sin el campo se conserva el tipo actual y el hash del recibo es el de la versión anterior; el tipo queda fijo desde la primera entrega (`aircraft_type_locked`). La consulta de la tablet trae las operaciones activas y las aprobadas de las últimas 48 horas, con las activas primero, y una operación iniciada sigue en el alcance de su agente aunque cambien su posición o su terminal. Ver [ADR-0039](0039-operation-planning-coverage-offline-tablet-occ-review-and-reports.md).

### Desviación con código IATA

**Tipo de incidencia.** `Deviation` exige un `delayCode` del catálogo `IataDelayCodes`, los códigos AHM 730 que se observan en rampa. Los demás tipos no lo llevan.

**Alerta a OCC.** La desviación se notifica como `deviation_reported`, que AVIAM Web ya muestra como alerta.

**Envío.** Usa la cola sin conexión que ya tienen las incidencias.

### Un checklist de ejecución por operación

Al asignar, OCC crea un checklist según el contrato:
- **con puente** (PASSENGER-BRIDGE): el checklist del puente (`TURNAROUND-BASE`);
- **sin puente:** el del Reporte de Vuelo (`FLIGHT-REPORT`), con los 10 puntos de llegada y los 11 de retroempuje literales.

Los almacenes de checklist y de entrega aceptan cualquiera de los dos, así que ya se puede entregar una operación sin puente.

**Plantillas por entorno.** Si la estación no tiene publicada la plantilla `FLIGHT-REPORT`, la asignación sigue como antes. El seed de Development la incluye; en Production la plantilla se publica como dato de referencia, igual que la del puente.

### Tablet

**Cola persistente.** Vive en `src/synchronization/flight-report-outbox.ts`, por cuenta.
- Cada toque se guarda en el dispositivo antes de enviarse.
- Se envía en orden, con su clave idempotente estable.
- Un toque nuevo del mismo hito sustituye al que aún no salió.
- Si el servidor rechaza un elemento, este queda «por revisar» y nunca se reintenta a ciegas.

**Envío.** El envío se dispara al tocar, al recuperar la señal (`@react-native-community/netinfo`) y desde «Sincronización».

> **Actualización (8 de noviembre de 2026).** La misma cola lleva ahora el inicio, las transiciones de servicio, los cargos, el envío del checklist y el chat, en orden FIFO por operación. El inicio y los servicios viajan con la hora del toque (`startedAt` y `occurredAt`), corregida con el reloj de ELEVANT que la tablet toma de la cabecera `Date`. La cola se vacía también al abrir la app, al volver a primer plano y cada minuto. Un `401`, un `403` o el cierre de sesión ya no borran lo que ELEVANT no confirmó: queda en la tablet ligado a su cuenta. La entrega no sale mientras quede algo pendiente o rechazado de la operación, ni con la Orden de Servicio sin las dos firmas sobre su contenido actual. Ver [ADR-0039](0039-operation-planning-coverage-offline-tablet-occ-review-and-reports.md).

**Pantalla de operación por fases**
- Barra de progreso de cuatro fases.
- Botones de hito de al menos 72 dp que se usan con guantes.
- «Ahora» con vibración (`expo-haptics`) y ajuste de minutos.
- Cada valor muestra su estado: «En el dispositivo», «Confirmado» o «Rechazado», con color, icono y texto.

**Otras piezas**
- **Datos del vuelo:** tarjeta propia en la operación.
- **Desviación:** botón rojo de acción rápida.
- **Indicador de conexión** siempre visible.
- **«Sincronización»** deja de ser un marcador y lista los pendientes y los rechazados.

**Sistema de diseño.** `src/theme/tokens.ts` define espaciado, radios, tamaños táctiles mínimos, tipografía y tonos de sincronización.

## Consecuencias

**Ventajas**
- El agente escribe cada dato una vez, sin papel, y no pierde ningún tiempo por falta de señal.
- OCC recibe las desviaciones en vivo.
- Las operaciones sin puente ya se pueden entregar.

**Límites**
- El catálogo de hitos y el de códigos IATA viven en dos sitios (Application y api-client), y deben cambiarse juntos. Las pruebas de ambos lados fijan el número de hitos y su formato.

**Pendiente para los bloques 4 y 5**
- Las fotos del walk-around, porque necesitan el flujo de medios a S3 y la subida sin conexión.
- El pre-uso del puente por cobertura.
- Llevar los hitos y los datos del vuelo a la evidencia congelada de la entrega y a la Revisión de OCC.
- Las firmas y los PDF.
