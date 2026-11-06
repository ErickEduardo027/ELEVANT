# ADR-0022: Verificación por correo del portal de aerolíneas

## Estado

Accepted — 2026-11-02.

## Contexto

Las cuentas del portal nacían con `EmailConfirmed=true` y una contraseña temporal que AVIAM
entregaba por fuera del sistema. No había recuperación de contraseña ni segundo factor, y la
API no sabía enviar correo. Se pidió validar al usuario público por correo: activación por
enlace, un código de 6 dígitos en cada inicio de sesión y «¿Olvidaste tu contraseña?». Las
cuentas internas de AVIAM quedan fuera.

## Decisión

### Bandeja de salida

- **Tabla `infra.email_outbox`:** cada correo se escribe en la misma transacción que lo
  provoca, con estado `Pending`, `Sent` o `Failed`.
- **Envío:** `EmailDispatchWorker` (API) toma lotes cada 5 segundos con un *lease* por
  compare-and-set sobre `attempts`, y envía por SMTP (`SmtpEmailSender`, STARTTLS en el puerto
  587). Hasta 5 intentos con espera creciente; después queda `Failed` con el motivo.
- **Privacidad:** el cuerpo, que contiene códigos y enlaces, se borra al quedar `Sent` o
  `Failed`. Los logs nunca llevan cuerpos ni credenciales.
- **Sin SMTP configurado:** con `Smtp:Host` vacío el worker no envía y los correos quedan
  `Pending`. Ninguna pantalla afirma que se envió algo.
- **Local:** `compose.local.yml` levanta Mailpit (`http://127.0.0.1:8025`).
- **Servidor:** la cuenta Gmail no-reply se configura con `ELEVANT_SMTP_*` en el Environment
  privado de Dokploy, con una contraseña de aplicación
  (`docs/deployment/dokploy-configuration.md`).
- **Diseño:** las plantillas usan la paleta de ELEVANT con tablas y estilos en línea, y el logo
  real como imagen embebida (`cid:elevant-logo`). `SmtpEmailSender` lo adjunta al enviar, así
  que el destinatario no descarga nada externo: la web Development solo se alcanza por la
  tailnet. La bandeja de salida guarda solo el HTML con la referencia.

> **Actualización (6 de noviembre de 2026).** La bandeja suma el estado `Discarded`. Un enlace o
> un código que vence en la cola, o que otro reemplaza, se descarta con su motivo y pierde el
> cuerpo, también sin SMTP: en ese caso el worker revisa la cola cada minuto y no envía nada.
> Los fallos guardan un motivo normalizado en lugar del texto del proveedor, y el código de
> inicio de sesión ya no va en el asunto. El superadministrador revisa la bandeja con
> `GET governance/email/outbox`. Una contraseña temporal asignada sobre una invitación pendiente
> la cierra y descarta su correo. Ver
> [ADR-0037](0037-commercial-cycle-requests-drafts-amendments-and-portal-accounts.md).

### Secretos de un solo uso

`iam.account_email_tokens` guarda solo el SHA-256 del secreto, su propósito, su vencimiento,
los intentos y `used_at`. Se comparan en tiempo constante.

| Propósito | Secreto | Vigencia | Regla |
|---|---|---|---|
| Activación | Enlace `/activar?token=…` (32 bytes) | 72 h | Un uso; reenviar invalida los anteriores |
| Código de login | 6 dígitos | 10 min | 5 intentos; reenviar reemplaza el código |
| Recuperación | Enlace `/recuperar?token=…` | 30 min | Un uso; termina todas las sesiones |

### Flujo

- **Login del portal:** con correo y contraseña válidos, una cuenta con rol de portal
  `AirlinePortal` recibe `202 code_required`, con `challengeId`, el correo enmascarado y el
  vencimiento. `POST auth/session/verify-code` emite la sesión (access más refresh,
  ADR-0021); `POST auth/session/resend-code` manda otro código. Las cuentas internas siguen
  recibiendo `200` directamente.
- **Alta:** el aprovisionamiento y «Añadir usuario» del superadministrador invitan por correo
  por defecto. La cuenta nace con `EmailConfirmed=false` e `InvitationStatus=Sent`, sin
  contraseña, y no puede iniciar sesión hasta activarla. La contraseña temporal queda como
  alternativa explícita.
- **Recuperación:** `POST auth/password-reset` responde siempre `202`, exista o no la cuenta.
  `POST auth/password-reset/confirm` aplica la política de contraseñas y rota el sello de
  seguridad.
- **Errores:** los enlaces fallidos responden Problem Details con `code` `invalid_link` o
  `password_policy`. Todos los endpoints anónimos usan el rate limit de inicio de sesión.
- **Prueba de humo:** `POST governance/email/test` y `GET governance/email/deliveries`, solo
  para el superadministrador.

## Consecuencias

- El portal depende de que el correo llegue. Sin SMTP en el servidor, las cuentas de
  aerolínea no pueden entrar; el despliegue debe configurar `ELEVANT_SMTP_*` antes de
  promocionar este cambio.
- Las cuentas de aerolínea que ya existían conservan su contraseña y pasan a pedir el código
  en cada inicio de sesión.
- Para desactivar el código en una demostración sin correo:
  `AccountEmail:RequireAirlineLoginCode=false`.
