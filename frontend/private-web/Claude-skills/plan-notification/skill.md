CONTEXTO DE CONTINUIDAD — LEER ANTES DE EMPEZAR:

Ya existen en el proyecto:

- Login
- AppShell
- Sidebar
- Topbar
- Dashboard
- Monitoreo de Vuelos
- Revisión
- Reportes

Antes de crear o modificar cualquier cosa, inspecciona el proyecto real.

Especialmente revisa:

- AlertsFeed del Dashboard
- tipos de alerta ya definidos
- StatusBadge
- sistema de badges del Sidebar/Topbar
- sistema de filtros
- componentes de lista
- drawers/paneles de detalle
- toasts
- skeleton loaders
- estados vacíos
- paginación
- sistema de rutas
- sistema de modo claro/oscuro
- tokens de diseño
- arquitectura de servicios/API
- sistema de mocks

IMPORTANTE:

El Dashboard ya posee un AlertsFeed que muestra las últimas 5-6 alertas.

El módulo "Notificaciones" es la versión completa, histórica y gestionable de ese feed.

Por lo tanto:

NO inventes un sistema de tipos de alerta diferente.

Reutiliza los tipos, categorías, severidades, iconografía y lenguaje visual ya definidos en AlertsFeed siempre que sea posible.

NO reconstruyas Dashboard.

NO reconstruyas AppShell.

NO reconstruyas Sidebar.

NO reconstruyas Topbar.

NO reemplaces componentes funcionales existentes.

Este módulo debe integrarse como una nueva ruta dentro del AppShell existente, accesible desde el ítem "Notificaciones" del Sidebar.

Debe utilizar el mismo badge de cantidad de notificaciones no leídas que ya existe en el shell.

Si el badge actualmente utiliza estado global/context/store, reutiliza ese mismo mecanismo.

---

ACTÚA COMO:

Un Senior Frontend Engineer + Product Designer especializado en software enterprise para operaciones aeroportuarias.

Vas a diseñar y construir el módulo completo de "Notificaciones" del entorno Administrador/OCC de ELEVANT.

ELEVANT es una plataforma corporativa de gestión de operaciones de ground handling para AVIAM Ltd. en el aeropuerto de Punta Cana (PUJ).

Estoy trabajando exclusivamente en frontend y UX/UI.

---

OBJETIVO DEL MÓDULO:

Este módulo representa el centro histórico y gestionable de notificaciones del sistema.

A diferencia del AlertsFeed del Dashboard, que únicamente presenta las últimas alertas relevantes, aquí el Administrador/OCC podrá:

- consultar el historial completo
- buscar notificaciones
- filtrar por categoría
- filtrar por severidad
- filtrar por estado leído/no leído
- filtrar por fecha
- identificar eventos críticos
- marcar notificaciones como leídas
- marcar notificaciones como no leídas
- marcar todas como leídas
- seleccionar múltiples notificaciones
- realizar acciones masivas
- abrir el contexto de una notificación
- navegar al recurso relacionado
- consultar información adicional
- recibir nuevas notificaciones en tiempo real
- mantener sincronizado el contador del Sidebar/Topbar

El módulo debe sentirse como un centro de operaciones enterprise y no como una bandeja de correo genérica.

---

TIPOS DE NOTIFICACIONES:

Contemplar las siguientes categorías:

1. OPERATIVAS

Eventos relacionados con la operación aeroportuaria:

- cambios de posición
- posiciones inhabilitadas automáticamente
- vuelos fuera de tiempo estimado
- cambios operacionales
- incidencias relacionadas con vuelos
- alertas de operación

Ejemplo:

"Vuelo DM161 fuera de tiempo estimado"

"El vuelo DM161 no llegó a la posición asignada según la hora estimada."

Otro:

"Posición A10 inhabilitada"

"La posición A10 fue marcada como no disponible debido a una configuración 9-Alfa."

2. REVISIÓN

Eventos relacionados con el proceso de revisión:

- nueva operación pendiente de revisión
- operación devuelta con correcciones
- operación reenviada
- operación aprobada

Ejemplo:

"Nueva operación pendiente de revisión"

