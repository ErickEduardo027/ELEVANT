---
id: plantilla-incidente
title: "Plantilla: incidente"
type: template
area: governance
status: verified
maturity: stable
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "300f0be1dcd5a27b7cf5d432c577e78a6b9a7b43"
sources:
  - Vault/08-gobernanza/fuentes-y-evidencia.md
  - Vault/08-gobernanza/mantenimiento-del-vault.md
tags:
  - plantilla
  - incidente
  - aprendizaje
---

# Plantilla: incidente — resumen sin datos sensibles

> [!WARNING]
> Al duplicar: cambia `type` a `incident`, usa evidencia saneada, reemplaza identidad/fechas y elimina este aviso. Nunca pegues logs crudos, tokens, PII, IP o FQDN privados.

## Resumen ejecutivo

| Campo | Valor |
| --- | --- |
| Estado | Detectado / mitigado / resuelto / seguimiento |
| Severidad | Criterio definido por el equipo |
| Ambiente | Local / Development / Production futura |
| Inicio | Fecha/hora con zona |
| Detección | Fecha/hora con zona |
| Recuperación | Fecha/hora con zona |
| Responsable | Rol/equipo |

Describe en pocas frases qué ocurrió, impacto, duración y estado final.

## Impacto

- Usuarios/capacidades afectadas:
- Datos afectados o riesgo descartado:
- Ambientes y componentes:
- Lo que permaneció sano:

No uses métricas estimadas como exactas; etiqueta la incertidumbre.

## Detección

- Señal inicial:
- Quién/sistema detectó por rol:
- Por qué la detección funcionó o tardó:
- Alerta que faltó:

## Línea de tiempo

| Fecha/hora y zona | Evento observable | Decisión/acción | Evidencia saneada |
| --- | --- | --- | --- |
|  |  |  |  |

Separa hechos observados de inferencias realizadas durante la respuesta.

## Respuesta y recuperación

1. Pendiente de completar.

### Gates de recuperación

- [ ] Salud funcional restaurada.
- [ ] Integridad/consistencia de datos comprobada.
- [ ] Fronteras de red y permisos comprobados.
- [ ] Jobs, locks y controladores en estado esperado.
- [ ] No quedaron secretos temporales ni accesos ampliados.

## Causa

### Causa técnica inmediata

<!-- Mecanismo exacto demostrado. -->

### Factores contribuyentes

<!-- Diseño, proceso, observabilidad, documentación o comunicación. Sin culpar personas. -->

### Por qué las defensas no lo evitaron

<!-- Gates ausentes, insuficientes o eludidos. -->

## Seguridad y datos

- ¿Hubo acceso no autorizado? Sí / No / Desconocido.
- ¿Hubo pérdida, corrupción o exposición? Sí / No / Desconocido.
- Método de comprobación:
- Escalamiento requerido:

Si la respuesta es desconocida, no cierres el incidente hasta definir el seguimiento.

## Acciones correctivas

| Acción | Tipo | Owner por rol | Prioridad | Criterio de cierre | Estado |
| --- | --- | --- | --- | --- | --- |
|  | Prevenir / detectar / recuperar / documentar |  |  |  |  |

Cada acción debe tener un criterio verificable. “Tener cuidado” no es una acción correctiva.

## Aprendizajes

### Qué funcionó

- Pendiente de completar.

### Qué debe cambiar

- Pendiente de completar.

### Runbooks y documentación afectados

- Pendiente de completar.

## Evidencia

<!-- Enlaces versionados a registros saneados, PRs, tests, ADR y runbooks. Describe qué demuestra cada fuente y qué no. -->

## Cierre

- [ ] Causa demostrada o incertidumbre documentada.
- [ ] Acciones con owner y criterio de cierre.
- [ ] Runbooks y Vault actualizados.
- [ ] Evidencia revisada para secretos/PII.
- [ ] Revisión posterior completada.

Relacionados: [Plantilla de runbook](runbook.md), [Política de evidencia](../08-gobernanza/fuentes-y-evidencia.md).
