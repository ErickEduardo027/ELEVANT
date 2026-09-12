---
id: plantilla-runbook
title: "Plantilla: runbook operativo"
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
  - ops/AGENTS.md
tags:
  - plantilla
  - runbook
  - operaciones
---

# Plantilla: runbook — operación

> [!WARNING]
> Al duplicar: cambia `type` a `runbook`, valida contra `ops/AGENTS.md`, reemplaza placeholders y elimina este aviso. Un runbook versionado no concede autorización para mutar un host.

## Objetivo

<!-- Resultado concreto, ambiente y razón de la operación. -->

## Autoridad y responsables

- Solicitante autorizado por rol:
- Operador:
- Revisor/checkpoint:
- Ventana aprobada:

## Impacto

| Recurso | Cambio esperado | Debe permanecer sin cambios |
| --- | --- | --- |
|  |  |  |

## Precondiciones

- [ ] Ambiente y objetivo identificados sin ambigüedad.
- [ ] Snapshot/backup aplicable verificado.
- [ ] Estados, locks y salud inicial capturados.
- [ ] Secretos disponibles fuera del repositorio y sin imprimir.
- [ ] Ruta de rollback preparada y comprobada.
- [ ] Ventana de seguridad/rollback activa cuando corresponda.

## Variables seguras

```text
<RESOURCE_ID>
<PRIVATE_SERVICE>
<EXPECTED_DIGEST>
```

<!-- Nunca pegues valores reales sensibles. Los comandos deben fallar si falta una variable. -->

## Procedimiento

### Checkpoint 1 — preflight

```text
<COMANDO_DE_SOLO_LECTURA>
```

Resultado exacto esperado:

```text
<PREFLIGHT_OK>
```

Si falla: detener; no continuar al siguiente checkpoint.

### Checkpoint 2 — cambio mínimo

```text
<COMANDO_AUTORIZADO>
```

Resultado exacto esperado:

```text
<CHANGE_OK>
```

### Checkpoint 3 — verificación

```text
<COMANDO_DE_VERIFICACION>
```

Resultado exacto esperado:

```text
<ACCEPTANCE_GATE_OK>
```

## Fallos esperados y respuesta

| Señal | Significado | Acción segura |
| --- | --- | --- |
| Preflight no coincide | Objetivo o estado inesperado | Detener y diagnosticar |
| Lock ocupado | Operación concurrente | Esperar/cancelar según política, nunca eludir lock |
| Salud falla | Cambio no aceptable | Activar rollback |
| Sesión desconectada | Resultado desconocido | Reconectar y observar; no repetir mutación a ciegas |

## Rollback

### Condiciones de activación

- Pendiente de completar.

### Procedimiento

```text
<COMANDO_DE_ROLLBACK>
```

### Gates posteriores

- [ ] Estado terminal consistente.
- [ ] Servicios no objetivo sin cambios.
- [ ] Frontera de red exacta.
- [ ] Evidencia saneada registrada.

## Cierre

- [ ] Aceptación funcional/técnica completa.
- [ ] Locks libres.
- [ ] Automatismos reanudados en orden.
- [ ] Ventana de rollback cerrada solo después de aceptación.
- [ ] No quedaron secretos temporales.
- [ ] Se actualizó el Vault si el procedimiento real difirió.

## Evidencia saneada

<!-- Fecha, ambiente abstracto, gate y resultado. Sin IP, FQDN privado, usuarios, tokens ni logs crudos. -->

## Fuentes y relacionados

- [Política de evidencia](../08-gobernanza/fuentes-y-evidencia.md)
- [Mantenimiento](../08-gobernanza/mantenimiento-del-vault.md)
