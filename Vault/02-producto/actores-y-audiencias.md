---
id: producto-actores-y-audiencias
title: "Actores y audiencias"
type: reference
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
  - docs/architecture/database-v1.md
  - docs/database/schema-v1.md
  - backend/Elevant.Infrastructure/Integrations/FlightAware/README.md
tags:
  - producto
  - actores
  - audiencias
  - autorizacion
---

# Actores y audiencias

Esta página inventaría audiencias observables en las fuentes. No constituye investigación de usuarios ni un catálogo final de roles de autorización.

## Mapa de contexto humano

```mermaid
flowchart TB
    subgraph AVIAM[AVIAM]
      OCC[OCC y control operativo]
      DEP[Administración y departamentos]
      RAMP[Agentes de rampa]
    end
    subgraph CLIENTE[Organización cliente]
      AIR[Usuarios de aerolínea]
    end
    VIS[Visitante del sitio]

    OCC --> PVT[AVIAM Web]
    DEP --> PVT
    RAMP --> MOB[Mobile Agent]
    AIR --> PUB[Portal de clientes]
    VIS --> PUB
    PVT --> API[API como autoridad]
    MOB --> API
    PUB --> API
```

## Audiencias respaldadas por el repositorio

Posterior al commit verificado de esta nota: las columnas «Nivel de certeza» y
«Estado» describen el código de `39a85a46`.

| Audiencia | Resultado que el producto sirve | Cliente | Nivel de certeza |
| --- | --- | --- | --- |
| OCC/control operativo | planificar, monitorear, revisar y aprobar/devolver operaciones | AVIAM Web | Audiencia explícita; permisos del departamento Operaciones en el catálogo del servidor |
| Administración y departamentos internos | trabajar con contratos, finanzas, gestión humana, reportes y operaciones según su función | AVIAM Web | Cuatro departamentos con módulos y acciones del catálogo del servidor; perfiles por plantilla |
| Agente de rampa | consultar asignaciones, iniciar/cerrar atención, completar checklist/hitos, reportar incidencias y sincronizar | Mobile Agent | Recorrido contra la API con sesión, tableta vinculada y cola offline idempotente |
| Usuario de aerolínea/cliente | consultar información limitada a su organización/estaciones y realizar escrituras expresamente autorizadas | Public Web | Sesión con código por correo; el servidor filtra por organización y estaciones |
| Visitante | conocer la propuesta pública y solicitar servicios | Public Web | Catálogo público y envío de solicitudes comerciales por la API |

## Actores del sistema que no son personas usuarias

| Actor | Responsabilidad | Estado |
| --- | --- | --- |
| API ELEVANT | autenticar, autorizar, aplicar scope, reglas y contratos | 400 operaciones de las cuatro fases del ciclo, con JWT y política fallback autenticada |
| SQL Server | persistir estado canónico de ELEVANT | 57 migraciones; nunca es interfaz de cliente |
| Proveedor de información de vuelos | aportar información externa mediante un adaptador | Adaptador AeroDataBox configurable, apagado por defecto |
| Dispositivo móvil registrado | acotar identidad de dispositivo y reintentos idempotentes | Vínculo de tableta, liberación y revocación por la API |

## Identidades que no deben confundirse

El modelo canónico separa:

- **persona:** identidad humana;
- **cuenta:** credenciales y acceso;
- **membresía de organización:** relación con un tenant;
- **perfil de agente de rampa:** vínculo laboral/operativo;
- **scope de estación/terminal:** límite contextual de acceso.

Un nombre, correo, etiqueta de UI o ID enviado por el navegador no reemplaza esas relaciones. El portal no elige un tenant confiable y el móvil no amplía su agente o estación enviando otro identificador.

## Lo que los roles del prototipo sí y no prueban

Los menús y fixtures permiten descubrir tareas, lenguaje y posibles separaciones de responsabilidad. No prueban:

- una matriz RBAC aprobada;
- segregación de funciones reglamentaria;
- que todos los departamentos necesiten todos los módulos visibles;
- jerarquías, turnos de aprobación o delegaciones;
- personas, volúmenes o condiciones reales de trabajo.

La autorización final debe expresarse en casos de uso y pruebas de API, no en rutas ocultas o almacenamiento del navegador.

## Investigación pendiente por audiencia

| Audiencia | Pregunta mínima antes de cerrar su MVP |
| --- | --- |
| OCC | ¿Qué eventos requieren acción inmediata y qué evidencia permite aprobar/devolver una operación? |
| Departamentos internos | ¿Qué tareas y datos son propios, compartidos o incompatibles entre funciones? |
| Agente de rampa | ¿Qué pasos deben funcionar sin red y cómo se resuelven conflictos al reconectar? |
| Aerolínea/cliente | ¿Qué información, latencia y capacidad de respuesta son contractualmente necesarias? |
| Visitante | ¿Qué objetivo tiene la landing y cuál es el tratamiento autorizado de una solicitud comercial? |

## Fuentes

- [README del monorepo](../../README.md): audiencias principales.
- [Private Web](../../frontend/private-web/README.md), [Public Web](../../frontend/public-web/README.md) y [Mobile Agent](../../frontend/mobile-agent/README.md): módulos y recorridos observados.
- [Base de datos v1](../../docs/architecture/database-v1.md) y [esquema v1](../../docs/database/schema-v1.md): separación de persona, cuenta, membresía, agente y scopes.
- [Límite de FlightAware](../../backend/Elevant.Infrastructure/Integrations/FlightAware/README.md): estado futuro de ese proveedor; el feed configurable vigente es AeroDataBox ([integraciones](../04-arquitectura/integraciones-externas.md)).

Relacionados: [Fronteras de los clientes](fronteras-de-clientes.md), [Preguntas abiertas](preguntas-abiertas.md) y [Mapa de producto](README.md).