"El reporte de la operación del vuelo AA123 fue enviado y requiere revisión."

3. SISTEMA / INTEGRACIÓN

Eventos relacionados con integraciones y funcionamiento del sistema:

- FlyAware desconectado
- recuperación de FlyAware
- error de sincronización
- API no disponible
- recuperación de conexión
- errores importantes del sistema

Ejemplo:

"FlyAware desconectado"

"No se ha recibido información actualizada de vuelos desde hace 8 minutos."

4. PERSONAL

Eventos provenientes de Gestión Humana que son relevantes para OCC:

- habilitación próxima a vencer
- carnet próximo a vencer
- habilitación vencida
- documentación que requiere atención

Estas notificaciones hacen referencia a información proveniente de Gestión Humana, pero son visibles para el Administrador/OCC.

5. GENERALES

Mensajes generales del sistema.

---

SEVERIDADES:

Utilizar exactamente el sistema visual existente.

Informativa:
#145DC4

Atención / Advertencia:
#D9A441

Crítica:
#C4453C

Positiva / Confirmación:
#1E9E6B

No utilizar grandes bloques de color.

La severidad debe comunicarse mediante:

- indicador lateral
- punto
- badge
- iconografía
- tipografía

de forma discreta y profesional.

---

ESTILO VISUAL:

Mantener exactamente el lenguaje visual de Dashboard, Monitoreo de Vuelos, Revisión y Reportes.

Características:

- premium
- corporativo
- minimalista
- enterprise
- aeronáutico
- alta densidad de información
- excelente jerarquía visual
- glassmorphism moderado
- cero emojis
- cero iconografía decorativa
- iconografía outline
- geometría técnica
- animaciones discretas
- modo claro y oscuro

Tipografía:

Reutilizar la tipografía existente.

Preferentemente:

Inter
o
IBM Plex Sans

No introducir una fuente nueva si ya existe una definida.

---

PALETA:

Primario:
#0B1F3F

Azul:
#145DC4

Naranja:
#F2661E

Light:

Background:
#F7F9FB

Cards:
#FFFFFF

Texto principal:
#0B1F3F

Texto secundario:
#6B7684

Dark:

Background:
#0A1220

Cards:
rgba(11,31,63,0.55)

Texto principal:
#F4F6F9

Texto secundario:
#94A3B8

Mantener los mismos tokens existentes.

No crear colores arbitrarios.

---

ESTRUCTURA DEL MÓDULO:

1. HEADER

Título:

"Notificaciones"

Subtítulo:

"Historial y alertas operativas del sistema."

A la derecha:

"Marcar todas como leídas"

y un botón/icono de configuración para preferencias de notificaciones.

Debajo o integrado de forma discreta:

- Total
- No leídas
- Críticas
- Requieren atención

Estos indicadores no deben convertirse en un segundo Dashboard.

---

2. BARRA DE FILTROS

Crear NotificationFilterBar.

Debe incluir:

Categorías:

- Todas
- Operativas
- Revisión
- Sistema
- Personal
- Generales

Severidad:

- Todas
- Informativa
- Atención
- Crítica
- Positiva

Estado:

- Todas
- Solo no leídas
- Leídas

Fecha:

- Hoy
- Ayer
- Esta semana
- Últimos 30 días
- Rango personalizado

Buscador:

"Buscar por vuelo, referencia o descripción..."

Debe poder buscar por:

- número de vuelo
- aerolínea
- referencia
- operación
- posición
- título
- descripción

Agregar:

"Limpiar filtros"

cuando existan filtros activos.

Los filtros deben mantener el lenguaje visual de los módulos anteriores.

---

3. FEED PRINCIPAL

Crear NotificationFeed.

El feed debe estar centrado y tener un ancho de lectura cómodo en desktop, aproximadamente 720–800px, salvo que el diseño existente indique otra cosa.

Cada notificación debe mostrar:

- icono outline según categoría
- indicador de severidad
- título
- descripción breve
- timestamp relativo
- hora exacta disponible
- estado leído/no leído
- vuelo relacionado si aplica
- aerolínea si aplica
- posición si aplica
- acción contextual si aplica

