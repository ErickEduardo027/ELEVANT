# ADR-0024: Expediente de permisos y ciclo cronológico del contrato

## Estado

Accepted — 2026-11-02.

## Contexto

La solicitud comercial solo pasaba de pendiente a aprobada o rechazada. El contrato se volvía
`Active` en cuanto Finanzas aprobaba la versión, antes de que nadie firmara, y `SignedOn` se
fijaba en esa fecha. Los estados `Suspended`, `Terminated` y `Expired` existían, pero nada los
asignaba, y los eventos de estado se guardaban sin que nadie los mostrara. Se pidió un ciclo
cronológico de licencias y permisos para integrar a las aerolíneas en los servicios, en sus dos
sentidos:
- el expediente de permisos de la aerolínea;
- el ciclo de vida del contrato.

## Decisión

### Expediente de permisos

`commercial.airline_permits` guarda por aerolínea:
- el tipo: permiso de operación (JAC), certificado de explotador (IDAC/AOC), póliza de seguro u
  otro;
- el número, el emisor, la fecha de emisión y la de vencimiento;
- el documento escaneado (PDF, JPG o PNG en el almacén privado de medios, propósito
  `airline-permit`), que es opcional;
- la revisión de Contratos.

**Flujo:**
- La aerolínea envía el permiso desde su portal (`POST airline/permits`). No se acepta un permiso
  vencido ni uno emitido en el futuro.
- Contratos lo verifica o lo rechaza con motivo (`POST contracts/permits/{id}/review`, permiso
  `contracts.permits.verify`).
- «Vigente», «por vencer» (30 días o menos) y «vencido» se calculan con la fecha; no se guardan.
- El documento solo lo leen Contratos y la aerolínea que lo subió. La limpieza de medios
  huérfanos lo conserva.

> **Actualización (7 de noviembre de 2026).** Solo un representante o un firmante de la
> aerolínea envía el permiso, y el envío acepta una `Idempotency-Key`. Un documento subido hace
> más de seis días se vuelve a subir (`document_expired`). La revisión solo aplica a un permiso
> enviado (`review_closed`). Contratos revoca con motivo un permiso verificado
> (`POST contracts/permits/{id}/revocation`): queda `Revoked`, conserva su verificación original
> y, en la misma transacción, suspende los contratos activos que se quedan sin un permiso de
> operación usable. Ver
> [ADR-0038](0038-preoperation-contract-lifecycle-permits-master-data-and-workforce-readiness.md).

### Activación

Un contrato pasa a `Active` solo cuando se cumplen las tres condiciones:
1. Finanzas aprobó la versión vigente o la próxima.
2. Ambas partes firmaron esa versión.
3. La aerolínea tiene un permiso de operación **verificado y vigente**.

La comprobación (`ContractActivation`) se hace en tres momentos: al registrar la segunda firma,
al verificar un permiso de operación y en el barrido periódico. `SignedOn` es la fecha real de
la segunda firma. Hasta entonces el contrato sigue en `Draft`; la interfaz lo muestra como
«Pendiente de firmas y permiso».

La aprobación de la *solicitud* no puede exigir el permiso: la aerolínea todavía no tiene cuenta
del portal, porque se aprovisiona después. El permiso condiciona la activación del contrato, que
es lo que habilita operaciones (OCC solo planifica contratos `Active`).

> **Actualización (7 de noviembre de 2026).** Las dos firmas deben ser sobre la misma huella, y
> `SignedOn` es el día hábil de la primera activación: una renovación ya no lo mueve. La fecha de
> firma de cada versión es la de su segunda firma. Ver
> [ADR-0038](0038-preoperation-contract-lifecycle-permits-master-data-and-workforce-readiness.md).

### Acciones manuales de Contratos

`POST contract-versions/{id}/lifecycle` requiere el permiso `contracts.agreements.lifecycle`, un
motivo y el estado que el usuario vio. Si el estado cambió entre tanto, responde 409.

| Acción | Desde | Hacia | Regla |
|---|---|---|---|
| Suspender | Activo | Suspendido | — |
| Reactivar | Suspendido | Activo | Necesita un permiso usable y una versión vigente |
| Terminar | Activo, suspendido o vencido | Terminado | Fija `TerminatedOn`; es definitivo |
| Renovar | Activo, suspendido o vencido | (sin cambio) | Copia la última versión aprobada en un borrador con la nueva vigencia; sigue el flujo normal de Finanzas y firmas |

