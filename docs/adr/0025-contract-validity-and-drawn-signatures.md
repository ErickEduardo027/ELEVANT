# ADR-0025: Vigencia confirmada por Contratos, firma dibujada y orden de firma

## Estado

Accepted — 2026-11-03.

## Contexto

Fase 2 del ciclo operativo (pre-operación). Después de la aprobación de tarifas por Finanzas
(ADR-0016) el contrato debía pasar a la firma de la aerolínea y de Contratos y, con ambas, entrar
en vigencia (ADR-0024). Faltaban cuatro piezas:
- Contratos no tenía un paso para fijar la vigencia, la renovación y la terminación: solo
  existían `ValidFrom`/`ValidTo`, propuestas en el borrador antes de Finanzas, y el texto libre de
  `Terms`.
- La firma era un nombre escrito con la casilla «Acepto», sin firma dibujada.
- No había un orden de firma.
- El código del contrato seguía siendo `DRAFT-…` aunque ya estuviera firmado, y nadie recibía el
  PDF firmado.

## Decisión

### Paso de vigencia, después de Finanzas y antes de las firmas

`PUT contract-versions/{id}/validity`, con el permiso nuevo `contracts.agreements.validity`
(«Fijar vigencia y renovación»). Solo vale para una versión `Approved` que nadie firmó todavía;
`ExpectedDocumentSha256` es el control de concurrencia: si el contenido cambió, responde 409.

**Qué fija** (columnas nuevas *nullable* de `commercial.contract_versions`):
- `ValidFrom` y `ValidTo` (obligatoria). Un contrato nuevo empieza hoy o después; una renovación
  puede empezar antes solo si es posterior a la versión que renueva.
- `RenewalMode`: `Manual` o `Automatic`, con `RenewalTermMonths` (1–60, obligatorio en
  automática) y `RenewalNoticeDays` (0–180).
- `TerminationNoticeDays` (0–180) y `TerminationTerms` (hasta 4.000 caracteres).
- `ValidityConfirmedAt` / `ValidityConfirmedByAccountId`.

Si Contratos mueve el inicio, la versión que esta reemplaza (Finanzas ya la recortó al aprobar)
termina la víspera del nuevo inicio. Los paquetes aprobados por Finanzas deben seguir cubriendo
las fechas (`packages_out_of_range`). Finanzas ve las fechas propuestas como lectura.

**Huella del documento:** los términos de vigencia entran en el SHA-256 firmado solo cuando
existen. Así, las versiones firmadas antes de este ADR conservan exactamente su huella.

### Código definitivo

Al confirmar la vigencia, un contrato con código `DRAFT-…` recibe `CTR-{año}-{n:0000}` de la
secuencia `commercial.contract_code_seq`. Se asigna **antes** de firmar, porque el código forma
parte del contenido firmado: cambiarlo después invalidaría la huella de las firmas.

### Firma dibujada y orden

`SignContractRequest.SignatureImagePng` (obligatoria): PNG real (cabecera mágica), de hasta
256 KB y 1200×400 px, en base64 o como *data URL* de un canvas. Se guarda en
`contract_signatures.signature_image` con su SHA-256; la imagen no forma parte de la huella del
documento. Las firmas anteriores quedan sin imagen y el PDF muestra el nombre escrito.

- Nadie firma sin vigencia confirmada: 409 `validity_pending`.
- **Primero firma la aerolínea** y después AVIAM contrafirma: 409 `airline_signature_pending`.
- `SignableBy` refleja ambas reglas. El PDF dibuja cada firma sobre el nombre, el cargo, la
  fecha UTC y la comprobación de la huella; la sección 2 imprime la renovación y la terminación.

### Renovación

- **Automática:** el barrido diario (`ContractLifecycleWorker`) crea por sí solo la versión de
  renovación `RenewalNoticeDays` días antes del fin, una sola vez (`RenewalStartedAt`), con las
  tarifas y términos de la anterior y la vigencia siguiente de `RenewalTermMonths` meses. Esa
  versión vuelve a pasar por Finanzas, por la vigencia y por ambas firmas. **Nada se prorroga en
  silencio**: el contenido firmado y las tarifas son inmutables.
- **Manual:** Contratos la inicia con la acción `Renew`, como hasta ahora.

### Correo con el PDF firmado

Cuando un contrato se activa (o cuando una renovación de un contrato ya activo recibe su segunda
firma), se encola `EmailPurpose.ContractActivated` para las cuentas activas del portal de la
aerolínea y para los firmantes de AVIAM. La bandeja guarda solo la referencia
`contract-version:{publicId}` (`infra.email_outbox.attachment_reference`); el
`EmailDispatchWorker` genera el PDF al enviar (`IEmailAttachmentResolver`) y `SmtpEmailSender`
lo adjunta. El archivo nunca se almacena en la bandeja.

### Lo que no cambia

El reemplazo de versiones anteriores sigue ocurriendo al aprobar Finanzas: las enmiendas de
paquetes con fecha retroactiva (ADR-0018) y la valoración de prefacturas dependen de él.

## Consecuencias

- Una versión aprobada antes de este ADR y todavía sin firmas necesita que Contratos confirme su
  vigencia antes de poder firmarse.
- La migración `AddContractValidityAndDrawnSignatures` solo añade columnas, restricciones y la
  secuencia; no hay datos de negocio en ella.
- `ContractVersionStatus.Rejected` sigue reservado: ningún flujo lo asigna.
