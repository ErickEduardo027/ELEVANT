CONTEXTO DE CONTINUIDAD — LEER COMPLETAMENTE ANTES DE EMPEZAR

Ya existen en el proyecto:

• Login
• Dashboard del Administrador/OCC
• AppShell
• Sidebar
• Topbar
• Design System
• Modo claro y oscuro
• Componentes reutilizables
• Módulo de Monitoreo de Vuelos
• Estructura de rutas existente
• Patrones de tablas, listas, detalles, badges y paneles

Este módulo se integrará como una nueva ruta dentro del AppShell existente.

ANTES DE ESCRIBIR CÓDIGO:

1. Inspecciona completamente la estructura actual del proyecto.
2. Revisa cómo están implementados Dashboard y Monitoreo de Vuelos.
3. Identifica componentes reutilizables.
4. Identifica tokens de diseño.
5. Identifica patrones de tabla/lista/detalle.
6. Identifica cómo se manejan los drawers, modals, toasts y estados.
7. Identifica cómo están configuradas las rutas.
8. Identifica si el Sidebar ya contiene un ítem llamado "Aprobaciones".

NO reconstruyas:

• AppShell
• Sidebar
• Topbar
• Dashboard
• Monitoreo de Vuelos

Reutiliza todo lo existente.

========================================================
CAMBIO DE NOMBRE — IMPORTANTE
========================================================

El módulo anteriormente llamado:

"Aprobaciones"

ahora se llama:

"Revisión"

Este nombre debe utilizarse en TODA la interfaz.

Si actualmente existe:

Aprobaciones

como label del Sidebar, debe cambiarse a:

Revisión

También debe actualizarse la ruta y cualquier referencia visible relacionada, sin romper el badge de conteo ni la navegación existente.

No utilizar "Aprobaciones" como nombre visible del módulo.

La acción individual sí puede llamarse:

"Aprobar"

porque aprobar es una de las decisiones posibles dentro del proceso de revisión.

========================================================
ROL DEL MÓDULO
========================================================

Actúa como Senior Frontend Engineer y Product Designer especializado en software enterprise para operaciones aeroportuarias.

Debes construir el módulo:

REVISIÓN

del entorno Administrador/OCC de ELEVANT.

ELEVANT es una plataforma de gestión de operaciones de ground handling utilizada por AVIAM Ltd. en el Aeropuerto Internacional de Punta Cana (PUJ).

========================================================
CONCEPTO FUNCIONAL
========================================================

Este módulo representa un punto de control obligatorio dentro del flujo operacional.

La operación sigue conceptualmente este flujo:

PLANIFICACIÓN
↓
ASIGNACIÓN
↓
EJECUCIÓN
↓
REPORTE DEL AGENTE
↓
PENDIENTE DE REVISIÓN
↓
REVISIÓN OCC
↓
APROBADA
↓
FINANZAS

Si el OCC detecta errores:

REVISIÓN
↓
DEVUELTA CON CORRECCIONES
↓
AGENTE / SUPERVISOR
↓
CORRIGE
↓
REENVIADA
↓
NUEVA REVISIÓN

Por tanto:

PLANIFICACIÓN responde:

"¿Qué debía ocurrir?"

MONITOREO responde:

"¿Qué está ocurriendo?"

REVISIÓN responde:

"¿Lo que ocurrió y fue reportado es correcto y puede pasar a Finanzas?"

No diseñar este módulo como un simple CRUD.

No diseñarlo como una simple bandeja de aprobaciones.

Debe sentirse como un:

CENTRO DE CONTROL Y VALIDACIÓN OPERACIONAL.

========================================================
OBJETIVOS DEL OCC
========================================================

Desde este módulo el Administrador/OCC debe poder determinar rápidamente:

• ¿Qué operaciones necesitan revisión?
• ¿Qué vuelo corresponde?
• ¿Quién realizó la operación?
• ¿Qué se planificó?
• ¿Qué ocurrió realmente?
• ¿Cuándo ocurrió?
• ¿Qué servicios se ejecutaron?
• ¿Qué equipos fueron utilizados?
• ¿Existen incidencias?
• ¿Existen discrepancias?
• ¿Las firmas requeridas están completas?
• ¿La operación coincide con lo contratado?
• ¿Está lista para pasar a Finanzas?
• ¿Necesita correcciones?

La información crítica debe poder identificarse en pocos segundos.

========================================================
ESTILO VISUAL
========================================================

Mantener exactamente el lenguaje visual de ELEVANT.

Premium.

Corporativo.

Minimalista.

Enterprise.

Aviation Operations Software.

Glassmorphism moderado.

Cero emojis.

Cero iconografía decorativa.

Iconografía únicamente outline, técnica y geométrica.

No crear un diseño consumer.

No utilizar colores fuera del Design System.

========================================================
PALETA
========================================================

Azul marino:

#0B1F3F

Azul de acento:

#145DC4

Naranja:

#F2661E

Modo claro:

Background
#F7F9FB

Cards
#FFFFFF

Texto principal
#0B1F3F

Texto secundario
#6B7684

Modo oscuro:

Background
#0A1220

Cards:

rgba(11,31,63,0.55)

Texto principal:

#F4F6F9

Texto secundario:

#94A3B8

========================================================
ESTADOS DEL FLUJO DE REVISIÓN
========================================================

Pendiente de revisión

Ámbar:

#D9A441

En revisión

Azul:

#145DC4

Aprobado

Verde:

#1E9E6B

Devuelto con correcciones

Rojo:

#C4453C

Reenviado

Azul:

#145DC4

========================================================
LAYOUT PRINCIPAL
========================================================

Utilizar patrón:

MASTER / DETAIL

Desktop:

+----------------------------------------------------------+
| Header                                                   |
+----------------------------------------------------------+
| KPIs                                                     |
+----------------------------------------------------------+
| Tabs / filtros / búsqueda                                |
+----------------------------------------------------------+
|                                                          |
|                 TABLA DE REVISIÓN                        |
|                                                          |
+----------------------------------------------------------+

Al seleccionar una operación:

+--------------------------------------+-------------------+
|                                      |                   |
| Tabla / cola de revisión             | Review Drawer     |
|                                      |                   |
|                                      |                   |
|                                      |                   |
+--------------------------------------+-------------------+

El detalle debe abrirse como Drawer lateral derecho.

Si el proyecto ya posee un patrón de Drawer para detalles, reutilizarlo.

No crear un patrón diferente sin necesidad.

========================================================
1. HEADER
========================================================

Título:

Revisión

Descripción:

"Revise y valide las operaciones de ground handling antes de enviarlas a Finanzas."

Acciones:

Actualizar

Exportar

========================================================
2. KPIs
========================================================

Crear cuatro KPI Cards.

Reutilizar KpiCard existente si está disponible.

KPIs:

Pendientes de revisión

En revisión

Aprobadas hoy

Devueltas

Ejemplo:

Pendientes
12

En revisión
3

Aprobadas hoy
27

Devueltas
2

Los KPIs deben ser interactivos.

Click en KPI:

aplica automáticamente el filtro correspondiente.

========================================================
3. TABS / ESTADOS
========================================================

Crear navegación por estado:

Pendientes (12)

En revisión (3)

Aprobadas

Devueltas

Reenviadas

El estado activo debe utilizar el patrón visual existente.

No crear navegación visualmente pesada.

========================================================
4. FILTROS
========================================================

Filtros:

Estado

Aerolínea

Rango de fecha

Agente

Supervisor

Posición / Stand

Tipo de servicio

Número de vuelo

Referencia de orden

Buscador general

Debe existir:

Limpiar filtros

Los filtros deben poder combinarse.

========================================================
5. TABLA DE OPERACIONES
========================================================

Crear:

ReviewQueueTable

Cada fila debe mostrar:

• Checkbox
• Estado
• Aerolínea
• Número de vuelo
• Llegada / salida
• Fecha
• Posición / Stand
• Agente responsable
• Supervisor
• Hora de envío
• Tiempo esperando revisión
• Incidencias
• Acción

