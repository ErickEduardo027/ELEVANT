---
id: historia-origen-limites-evidencia
title: "Orígenes y límites de evidencia"
type: history
area: history
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "0c392571a9a235ff5e75846d14b2a127b6c25c73"
sources:
  - README.md
  - SETUP_REPORT.md
  - AGENTS.md
  - docs/architecture/system-overview.md
  - docs/adr/0001-use-monorepo.md
  - docs/adr/0002-use-dotnet-10.md
  - docs/adr/0003-use-modular-monolith.md
  - docs/adr/0004-centralize-external-api-access.md
  - docs/adr/0005-use-remote-development-api.md
  - docs/adr/0006-separate-development-and-production.md
tags:
  - historia
  - evidencia
  - unknown
  - origen
---

# Orígenes y límites de evidencia

Esta página evita que una historia técnicamente detallada termine inventando el
origen humano de ELEVANT. Su afirmación verificada es negativa y acotada: en el
grafo Git alcanzable hasta el commit de corte no existe evidencia versionada
anterior al 22 de julio de 2026 que permita reconstruir de forma responsable la
concepción del producto.

## Punto cero verificable

El primer objeto Git alcanzable es `8a1a1d8`, fechado el 22 de julio de 2026 y
con asunto `push`. Ese snapshot ya contiene un monorepo amplio: backend .NET,
documentación, reglas, pruebas, shells de clientes y siete ADR iniciales. Por su
tamaño y contenido es razonable describirlo como **primer snapshot versionado**,
no como prueba de que todo fue creado ese día.

Los ADR-0001 a ADR-0006 dicen «Accepted — 2026-07-18». Esta es una afirmación de
los documentos. Como esos archivos aparecen por primera vez en el commit raíz,
Git no puede verificar por separado la sesión, sus participantes ni el proceso
que llevó a esa fecha.

## Matriz de certeza

| Pregunta | Estado | Evidencia o límite |
| --- | --- | --- |
| ¿Cuál es el primer commit alcanzable? | Verificado | `8a1a1d8`, 2026-07-22 |
| ¿Qué arquitectura ya estaba escrita allí? | Verificado | Monorepo, .NET 10, monolito modular, backend como puerta a proveedores y separación de ambientes |
| ¿Los ADR iniciales declaran 2026-07-18? | Verificado | Texto versionado de ADR-0001 a ADR-0006 |
| ¿Quién concibió ELEVANT y en qué reunión? | `unknown` | No existe acta/testimonio versionado en el corte |
| ¿Qué problema original relató cada stakeholder? | `unknown` | Los prototipos muestran soluciones exploradas, no el origen de cada necesidad |
| ¿Hubo repositorios, archivos o diseños anteriores? | `unknown` | La ausencia en este grafo no prueba que nunca existieran fuera de él |
| ¿Quién decidió personalmente cada ADR? | `unknown` | El estado del ADR registra la decisión, no atribución individual suficiente |
| ¿Los datos prototipo reflejan operación real? | No demostrado y no autorizado | Las reglas actuales los tratan como material sintético/descartable |

## Inferencias prohibidas

No debe escribirse como hecho que:

- el asunto del primer commit describe la creación del producto;
- una persona visible en metadata Git fue la única autora de una decisión;
- una pantalla prueba una entrevista, una obligación contractual o una regla de
  negocio aprobada;
- una fecha declarada en un ADR equivale a un commit o acta de esa fecha;
- la falta de archivos anteriores significa que no hubo trabajo previo;
- un rollout documentado de Development prueba Production.

## Cómo completar el origen sin reescribirlo

Una futura reconstrucción humana debería incorporarse como evidencia nueva y
separada:

1. entrevistar a participantes con consentimiento;
2. registrar fecha, rol y alcance del testimonio sin exponer PII innecesaria;
3. separar recuerdo, documento contemporáneo e interpretación posterior;
4. contrastar versiones divergentes en lugar de elegir una sin evidencia;
5. enlazar el registro saneado y conservar esta página como límite del corte
   anterior;
6. actualizar `last_verified` y `verified_commit` solo después de revisar todas
   las fuentes.

Un testimonio posterior puede explicar motivaciones, pero no convierte su
recuerdo en un commit contemporáneo. La historia debe conservar ambas capas.

## Método de auditoría

Estas consultas de solo lectura reproducen el límite Git:

```text
git rev-list --max-parents=0 HEAD
git show --stat --summary 8a1a1d8
git log --reverse --date=short --format="%h|%cs|%s"
git log --diff-filter=A --format="%h|%cs|%s" -- docs/adr
```

El resultado prueba qué está en este repositorio y cuándo aparece según su
metadata. No prueba hechos fuera del repositorio. La política editorial para
mantener esa distinción está en
[Fuentes y evidencia](../08-gobernanza/fuentes-y-evidencia.md).

## Relacionados

- [Cronología versionada](cronologia-versionada.md)
- [De prototipos a monorepo convergente](prototipos-y-convergencia.md)
- [Índice de historia](README.md)
- [Estado inicial del conocimiento](../00-inicio/estado-inicial.md)

## Fuentes verificadas

- [README vigente](../../README.md), [reporte estructural](../../SETUP_REPORT.md), [reglas del repositorio](../../AGENTS.md) y [visión del sistema](../../docs/architecture/system-overview.md): contenido y límites documentados del proyecto.
- [ADR-0001](../../docs/adr/0001-use-monorepo.md), [ADR-0002](../../docs/adr/0002-use-dotnet-10.md), [ADR-0003](../../docs/adr/0003-use-modular-monolith.md), [ADR-0004](../../docs/adr/0004-centralize-external-api-access.md), [ADR-0005](../../docs/adr/0005-use-remote-development-api.md) y [ADR-0006](../../docs/adr/0006-separate-development-and-production.md): decisiones que declaran aceptación previa al primer snapshot Git.
