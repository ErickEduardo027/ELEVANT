---
id: backlog-indice
title: "Backlog transversal y límites del conocimiento"
type: index
area: backlog
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "c2a060179983a13b7e5a0dd45cba1a1fd2e54e8a"
sources:
  - AGENTS.md
  - docs/deployment/development-hardening-backlog.md
  - docs/deployment/environments.md
  - docs/workflows/mobile-workflow.md
  - Vault/02-producto/preguntas-abiertas.md
  - Vault/03-dominio/brechas-y-preguntas-abiertas.md
  - Vault/10-seguridad/riesgos-y-controles-pendientes.md
tags:
  - backlog
  - pendientes
  - decisiones
---

# Backlog transversal

Un vacío documentado no es una funcionalidad disponible ni una orden de implementación. Este mapa reúne las decisiones todavía abiertas y enlaza al dueño de cada explicación; las instrucciones ejecutables siguen en el subárbol correspondiente.

| Plano | Pregunta que falta cerrar | Fuente de contexto |
| --- | --- | --- |
| Producto | ¿Qué reglas finales y recorridos se aprueban? | [Preguntas de producto](../02-producto/preguntas-abiertas.md) |
| Dominio | ¿Qué invariantes requieren validación con usuarios y datos reales? | [Brechas de dominio](../03-dominio/brechas-y-preguntas-abiertas.md) |
| Mobile | ¿Cómo se integra el Agent con la API y se firma/distribuye una APK? | [Diseño diferido de CI/CD móvil](../07-entrega/mobile-apk-ci-cd.md) |
| Development | ¿Qué controles de alerta y resiliencia faltan? | [Backlog de hardening](../../docs/deployment/development-hardening-backlog.md) y [Observabilidad](../09-operaciones/observabilidad-y-alertas.md) |
| Seguridad | ¿Qué controles siguen manuales o diferidos? | [Riesgos y controles](../10-seguridad/riesgos-y-controles-pendientes.md) |
| Production | ¿Qué plan separado permitirá crear el ambiente? | [Ambientes](../../docs/deployment/environments.md) |
| Historia | ¿Qué ocurrió antes del primer commit? | [Orígenes y límites de evidencia](../01-historia/origenes-y-limites-de-evidencia.md) |

La [matriz de pendientes](pendientes-transversales.md) separa dependencia, evidencia necesaria y criterio de cierre. La [reconciliación documental](../11-referencia/reconciliacion-docs.md) registra contradicciones detectadas en `docs/` sin reinterpretarlas como trabajo de producto aprobado.

## Regla de promoción

Un pendiente pasa a capacidad vigente sólo cuando existe decisión autorizada, implementación con pruebas, actualización de contratos y documentación, y aceptación del ambiente si aplica. El merge de una nota no cumple esos pasos por sí mismo.

Volver a [Home](../00-inicio/home.md).