Ejemplo:

[PENDIENTE]

Arajet

DM161

MIA → PUJ

05 AGO 2026

A5

Carlos Medina

Juan Pérez

15:45

18 min

2 incidencias

[Revisar]

========================================================
6. ACCIONES RÁPIDAS
========================================================

Cada fila puede tener menú de acciones.

Menú:

Ver detalle

Aprobar

Devolver

Historial

La opción "Aprobar" rápida solo debe estar disponible cuando la operación cumpla las condiciones necesarias.

Si existen discrepancias críticas:

no permitir aprobación rápida.

Obligar al OCC a entrar al detalle.

========================================================
7. SELECCIÓN MÚLTIPLE
========================================================

Permitir seleccionar múltiples operaciones.

Cuando exista al menos una selección:

mostrar barra contextual.

Ejemplo:

3 operaciones seleccionadas

Acciones:

Aprobar seleccionadas

Devolver seleccionadas

Limpiar selección

IMPORTANTE:

Aprobar múltiples operaciones requiere confirmación explícita.

Mostrar:

"Está a punto de aprobar 3 operaciones."

"No podrá deshacer esta acción una vez confirmada."

No aprobar silenciosamente.

========================================================
8. REVIEW DETAIL DRAWER
========================================================

El Drawer debe ocupar aproximadamente:

60% del ancho en Desktop.

Debe ser amplio porque contiene información operacional compleja.

Header:

Número de vuelo

Aerolínea

Fecha

Posición

Estado

Prioridad

Botón cerrar

========================================================
9. DATOS DEL VUELO
========================================================

Mostrar:

Número de vuelo

Aerolínea

Origen

Destino

Tipo de aeronave

Matrícula

STA

ATA

STD

ATD

Llegada / salida

Posición

========================================================
10. TIMELINE OPERACIONAL
========================================================

Crear componente:

FlightTimeline

No presentar únicamente una tabla.

Utilizar timeline visual horizontal o adaptativo.

Mostrar:

Blocks On

Blocks Off

Apertura de puertas

Cierre de puertas

Inicio de carga

Fin de carga

Inicio de pasajeros

Primer pasajero

Último pasajero

Primer equipaje

Último equipaje

etc.

Los datos incompletos deben ser fácilmente identificables.

Ejemplo:

14:20
Blocks On

14:24
Puerta abierta

14:32
Inicio equipaje

14:55
Fin equipaje

15:12
Último pasajero

15:42
Blocks Off

Si falta información:

"Sin registro"

Debe destacarse discretamente.

========================================================
11. PLANIFICACIÓN VS EJECUCIÓN
========================================================

Esta sección es crítica.

Crear:

PlanningVsExecution

Comparar lado a lado:

PLANIFICADO | EJECUTADO

Posición

Hora

Agentes

Equipos

Servicios

Duración

Supervisor

Ejemplo:

Posición

A5 | A5

Resultado:

Coincide

Hora inicio

14:20 | 14:27

Resultado:

+7 min

Agentes

5 | 4

Resultado:

Discrepancia

Las diferencias deben resaltarse:

Coincide → verde sutil

Atención → ámbar sutil

Discrepancia crítica → rojo sutil

No utilizar colores agresivos.

========================================================
12. SERVICIOS Y EQUIPOS
========================================================

Crear:

ServiceChecklist

Mostrar los servicios reportados por el agente.

Ejemplo:

GPU
Completado

Baggage
Completado

Cleaning
Completado

Catering
No requerido

Pushback
Completado

Equipos:

Baggage Cart

Belt Loader

Dollies

Loader

Stairs

Tractor

GPU

ACU

ASU

Mostrar:

Planificado

Reportado

Utilizado

Si existe diferencia:

resaltarla.

========================================================
13. INCIDENCIAS Y OBSERVACIONES
========================================================

Crear:

IncidentList

Las incidencias NO deben quedar escondidas.

Si existen:

mostrar sección destacada.

