# ADR-0046: Sesiones renovables en las tablets compartidas

## Estado

Accepted — 2026-11-19.

## Contexto

En la corrida del VPS del 16 de noviembre de 2026 (hallazgo S3), la sesión de la tablet terminó dos veces a los 15 minutos. La app de rampa descarta el refresh token que recibe al iniciar sesión, así que cuando vence el access token (`Authentication:AccessTokenMinutes`, 15 minutos) el agente tiene que volver a entrar. Sin señal, pasado ese plazo la tablet ni siquiera encola lo que el agente registra.

[ADR-0021](0021-rotating-refresh-tokens.md) ya permite renovar la sesión hasta cerrarla, y AVIAM Web lo hace. Pero el registro de la tablet (2-N02 de [ADR-0038](0038-preoperation-contract-lifecycle-permits-master-data-and-workforce-readiness.md)) tomaba el inicio de la sesión del `iat` del access token y suponía que la app nunca renueva. Si la tablet renovara con esa regla, cada token nuevo contaría como otra sesión: cerraría y reabriría el vínculo de la tablet (`mobile_device.binding_renewed`), avisaría a OCC y haría que el cierre de sesión respondiera `version_conflict` sin liberar la tablet.

Se evaluó poner un tope absoluto a la sesión de las cuentas de rampa, de 16 horas desde el inicio. Erick decidió el 2026-11-19 no ponerlo: la tablet se renueva como AVIAM Web.

## Decisión

**1. El inicio de la sesión es `auth_time`.**
- Todo access token lleva `auth_time`, una NumericDate en segundos enteros como `iat`. Al iniciar sesión vale lo mismo que `iat`.
- La renovación conserva el inicio de la sesión:
  - `POST auth/session/refresh` rota el refresh token, y `EfRefreshTokenStore.RotateAsync` devuelve en `RefreshTokenRotation.SessionStartedAt` cuándo empezó su familia: el `issued_at` más antiguo de la familia (`MIN(issued_at)` por `family_id`), que es el inicio de sesión.
  - `RefreshSessionHandler` pasa ese instante al emisor con la sobrecarga `IAccessTokenIssuer.IssueAsync(actor, sessionStartedAt, ct)`. La implementación por defecto de esa sobrecarga emite el token como en un inicio de sesión.
  - `JwtAccessTokenIssuer` escribe ese instante como `auth_time`. El `iat` avanza con cada renovación y el `auth_time` no cambia. El `auth_time` nunca es posterior al `iat` del propio token: si otra instancia guardó un inicio que el reloj de esta aún no alcanza, vale el `iat`.
- El registro de la tablet (`PUT mobile/device`) toma el inicio de la sesión de `auth_time` y, si el token no lo trae, de `iat` (`MobileDeviceSession.StartedAt`). Así, renovar el token ya no abre un vínculo nuevo. Un inicio de sesión nuevo sí lo abre, como pide 2-N02.
- No hay migración ni cambios en el modelo EF ni en OpenAPI. `auth_time` viaja dentro del JWT y la respuesta de sesión no cambia.

**2. La tablet se renueva como AVIAM Web, sin tope absoluto.**
- Por decisión de Erick del 2026-11-19, la sesión de una cuenta de rampa en una tablet compartida no tiene un tope de horas ni de turno. No existe `Authentication:RampMobileSessionMaxHours` y nada revoca una familia por su antigüedad.
- La tablet guarda el refresh token del inicio de sesión y renueva el access token antes de que venza, con las reglas de [ADR-0021](0021-rotating-refresh-tokens.md). Solo renueva si el JWT trae `auth_time`: frente a una API anterior a este cambio, cada renovación abriría un vínculo nuevo.
- Los controles son los de cualquier sesión:
  - **Rotación con detección de reuso.** Un refresh token ya reemplazado que se presenta otra vez fuera del margen de 60 segundos revoca toda la familia.
  - **Inactividad.** El refresh token caduca a los 30 días sin uso.
  - **Cierre de sesión.** Revoca la familia (`POST auth/session/logout`, `endSession` en el cliente compartido).
  - **Revocación desde OCC.** Revocar la tablet rota el sello de seguridad de la cuenta que la tenía, salvo que esa cuenta ya hubiera cerrado sesión en ella. El access token se rechaza en la petición siguiente y la renovación también.
  - **Revalidación.** Cada renovación revalida la cuenta igual que un inicio de sesión: estado, membresías, alcance y sello de seguridad. Un cambio de contraseña, una desactivación o una baja terminan la sesión.

