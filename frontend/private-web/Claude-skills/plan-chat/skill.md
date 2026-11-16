CONTEXTO DE CONTINUIDAD — LEE ANTES DE EMPEZAR:

Ya existen en el proyecto:
- Dashboard del Administrador/OCC
- AppShell con Sidebar y Topbar
- Monitoreo de Vuelos
- Revisión
- Reportes
- Notificaciones

Antes de crear cualquier cosa, inspecciona el proyecto actual y revisa especialmente:
- AppShell y Sidebar
- sistema de rutas existente
- tokens de diseño
- componentes reutilizables
- StatusBadge
- patrones de tablas/listas
- patrones de detalle/drawer
- sistema de notificaciones/toasts
- AlertsFeed y módulo de Notificaciones
- patrones de estados de carga y estados vacíos
- componentes relacionados con vuelos y operaciones

NO reconstruyas componentes que ya existen correctamente.
NO cambies la arquitectura actual.
NO modifiques Dashboard, Monitoreo de Vuelos, Revisión o Reportes salvo que sea estrictamente necesario para integrar este módulo.

Este módulo debe agregarse como una nueva ruta dentro del AppShell existente, accesible desde el ítem "Chat interno" del Sidebar.

==================================================
MÓDULO: CHAT INTERNO
==================================================

Actúa como un senior frontend engineer y diseñador de producto especializado en sistemas enterprise de operaciones aeroportuarias.

Vas a diseñar y construir el módulo "Chat interno" del entorno Administrador/OCC de ELEVANT, plataforma de gestión de operaciones de ground handling para AVIAM Ltd. en el aeropuerto de Punta Cana (PUJ).

El objetivo del módulo es permitir la comunicación directa entre el Administrador/OCC y los agentes de rampa, organizada por vuelo/operación.

IMPORTANTE:

Esto NO debe parecer una aplicación de mensajería consumer como WhatsApp, Messenger o Telegram.

Debe sentirse como una herramienta corporativa/operativa integrada al sistema de gestión de vuelos.

La conversación debe estar vinculada a una operación concreta para que los mensajes tengan contexto y trazabilidad.

==================================================
IDENTIDAD VISUAL
==================================================

Mantén EXACTAMENTE el lenguaje visual establecido en los módulos anteriores.

Estilo:
- Premium
- Corporativo
- Enterprise
- Aeronáutico
- Minimalista
- Profesional
- Glassmorphism moderado
- Mucho orden visual
- Alta legibilidad
- Cero emojis

Iconografía:
- Solo iconos outline
- Línea fina
- Geométricos
- Técnicos
- No utilizar iconografía decorativa tipo consumer app

Tipografía:
- Inter, IBM Plex Sans o la tipografía ya existente en el proyecto.

PALeta existente:

Azul marino:
#0B1F3F

Azul de acento:
#145DC4

Naranja:
#F2661E

Modo claro:
Background:
#F7F9FB

Cards:
#FFFFFF

Texto principal:
#0B1F3F

Texto secundario:
#6B7684

Modo oscuro:
Background:
#0A1220

Cards:
rgba(11,31,63,0.55)

Texto principal:
#F4F6F9

Texto secundario:
#94A3B8

Estados:
Informativo:
#145DC4

Activo/atención:
#F2661E

Completado:
#1E9E6B

Advertencia:
#D9A441

Error/crítico:
#C4453C

No introducir colores arbitrarios.

==================================================
OBJETIVO FUNCIONAL
==================================================

El Administrador/OCC debe poder:

1. Ver las conversaciones activas relacionadas con operaciones.
2. Identificar rápidamente a qué vuelo pertenece cada conversación.
3. Identificar qué agente está participando.
4. Ver mensajes enviados y recibidos.
5. Enviar mensajes directamente al agente.
6. Consultar el historial de conversación.
7. Iniciar una conversación relacionada con un vuelo/operación.
8. Buscar conversaciones.
9. Filtrar conversaciones.
10. Identificar mensajes no leídos.
11. Ver cuándo fue el último mensaje.
12. Navegar desde una conversación hacia el vuelo/operación relacionada.
13. Recibir mensajes nuevos en tiempo real cuando la infraestructura lo permita.
14. Mantener trazabilidad de la comunicación.

==================================================
ESTRUCTURA GENERAL
==================================================

Utiliza una interfaz de tipo:

CONVERSACIONES | CHAT ACTIVO

Similar a un patrón master-detail enterprise.

Desktop:

┌──────────────────────┬─────────────────────────────────────┐
│                      │                                     │
│ LISTA DE CONVERS.    │        CHAT / OPERACIÓN             │
│                      │                                     │
│ búsqueda             │ encabezado del vuelo                │
│ filtros               │                                     │
│ conversaciones        │ mensajes                            │
│                      │ mensajes                            │
│                      │ mensajes                            │
│                      │                                     │
│                      │ input + enviar                       │
└──────────────────────┴─────────────────────────────────────┘