Ejemplos:

"Vuelo DM161 fuera de tiempo estimado"

"Posición A10 inhabilitada"

"Nueva operación pendiente de revisión"

"FlyAware desconectado"

"Habilitación próxima a vencer"

---

4. NOTIFICACIONES LEÍDAS / NO LEÍDAS

Una notificación no leída debe distinguirse claramente.

Utilizar:

- pequeño punto
- fondo ligeramente diferente
- mayor peso tipográfico

Una notificación leída:

- menor contraste
- background neutro
- texto secundario

No hacer que una notificación no leída tenga un color excesivamente fuerte.

---

5. AGRUPACIÓN POR FECHA

Agrupar el feed mediante separadores:

HOY

AYER

ESTA SEMANA

ANTERIORES

Los separadores deben ser discretos.

No utilizar tarjetas gigantes.

---

6. ACCIONES DE NOTIFICACIÓN

Cada notificación debe poder:

- abrirse
- marcarse como leída
- marcarse como no leída
- navegar al recurso relacionado
- archivarse/descartarse si el modelo del sistema lo contempla

Al hacer clic:

Si no tiene navegación:
→ marcar como leída automáticamente.

Si tiene recurso relacionado:
→ marcar como leída
→ navegar al recurso.

Ejemplos:

Notificación de vuelo:
"Ver vuelo"

Debe llevar a:

Monitoreo de Vuelos

y, si es posible, seleccionar automáticamente ese vuelo.

Notificación de revisión:
"Ver operación"

Debe llevar a:

Revisión

Notificación relacionada con reportes:
"Ver reporte"

Debe llevar a:

Reportes

No crear rutas nuevas innecesarias.

---

7. DETALLE DE NOTIFICACIÓN

Al seleccionar una notificación, abrir un drawer lateral reutilizando el patrón existente del proyecto.

El drawer debe mostrar:

- categoría
- severidad
- estado
- título completo
- descripción completa
- fecha/hora
- origen de la notificación
- vuelo relacionado
- aerolínea
- posición
- operación relacionada
- usuario/sistema que generó el evento
- metadata relevante

Si existe un recurso relacionado:

Mostrar una acción clara:

"Ver vuelo"

"Ver operación"

"Ver revisión"

"Ver reporte"

según corresponda.

No crear una pantalla completa si el patrón de drawers existente funciona correctamente.

---

8. SELECCIÓN MÚLTIPLE

Agregar checkbox en cada notificación.

Cuando exista selección:

mostrar una barra contextual.

Ejemplo:

"4 seleccionadas"

Acciones:

- Marcar como leídas
- Marcar como no leídas
- Limpiar selección

No eliminar registros históricos.

Si existe archivado:

el archivado debe ser una acción secundaria.

---

9. MARCAR COMO LEÍDA

Al marcar una notificación:

- actualizar visualmente el estado
- actualizar contador global
- mantener la posición en el feed
- no eliminarla abruptamente

Usar una transición sutil de background/opacidad.

Mostrar toast breve:

"Notificación marcada como leída."

---

10. MARCAR TODAS COMO LEÍDAS

El botón:

"Marcar todas como leídas"

debe:

- ejecutar la acción
- actualizar el feed
- actualizar contador del Sidebar/Topbar
- mostrar toast

Ejemplo:

"Todas las notificaciones fueron marcadas como leídas."

No utilizar modal pesado para esta acción.

---

11. CONFIGURACIÓN DE NOTIFICACIONES

Agregar un botón de configuración.

Al abrirlo:

crear NotificationSettingsDrawer.

Debe ser simple en esta fase.

Permitir visualizar/preparar preferencias como:

Operativas
Revisión
Sistema
Personal
Generales

Cada categoría puede tener:

- Mostrar
- Silenciar

No es necesario implementar persistencia real si el backend todavía no existe.

La arquitectura debe quedar preparada.

---

12. TIEMPO REAL

El módulo debe quedar preparado para recibir nuevas notificaciones mediante:

- WebSocket

o temporalmente:

- polling

Cuando llegue una nueva notificación:

