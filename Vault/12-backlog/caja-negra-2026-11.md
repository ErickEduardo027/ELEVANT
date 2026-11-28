---
id: backlog-caja-negra-2026-11
title: "Caja negra noviembre 2026: corridas en Development y hallazgos"
type: backlog
area: backlog
status: documented
maturity: evolving
evidence: operator-recorded
owner: equipo-elevant
last_verified: "2026-11-28"
verified_commit: "517bf8e68f6950a1ed77355e01446425362c374a"
sources:
  - docs/adr/0043-occ-maps-one-engine.md
  - docs/adr/0044-occ-noc-visual-system.md
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
| CN-27 | Renombrar una estación invalida las firmas de documentos ya firmados | La firma solo caduca si cambian los hechos operativos, no las etiquetas de datos maestros | Aprobado; en curso |
| CN-28 | La importación no carga el tipo de avión ni la posición de vuelos reales | Tipo desde el tráfico en vivo o el historial; posición desde la puerta del aeropuerto o sugerida por terminal y tamaño | En PR |
| CN-29 | La ruta prevista de un vuelo real dibuja un rodeo en ángulo recto cerca de Higüey | Aproximación propia desde la posición y el rumbo del avión, suave hasta la final; estelas de otros vuelos ocultas mientras se elige uno; rótulos que no se pisan en las terminales | En PR |
| CN-30 | Seguir al avión en 3D con un panel de vuelo y operación | «Seguir en 3D»: cámara que orbita el avión (vistas, gestos y botones), panel lateral, modelos 3D detallados con libreas y actitud real | En PR |
| CN-31 | Los aviones reales deben verse donde están, también en rodaje | Mezcla de 1,5 s, sin rodaje estimado para un avión real, estacionamiento en su posición, calzos de la tablet, aviso de posición distinta; lectura del aeródromo cada 3 s | En PR |
| CN-32 | Monitoreo OCC más profesional: paneles y controles dispersos sobre el mapa | Una columna de control por mapa, paneles acoplados en Panorama, detalle acoplado con los datos en vivo y tablero ordenable con demoras en Monitoreo | En PR |
| CN-32 (M1) | Refinamiento del 27 de noviembre: los paneles acoplados restan mapa; el dueño pide el mapa a pantalla completa con todo flotando dentro | Mapa a pantalla completa en Panorama, Monitoreo y Mapa de posiciones, con paneles flotantes medidos y la columna de control fija en el borde derecho | En Development (#242 por #243); sin desplegar |

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

## Refinamiento definitivo de los mapas (27–28-nov)

Plan de mapas del 27 de noviembre, en nueve líneas. M3 (#235) y M6 (#236) se fusionaron en `Development` por su
cuenta; las demás se unieron en la rama de integración `feat/occ-mapas-integracion`, que entró por la PR #243 y cierra
las PRs de cada línea (#237 a #242; M7 no tuvo PR propia). La verificación final de esa rama (batería completa, capturas
revisadas, medición en GPU real y esta documentación) va en una PR aparte hacia `Development`. Nada está desplegado. El
detalle y las decisiones de la integración están en las notas fechadas del
[ADR-0043](../../docs/adr/0043-occ-maps-one-engine.md) y del [ADR-0044](../../docs/adr/0044-occ-noc-visual-system.md).

| Línea | Qué entrega | PR |
| --- | --- | --- |
| M1 | Mapa a pantalla completa en Panorama, Monitoreo y Mapa de posiciones; paneles flotantes medidos y columna de control fija en el borde derecho (revierte el acoplado de CN-32) | #242 (por #243) |
| M2 | Capa de tráfico animada: cada cuadro interpola los aviones a la vista en three.js; regulador corregido, GeoJSON del tráfico a 2 Hz o menos y medidor Ctrl+Alt+F | #240 (por #243) |
| M3 | Seguimiento ampliado: lectura de 25 NM cada 2 s, búsqueda mundial de vuelos de AVIAM y rodaje continuo | #235 (fusionada) |
| M4 | «Seguir en 3D» ultra cerca: doble clic o botón en las tres pantallas, zoom 22 y vista «Muy cerca» con cielo, sol y sombra de contacto | #238 (por #243) |
| M5 | Modelos 3D de terceros con licencia GPL (L1 y L2), libreas propias, logotipos de dominio público con aviso de marcas y «Créditos y licencias» | #241 (por #243) |
| M6 | Meteorología regional en el servidor: METAR y TAF de la región (NOAA AWC), SIGMET, malla de viento (Open-Meteo) e índice del radar (IEM), sin SQL ni migración | #236 (fusionada) |
| M7 | Panorama meteorológico: abre en Región; bucle GOES-East, radar, estaciones METAR por categoría de vuelo y SIGMET en el mapa, y el panel «Meteorología PUJ» | Sin PR propia (por #243) |
| M8 | Monitoreo mundial en globo con la vista «Mundo», apertura en RD, base mundial de GIBS, rutas de los vuelos de AVIAM y filtros del tablero enlazados al mapa | #239 (por #243) |
| M9 | Mapa de posiciones fijado en PUJ, aeropuerto en 3D (terminales, fingers y calles de rodaje) y aviones estacionados con librea | #237 (por #243) |

### Medición en GPU real tras la integración

Laboratorio de mapas de M2 sobre la rama de integración (`a0c7ce23`), 28-nov: Intel UHD (el piso), ANGLE sobre
Direct3D 11, 1920 × 1080, densidad 1, `next dev` en la laptop de desarrollo. Entre paréntesis, la segunda corrida.

| Escena | Cuadros/s | p50 / p95 (ms) | Cuadros de más de 33,3 ms | Bloqueo del hilo (s/min) |
| --- | --- | --- | --- | --- |
| Aproximación (`perf-approach-feed`) | 120,7 | 7,5 / 12,5 | 0,1 % | 0 |
| Aeródromo (`perf-airfield-feed`) | 129,5 | 7,1 / 11,6 | 0,1 % | 0 |
| Aeródromo reproducido en 3D | 135,3 (120,6) | 6,9 / 11,4 (7,2 / 14,4) | 0,1 % (0,7 %) | 0,17 (0,20) |
| «Seguir en 3D» en el aeródromo reproducido | 136,3 (129,2) | 7,0 / 10,0 (7,1 / 10,8) | 0,2 % (0,3 %) | 0 (0) |

Todas pasan los pisos (30 cuadros/s o más y p95 de 33 ms o menos), con cifras iguales o mejores que las de M2 en la
misma GPU. No se volvieron a medir la RTX 3060, el globo de Monitoreo ni el Mapa de posiciones con el aeropuerto en 3D;
la medición del NOC en el VPS queda para después del despliegue.

### Límites conocidos

- En el globo no hay modelos 3D por debajo del zoom 12: ahí los aviones se dibujan con los iconos GeoJSON.
- El filtro del tablero atenúa siluetas, placas y rótulos, pero no los modelos 3D instanciados.
- El radar es el de TJUA (IEM), y PUJ queda en el borde de su alcance.
- Open-Meteo y adsb.fi son de uso no comercial y solo se usan en Development; Production necesita el plan comercial de
  Open-Meteo y revisar las condiciones de las demás fuentes.
- Las alturas de las estructuras del aeropuerto en 3D son estimadas y se rotulan como tales.

## Propuestas aplazadas

No se programan hasta la fecha indicada; cambian el ciclo operativo o requieren decisión de producto.

| ID | Propuesta | Cuándo |
| --- | --- | --- |
| P-01 | Aviso a OCC cuando a un agente le termina el turno con una operación en curso, con acceso directo al relevo | Después de la segunda corrida |
| P-02 | Asignación automática al importar un vuelo a una posición con cobertura activa y un agente elegible; OCC atiende solo las excepciones | Después de la auditoría del 30 de noviembre |

## Relacionado

- [Backlog transversal](README.md)
- [Pendientes transversales](pendientes-transversales.md)
