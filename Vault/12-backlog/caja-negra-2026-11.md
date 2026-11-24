---
id: backlog-caja-negra-2026-11
title: "Caja negra noviembre 2026: corridas en Development y hallazgos"
type: backlog
area: backlog
status: documented
maturity: evolving
evidence: operator-recorded
owner: equipo-elevant
last_verified: "2026-11-24"
verified_commit: "ccf028fa73fa1c056dc303f32c36887e4d0fe0d8"
sources:
  - docs/adr/0043-occ-maps-one-engine.md
  - frontend/private-web/src/features/maps/core/frameLoop.js
  - frontend/mobile-agent/src/app/flight/[id].tsx
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Seed/DevelopmentDataSeeder.cs
tags:
  - backlog
  - caja-negra
  - calidad
---

# Caja negra noviembre 2026

Entre el 24 y el 30 de noviembre de 2026 el equipo recorre ELEVANT como lo haría un evaluador externo: el ciclo
operativo completo en el ambiente Development, desde una solicitud nueva hasta la factura cobrada y el portal de la
aerolínea. Cada corrida produce hallazgos numerados `CN-NN`; nada se corrige sin aprobación y el flujo del ciclo
operativo no cambia durante este periodo.

## Método

1. Corrida completa en Development con las cuentas de prueba de cada rol y la tablet en emulador.
2. Registro de capturas, errores de consola, peticiones fallidas, tiempos de carga y fluidez del NOC.
3. Hallazgos con pantalla, evidencia, gravedad y propuesta; el responsable del producto aprueba.
4. Corrección en PRs pequeños hacia `Development`; nueva corrida con otra aerolínea.

Los datos que crea cada corrida quedan en Development y deben ser realistas y coherentes.

## Corrida 1 — Copa Airlines (24-nov)

Recorrido: solicitud pública (bloqueada por segunda afiliación) → enmienda del contrato vigente con servicios nuevos →
aprobación de precios en Finanzas → firma de la aerolínea y de AVIAM → cobertura → vuelo demo → importación y
asignación en OCC → operación completa en la tablet → revisión OCC → e-CF → cobro por transferencia → portal.

| ID | Hallazgo | Arreglo | Estado |
| --- | --- | --- | --- |
| CN-01 | Servicios de prueba y nombres en inglés en el catálogo | Baja por la aplicación; nombres en español en el seed | Datos corregidos; seed en PR |
| CN-02 | Aerolíneas repetidas en los filtros de Finanzas | Etiqueta con IATA cuando dos comparten nombre | En PR |
| CN-03 | Entregas viejas «Pendiente» en Revisión OCC | La historia no firmaba la Orden de Servicio (ver CN-26) | En PR |
| CN-04 | Operaciones viejas en «Por facturar» | Facturadas por aerolínea desde Finanzas | Datos corregidos |
| CN-05 | Solicitud pública de prueba abierta | Rechazada con motivo | Datos corregidos |
| CN-06 | «Development» visible en nombres y textos | Tipos de avión y estación renombrados; seed y texto de Contratos | Parcial; seed y texto en PR |
| CN-07 | Identificadores internos crudos a la vista | Códigos legibles en notificaciones y factura | En PR; referencia de solicitud aplazada (requiere migración) |
| CN-08 | Botón «Nueva solicitud» deshabilitado en el portal | Ocultarlo y explicar el canal real | En PR |
| CN-09 | El asistente público no avisa a clientes existentes | Aviso genérico en el paso de aerolínea | En PR |
| CN-10 | Texto de cobertura promete asignación automática | Texto fiel a la regla real | En PR |
| CN-11 | Selección de posiciones de cobertura inconsistente | Límite, limpieza y vehículo visible antes de enviar | En PR |
| CN-12 | «Enviar a Finanzas» sin aviso visible | Aviso junto al editor y estado claro | En PR |
| CN-13 | Contrato «Aprobada» con firmas pendientes | «Precios aprobados · firmas pendientes» | En PR |
| CN-14 | Preaviso de terminación duplicado | Ayuda y limpieza al guardar | En PR |
| CN-15 | «Emitir factura» sin confirmación; lista vacía tras emitir | Diálogo de confirmación y filtro coherente | En PR |
| CN-16 | Recargo nocturno y festivo distintos de la Orden de Servicio | Nueva versión del tarifario al 15 % | Datos corregidos |
| CN-17 | Petición de línea de tiempo con versión nula | No consultar sin versión | En PR |
| CN-18 | Panorama y Mapa de posiciones saturan el hilo principal; aviones «saltan» | Movimiento suavizado y menos escrituras por cuadro | En PR |
| CN-19 | Pantallas OCC sobre el presupuesto de peticiones | Una sola suscripción y lecturas coalescidas | En PR |
| CN-20 | Inicios de sesión y primeras cargas lentos | Se mide de nuevo tras CN-18/19 | Pendiente |
| CN-21 | Códigos de posición mezclados en la tablet | Código de presentación compartido | En PR |
| CN-22 | Pantalla de operación demasiado larga | Pestañas con progreso | En PR |
| CN-23 | Confirmación de servicio fuera de la vista | Confirmar en el mismo lugar | En PR |
| CN-24 | Firmar antes del push-back obliga a firmar dos veces | Aviso; bloquear la firma queda aplazado | En PR |
| CN-25 | Texto en inglés en la asignación de la tablet | «Agente de rampa» | En PR |
| CN-26 | La historia sintética no firma la Orden de Servicio | Bloque adicional del seeder que inserta las firmas | En PR |

### Medición del NOC (base, antes de CN-18/19)

Chromium sin GPU, un minuto por pantalla con un vuelo demo en curso.

| Pantalla | Carga | Peticiones/min | Bloqueo del hilo | FPS |
| --- | --- | --- | --- | --- |
| Panorama | 2,4 s | 52 | 56 s | 12 |
| Mapa de posiciones | 13 s | 44 | 54 s | 16 |
| Monitoreo | 8,3 s | 79 | 0,9 s | 42 |
| Planificación | 2,0 s | 49 | 0 s | 60 |
| Cobertura | 1,6 s | 62 | 0 s | 60 |
| Revisión | 1,8 s | 32 | 0 s | 60 |

Meta tras los arreglos: bloqueo menor de 10 s por minuto, 40 FPS o más y como máximo 40 peticiones por minuto.

## Relacionado

- [Backlog transversal](README.md)
- [Pendientes transversales](pendientes-transversales.md)