1. actualizar el contador global
2. insertar la notificación al inicio del feed si corresponde
3. mantener filtros activos
4. mostrar toast discreto
5. no recargar toda la página

La nueva notificación debe entrar con:

fade + slight slide

sin animaciones agresivas.

---

13. CONTADOR GLOBAL

El contador de no leídas debe utilizar el mismo estado que el Sidebar/Topbar.

No crear un contador independiente.

Si existen 0:

ocultar badge.

Si existen notificaciones:

mostrar cantidad.

Si existen muchas:

considerar formato:

99+

si ese patrón coincide con el proyecto.

---

14. ESTADOS

Implementar:

A. Loading

Skeleton del feed.

B. Estado vacío general

"Sin notificaciones nuevas"

"Las nuevas alertas y eventos operativos aparecerán aquí."

C. Estado vacío por filtro

"No hay notificaciones en esta categoría."

D. Solo no leídas

Mostrar exclusivamente las no leídas.

E. Todas leídas

Mostrar estado:

"Todas las notificaciones están al día."

F. Notificación crítica

Debe tener mayor peso visual.

Ejemplo:

"FlyAware desconectado"

No utilizar parpadeos.

G. Error

"No fue posible cargar las notificaciones."

Botón:

"Reintentar"

---

15. PAGINACIÓN

Si la arquitectura existente utiliza paginación:

reutilizarla.

Si no existe:

crear una solución reutilizable.

Debe soportar:

- página actual
- total
- anterior
- siguiente

No cargar miles de registros en el frontend.

Preparar para API.

---

16. DATOS MOCK

Crear mocks realistas separados de los componentes.

No colocar grandes arrays hardcodeados dentro del JSX.

Modelo sugerido:

{
  id,
  category,
  severity,
  title,
  description,
  read,
  createdAt,
  flightNumber,
  airline,
  position,
  operationId,
  relatedModule,
  relatedRoute,
  source,
  metadata
}

Los mocks deben incluir:

- Operativas
- Revisión
- Sistema
- Personal
- Generales

y todas las severidades.

También incluir:

- leídas
- no leídas
- críticas
- positivas
- notificaciones con navegación
- notificaciones sin navegación

---

17. API / ARQUITECTURA

Preparar el frontend para API REST.

No asumir endpoints definitivos.

No inventar contratos backend como si ya existieran.

Separar:

UI
estado
servicios
types
mocks

Funciones conceptuales:

getNotifications()
getUnreadNotificationCount()
getNotification(id)
markNotificationAsRead(id)
markNotificationAsUnread(id)
markAllNotificationsAsRead()
markNotificationsAsRead(ids)
updateNotificationPreferences()

Si ya existe una capa API:

reutilizarla.

No crear una arquitectura paralela.

---

18. RESPONSIVE

Desktop 1440px+:

- feed de 720–800px aproximadamente
- filtros horizontales
- drawer de detalle de aproximadamente 400–500px
- excelente aprovechamiento del espacio sin expandir innecesariamente las tarjetas

Tablet 1024px:

- filtros pueden pasar a segunda línea
- algunos filtros pueden colapsar
- drawer aproximadamente 60–70% del ancho

Mobile:

No es prioridad, pero debe funcionar.

- filtros en drawer
- feed a una columna
- detalle en pantalla completa

---

19. COMPONENTES

Reutilizar primero.

Si no existen, crear:

NotificationFeed
NotificationCard
NotificationFilterBar
NotificationDetailDrawer
NotificationSettingsDrawer
NotificationBulkActions
NotificationEmptyState
NotificationSkeleton
NotificationPriorityBadge

No duplicar:

AlertsFeed
StatusBadge
Toast
Drawer
Filter
Pagination

si ya existen componentes equivalentes.

---

20. MICROINTERACCIONES

Implementar:

- hover sutil
- selección
- transición al marcar como leída
- toast
- entrada de nuevas notificaciones
- drawer suave
- filtros activos
- actualización de badge

Evitar:

- rebotes
- parpadeos
- animaciones exageradas
- efectos consumer
- colores saturados

---

21. INTEGRACIÓN CON ALERTSFEED

