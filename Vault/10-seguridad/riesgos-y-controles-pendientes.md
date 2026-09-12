---
id: seguridad-riesgos-controles-pendientes
title: "Riesgos y controles pendientes"
type: backlog
area: security
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "ca10cdb73e729622f0c1870e1c8762756a9138a4"
sources:
  - AGENTS.md
  - .github/BRANCH_PROTECTION.md
  - docs/deployment/development-hardening-backlog.md
  - docs/security/database-access.md
  - docs/security/secrets-management.md
  - docs/architecture/backend-architecture.md
  - ops/dokploy/observability/README.md
tags:
  - seguridad
  - riesgos
  - hardening
  - backlog
---

# Riesgos y controles pendientes

Esta es una **lista verificada de brechas documentadas**, no una declaración de que los controles diferidos ya funcionan. Cada fila conecta riesgo, compensación y condición de cierre. El [backlog fuente](../../docs/deployment/development-hardening-backlog.md) requiere PR y aceptación separados.

| Riesgo actual | Compensación documentada | Cierre pendiente |
| --- | --- | --- |
| Push directo a `Development` técnicamente posible en el repositorio privado | Norma de PR manual, CI y controladores fail-closed | Plan y reglas que impongan PR, checks y revisión; pruebas negativas de push/merge |
| Fallo o silencio de un schedule sin alerta externa independiente | Revisión manual de Beszel, Dokploy y logs | Heartbeat/dead-man por SQL y cada carril, canal aprobado, prueba de fallo y silencio |
| CRUD humano SQL evita validaciones de negocio | Identidad propia, red privada, rol limitado, constraints SQL | Tratar el dato como experimento, no como validación de negocio |
| Sin historial DML durable por fila | Principal SQL individual identificable | Decisión y mecanismo de auditoría separados, si el equipo lo exige |
| API de negocio sin autenticación/autorización implementada | Development privado y superficie HTTP mínima | Casos de uso con identidad, tenant/estación, RBAC y pruebas de denegación |
| Mobile APK sin pipeline/firma/distribución aprobados | Expo ejecutable y pruebas locales parciales | Decisiones y aceptación del [plan móvil](../07-entrega/mobile-apk-ci-cd.md) antes de activar CI/CD |

## Aprobación y alertas

La [protección de ramas](../../.github/BRANCH_PROTECTION.md) documenta que el plan actual no impone el PR: un push directo puede producir candidatos para CD de Development. Un PR sin conflictos no garantiza CI y CI verde tampoco obliga a revisión. Hasta activar reglas obligatorias, el equipo debe seguir la norma de rama/PR y revisar checks y migraciones explícitamente.

Un dashboard no sustituye la [deuda de alertas](../../docs/deployment/development-hardening-backlog.md): la ausencia de heartbeat debe producir una señal externa independiente. Beszel observa el host y no inventaría contenedores mediante socket Docker en la configuración actual. Esta nota no inventa umbrales, destinatarios ni tokens.

## Regla de escalamiento

Si un cambio exige relajar firewall, TLS, permisos SQL, aislamiento tenant o controles de CI para «hacerlo pasar», se detiene. La corrección debe preservar el límite o registrar decisión nueva con propietario, alternativa, prueba negativa y rollback. Ni el Vault ni este backlog autorizan modificar GitHub, Dokploy, Tailscale o el VPS.

Relacionado: [Operaciones](../09-operaciones/README.md), [CI/CD Development](../07-entrega/README.md) y [fuentes y evidencia](../08-gobernanza/fuentes-y-evidencia.md).
