---
id: seguridad-registro-signalr-sin-tokens
title: "Registro del transporte SignalR en los clientes web"
type: capability
area: security
status: documented
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-10-01"
verified_commit: pending
sources:
  - frontend/private-web/src/services/accountChangeObserver.js
  - frontend/private-web/src/services/accountChangeObserver.test.js
  - frontend/public-web/src/lib/airline-change-observer.ts
  - frontend/public-web/tests/unit/airline-change-observer.test.ts
tags:
  - signalr
  - navegador
  - tokens
---

# Registro del transporte SignalR en los clientes web

Los observadores de cambios de AVIAM y del portal de aerolíneas usan un
WebSocket autenticado únicamente como aviso para releer el feed y los recursos
HTTP autorizados. En el navegador, SignalR puede incorporar el token de acceso
a la URL de conexión y registrar esa URL a nivel informativo. Por ello ambos
observadores configuran `LogLevel.None` en el cliente SignalR.

La supresión del log no sustituye la autorización del servidor ni desactiva
la reconciliación por cursor, la relectura REST, la reconexión o el sondeo de
respaldo. Las pruebas de los dos observadores capturan un token sintético y
comprueban que la conexión no lo escribe en `console.info`. Esto no acredita
que todos los logs de terceros o del servidor estén saneados, ni que haya una
prueba de latencia extremo a extremo en el VPS para esta revisión.

Fuentes: [observador AVIAM](../../frontend/private-web/src/services/accountChangeObserver.js),
[prueba AVIAM](../../frontend/private-web/src/services/accountChangeObserver.test.js),
[observador Public Web](../../frontend/public-web/src/lib/airline-change-observer.ts)
y [prueba Public Web](../../frontend/public-web/tests/unit/airline-change-observer.test.ts).