Cada incidencia:

Descripción

Severidad

Reportada por

Fecha/hora

Estado

Observación

Ejemplo:

Retraso en carga de equipaje

Severidad:

Media

Reportado por:

Carlos Medina

14:52

Si no existen incidencias:

mostrar:

"Sin incidencias reportadas."

========================================================
14. CONCILIACIÓN CON CONTRATO
========================================================

Crear:

ReconciliationDiff

Esta sección permite al OCC detectar diferencias entre:

LO CONTRATADO

vs

LO EJECUTADO

Antes de aprobar.

Comparar:

Servicio

Cantidad

Equipo

Personal

Tiempo

Concepto facturable

Ejemplo:

Baggage Handling

Contratado:
4 agentes

Ejecutado:
4 agentes

Coincide.

Otro:

GPU

Contratado:
1

Ejecutado:
2

Diferencia:

+1

Mostrar discrepancias en ámbar o rojo.

Esta información será utilizada posteriormente por Finanzas.

El frontend debe dejar preparada esta estructura.

========================================================
15. FIRMAS
========================================================

Mostrar estado de firmas:

Representante de aerolínea

Firmado

Agente de rampa

Firmado

Supervisor

Pendiente

No es necesario mostrar la firma gráfica.

Mostrar:

Nombre

Rol

Fecha/hora

Estado

Si falta una firma requerida:

mostrar alerta de atención.

========================================================
16. EVIDENCIAS
========================================================

Preparar sección:

EvidenceList

Tipos posibles:

Fotografía

Documento

Registro

Checklist

Observación

Cada evidencia:

Nombre

Tipo

Usuario

Fecha

Estado

No implementar almacenamiento real si backend todavía no existe.

Utilizar mocks.

========================================================
17. OBSERVACIONES
========================================================

Mostrar las observaciones generales registradas por:

Agente

Supervisor

Sistema

Deben mostrar:

Usuario

Rol

Fecha

Hora

Comentario

========================================================
18. HISTORIAL
========================================================

Crear:

ReviewHistoryLog

Timeline de auditoría.

Ejemplo:

14:20
Operación iniciada

Usuario:
Carlos Medina

15:42
Operación completada

Usuario:
Carlos Medina

15:45
Reporte enviado a revisión

15:51
Recibido por OCC

16:02
Revisión iniciada

Usuario:
Administrador OCC

Mostrar:

Acción

Fecha

Hora

Usuario

Estado anterior

Estado nuevo

Comentario

========================================================
19. BARRA DE ACCIONES
========================================================

Fija en la parte inferior del Drawer.

Acciones principales:

Aprobar

Devolver con correcciones

Debe existir:

Ver historial

========================================================
20. APROBAR
========================================================

Al aprobar:

no utilizar un modal pesado.

Puede utilizar confirmación ligera según los patrones existentes.

Mostrar:

"Aprobar operación"

"Confirme que la operación ha sido revisada y cumple con los requisitos para pasar a Finanzas."

Acciones:

Confirmar

Cancelar

Después:

Toast:

"Operación aprobada correctamente."

La fila debe desaparecer de Pendientes con transición suave.

Actualizar contador.

Actualizar KPI.

========================================================
21. DEVOLVER CON CORRECCIONES
========================================================

Abrir modal o panel de confirmación.

Título:

Devolver con correcciones

Campo obligatorio:

Motivo de devolución

Placeholder:

"Indique qué información debe corregirse o completarse."

El botón confirmar permanece deshabilitado hasta que exista un comentario válido.

Al confirmar:

cambiar estado a:

DEVUELTO

Mostrar Toast.

La operación desaparece de Pendientes.

========================================================
22. REENVIADO
========================================================

Cuando una operación devuelta sea corregida y enviada nuevamente:

estado:

REENVIADO

Debe aparecer nuevamente en la cola de revisión.

Debe conservarse el historial anterior.

========================================================
23. ESTADOS DE LA INTERFAZ
========================================================

Implementar:

Loading

Skeleton

Empty

Error

Success

Pending Review

