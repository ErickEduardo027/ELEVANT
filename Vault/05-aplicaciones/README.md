---
id: aplicaciones-indice
title: "Mapa de aplicaciones"
type: index
area: applications
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "29600f562e82092b4341ff4c1696171037b51593"
sources:
  - AGENTS.md
  - frontend/AGENTS.md
  - frontend/private-web/README.md
  - frontend/public-web/README.md
  - frontend/mobile-agent/README.md
  - backend/README.md
  - database/DevelopmentDB/README.md
  - packages/api-client/README.md
tags:
  - aplicaciones
  - clientes
  - api
  - onboarding
---

# Mapa de aplicaciones

Para una capacidad posterior a la fotografía histórica de este mapa, véase
la [asistencia compartida OCC–agente](asistencia-compartida-occ-agente.md).
Su evidencia y commit se documentan en esa nota; no actualizan la
verificación histórica de las tablas siguientes.

La [clausura comercial de servicios](clausura-comercial-servicios.md) describe
el flujo OCC → Contratos, que se integró en `Development` por el merge #128,
después del commit verificado de esta nota, y sus límites de evidencia;
tampoco cambia la fotografía histórica de este índice.

> El [flujo comercial y de gobernanza](flujo-comercial-y-gobernanza.md) se integró en `Development` después del commit verificado de esta nota. Las tablas siguientes son una fotografía histórica de ese commit: no describen el alcance actual del merge #114 ni prueban su despliegue en el VPS.

ELEVANT es un sistema con tres clientes especializados, una API compartida y una sola base lógica por ambiente. Este mapa describe la responsabilidad y la madurez comprobable de cada frontera; una interfaz navegable no demuestra que su flujo de negocio ya tenga contrato HTTP, autorización o persistencia real.

## Leyenda de estado

| Señal | Lectura correcta |
| --- | --- |
| **Actual** | Existe código ejecutable o configuración comprobable en el commit verificado. |
| **Prototipo** | El flujo sirve para explorar UX y vocabulario, pero sus mocks y endpoints heredados no son contratos. |
| **Objetivo** | Es la frontera exigida por las guías y debe implementarse mediante contratos revisados. |
| **Desconocido** | El repositorio no permite afirmar la decisión, fecha o comportamiento. |

## Las cinco fronteras

| Frontera | Audiencia o función | Estado de implementación verificable | Perfil |
| --- | --- | --- | --- |
| Private Web / AVIAM | OCC, administración, contratos, finanzas, Gestión Humana y departamentos operativos | SPA React ejecutable y extensa; integración de negocio todavía depende de adaptadores prototípicos | [Private Web / AVIAM](private-web-aviam.md) |
| Public Web / portal | Visitantes y usuarios de aerolíneas/clientes | Landing y portal ejecutables; sesión, autorización y la mayoría de datos son mock/locales | [Public Web / portal](public-web-portal.md) |
| Correcciones de la revisión docente | Todos los departamentos y el portal | Estado de los 17 puntos de la revisión del 19-oct-2026 | [Correcciones de la revisión](correcciones-revision-docente-2026-10.md) |
| Mobile Agent | Agentes de rampa en tablet | Aplicación Expo ejecutable con flujos y outbox prototípicos; no consume aún los contratos de negocio de la API .NET | [Mobile Agent](mobile-agent.md) |
| API compartida | Única puerta a reglas, datos e integraciones para los tres clientes | Host .NET funcional con diagnóstico, health, OpenAPI y hubs reservados; sin autenticación ni endpoints de negocio | [API compartida](api-compartida.md) |
| DevelopmentDB | Esquema y persistencia compartidos de Development | Modelo EF y cadena de migraciones ejecutables; solo la API es dependencia de aplicación autorizada | [DevelopmentDB compartida](developmentdb-compartida.md) |

## Regla de composición

El recorrido objetivo siempre cruza estas fronteras:

1. una persona interactúa con el cliente que corresponde a su contexto;
2. el cliente usa un contrato OpenAPI versionado sobre HTTPS;
3. la API autentica, autoriza, aplica tenant/estación y ejecuta el caso de uso;
4. la persistencia conserva el estado canónico;
5. el cliente representa éxito, vacío, error recuperable o no autorizado.

En el commit verificado, las piezas técnicas de los pasos 2 a 4 existen por separado: el API expone un `ping` en OpenAPI y readiness comprueba la base de datos. Ningún caso de negocio documentado recorre todavía esos pasos de extremo a extremo; esos recorridos siguen siendo prototipos o trabajo pendiente.

## Dependencias permitidas

| Desde | Puede depender de | No puede depender directamente de |
| --- | --- | --- |
| Los tres clientes | `@elevant/api-client`, capacidades de su plataforma y API HTTPS | SQL Server, entidades EF, credenciales de servidor o proveedores aeronáuticos |
| API | Application, Contracts, Infrastructure y Persistence mediante composición | Mocks de clientes o almacenamiento del navegador/dispositivo |
| Persistence | Domain y SQL Server mediante EF Core | Decisiones de UI o fixtures de frontend |
| Cliente API compartido | Snapshot OpenAPI revisado | Estructuras mock, entidades EF o una URL privada horneada |

## Ruta de lectura recomendada

- Si vas a modificar una pantalla: abre primero el perfil del cliente y después su `AGENTS.md`/README de código.
- Si el cambio cruza HTTP: lee [API compartida](api-compartida.md) y el [contrato OpenAPI](../../docs/api/openapi-contract.md).
- Si cambia estructura persistente: lee [DevelopmentDB compartida](developmentdb-compartida.md) y el [modelo de dominio](../03-dominio/README.md).
- Si el requisito parece salir de un mock: comprueba [Fronteras de los clientes](../02-producto/fronteras-de-clientes.md) antes de tratarlo como contrato.

## Respuestas rápidas

| Pregunta | Respuesta verificable |
| --- | --- |
| ¿Cada cliente tiene su backend o base? | No. Comparten una API y una base lógica por ambiente. |
| ¿Los prototipos ya usan la API de negocio? | No de forma general. El OpenAPI actual solo publica `system/ping`. |
| ¿Un tipo TypeScript/JS de una pantalla define el contrato? | No. El contrato existe cuando está publicado en OpenAPI y generado en el cliente compartido. |
| ¿Mobile Agent se despliega como web en el VPS? | No. Su destino es una app nativa instalada; la primera distribución firmada sigue pendiente. |
| ¿Una tabla existente prueba que la capacidad está lista? | No. Prueba estructura persistente, no endpoint, autorización ni recorrido de usuario. |

## Extensiones de la rama de trabajo

- [Acceso animado y certificación](acceso-animado-y-certificacion.md): introducción y carrusel verificados contra la imagen de producción, con límites explícitos de aceptación en el VPS.
- [Cobros, aplicaciones y consulta de aerolínea](tesoreria-cobros-y-portal.md): implementación local de Tesorería y consultas financieras del portal.

## Fuentes verificadas

- [Guía raíz](../../AGENTS.md) y [guía de frontends](../../frontend/AGENTS.md): límites normativos de clientes, API y datos.
- [Private Web](../../frontend/private-web/README.md), [Public Web](../../frontend/public-web/README.md) y [Mobile Agent](../../frontend/mobile-agent/README.md): estado, comandos y configuración propios.
- [Backend](../../backend/README.md) y [DevelopmentDB](../../database/DevelopmentDB/README.md): superficie compartida y persistencia.
- [Cliente API compartido](../../packages/api-client/README.md): generación, transporte y contrato TypeScript.
