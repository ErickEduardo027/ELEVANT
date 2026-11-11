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
| Un caso de uso nuevo sin pruebas de denegación entre organizaciones o estaciones | *Posterior al commit verificado:* JWT, política fallback autenticada y autorización por departamento, organización y estación en cada caso de uso | Pruebas negativas de aislamiento en cada caso de uso nuevo, no solo en los existentes |
| Datos de tarjeta en logs, auditoría, avisos o respuestas | *Posterior al commit verificado:* solo se guardan la marca y los últimos cuatro dígitos; número, código de seguridad y vencimiento llegan solo a la pasarela ([cobro con tarjeta](../../backend/Elevant.Application/Finance/CardPayments.cs)) | Revisión de cumplimiento antes de conectar una pasarela real |
| Pasarela simulada en un ambiente real | *Posterior al commit verificado:* `CardPayments:Mode` es `Disabled` por defecto y en `appsettings.Production.json`; con `Simulated` fuera de Development o de los entornos de prueba la API no arranca ([composición](../../backend/Elevant.Infrastructure/DependencyInjection.cs), [ADR-0040](../../docs/adr/0040-billing-cycle-invoicing-from-operations-card-collections-credit-notes-and-payables.md)) | Contrato y adaptador de una pasarela real, fuera del alcance actual |
| Mobile APK sin pipeline/firma/distribución aprobados | Expo ejecutable; *posterior al commit verificado,* `mobile-ci.yml` valida lint, tipos, pruebas y bundle sin construir la APK | Decisiones y aceptación del [plan móvil](../07-entrega/mobile-apk-ci-cd.md) antes de activar CI/CD |

*Posterior al commit verificado de esta nota (código de `39a85a46`):* la fila de la API de negocio sin autenticación ni autorización quedó cerrada; la API autentica con JWT y refresh rotativo ([fronteras de confianza](../04-arquitectura/sistema-y-fronteras-de-confianza.md)). Las tres filas marcadas describen controles del código de ese commit, no aceptación en un ambiente.

## Aprobación y alertas

La [protección de ramas](../../.github/BRANCH_PROTECTION.md) documenta que el plan actual no impone el PR: un push directo puede producir candidatos para CD de Development. Un PR sin conflictos no garantiza CI y CI verde tampoco obliga a revisión. Hasta activar reglas obligatorias, el equipo debe seguir la norma de rama/PR y revisar checks y migraciones explícitamente.

Un dashboard no sustituye la [deuda de alertas](../../docs/deployment/development-hardening-backlog.md): la ausencia de heartbeat debe producir una señal externa independiente. Beszel observa el host y no inventaría contenedores mediante socket Docker en la configuración actual. Esta nota no inventa umbrales, destinatarios ni tokens.

## Regla de escalamiento

Si un cambio exige relajar firewall, TLS, permisos SQL, aislamiento tenant o controles de CI para «hacerlo pasar», se detiene. La corrección debe preservar el límite o registrar decisión nueva con propietario, alternativa, prueba negativa y rollback. Ni el Vault ni este backlog autorizan modificar GitHub, Dokploy, Tailscale o el VPS.

Relacionado: [Operaciones](../09-operaciones/README.md), [CI/CD Development](../07-entrega/README.md) y [fuentes y evidencia](../08-gobernanza/fuentes-y-evidencia.md).