ESTO ES IMPORTANTE.

El AlertsFeed del Dashboard debe considerarse la fuente visual y conceptual inicial del módulo.

Antes de crear NotificationCard:

1. inspecciona AlertsFeed
2. identifica estructura de datos
3. identifica tipos de alerta
4. identifica severidades
5. identifica iconos
6. identifica estilos
7. identifica acciones existentes

Después:

crear el módulo histórico reutilizando esos patrones.

No crear dos sistemas de alertas incompatibles.

Si AlertsFeed necesita una pequeña refactorización para compartir tipos/componentes con NotificationFeed, hacerla únicamente si no rompe el Dashboard.

Idealmente:

AlertsFeed
↓
reutiliza NotificationCard/NotificationItem o un componente base compartido

NotificationFeed
↓
extiende ese patrón para historial completo.

---

22. RUTAS

Integrar dentro del sistema de rutas existente.

Sidebar:

"Notificaciones"

Debe mantener el badge de no leídas.

No modificar innecesariamente las rutas existentes.

---

23. ENTREGABLES

Implementar:

1. Notificaciones — modo claro.
2. Notificaciones — modo oscuro.
3. Feed histórico.
4. Categorías.
5. Severidades.
6. Buscador.
7. Filtros.
8. Solo no leídas.
9. Agrupación por fecha.
10. Marcar individualmente como leída.
11. Marcar individualmente como no leída.
12. Marcar todas como leídas.
13. Selección múltiple.
14. Acciones masivas.
15. Drawer de detalle.
16. Navegación hacia recurso relacionado.
17. Settings drawer.
18. Estado loading.
19. Estado vacío.
20. Estado vacío por filtro.
21. Estado todas leídas.
22. Estado crítico.
23. Estado error.
24. Preparación WebSocket/polling.
25. Sincronización con badge del Sidebar/Topbar.
26. Responsive.

---

RESTRICCIONES ABSOLUTAS:

NO:

- reconstruir Dashboard
- reconstruir AlertsFeed desde cero
- reconstruir AppShell
- reconstruir Sidebar
- reconstruir Topbar
- crear un segundo sistema de badges
- crear una segunda lógica de severidades
- instalar librerías innecesarias
- cambiar colores existentes
- crear iconografía consumer
- utilizar emojis
- crear backend
- inventar endpoints definitivos
- duplicar componentes
- romper rutas existentes

SÍ:

- inspeccionar primero
- reutilizar AlertsFeed
- reutilizar componentes existentes
- mantener tokens
- mantener modo claro/oscuro
- mantener arquitectura
- preparar API
- preparar tiempo real
- usar mocks realistas
- mantener coherencia con Dashboard, Monitoreo de Vuelos, Revisión y Reportes

---

FLUJO DE EJECUCIÓN:

ANTES DE PROGRAMAR:

1. Inspecciona la estructura del proyecto.
2. Inspecciona AlertsFeed.
3. Inspecciona el modelo de datos de alertas.
4. Inspecciona cómo se maneja el badge del Sidebar.
5. Inspecciona el estado global utilizado por notificaciones.
6. Inspecciona los componentes de Drawer.
7. Inspecciona los componentes de Toast.
8. Inspecciona filtros y paginación existentes.
9. Inspecciona las rutas existentes.
10. Inspecciona cómo se manejan mocks y servicios API.

DESPUÉS:

11. Explica brevemente qué componentes existentes reutilizarás.
12. Indica qué componentes nuevos son realmente necesarios.
13. Implementa el módulo.
14. Integra la ruta.
15. Integra el contador existente.
16. Verifica navegación hacia Monitoreo de Vuelos, Revisión y Reportes.
17. Verifica modo claro y oscuro.
18. Verifica loading, empty y error.
19. Verifica filtros.
20. Verifica selección múltiple.
21. Verifica actualización del contador.
22. Ejecuta lint/build/tests disponibles.
23. Corrige errores introducidos.

Si el proceso se interrumpe:

NO empieces desde cero.

Primero inspecciona qué parte de Notificaciones ya fue implementada, compárala con esta especificación y continúa únicamente con lo que falta.