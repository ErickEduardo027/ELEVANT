---
id: backlog-pendientes-transversales
title: "Pendientes transversales: dependencias y prueba de cierre"
type: backlog
area: backlog
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "c2a060179983a13b7e5a0dd45cba1a1fd2e54e8a"
sources:
  - docs/deployment/development-hardening-backlog.md
  - docs/deployment/environments.md
  - .github/BRANCH_PROTECTION.md
  - .github/workflows/mobile-ci.yml.template
  - Vault/00-inicio/roadmap-del-vault.md
  - Vault/02-producto/preguntas-abiertas.md
  - Vault/03-dominio/brechas-y-preguntas-abiertas.md
  - Vault/07-entrega/mobile-apk-ci-cd.md
  - Vault/09-operaciones/observabilidad-y-alertas.md
  - Vault/10-seguridad/riesgos-y-controles-pendientes.md
tags:
  - backlog
  - dependencias
  - aceptacion
  - decisiones
---

# Pendientes transversales

Esta matriz es un **índice de brechas verificables**, no una lista de tareas ya aprobadas ni un calendario. El owner aquí es el equipo hasta que una decisión designe un responsable por rol. El estado de cada capacidad se confirma en la fuente enlazada, no por la sola presencia de una fila.

| Brecha o decisión | Dependencia antes de ejecutar | Prueba mínima para cerrarla | Fuente dueña |
| --- | --- | --- | --- |
| Primer caso de uso real, identidad y permisos | Acordar actor, resultado, tenant/estación, estados y denegaciones | API/contrato, pruebas negativas, cliente consumidor y evidencia de recorrido completo | [Producto](../02-producto/preguntas-abiertas.md) y [Dominio](../03-dominio/brechas-y-preguntas-abiertas.md) |
| Sustituir mocks de los tres clientes | Caso de uso y contrato OpenAPI aprobados; adapter y estados de error | Pruebas de integración y aislamiento, sin usar fixtures como datos reales | [Aplicaciones](../05-aplicaciones/README.md) |
| Mobile APK de Development | Integración .NET, alcance offline, identidad, firma, canal y dispositivos | CI móvil activo, APK firmada trazable, distribución restringida y aceptación en tablet | [Diseño APK](../07-entrega/mobile-apk-ci-cd.md) |
| Alertas externas y heartbeats | Canal/proveedor, privacidad, periodos, responsables y prueba controlada | Detección de fallo y silencio para SQL y cada carril, sin duplicar jobs | [Hardening](../../docs/deployment/development-hardening-backlog.md) |
| Protección técnica de ramas | Plan y permisos GitHub compatibles, checks estables y política de excepción | Push directo, PR sin aprobación y check fallido efectivamente bloqueados | [Protección de ramas](../../.github/BRANCH_PROTECTION.md) |
| Simulacros periódicos de recuperación | Política de frecuencia, alcance, custodio y entorno seguro | Ensayo fechado con restauración, RPO/RTO medidos y acciones correctivas | [Backups](../09-operaciones/backups-y-restore-check.md) y [recuperación](../09-operaciones/mantenimiento-reboot-y-recuperacion.md) |
| Production | Plan independiente, secretos, datos, red, backup, monitoreo y aprobación | Infraestructura y gates propios, aceptación de seguridad y restauración; jamás inferirla de Development | [Ambientes](../../docs/deployment/environments.md) |
| Historia anterior a Git | Entrevista consentida y fuente contemporánea si existe | Testimonio fechado atribuido por rol, incertidumbres separadas de hechos | [Orígenes](../01-historia/origenes-y-limites-de-evidencia.md) |

## Cómo convertir una fila en trabajo

1. Registrar decisión, alcance y owner por rol en el área dueña; separar diseño de autorización de ejecución.
2. Definir riesgo, precondiciones, prueba negativa, criterio de aceptación y rollback cuando aplique.
3. Implementar en un PR desde `Development`, con fuentes ejecutables y documentación actualizadas.
4. Aceptar el despliegue por el operador si cambia el VPS o el acceso; conservar sólo evidencia saneada.
5. Revalidar la nota del Vault y retirar la fila sólo cuando otra nota vigente y verificable cuente el resultado.

No hay fechas ni un orden global aprobado para estas filas. Las dos brechas de hardening tienen prioridad alta en su [fuente](../../docs/deployment/development-hardening-backlog.md), lo que no autoriza activarlas sin sus dependencias y pruebas.

Volver al [Índice de Backlog](README.md) o a la [política de evidencia](../08-gobernanza/fuentes-y-evidencia.md).