El panel izquierdo debe ocupar aproximadamente 30-35%.

El panel derecho aproximadamente 65-70%.

==================================================
1. PANEL DE CONVERSACIONES
==================================================

Crear componente:

ConversationList

Debe mostrar las conversaciones activas/relevantes.

Cada conversación debe contener:

- número de vuelo
- aerolínea/código
- ruta origen → destino
- posición/stand cuando esté disponible
- nombre del agente
- avatar o iniciales del agente
- último mensaje
- hora del último mensaje
- contador de mensajes no leídos
- indicador de estado de la conversación
- indicador sutil si requiere atención

Ejemplo conceptual:

DM161
Delta Air Lines
PUJ → ATL
Posición A7
Agente: Carlos Martínez

"Ya iniciamos el proceso de descarga..."

hace 2 min

[2]

No copies literalmente este contenido como dato real; utiliza mocks realistas.

==================================================
2. BÚSQUEDA
==================================================

En la parte superior del panel izquierdo:

Buscador con icono outline.

Debe permitir buscar por:

- número de vuelo
- aerolínea
- nombre del agente
- matrícula
- referencia de operación

La búsqueda debe actualizar la lista sin recargar la página.

Agregar estado de búsqueda sin resultados:

"No se encontraron conversaciones"

==================================================
3. FILTROS
==================================================

Agregar filtros rápidos.

Opciones:

- Todas
- No leídas
- En curso
- Pendientes
- Cerradas

Si el sistema existente utiliza otro concepto de estado, reutilizarlo.

Los filtros deben utilizar el mismo patrón visual de chips utilizado en otros módulos.

No crear estilos nuevos innecesariamente.

==================================================
4. CHAT ACTIVO
==================================================

Cuando el usuario selecciona una conversación, mostrar el chat correspondiente.

Encabezado del chat:

- número de vuelo
- aerolínea
- origen → destino
- posición
- agente asignado
- estado de la operación
- indicador online/offline del agente si el backend lo soporta

Agregar acciones rápidas:

"Ver vuelo"

"Ver operación"

Estas acciones deben navegar a los módulos existentes correspondientes.

IMPORTANTE:

No duplicar información innecesariamente.

El encabezado debe ser compacto y permitir identificar rápidamente el contexto operacional.

==================================================
5. CONTEXTO DE LA OPERACIÓN
==================================================

El chat debe mostrar claramente que la conversación está asociada a una operación.

Incluir un pequeño bloque contextual debajo del encabezado o integrado en él:

Vuelo:
DM161

Posición:
A7

Agente:
Carlos Martínez

Estado:
En ejecución

Si la información existe en los datos reales, mostrarla.

Este bloque puede ser colapsable para no consumir demasiado espacio.

==================================================
6. MENSAJES
==================================================

Crear componente:

MessageList

Cada mensaje debe mostrar:

- contenido
- hora
- estado de envío
- remitente
- indicador de leído/no leído cuando aplique

Diferenciar visualmente:

Mensajes enviados por OCC:
alineados a la derecha.

Mensajes enviados por agente:
alineados a la izquierda.

Mantener un diseño enterprise.

NO utilizar burbujas exageradamente redondeadas.

NO utilizar colores saturados.

NO utilizar emojis.

Los mensajes deben sentirse integrados al sistema operativo, no a una app social.

==================================================
7. SEPARADORES DE FECHA
==================================================

Cuando corresponda:

Hoy
Ayer
7 de agosto de 2026

Utilizar separadores discretos.

==================================================
8. MENSAJES NO LEÍDOS
==================================================

Si existen mensajes no leídos:

- mostrar indicador visual
- mostrar contador en la conversación
- al abrir la conversación, marcar como leídos según el comportamiento definido por el sistema

La transición debe ser sutil.

==================================================
9. INPUT DE MENSAJE
==================================================

Parte inferior del chat:

Input multilinea para escribir mensajes.

Acciones:

- adjuntar archivo, si la infraestructura lo permite
- enviar mensaje

El botón enviar debe utilizar el azul de acento #145DC4.

El botón debe quedar deshabilitado cuando no exista contenido.

Permitir:

- Enter → enviar
- Shift + Enter → salto de línea

Si el proyecto ya utiliza otra convención de teclado, mantenerla.

==================================================
10. MENSAJES DEL SISTEMA
==================================================

Debe existir soporte visual para mensajes/eventos generados por el sistema.

Ejemplos:

"El agente Carlos Martínez fue asignado a la operación."

"La operación cambió a estado En ejecución."