In Review

Approved

Returned

Resubmitted

========================================================
24. ESTADO VACÍO
========================================================

Cuando no existan operaciones pendientes:

"No hay operaciones pendientes de revisión."

Opcionalmente:

"Las operaciones completadas aparecerán aquí cuando sean enviadas por los agentes."

No emojis.

No ilustraciones consumer.

========================================================
25. ESTADOS ESPECIALES
========================================================

Debe existir mock para:

Caso limpio

Sin incidencias.

Sin discrepancias.

Todas las firmas completas.

Caso con incidencia

Incidencia visible.

Caso con discrepancia

Planificación ≠ ejecución.

Caso con problema contractual

Servicio contratado ≠ ejecutado.

Caso incompleto

Falta firma o timestamp.

Caso devuelto

Con historial de devolución.

Caso reenviado

Con historial anterior conservado.

========================================================
26. MICROINTERACCIONES
========================================================

Hover:

Elevación sutil.

Selección:

Highlight.

Aprobación:

Toast + transición de salida.

Devolución:

Confirmación + actualización de estado.

Discrepancias:

Highlight muy sutil.

Selección múltiple:

Barra contextual.

Drawer:

Animación suave.

No utilizar animaciones excesivas.

========================================================
27. RESPONSIVE
========================================================

Desktop 1440px+:

Tabla completa.

Drawer 60%.

Tablet:

Columnas reducidas.

Drawer como overlay de pantalla casi completa.

Mobile:

No prioritario.

Convertir tabla compleja en cards si es necesario.

========================================================
28. COMPONENTES
========================================================

Reutilizar componentes existentes.

Si no existen, crear:

ReviewPage

ReviewHeader

ReviewKPIs

ReviewTabs

ReviewFilters

ReviewQueueTable

ReviewQueueRow

ReviewStatusBadge

ReviewPriorityBadge

ReviewDetailDrawer

FlightInfoSection

FlightTimeline

PlanningVsExecution

ServiceChecklist

EquipmentList

IncidentList

ReconciliationDiff

SignatureStatus

EvidenceList

ObservationList

ReviewHistoryLog

ReviewActionBar

ApprovalConfirmation

ReturnCorrectionModal

ReviewEmptyState

ReviewSkeleton

========================================================
29. DATOS MOCK
========================================================

Crear mocks realistas.

Ejemplo:

{
  "id": "REV-1001",

  "status": "PENDING_REVIEW",

  "priority": "NORMAL",

  "flight": {
    "number": "DM161",
    "airline": "Arajet",
    "origin": "MIA",
    "destination": "PUJ",
    "aircraft": "B737 MAX 8",
    "registration": "HI1024"
  },

  "schedule": {
    "sta": "14:20",
    "ata": "14:27",
    "std": "15:35",
    "atd": "15:42"
  },

  "position": "A5",

  "agent": {
    "id": 12,
    "name": "Carlos Medina"
  },

  "supervisor": {
    "id": 5,
    "name": "Juan Pérez"
  },

  "planned": {
    "agents": 5,
    "stand": "A5",
    "services": [
      "GPU",
      "Baggage",
      "Cleaning"
    ]
  },

  "actual": {
    "agents": 5,
    "stand": "A5",
    "services": [
      "GPU",
      "Baggage",
      "Cleaning"
    ]
  },

  "timeline": [],

  "services": [],

  "equipment": [],

  "incidents": [],

  "evidence": [],

  "signatures": [],

  "reconciliation": [],

  "observations": [],

  "history": []
}

Crear varios registros mock que representen diferentes escenarios.

========================================================
30. API FUTURA
========================================================

No implementar backend.

Preparar interfaces y servicios tipados.

Endpoints conceptuales:

GET /reviews

GET /reviews/{id}

GET /reviews/statistics

GET /reviews/{id}/timeline

GET /reviews/{id}/services

GET /reviews/{id}/incidents

GET /reviews/{id}/evidence

GET /reviews/{id}/history

GET /reviews/{id}/reconciliation

POST /reviews/{id}/start-review

