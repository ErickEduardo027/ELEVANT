---
id: referencia-reconciliacion-docs
title: "Reconciliación de docs con código y Vault"
type: reference
area: reference
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "c2a060179983a13b7e5a0dd45cba1a1fd2e54e8a"
sources:
  - AGENTS.md
  - docs/README.md
  - docs/architecture/system-overview.md
  - docs/architecture/dependency-rules.md
  - docs/database/schema-v1.md
  - docs/api/openapi-contract.md
  - docs/workflows/release-workflow.md
  - docs/workflows/mobile-workflow.md
  - docs/deployment/environments.md
  - docs/deployment/rollback.md
  - docs/security/secrets-management.md
  - docs/adr/0012-pull-based-web-development-cd.md
  - Vault/08-gobernanza/fuentes-y-evidencia.md
tags:
  - referencia
  - auditoria
  - documentacion
  - reconciliacion
---

# Reconciliación de `docs/`

Este registro explica qué discrepancias se corrigieron en esta etapa y cómo leer documentación histórica sin convertirla en contrato actual. Su alcance es **documental**: no cambia código, migraciones, workflows activos, controladores ni estado del VPS. La [precedencia de fuentes](../08-gobernanza/fuentes-y-evidencia.md) sigue siendo la regla cuando aparezca una nueva discrepancia.

| Zona revisada | Discrepancia detectada | Tratamiento en `docs/` | Fuente vigente que decide |
| --- | --- | --- | --- |
| Arquitectura | Algunas páginas aún describían clientes sin framework, API/base sin entidades ni migraciones y Dokploy futuro. | [Visión del sistema](../../docs/architecture/system-overview.md) y [overview](../../docs/architecture/overview.md) distinguen estructura existente de casos de uso no implementados. | Código de los tres clientes, backend y [migraciones EF](../../docs/database/migrations.md) |
| Dependencias e integraciones | Dibujos antiguos atribuían EF a Infrastructure o presentaban SignalR/proveedores como capacidades funcionales. | [Reglas de dependencia](../../docs/architecture/dependency-rules.md), [límites](../../docs/architecture/integration-boundaries.md) y [realtime](../../docs/architecture/realtime.md) explican propiedad y estado real. | Referencias de proyectos, hubs y adaptadores versionados |
| Esquema y HTTP | Inventarios y guías podían confundirse con endpoints de negocio o con migraciones ejecutadas por la API. | [Esquema v1](../../docs/database/schema-v1.md) y [OpenAPI](../../docs/api/openapi-contract.md) separan modelo persistente, endpoint existente y futuro. | Migraciones, snapshot OpenAPI y código del host |
| Flujos y onboarding | Guías arrastraban supuestos de plantillas, herramientas o publicación automática como si todo merge desplegara y el móvil ya tuviera APK. | [Release](../../docs/workflows/release-workflow.md), [Mobile](../../docs/workflows/mobile-workflow.md), PR y onboarding diferencian CI, certificación, promoción y distribución futura. | Workflows activos, manifiestos npm y [diseño APK diferido](../07-entrega/mobile-apk-ci-cd.md) |
| Operación y seguridad | Algunas guías trataban API/webs como futuras o sugerían revertir sólo una imagen sin su Compose certificado. | [Ambientes](../../docs/deployment/environments.md), [rollback](../../docs/deployment/rollback.md) y [secretos](../../docs/security/secrets-management.md) aclaran límites y procedimiento fuente. | Compose/controladores revisados y aceptación operativa saneada |
| ADR | Decisiones de su fecha podían leerse como una fotografía de implementación presente. | Los ADR afectados conservan su contexto histórico y enlazan documentación posterior; no se reescribe su decisión. | Estado `Accepted`/`Proposed`, fecha y evidencia ejecutable posterior |

## Qué no se «resolvió» por editar documentación

- La API de negocio y la autorización siguen incompletas aunque el esquema tenga entidades.
- Mobile Agent conserva flujos de prototipo; no hay pipeline APK/EAS activo ni distribución certificada.
- Production, alertas externas y protección obligatoria de ramas continúan pendientes según sus fuentes.
- Un restore-check exitoso demuestra una restauración de prueba bajo sus condiciones, no un ensayo completo de desastre con RPO/RTO acordados.
- La [cronología anterior a Git](../01-historia/origenes-y-limites-de-evidencia.md) no puede reconstruirse sólo desde un repositorio.

## Rutas que requieren interpretación especial

- [`docs/architecture/generated-repository-tree.md`](../../docs/architecture/generated-repository-tree.md) es un árbol resumido y remite a `rg --files`/script; no se debe usar como inventario exhaustivo.
- [`docs/superpowers/plans/`](../../docs/superpowers/plans/2026-08-09-integracion-lw-front-gestion-humana.md) conserva una propuesta histórica, no un contrato vigente ni autorización de ejecución.
- Los [ADR](../../docs/adr/0001-use-monorepo.md) explican la decisión en su momento; el estado actual debe contrastarse con código y contratos.
- Los [runbooks](../../ops/dokploy/README.md) contienen checkpoints ejecutables. Este Vault sólo orienta; no inventa comandos ni sustituye la verificación del operador.

## Regla para la siguiente auditoría

Si un PR cambia una fuente listada en el frontmatter de una nota, revisa sus afirmaciones centrales. Conserva el commit de una fotografía histórica si todavía describe correctamente ese momento; si actualizas la nota actual, vuelve a comprobar todas sus fuentes, registra el nuevo commit y regenera el inventario. Una actualización de fecha sin contraste no es reconciliación.

El [índice de Referencia](README.md) ofrece rutas de consulta y el [Backlog transversal](../12-backlog/README.md) guarda las brechas sin esconderlas como documentación «completa».
