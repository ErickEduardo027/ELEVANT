---
id: plantilla-capacidad
title: "Plantilla: capacidad"
type: template
area: governance
status: verified
maturity: stable
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "300f0be1dcd5a27b7cf5d432c577e78a6b9a7b43"
sources:
  - Vault/08-gobernanza/metadatos.md
  - AGENTS.md
tags:
  - plantilla
  - capacidad
  - trazabilidad
---

# Plantilla: capacidad — resultado del usuario

> [!NOTE]
> Al duplicar: cambia `type` a `capability`, define el estado por capa y elimina este aviso. Una pantalla prototipo no demuestra una capacidad de extremo a extremo.

## Resultado esperado

<!-- Qué puede lograr el usuario, en qué contexto y cómo se reconoce el éxito. -->

## Actores y autorización

| Actor/rol | Puede | No puede | Scope obligatorio |
| --- | --- | --- | --- |
|  |  |  |  |

## Alcance

### Incluido

- Pendiente de completar.

### Excluido o diferido

- Pendiente de completar.

## Estado por capa

| Capa | Estado | Fuente | Brecha |
| --- | --- | --- | --- |
| Flujo de producto |  |  |  |
| Private/Public/Mobile |  |  |  |
| OpenAPI/API |  |  |  |
| Dominio/aplicación |  |  |  |
| Persistencia |  |  |  |
| CI/CD/operación |  |  |  |
| Observabilidad |  |  |  |

## Flujo principal

```mermaid
sequenceDiagram
    actor User as Usuario
    participant Client as Cliente
    participant API as API
    participant DB as Persistencia
    User->>Client: Acción autorizada
    Client->>API: Comando/consulta versionado
    API->>DB: Regla y persistencia
    DB-->>API: Estado canónico
    API-->>Client: Resultado contractual
    Client-->>User: Confirmación observable
```

## Reglas e invariantes

- Pendiente de completar.

## Contrato API

- Endpoints:
- DTO/versiones:
- Errores esperados:
- Idempotencia/concurrencia:
- Compatibilidad:

## Datos

- Entidades/tablas:
- Ownership:
- Retención/auditoría:
- Migración/seed:
- PII o clasificación:

## Clientes

### Private Web

- Estado y comportamiento:

### Public Web

- Scope tenant/estación y comportamiento:

### Mobile Agent

- Offline, sincronización, dispositivo y comportamiento:

## Seguridad

- Autenticación:
- Autorización:
- Fronteras de confianza:
- Secretos:
- Casos de abuso:

## Validación

| Nivel | Escenario | Resultado |
| --- | --- | --- |
| Unitario |  |  |
| Integración |  |  |
| Contrato |  |  |
| Cliente |  |  |
| Operación |  |  |

## Fallos y recuperación

- Pendiente de completar.

## Métricas y observabilidad

- Señal de uso:
- Señal de éxito:
- Señal de fallo:
- Alerta/owner:

## Decisiones y relacionados

- ADR:
- Arquitectura:
- Runbook:
- Backlog:

## Fuentes

<!-- Enlaces a prototipo, OpenAPI, código, migraciones, tests y evidencia operativa, indicando qué prueba cada uno. -->