POST /reviews/{id}/approve

POST /reviews/{id}/return

POST /reviews/bulk-approve

POST /reviews/bulk-return

========================================================
31. INTEGRACIÓN CON FINANZAS
========================================================

El frontend debe reflejar conceptualmente:

Aprobada
↓
Disponible para Finanzas

No crear todavía un módulo de Finanzas.

No implementar lógica financiera.

Únicamente preparar el estado y la respuesta del frontend para que el backend pueda posteriormente notificar que la operación está lista para Finanzas.

========================================================
32. AUDITORÍA Y TRAZABILIDAD
========================================================

Toda decisión de revisión debe quedar preparada para auditoría.

El frontend debe manejar:

Usuario

Fecha

Hora

Acción

Comentario

Estado anterior

Estado nuevo

Esto es especialmente importante para:

Aprobación

Devolución

Reenvío

========================================================
33. RESTRICCIONES
========================================================

NO utilizar emojis.

NO utilizar colores fuera de la paleta.

NO modificar Dashboard.

NO modificar Monitoreo.

NO reconstruir Sidebar.

NO reconstruir AppShell.

NO crear componentes duplicados.

NO crear un CRUD genérico.

NO utilizar glassmorphism excesivo.

NO implementar backend.

NO ocultar discrepancias.

NO permitir aprobación silenciosa cuando existan diferencias críticas.

========================================================
34. CRITERIOS DE CALIDAD UX
========================================================

El OCC debe poder revisar una operación sin perder contexto.

Debe existir una jerarquía clara:

1. Estado
2. Vuelo
3. Incidencias
4. Discrepancias
5. Ejecución
6. Evidencias
7. Firmas
8. Historial
9. Decisión

La información más crítica debe estar arriba.

Las discrepancias deben destacar sin dominar toda la interfaz.

La acción de aprobar debe ser clara.

La acción de devolver debe ser clara.

No sobrecargar visualmente al operador.

========================================================
35. VALIDACIÓN FINAL
========================================================

Antes de considerar terminado el módulo:

1. Ejecuta el proyecto.
2. Verifica que compile.
3. Verifica TypeScript.
4. Verifica imports.
5. Verifica rutas.
6. Verifica Sidebar.
7. Verifica Dashboard.
8. Verifica Monitoreo.
9. Verifica Revisión.
10. Verifica Light Mode.
11. Verifica Dark Mode.
12. Verifica filtros.
13. Verifica búsqueda.
14. Verifica selección múltiple.
15. Verifica Drawer.
16. Verifica timeline.
17. Verifica discrepancias.
18. Verifica incidencias.
19. Verifica conciliación.
20. Verifica aprobación.
21. Verifica devolución.
22. Verifica estado reenviado.
23. Verifica historial.
24. Verifica estado vacío.
25. Verifica skeleton.
26. Verifica responsive.

Si encuentras problemas existentes en otros módulos:

NO los corrijas automáticamente si no son necesarios para este módulo.

No alterar funcionalidades existentes.

========================================================
OBJETIVO FINAL
========================================================

Construir un módulo de REVISIÓN que se sienta como una herramienta profesional de Operations Control Center.

El flujo conceptual debe ser:

Planificación
    ↓
Monitoreo
    ↓
Ejecución
    ↓
Reporte del agente
    ↓
REVISIÓN OCC
    ↓
┌───────────────────┐
│                   │
Aprobada        Devuelta
│                   │
↓                   ↓
Finanzas        Corrección
                    ↓
                Reenviada
                    ↓
                 Revisión

La experiencia debe permitir que el Administrador/OCC valide rápidamente que lo reportado corresponde con lo planificado, que los servicios fueron realmente ejecutados, que las incidencias fueron registradas, que las evidencias y firmas estén completas y que cualquier discrepancia contractual sea detectada antes de que la operación pase a Finanzas.

El resultado debe mantener exactamente la identidad visual de ELEVANT y sentirse como una evolución natural del Dashboard, Planificación y Monitoreo de Vuelos ya existentes.