**3. Respuesta de renovación perdida (D-S3b).**
- El servidor no cambia. Si la respuesta de una renovación no llega a la tablet, la tablet conserva un refresh token que ya fue reemplazado:
  - durante 60 segundos, presentarlo otra vez responde `409 refresh_rotated` y no revoca nada;
  - después cuenta como reuso y revoca la familia, así que la sesión termina y el agente vuelve a entrar.
- La tablet documenta y prueba ese caso. No hay tolerancia adicional en el servidor.
- En la tablet, la respuesta perdida es un fallo de red: la sesión sigue con su access token y la siguiente renovación espera 30 segundos. El `409` que llega dentro del minuto de margen no trae nada nuevo que guardar, así que la sesión sigue igual y la siguiente renovación vuelve a esperar 30 segundos. Mientras tanto, lo que un access token ya vencido no puede hacer falla como una solicitud que se puede reintentar (`request_failed`), nunca como un cambio de la operación (`conflict`). Pasado el margen, el `401` termina la sesión. Lo que el agente registró queda en la tablet ligado a su cuenta (3-N12) y sale cuando vuelve a entrar ([prueba](../../frontend/mobile-agent/tests/mobile-session-renewal.test.js)).

**4. Cómo renueva la tablet.**
- **Lo que guarda.** El sobre de SecureStore pasa a la versión 2 y lleva el refresh token junto al access token; el sobre v1 de la APK anterior se sigue leyendo, sin refresh. La metadata no secreta de AsyncStorage pasa a la versión 2 y dice hasta cuándo renueva el refresh token (`refreshExpiresAt`), o `null` si la sesión no puede renovarse. Un inicio de sesión de otra cuenta reemplaza ambos sobres, refresh token incluido.
- **Cuándo renueva.** La siguiente solicitud renueva el access token en su último minuto o ya vencido, igual que AVIAM Web. Una sola renovación en curso atiende a todas las solicitudes que la esperan, y un refresh token ya reemplazado nunca se vuelve a presentar. Todo se compara con el reloj de ELEVANT (3-N18): un reloj de la tablet adelantado no impide entrar, y un desfase viejo solo adelanta la renovación, porque la respuesta corrige el reloj.
- **Solo con `auth_time`.** La tablet lee el `auth_time` del JWT sin verificar la firma, porque solo decide si renovar. Sin él, la sesión termina con su access token, como antes, y el refresh token se guarda solo para terminar la familia al cerrar sesión.
- **Según la respuesta.**
  - `200`: la credencial nueva, de la misma cuenta, reemplaza a la anterior con la misma revisión de la sesión. Las cachés, los borradores, las reservas y el vínculo de la tablet siguen igual.
  - `409`: la tablet relee lo guardado.
  - `401`: la sesión termina con esa causa (`session_expired`, estado 401) y conserva lo que el agente registró.
  - Sin señal, `429` o `5xx`: la sesión sigue con su credencial y la siguiente renovación espera 30 segundos. La solicitud sale con esa credencial: sin señal falla como sin conexión y las lecturas usan su caché.
- **El `401` de una solicitud.** Fuerza una renovación y la solicitud se repite una vez, los comandos con su misma clave. Si la credencial ya cambió, se repite sin renovar. Una credencial que ELEVANT rechaza recién renovada termina la sesión, para no entrar en un ciclo.
- **Sin red.** Encolar un toque, guardar un borrador y reservar una observación de asistencia solo necesitan la identidad de la sesión guardada en la tablet. Una sesión cuyo access token venció sigue activa mientras su refresh token esté vigente.
- **La tablet y la presencia.** La confirmación del registro de la tablet y la versión de la liberación se atan a la sesión, no al token, así que sobreviven a la renovación. La presencia identifica su lease por la sesión y la cuenta, y cada latido lee el token vigente. Los hubs de SignalR piden el token en cada conexión y toman el renovado.
- **Cerrar sesión.** Libera la tablet y termina la familia en ELEVANT (`endSession`), cada uno con un límite de 5 segundos. Si el access token ya venció o está en su último minuto, antes lo renueva una vez, aunque sea durante la pausa de 30 segundos, y espera esa renovación 5 segundos como máximo: con el token vencido ELEVANT rechazaría la liberación y el vínculo seguiría abierto. La familia termina después de esa renovación, nunca mientras va en camino, porque la rechazaría. Si la renovación no termina, la liberación sale con la credencial que guarda la tablet. Si la tablet no conserva un inicio de sesión, por ejemplo porque falla su registro, también termina la familia recién emitida.