"El vuelo DM161 fue asociado a la posición A7."

Estos NO deben parecer mensajes enviados por una persona.

Representarlos como eventos de sistema discretos dentro del timeline.

Esto permitirá conservar contexto operacional.

==================================================
11. EVENTOS IMPORTANTES
==================================================

Cuando ocurra algo importante, el chat puede mostrar un evento contextual:

- cambio de posición
- cambio de agente
- cambio de estado de operación
- operación enviada a revisión
- operación devuelta
- operación aprobada

Estos eventos deben integrarse visualmente con el historial.

==================================================
12. INDICADOR DE AGENTE
==================================================

Cuando el backend lo permita, mostrar:

Online
Offline
Última conexión hace X min

No inventar presencia en tiempo real si todavía no existe el endpoint.

Preparar el componente para recibir este estado posteriormente.

==================================================
13. TIEMPO REAL
==================================================

El módulo debe quedar preparado para:

WebSocket o polling.

Cuando llegue un mensaje nuevo:

- actualizar la conversación automáticamente
- incrementar el contador de no leídos si la conversación no está activa
- mostrar el mensaje si el chat está abierto
- actualizar timestamp del último mensaje
- mover la conversación al principio de la lista
- mostrar una transición suave

No implementar una arquitectura WebSocket ficticia si el backend todavía no existe.

Crear una abstracción que permita conectar posteriormente:

useChat / chatService / messageService

según la arquitectura existente.

Utilizar mocks realistas mientras tanto.

==================================================
14. CREAR NUEVA CONVERSACIÓN
==================================================

Agregar botón:

"Nueva conversación"

Debe abrir un drawer/modal ligero.

Permitir seleccionar:

- vuelo
- operación
- agente

Después de seleccionar el contexto, abrir la conversación.

No permitir crear una conversación sin contexto operacional si el modelo de negocio exige que esté asociada a una operación.

Si el backend todavía no soporta creación, dejar la interfaz preparada y utilizar mock.

==================================================
15. CIERRE DE CONVERSACIÓN
==================================================

Preparar soporte para cerrar una conversación cuando la operación ya no requiera comunicación.

Acción:

"Marcar como cerrada"

La conversación no debe desaparecer inmediatamente.

Debe pasar al estado "Cerrada" y poder ser consultada mediante el filtro correspondiente.

==================================================
16. ADJUNTOS
==================================================

Preparar visualmente soporte para archivos adjuntos.

Ejemplos:

- fotografías de operación
- documentos
- evidencias

Por ahora no inventar una implementación compleja de almacenamiento.

Crear solamente la estructura frontend necesaria para conectar posteriormente con el endpoint de archivos.

Mostrar:

nombre
tipo
tamaño
estado

==================================================
17. NAVEGACIÓN HACIA OTROS MÓDULOS
==================================================

Desde el chat debe poder navegarse a:

Monitoreo de Vuelos

Revisión

Dashboard si corresponde

La navegación debe reutilizar las rutas existentes.

No crear rutas duplicadas.

Cuando sea posible, conservar el contexto del vuelo seleccionado.

==================================================
18. ESTADOS DEL MÓDULO
==================================================

Implementar:

A. Carga inicial

Skeleton para:
- lista de conversaciones
- encabezado
- mensajes

B. Sin conversaciones

"No hay conversaciones disponibles"

C. Sin resultados de búsqueda

"No se encontraron conversaciones"

D. Sin conversación seleccionada

"Selecciona una conversación para comenzar"

E. Conversación activa

Lista de mensajes + input.

F. Error de conexión

Mostrar estado discreto:

"No se pudo actualizar la conversación."

Con opción:

"Reintentar"

G. Agente desconectado

Mostrar estado de última conexión sin bloquear el envío, salvo que el backend posteriormente indique lo contrario.

==================================================
19. RESPONSIVE
==================================================

Desktop:

Panel conversación + chat.

Tablet:

El panel de conversaciones puede convertirse en drawer.

Por defecto mostrar el chat.

Agregar botón para regresar a la lista.

Mobile:

No es prioritario, pero debe degradar correctamente a:

Lista → Chat

Nunca mostrar ambos paneles comprimidos hasta hacerlos inutilizables.

==================================================
20. MICROINTERACCIONES
==================================================

Implementar:

- transición suave al seleccionar conversación
- entrada suave de nuevos mensajes
- actualización del contador de no leídos
- hover discreto
- scroll automático al recibir mensaje solamente si el usuario está cerca del final
- NO hacer scroll forzado si el usuario está leyendo mensajes anteriores
- indicador de "nuevo mensaje"
- estado de envío del mensaje
- skeleton loaders

No utilizar animaciones excesivas.

==================================================
21. COMPONENTES REUTILIZABLES
==================================================

