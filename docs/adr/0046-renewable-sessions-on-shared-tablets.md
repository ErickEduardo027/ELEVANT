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

## Compatibilidad y despliegue

- El cambio es aditivo. Un cliente que ignora `auth_time` funciona igual; AVIAM Web y el portal no cambian.
- `development-delivery.yml` publica la API antes que las webs, y la APK se publica a mano. Una APK que renueva, frente a una API anterior a este cambio, no renueva y vuelve a pedir el acceso al vencer el token, como hasta ahora.
- La APK ya instalada no guarda el refresh token. Hasta que se instale la nueva, la tablet sigue con la sesión de 15 minutos.
- Los tokens emitidos antes del despliegue no traen `auth_time`, y el registro de la tablet usa su `iat`, como antes. Esos tokens vencen a los 15 minutos.

## Consecuencias

- Una tablet compartida que queda abierta sigue usable hasta que alguien cierra la sesión, OCC la revoca o pasan 30 días sin uso. El riesgo queda en [riesgos y controles pendientes](../../Vault/10-seguridad/riesgos-y-controles-pendientes.md).
- `auth_time` no sirve para identificar una sesión: va en segundos enteros, y el token del inicio de sesión se firma unos milisegundos antes de que se cree la familia de refresh. Por eso el `auth_time` de los tokens renovados puede ser un segundo posterior al del primer token. Aun así, nunca supera el instante en que se abrió el vínculo de la tablet, que se registra después del inicio de sesión, así que no lo renueva.
- Cada renovación hace una consulta más: el mínimo de `issued_at` de la familia, que usa el índice `(family_id, revoked_at)`.
- El inicio de una familia sale de sus filas. Hoy solo se borra el token nuevo de una rotación que perdió la carrera, nunca el primero de la familia; una limpieza futura de `iam.refresh_tokens` tiene que conservar la primera fila de cada familia viva.

## Fuera de alcance

- Un tope por turno o por antigüedad de la sesión, y un bloqueo de la app por inactividad.
- Tolerancia del servidor a una respuesta de renovación perdida.
- Que «Liberar» en OCC cierre la sesión del agente. Liberar sigue sin cerrar sesiones; revocar sí las cierra.
- Subir la duración del access token en el VPS, que decide el operador.
