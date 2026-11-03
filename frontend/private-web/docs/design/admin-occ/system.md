# ELEVANT Admin/OCC — sistema de interfaz

## Dirección

Cristal azulado y navy, superficies flotantes y geometría orgánica. La composición
responde a la tarea operativa: comparar en tablas, recorrer secuencias, consultar
detalles junto al trabajo y editar mediante formularios claros. Se conservan los
logotipos y los nombres de módulos existentes.

## Límites de aplicación

- La presentación OCC es optativa y local, mediante CSS Modules y atributos de composición.
- Panorama no recibe el contenedor visual OCC. No se editan sus mapas, mapeadores,
  hooks, estilos ni servicios compartidos para aplicar esta dirección.
- Panorama comparte la barra horizontal global; se retira su sidebar y aprovecha el ancho liberado, conservando la rejilla y breakpoints internos.
- Todos los módulos OCC utilizan la misma barra flotante de 56 px, máximo 1328 px, con márgenes verticales 12 px en escritorio y 8 px en móvil, sin superposición.
- Usuarios y Gastos conservan su presentación original fuera de OCC.
- La confirmación de salida es la única superficie nueva común a todos los roles.

## Tokens y patrones

| Propiedad | Decisión |
| --- | --- |
| Marca | Navy `#0B1F3F`, azul `#145DC4`, naranja `#F2661E` |
| Fuente | Manrope; IBM Plex Mono para códigos, horas y números tabulares |
| Tipografía | Títulos 24 px escritorio / 22 px móvil; cuerpo 14 px (Panorama conserva su estilo) |
| Espaciado | Base 4 px; escala 4, 8, 12, 16, 24, 32, 48, 64 |
| Geometría | Paneles principales 24 px; secundarios 16 px; controles 8 px |
| Profundidad | Elevación por capas con una familia de sombras ambientales |
| Cristal | Desenfoque 12 px en la barra compartida y flotantes; contenido de Panorama intacto |
| Datos | Tablas y formularios sobre superficies suficientemente sólidas |
| Interacción | Objetivos táctiles/cabecera de 44 px; controles de escritorio con puntero fino de 36 px; transiciones de 150 ms |
| Accesibilidad | Contraste de texto 4,5:1, foco visible, teclado y movimiento reducido |

El modo oscuro usa navy en capas; los textos secundarios utilizan colores
explícitos con contraste suficiente. El naranja señala atención o contexto y
el azul identifica acciones. Los estados conservan sus colores semánticos.

## Composiciones

| Módulo | Patrón |
| --- | --- |
| Planificación | Barra operativa y filtros; Timeline, Tabla y Calendario comparten snapshot y detalle |
| Revisión | Cola y detalle con evidencias, historial y decisiones |
| Reportes | Selección/periodo junto a resultados, paginación y exportaciones |
| Notificaciones | Lista cronológica; resumen en campana y avisos flotantes |
| Chat | Hilos por operación, historial paginado y compositor por conversación |
| Usuarios | Directorio, perfiles, solicitudes y permisos |
| Mis gastos | Captura personal y seguimiento con detalle contextual |
| Vuelos/Posiciones | Consultas y acciones conservadas, sin mapas ni nuevas entradas del sidebar |

## Confirmación de salida

La acción manual abre una confirmación compartida. Cancelar tiene el foco
inicial y conserva la sesión, URL, selección y borradores. Escape y backdrop
equivalen a cancelar mientras no hay una confirmación en curso. El foco vuelve
al disparador estable, incluido el avatar cuando el menú ya se cerró.

El cierre existente es local: limpia exclusivamente la credencial de ambos
almacenamientos. Sus errores se propagan antes de publicar sesión nula. La UI
impide envíos repetidos y muestra un error traducido sin afirmar éxito. La
expiración y los 401 mantienen su flujo automático. No existe un nuevo endpoint
de logout ni se atribuye revocación de JWT al cliente.

## Auditoría de controles

Cada acción visible debe tener permiso, handler, servicio y resultado verificables.
Las acciones futuras sin implementación se retiran de la experiencia normal;
los controles deshabilitados por validación, permisos o envío conservan su razón.
Los datos y contadores proceden del contrato; los subconjuntos recientes se
identifican y no se presentan como totales globales.

Los artefactos de QA deben distinguir servicios simulados de integración real.
Las pruebas de chat real usan únicamente cuentas QA y operaciones autorizadas.

## Refinamiento v2

La navegación horizontal mide el conjunto de los cuatro grupos; cuando no cabe
se utiliza un menú agrupado accesible, sin un grupo adicional Más. El selector de idioma
tiene una superficie de 28 px dentro de un área de 44 px. El avatar mide 28 px,
con identidad, UTC y salida en el menú de cuenta; tema permanece junto al idioma. Los filtros operativos
pierden el contenedor exterior duplicado; los datos conservan superficies sólidas.
Las barras de desplazamiento se limitan al nuevo marco y sus contenedores.

La autorización final incluye reemplazar el marco exterior de Panorama por la barra compartida. Su contenido y tres mapas permanecen protegidos. La campana de pendientes conserva su comportamiento:
al confirmar lectura o apertura se retira el aviso, conservando el historial.
Los estilos internos, alturas de mapas, controles e interacciones de Panorama no cambian; su ancho y posición exterior se adaptan al marco aprobado.

La presencia muestra actividad observada en la aplicación, no disponibilidad
operativa. Se recibe del backend por participante y operación; nunca se deduce
de tener abierta una conversación. Web y Mobile Agent emiten leases efímeros
con identidad autenticada y secuencia creciente, sin cola offline ni migraciones.
Activo, Ausente y Desconectado proceden del servidor; No disponible representa
ausencia de información o conectividad del lector. Heartbeat 30 s, lectura 15 s,
inactividad 5 min, expiración 90 s y retención de actividad 24 h.
La actividad sin confirmar caduca a los cinco minutos: una suspensión larga
no vuelve a publicar entradas antiguas como actividad actual. El emisor nativo
comprueba la cuenta almacenada antes de cada escritura y el emisor Web admite
orígenes HTTP privados sin depender de `randomUUID`.


## Navegación global final

Panorama es acceso directo. Operación agrupa Planificación, Revisión, Reportes y Mis gastos; Comunicación agrupa Notificaciones y Chat interno; Administración contiene Usuarios. Los enlaces se filtran por los grants existentes y los grupos vacíos se omiten. Cuando no cabe la navegación completa, se utiliza un único menú agrupado con el mismo orden. Monitoreo y Posiciones siguen siendo consultas contextuales sin mapas.

El isotipo utiliza los dos PNG originales del login, 44 px de ancho y proporciones intrínsecas, sin fondo adicional. ES/EN es un selector segmentado con superficie de 28 px y objetivos de 44 px. Tema permanece junto al idioma; el perfil conserva identidad, UTC y salida, sin duplicar controles.

Chat distribuye el alto disponible: lista de 240–320 px en escritorio, historial flexible y compositor controlado de una fila entre 44 y 144 px. El texto solo se limpia después de confirmación del servidor. Activo es verde, Ausente ámbar, Desconectado rojo y No disponible neutral; los valores proceden del contrato existente.
