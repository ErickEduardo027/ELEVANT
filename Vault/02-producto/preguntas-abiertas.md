---
id: producto-preguntas-abiertas
title: "Preguntas abiertas de producto"
type: backlog
area: product
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "0c392571a9a235ff5e75846d14b2a127b6c25c73"
sources:
  - README.md
  - frontend/private-web/README.md
  - frontend/public-web/README.md
  - frontend/mobile-agent/README.md
  - backend/README.md
  - docs/architecture/database-v1.md
  - docs/deployment/environments.md
tags:
  - producto
  - preguntas-abiertas
  - investigacion
  - backlog
---

# Preguntas abiertas de producto

Este backlog registra decisiones que las fuentes no resuelven. `Verificada` significa que se comprobó la brecha en el commit indicado; **no significa que exista una respuesta**.

## Cómo cerrar una pregunta

Cada cierre debe aportar:

1. respuesta y alcance inequívocos;
2. evidencia (investigación, decisión aceptada, contrato o prueba);
3. owner por rol y fecha de revisión;
4. consecuencias sobre clientes, API, datos y operación;
5. enlace a la nota o ADR que pasa a ser fuente de verdad.

## Antes de priorizar el primer recorrido de negocio

| ID | Pregunta abierta | Por qué bloquea | Evidencia necesaria |
| --- | --- | --- | --- |
| PQ-01 | ¿Cuál es el primer resultado de usuario que debe funcionar de extremo a extremo? | Hoy existen muchos prototipos y ninguna operación de negocio en OpenAPI | Decisión de alcance con actor, escenario y criterio de aceptación |
| PQ-02 | ¿Cuál es la matriz mínima de roles, permisos, tenant y scopes por caso de uso? | Los roles de UI no son autorización y la API aún no autentica | Taller de autorización + pruebas de acceso/denegación |
| PQ-03 | ¿Qué estados y transiciones son válidos para solicitud, turnaround, operación, servicio, submission y revisión? | El esquema conserva eventos, pero no define por sí solo la máquina de estados | Reglas de dominio aprobadas con concurrencia y corrección |
| PQ-04 | ¿Qué constituye una operación lista, enviada, aprobada o devuelta? | Afecta OCC, móvil, evidencia y procesos posteriores | Criterios operativos validados con actores internos |
| PQ-05 | ¿Qué información de vuelo es manual, importada o proveniente de un proveedor, y con qué frescura? | La integración externa es solo futura | Fuente autorizada, contrato, límites y política de degradación |

## Antes de un piloto con usuarios

| ID | Pregunta abierta | Riesgo si no se responde | Evidencia necesaria |
| --- | --- | --- | --- |
| PQ-06 | ¿Qué tareas exactas debe completar cada audiencia y en qué dispositivo/contexto? | Diseñar desde menús en vez de trabajo real | Entrevistas/observación y journey validado por rol |
| PQ-07 | ¿Qué debe funcionar sin red y cómo se resuelve un conflicto que requiere intervención? | Pérdida, duplicado o falsa confirmación de trabajo móvil | Matriz offline, política de reintento y pruebas de campo |
| PQ-08 | ¿Qué fotos/documentos son necesarios, quién puede verlos y cuánto se retienen? | Riesgo de privacidad y almacenamiento improvisado | Clasificación de datos, consentimiento, retención y storage aprobado |
| PQ-09 | ¿Qué alertas requieren tiempo real y cuáles admiten consulta periódica? | Complejidad innecesaria o eventos perdidos | SLA funcional por evento y fallback REST |
| PQ-10 | ¿Qué indicadores ayudan a decidir y cómo se calculan? | Convertir números mock en métricas contractuales | Diccionario de métricas, fuente, ventana y owner |
| PQ-11 | ¿Qué accesibilidad, idioma, zona horaria y condiciones ambientales exige cada cliente? | UX no utilizable en operación real | Pruebas con dispositivos, usuarios y estaciones objetivo |

## Antes de Production

| ID | Pregunta abierta | Riesgo si no se responde | Evidencia necesaria |
| --- | --- | --- | --- |
| PQ-12 | ¿Qué datos reales se tratarán y bajo qué privacidad, retención y auditoría? | Incumplimiento y exposición de información | Clasificación/legal/políticas aprobadas |
| PQ-13 | ¿Cuáles son disponibilidad, latencia, RPO/RTO y soporte esperados? | Operación sin expectativas recuperables | SLO/SLI, plan de incidentes y restore probado |
| PQ-14 | ¿Cómo se distribuye y actualiza Mobile Agent y quién custodia la firma? | Builds no confiables o incompatibles | Estrategia de canales, firma, versionado y rollback |
| PQ-15 | ¿Cómo se publica el sitio externo sin mezclarlo con el acceso privado de Development? | Frontera de red/ambiente incorrecta | Diseño Production aprobado y pruebas de exposición |
| PQ-16 | ¿Cuándo entran facturación documental, conciliación, chat/notificaciones y analítica materializada? | Implementar desde mocks contradice la v1 | Priorización, reglas y ADR/diseño por módulo |

## Contexto humano e historia aún desconocidos

No existe una fuente versionada que permita responder con rigor:

- cuál fue el evento inicial que dio origen a ELEVANT;
- quiénes participaron en su definición original y con qué responsabilidades;
- qué entrevistas, datos o alternativas sustentaron la visión;
- qué compromisos de producto existen fuera del repositorio.

Si se recupera este contexto, debe documentarse como testimonio fechado y atribuido por rol, separando recuerdo de evidencia contemporánea. No se debe inventar una cronología para completar el Vault.

## Priorización sugerida, no aprobada

```mermaid
flowchart LR
    Q1[PQ-01 resultado] --> Q2[PQ-02 autorización]
    Q2 --> Q3[PQ-03 y PQ-04 reglas]
    Q3 --> PILOT[PQ-06 a PQ-11 piloto]
    PILOT --> PROD[PQ-12 a PQ-16 Production]
```

El orden muestra dependencias lógicas derivadas; no es roadmap, compromiso ni fecha. Cualquier priorización cambia mediante decisión explícita del equipo.

## Fuentes

- [README del monorepo](../../README.md): visión y pendientes generales.
- [Private Web](../../frontend/private-web/README.md), [Public Web](../../frontend/public-web/README.md) y [Mobile Agent](../../frontend/mobile-agent/README.md): brechas declaradas por cliente.
- [Backend](../../backend/README.md): ausencia de autenticación y endpoints funcionales.
- [Base de datos v1](../../docs/architecture/database-v1.md): decisiones persistentes y capacidades diferidas.
- [Ambientes](../../docs/deployment/environments.md): decisiones pendientes para Production y distribución móvil.

Relacionados: [Visión y problema](vision-y-problema.md), [Alcance y no objetivos](alcance-y-no-objetivos.md) y [Mapa de producto](README.md).