> **Actualización (6 de noviembre de 2026).** «Terminar» también vale para un contrato `Draft`
> que nunca se activó («Descartar contrato»), y toda terminación cierra como `Rejected` sus
> versiones abiertas. La línea de tiempo que lee la aerolínea omite el motivo interno de una
> devolución de Finanzas. Ver
> [ADR-0037](0037-commercial-cycle-requests-drafts-amendments-and-portal-accounts.md).

> **Actualización (7 de noviembre de 2026).** «Terminar» un contrato activo o suspendido respeta
> el preaviso firmado: exige una fecha efectiva de al menos hoy más los días de preaviso, o una
> causa inmediata (incumplimiento o mutuo acuerdo). `TerminatedOn` es el primer día sin
> cobertura; con una fecha futura el contrato sigue en su estado hasta ese día, y la terminación
> se puede cancelar antes (`CancelTermination`). Terminar cierra los borradores y las versiones
> aprobadas sin las dos firmas. Renovar parte de la versión en vigor, también desde `Expired`,
> copia sus recargos negociados, exenciones y paquetes, y se rechaza mientras otra versión aprobada
> espera las firmas. Contratos retira con motivo una versión aprobada que no firmaron ambas partes
> (`Rejected`). Ver
> [ADR-0038](0038-preoperation-contract-lifecycle-permits-master-data-and-workforce-readiness.md).

### Barrido periódico (`ContractLifecycleWorker`, cada hora e idempotente)

- Activa los contratos que ya cumplen las tres condiciones.
- Marca `Expired` el contrato sin una versión aprobada vigente hoy o más adelante.
- Suspende el contrato activo de una aerolínea que tuvo un permiso de operación verificado y ya
  no tiene ninguno vigente. Al verificarse uno nuevo, el contrato se reanuda solo.
- Avisa una sola vez, 30 días antes del vencimiento de un permiso o de la versión vigente, a
  Contratos (notificaciones del departamento) y al portal de la aerolínea.

Todo cambio escribe un `ContractStatusEvent` con motivo y actor; el sistema figura como actor
nulo.

> **Actualización (7 de noviembre de 2026).** El barrido también termina los contratos en su
> fecha de terminación programada y reintenta cada pasada la renovación automática que no pudo
> iniciarse. «Versión vigente» es ahora una versión que rige: aprobada y firmada por ambas partes,
> o la heredada. El aviso de vencimiento del contrato llega los `RenewalNoticeDays` que firmó su
> versión (30 si no tiene); el de un permiso sigue en 30 días. Un permiso revocado cuenta como un
> permiso que la aerolínea tuvo. La aerolínea recibe además esos avisos y las suspensiones por
> correo. Ver
> [ADR-0038](0038-preoperation-contract-lifecycle-permits-master-data-and-workforce-readiness.md).

### Línea de tiempo

`GET contract-versions/{id}/timeline` une, en orden cronológico, estos hechos:
- la solicitud y sus cambios de estado;
- los borradores y las aprobaciones o devoluciones de Finanzas;
- las firmas;
- los permisos y sus revisiones;
- los cambios de estado del contrato;
- el vencimiento previsto.

La consultan Contratos (Private Web) y la aerolínea dueña (portal). La aerolínea no ve los nombres
del personal interno.

> **Actualización (7 de noviembre de 2026).** La línea de tiempo muestra también la revocación de
> un permiso y la terminación programada, y expone `terminatesOn` y `earliestTerminationOn`. Ver
> [ADR-0038](0038-preoperation-contract-lifecycle-permits-master-data-and-workforce-readiness.md).

## Consecuencias

- **Contratos anteriores al expediente:** los contratos activos de aerolíneas que nunca
  registraron un permiso no se suspenden automáticamente (fase de expansión). Cuando la
  aerolínea registra un permiso verificado, pasan a depender de él.
- **Migración:** `AddAirlinePermitsAndContractLifecycle` guarda el expediente y la marca del
  aviso de vencimiento. Su `Down` se niega si ya hay datos (THROW 52333).
- **Permiso de lectura:** el código heredado `contracts.agreements.read` también concede
  `contracts.permits.read`, así que quien lee contratos ve los permisos que los condicionan.
