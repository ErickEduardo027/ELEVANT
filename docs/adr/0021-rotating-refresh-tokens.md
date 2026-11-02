# ADR-0021: Sesiones que duran hasta cerrar sesión (refresh token rotativo)

## Estado

Accepted — 2026-11-02.

## Contexto

El access token dura 15 minutos (`Authentication:AccessTokenMinutes`, con un tope validado de
60) y no existía forma de renovarlo. Private Web cerraba la sesión al llegar a `expiresAt`, así
que AVIAM pedía iniciar sesión cada 15 minutos. Se pidió que un solo inicio de sesión baste.

Subir la duración del access token no resuelve el problema y debilita la revocación: cada
petición vuelve a comprobar el sello de seguridad, pero un token de larga vida seguiría
viajando durante horas.

## Decisión

### API

- **Sin cambios en el access token:** sigue durando 15 minutos y comprobando el sello de
  seguridad en cada petición.
- **Refresh token nuevo:** `POST auth/session` devuelve además `refreshToken` y
  `refreshExpiresAt`. Son 32 bytes aleatorios en Base64URL; en `iam.refresh_tokens` solo se
  guarda su SHA-256.
- **Renovación:** `POST auth/session/refresh` cambia el refresh token por uno nuevo de la
  misma familia y emite un access token nuevo. Antes revalida lo mismo que un inicio de
  sesión: estado de la cuenta, membresías, alcance y sello de seguridad. Así, un cambio de
  contraseña, una desactivación o una baja terminan la sesión en la siguiente renovación.
- **Reutilización:** si se presenta un refresh token ya reemplazado, se revoca **toda la
  familia**, porque el token se filtró. La excepción son los 60 segundos posteriores a la
  renovación: dentro de ese margen se responde 409 `refresh_rotated`, porque es otra pestaña
  que renovó al mismo tiempo. La rotación es un compare-and-set sobre `revoked_at`.
- **Inactividad:** el refresh token caduca a los 30 días sin uso.
- **Cierre de sesión:** `POST auth/session/logout` revoca la familia.

### Private Web

- La sesión se renueva 60 segundos antes de que venza el access token. Solo una pestaña
  renueva a la vez (`navigator.locks`); las demás leen el resultado del almacenamiento.
- Todo cliente creado con `createPrivateWebApiClient` renueva el token antes de usarlo si
  está por vencer. Esto cubre el regreso de la suspensión del equipo.
- Un 401 provoca una renovación forzada, y la sesión solo termina si la API la rechaza.
- «Recordarme» sigue eligiendo `localStorage` o `sessionStorage`.

### Portal público

Aplica las mismas reglas, pero solo dentro de la pestaña (`sessionStorage`), como hasta ahora.

## Consecuencias

- Una sesión interna dura hasta que la persona cierra sesión, cambia su contraseña, la
  desactivan o pasa 30 días sin usar la aplicación.
- La migración `AddRefreshTokens` crea `iam.refresh_tokens`. Su `Down` se bloquea con
  `THROW 52330` mientras haya sesiones activas.
- Los clientes que ignoran `refreshToken` siguen funcionando como antes: el cambio de
  contrato es una expansión.