Crear o reutilizar componentes siguiendo la arquitectura existente.

Conceptualmente:

InternalChat
ConversationList
ConversationListItem
ConversationSearch
ConversationFilters
ChatHeader
OperationContext
MessageList
MessageItem
SystemEvent
MessageComposer
AttachmentPreview
NewConversationDrawer
ChatEmptyState

No crear componentes duplicados si ya existe funcionalidad equivalente.

==================================================
22. DATOS Y API
==================================================

Preparar el frontend para API REST.

Crear mocks con una estructura cercana a la respuesta real.

Modelo conceptual de conversación:

{
  id,
  flightId,
  flightNumber,
  airline,
  origin,
  destination,
  position,
  operationId,
  agentId,
  agentName,
  agentStatus,
  lastMessage,
  lastMessageAt,
  unreadCount,
  status
}

Modelo conceptual de mensaje:

{
  id,
  conversationId,
  senderId,
  senderRole,
  senderName,
  content,
  createdAt,
  readAt,
  status,
  attachments
}

No asumir endpoints definitivos del backend.

Separar la capa de servicios del componente visual para que posteriormente pueda conectarse fácilmente con los endpoints reales.

==================================================
23. PREPARACIÓN PARA TIEMPO REAL
==================================================

La arquitectura debe permitir posteriormente:

GET conversaciones
GET mensajes de una conversación
POST mensaje
PATCH mensaje leído
PATCH conversación
POST nueva conversación
POST adjunto

Y posteriormente:

WebSocket para nuevos mensajes.

No implementar llamadas reales si todavía no existen los endpoints.

==================================================
24. UX OPERATIVA
==================================================

Prioridad absoluta:

El OCC debe poder responder rápidamente a un agente.

Por eso:

- el vuelo debe identificarse inmediatamente
- el agente debe identificarse inmediatamente
- el último mensaje debe ser visible sin abrir la conversación
- las conversaciones no leídas deben destacar
- el chat debe tener buena área de lectura
- el input debe permanecer accesible
- los mensajes recientes deben estar disponibles rápidamente
- el contexto operacional nunca debe perderse

Evitar elementos innecesarios que hagan parecer el módulo una red social.

==================================================
25. ACCESIBILIDAD
==================================================

Implementar:

- navegación por teclado
- focus states
- labels accesibles
- botones con aria-label cuando solo tengan iconos
- contraste adecuado
- estados no dependientes únicamente del color

==================================================
26. ENTREGABLES
==================================================

Implementar:

1. Vista completa del Chat interno en modo claro.
2. Vista completa en modo oscuro.
3. Lista de conversaciones con datos mock.
4. Conversación activa con mensajes.
5. Estado de mensajes no leídos.
6. Estado sin conversaciones.
7. Estado sin conversación seleccionada.
8. Estado de búsqueda sin resultados.
9. Nueva conversación.
10. Eventos de sistema.
11. Contexto de vuelo/operación.
12. Navegación hacia Monitoreo de Vuelos y Revisión.
13. Estados de carga.
14. Estado de error/reintento.
15. Preparación para tiempo real.
16. Preparación para adjuntos.
17. Responsive tablet.

==================================================
27. RESTRICCIONES IMPORTANTES
==================================================

- CERO emojis.
- NO utilizar iconografía consumer.
- NO introducir nuevos colores.
- NO cambiar la identidad visual existente.
- NO reconstruir componentes existentes.
- NO duplicar AppShell.
- NO duplicar Sidebar.
- NO duplicar Topbar.
- NO romper rutas existentes.
- NO romper Dashboard.
- NO romper Monitoreo de Vuelos.
- NO romper Revisión.
- NO romper Reportes.
- NO romper Notificaciones.

Antes de modificar archivos:

1. inspecciona la estructura del proyecto;
2. identifica los componentes reutilizables;
3. identifica las rutas existentes;
4. identifica los tokens de diseño;
5. identifica cómo se manejan los mocks/API;
6. identifica cómo se manejan los estados de carga;
7. identifica cómo se manejan los toasts;
8. identifica cómo se manejan los temas claro/oscuro.

Después implementa únicamente lo necesario para el módulo de Chat interno.

Al finalizar:

- verifica que TypeScript compile correctamente;
- verifica que no existan errores de lint;
- verifica que las rutas funcionen;
- verifica que el módulo esté correctamente integrado al Sidebar;
- verifica modo claro y oscuro;
- verifica estados vacíos;
- verifica selección de conversaciones;
- verifica envío simulado de mensajes;
- verifica navegación hacia otros módulos;
- verifica responsive.

Si encuentras código existente que contradice alguna parte de este prompt, NO lo sobrescribas silenciosamente. Primero analiza cómo está construido y adapta el nuevo módulo al patrón existente.