**5. Lo que se marca después del fin de la sesión (hallazgo N5).**
- Una sesión que termina sin que el agente cierre sesión deja en AsyncStorage el marcador no secreto `elevant:mobile:ended-session:v1` con la cuenta, la causa y la hora del fin, según el reloj de ELEVANT. Las causas son `expired` (venció sin poder renovarse), `refused` (ELEVANT rechazó la renovación o la credencial con `401`) y `forbidden` (`403`, o la cuenta ya no califica). Una sesión vencida terminó cuando venció su access token, no cuando la tablet lo notó.
- La pantalla del checklist fija la cuenta al cargar el borrador y guarda siempre para ella (`writeRampChecklistDraftForAccount`). Guarda mientras la sesión de esa cuenta está activa, también si una renovación cambió su credencial. Sin sesión, guarda si el marcador nombra esa cuenta y no pasaron más de 2 horas desde el fin (D-N5), también si la sesión termina mientras el guardado espera al almacenamiento. Con otra cuenta activa, tras un cierre de sesión a propósito o fuera de ese plazo, no guarda.
- El servicio responde `saved` o `kept-until-sign-in`. Solo lanza `storage_unavailable` ante un fallo real del almacenamiento, y `session_expired` cuando el borrador ya no puede guardarse; nunca un `cancelled` silencioso.
- El marcador se borra al cerrar sesión a propósito y tras un inicio de sesión confirmado; un intento fallido lo deja. Las respuestas guardadas vuelven cuando la misma cuenta inicia sesión.
- El esquema del borrador no cambia. Los comandos de la cola siguen sin aceptarse sin sesión (D-N5): el checklist se envía después de volver a entrar.

## Compatibilidad y despliegue

- El cambio es aditivo. Un cliente que ignora `auth_time` funciona igual; AVIAM Web y el portal no cambian.
- `development-delivery.yml` publica la API antes que las webs, y la APK se publica a mano. Una APK que renueva, frente a una API anterior a este cambio, no renueva y vuelve a pedir el acceso al vencer el token, como hasta ahora.
- La APK ya instalada no guarda el refresh token. Hasta que se instale la nueva, la tablet sigue con la sesión de 15 minutos. La APK nueva lee la sesión que dejó la anterior y la deja terminar con su access token; el siguiente inicio de sesión ya renueva.
- Los tokens emitidos antes del despliegue no traen `auth_time`, y el registro de la tablet usa su `iat`, como antes. Esos tokens vencen a los 15 minutos.

## Consecuencias

- Una tablet compartida que queda abierta sigue usable hasta que alguien cierra la sesión, OCC la revoca o pasan 30 días sin uso. El riesgo queda en [riesgos y controles pendientes](../../Vault/10-seguridad/riesgos-y-controles-pendientes.md).
- Durante las 2 horas siguientes al fin de una sesión, quien tenga la tablet puede seguir marcando el checklist que esa cuenta dejó abierto. Esas respuestas solo quedan en la tablet: salen cuando esa cuenta vuelve a entrar, las ve en su checklist y lo envía.
- `auth_time` no sirve para identificar una sesión: va en segundos enteros, y el token del inicio de sesión se firma unos milisegundos antes de que se cree la familia de refresh. Por eso el `auth_time` de los tokens renovados puede ser un segundo posterior al del primer token. Aun así, nunca supera el instante en que se abrió el vínculo de la tablet, que se registra después del inicio de sesión, así que no lo renueva.
- Cada renovación hace una consulta más: el mínimo de `issued_at` de la familia, que usa el índice `(family_id, revoked_at)`.
- El inicio de una familia sale de sus filas. Hoy solo se borra el token nuevo de una rotación que perdió la carrera, nunca el primero de la familia; una limpieza futura de `iam.refresh_tokens` tiene que conservar la primera fila de cada familia viva.

## Fuera de alcance

- Un tope por turno o por antigüedad de la sesión, y un bloqueo de la app por inactividad.
- Tolerancia del servidor a una respuesta de renovación perdida.
- Que «Liberar» en OCC cierre la sesión del agente. Liberar sigue sin cerrar sesiones; revocar sí las cierra. Tras «Liberar», la lectura de la asistencia vuelve a registrar la tablet, como una escritura.
- Subir la duración del access token en el VPS, que decide el operador.
