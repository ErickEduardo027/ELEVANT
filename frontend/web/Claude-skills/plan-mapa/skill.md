CONTEXTO DE CONTINUIDAD — LEE ANTES DE EMPEZAR

Ya existen en el proyecto:

- Dashboard del Administrador/OCC
- AppShell con Sidebar y Topbar
- Monitoreo de Vuelos
- Revisión
- Reportes
- Notificaciones
- Chat Interno

El Dashboard ya posee un preview esquemático del mapa de posiciones y Monitoreo de Vuelos ya posee un componente FlightMap.

ANTES DE CREAR O MODIFICAR CUALQUIER COSA:

1. Inspecciona la estructura completa actual del frontend.
2. Revisa especialmente:
   - Preview del mapa existente en Dashboard.
   - Componente FlightMap de Monitoreo de Vuelos.
   - AppShell.
   - Sidebar.
   - Topbar.
   - sistema de routing.
   - tokens de diseño.
   - dark/light mode.
   - componentes reutilizables.
   - patrones de drawers/popovers.
   - controles de mapa existentes.
3. Reutiliza componentes, estilos, tokens y patrones ya existentes cuando sea posible.
4. NO reconstruyas Dashboard, AppShell, Sidebar, Topbar ni FlightMap.
5. NO crees un segundo sistema visual para mapas.
6. Este módulo debe sentirse como una evolución natural de FlightMap y del preview del Dashboard.
7. No rompas ninguna funcionalidad existente.
8. Si existe código relacionado con posiciones, reutilízalo y extiéndelo.
9. Si encuentras una implementación existente que contradice esta especificación, analiza primero el código y conserva lo que ya funcione correctamente.

Este módulo se integra como una nueva ruta dentro del AppShell existente, accesible desde:

"Mapa de posiciones"

del Sidebar.

==================================================
ROL
==================================================

Actúa como un Senior Frontend Engineer + Senior Product Designer especializado en aplicaciones enterprise, sistemas operacionales aeroportuarios, mapas interactivos y visualización geoespacial.

Construye el módulo completo de:

"Mapa de posiciones"

para el entorno Administrador/OCC de ELEVANT.

ELEVANT es una plataforma corporativa de gestión de operaciones de ground handling para AVIAM Ltd. en el Aeropuerto Internacional de Punta Cana (PUJ).

==================================================
OBJETIVO DEL MÓDULO
==================================================

Este módulo es el mapa operacional completo de las posiciones de estacionamiento de aeronaves.

Debe permitir al OCC:

- visualizar las posiciones geográficamente;
- identificar Terminal A;
- identificar Terminal B;
- identificar FBO / Aviación local;
- conocer el estado de cada posición;
- conocer si está ocupada;
- conocer si está disponible;
- conocer si está inhabilitada;
- conocer qué vuelo está asociado;
- consultar información de la posición;
- buscar una posición;
- filtrar por terminal;
- filtrar por estado;
- navegar rápidamente entre zonas;
- visualizar relaciones entre posiciones combinadas Alfa/Bravo;
- detectar automáticamente posiciones inhabilitadas por configuración combinada.

El mapa debe ser georreferenciado y utilizar una base cartográfica real.

NO debe ser un mapa esquemático.

==================================================
MAPA BASE — OPENSTREETMAP
==================================================

Utiliza OpenStreetMap como fuente cartográfica.

https://www.openstreetmap.org

NO utilizar:

- Google Maps.
- Google Maps tiles.
- Mapbox como proveedor de mapa base.

La implementación debe utilizar preferiblemente:

MapLibre GL JS

o, si el proyecto ya tiene una implementación sólida con Leaflet/react-leaflet, reutilizarla.

IMPORTANTE:

No introduzcas una segunda librería de mapas si ya existe una implementación compatible que pueda extenderse.

Antes de instalar una nueva dependencia, inspecciona package.json y el código existente.

La arquitectura debe desacoplar:

Map Engine
↓
Map Tiles
↓
ELEVANT Position Data
↓
Flight Data
↓
Operational State

El proveedor cartográfico debe poder cambiarse posteriormente mediante configuración.

Por ejemplo:

VITE_MAP_STYLE_URL

o una configuración equivalente.

Incluye siempre la atribución correspondiente a OpenStreetMap.

NO implementes scraping.

NO dependas de una URL hardcodeada de tiles si existe una configuración de entorno apropiada.

==================================================
VISTA 2D + 3D
==================================================

El módulo debe soportar dos modos:

2D
3D

Agregar un control:

"2D / 3D"

La transición debe ser suave.

### 2D

Vista superior tradicional del aeropuerto.

### 3D

Vista inclinada mediante WebGL/MapLibre.

Cuando la fuente cartográfica lo permita:

- edificios extruidos;
- estructuras;
- terreno/elevación;
- volumen visual de terminales.

IMPORTANTE:

NO inventes edificios o estructuras que no estén respaldados por los datos cartográficos.

NO construyas una maqueta 3D falsa del aeropuerto.

El 3D debe ser una representación geográfica real utilizando los datos disponibles.

La vista 3D debe ser profesional y moderada.

No utilizar una perspectiva exagerada.

El mapa debe seguir pareciendo una herramienta de OCC.

==================================================
ESTILO VISUAL
==================================================

Mantén exactamente el lenguaje visual de ELEVANT ya existente.

- Premium
- Corporativo
- Minimalista
- Enterprise
- Aeronáutico
- Técnico
- Sobrio

CERO emojis.

CERO iconografía consumer.

CERO pins genéricos estilo Google Maps.

Utilizar iconografía outline, geométrica y técnica.

Tipografía:

Inter o la tipografía ya configurada en el proyecto.

==================================================
PALETA
==================================================

No modificar los tokens existentes.

Azul marino:

#0B1F3F

Azul de acento:

#145DC4

Naranja:

#F2661E

Modo claro:

background:
#F7F9FB

cards:
#FFFFFF

texto principal:
#0B1F3F

texto secundario:
#6B7684

Modo oscuro:

background:
#0A1220

cards:
rgba(11,31,63,0.55)

texto principal:
#F4F6F9

texto secundario:
#94A3B8

Estados de posición:

LIBRE:
#1E9E6B

OCUPADA:
#145DC4

INHABILITADA:
#C4453C

PRÓXIMA A LIBERARSE:
#D9A441

==================================================
COORDENADAS — FUENTE DE VERDAD
==================================================

Utiliza EXACTAMENTE estas coordenadas.

NO inventes coordenadas.

NO las modifiques.

TERMINAL A:

A1  18.564194, -68.360250
A2  18.564194, -68.360861
A3  18.564167, -68.361528
A4  18.564111, -68.362222
A5  18.564028, -68.362833
A6  18.563944, -68.363389
A7  18.563917, -68.363944
A8  18.563889, -68.364472
A9  18.563861, -68.365111
A10 18.563833, -68.365528
A11 18.563778, -68.366028

AN1 18.565583, -68.361556
AN2 18.565500, -68.362000
AN3 18.565472, -68.362472
AN4 18.565472, -68.362917
AN5 18.565417, -68.363306

TERMINAL B:

B20 18.563333, -68.367972
B21 18.563139, -68.369194
B22 18.563667, -68.367972
B23 18.563667, -68.369194
B24 18.564028, -68.368028
B25 18.564333, -68.369278
B26 18.564444, -68.368028
B27 18.562556, -68.370806
B28 18.563000, -68.370833
B29 18.563528, -68.370833
B30 18.564167, -68.370944
B31 18.564306, -68.371750
B32 18.564278, -68.372167
B33 18.564167, -68.372611
B34 18.564111, -68.373222
B35 18.563722, -68.373222
B36 18.563333, -68.373139
B37 18.562917, -68.373111

FBO / AVIACIÓN LOCAL:

BN6  18.563917, -68.374806
BN7  18.563889, -68.375222
BN8  18.563889, -68.375694
BN9  18.563806, -68.376111
BN10 18.563778, -68.376583
BN11 18.563778, -68.377000
BN12 18.563611, -68.378417
BN13 18.563583, -68.378861

==================================================
ESTRUCTURA DE DATOS
==================================================

Centraliza las posiciones en un único origen de datos.

Por ejemplo:

positions.ts

o:

positions.json

La estructura debe quedar preparada para reemplazar mocks por API.

Ejemplo:

{
  id: "A1",
  terminal: "A",
  latitude: 18.564194,
  longitude: -68.360250,
  status: "available",
  flightId: null,
  flightNumber: null,
  airline: null,
  aircraftRegistration: null,
  aircraftType: null,
  assignedAgent: null,
  estimatedReleaseTime: null,
  updatedAt: null,
  combinedConfiguration: null,
  linkedPositionId: null
}

Estados:

available
occupied
disabled
releasing

No mezclar lógica de negocio con componentes visuales.

==================================================
POSICIONES COMBINADAS ALFA / BRAVO
==================================================

Este es un requisito funcional importante.

El sistema debe soportar posiciones combinadas.

Ejemplo:

Cuando una posición se utiliza en configuración:

"9-Alfa"

la posición adyacente correspondiente debe quedar:

INHABILITADA

automáticamente.

El frontend debe poder representar esta relación.

NO inventes relaciones que no hayan sido definidas por el backend.

Para los mocks, crea únicamente relaciones explícitamente configuradas en el modelo de datos.

Ejemplo conceptual:

{
  id: "A9",
  combinedConfiguration: "9-Alfa",
  linkedPositionId: "A10"
}

Cuando A9 esté activa en configuración Alfa:

A9 = occupied

A10 = disabled

La posición inhabilitada debe:

- cambiar a rojo;
- mostrar patrón visual distintivo;
- mostrar borde discontinuo;
- mostrar tooltip;
- indicar por qué está inhabilitada;
- indicar qué posición/configuración la bloqueó.

NO depender exclusivamente del color.

==================================================
RENDERIZADO VIRTUALIZADO
==================================================

Implementa una arquitectura preparada para manejar muchas más posiciones en el futuro.

Aunque actualmente existen aproximadamente 40 posiciones, el sistema puede crecer.

La implementación debe:

- evitar renders innecesarios;
- renderizar solamente elementos visibles cuando sea apropiado;
- usar clustering cuando el zoom sea muy alejado;
- separar los datos de posición de la representación visual.

Si utilizas MapLibre:

preferir Source + Layers cuando corresponda.

Si utilizas Leaflet:

utilizar una estrategia apropiada de clustering y renderizado condicionado al viewport.

NO implementar virtualización DOM artificial si la tecnología del mapa ya maneja correctamente los elementos mediante layers.

La prioridad es rendimiento real, no simplemente cumplir una palabra clave.

==================================================
CLUSTERING
==================================================

Cuando el usuario esté alejado:

agrupar posiciones.

Los clusters deben permitir distinguir las zonas:

Terminal A
Terminal B
FBO

Al hacer zoom:

el cluster debe expandirse suavemente.

Cuando el zoom sea suficiente:

mostrar posiciones individuales.

NO mostrar decenas de marcadores superpuestos en la vista general.

==================================================
LAYOUT
==================================================

El mapa debe ocupar prácticamente todo el viewport disponible.

Dentro del módulo:

------------------------------------------------
Toolbar
------------------------------------------------
Mapa
------------------------------------------------

La interfaz debe evitar paneles permanentes que reduzcan demasiado el área visible.

==================================================
TOOLBAR
==================================================

Crear una toolbar integrada o flotante.

Debe incluir:

Título:

"Mapa de posiciones"

Subtítulo:

"PUJ · Aeropuerto Internacional de Punta Cana"

Selector:

Todas
Terminal A
Terminal B
FBO

Buscador:

"Buscar posición, vuelo o matrícula..."

Controles:

2D / 3D

Fullscreen

Centrar PUJ

No saturar la interfaz.

==================================================
BÚSQUEDA
==================================================

Permitir buscar:

A1
A10
AN3
B24
B37
BN8

También preparar búsqueda futura por:

número de vuelo
matrícula

Al encontrar:

- hacer fly-to;
- aumentar zoom;
- resaltar posición;
- abrir o preparar el detalle.

Si no existe:

"No se encontró la posición."

==================================================
MARCADORES
==================================================

NO utilizar pins genéricos.

Crear un marcador técnico y sobrio.

Puede ser:

- rectángulo redondeado;
- stand outline;
- forma geométrica;
- indicador técnico.

Debe mostrar el código:

A1
A2
B24
BN8

cuando el zoom lo permita.

Estados:

Libre:
verde

Ocupada:
azul

Inhabilitada:
rojo + patrón discontinuo

Próxima a liberarse:
ámbar

El marcador seleccionado debe tener:

- outline;
- glow muy sutil;
- elevación visual;
- etiqueta claramente visible.

==================================================
PANEL DE DETALLE
==================================================

Al seleccionar una posición:

abrir un panel flotante o drawer.

Reutilizar el patrón de detalle existente en Revisión.

Mostrar:

Código:
A9

Terminal:
A

Estado:
Ocupada

Vuelo:
DM123

Aerolínea:
Arajet

Matrícula:
HI-XXX

Tipo de aeronave:
B737-8

Agente:
Nombre

Hora estimada de liberación:
HH:MM

Última actualización:
HH:MM

Si no está ocupada:

"Sin vuelo asignado"

NO inventar datos reales.

==================================================
POSICIÓN INHABILITADA
==================================================

Cuando una posición esté inhabilitada por una configuración combinada:

mostrar claramente:

"Posición inhabilitada"

Motivo:

"Configuración 9-Alfa activa"

Relación:

"Esta configuración utiliza A9 y bloquea temporalmente A10."

La información exacta debe provenir del modelo de datos.

Agregar visualmente:

- rojo;
- patrón discontinuo;
- icono técnico;
- mensaje explicativo.

==================================================
ACCIONES
==================================================

Si existe vuelo asociado:

mostrar:

"Ver vuelo en Monitoreo"

Debe navegar a la ruta existente de Monitoreo de Vuelos.

Utilizar:

flightId

o:

flightNumber

como query parameter.

Ejemplo:

/flight-monitoring?flight=DM123

No romper rutas existentes.

No implementar acciones de backend que todavía no existan.

Acciones futuras como:

- Asignar posición
- Liberar posición
- Bloquear posición
- Cambiar posición

deben quedar desacopladas de la UI y no deben inventar endpoints.

==================================================
PANEL LATERAL DE POSICIONES
==================================================

Crear un panel lateral opcional.

Botón:

"Lista de posiciones"

Debe mostrar:

Código
Terminal
Estado
Vuelo

Ejemplo:

A1 | Libre
A2 | Ocupada | DM123
A3 | Libre
A4 | Inhabilitada

La lista debe sincronizarse con el mapa.

Al seleccionar una fila:

centrar la posición en el mapa.

Si la cantidad de posiciones aumenta considerablemente:

utilizar virtualización adecuada para la lista.

==================================================
PANEL RESUMEN
==================================================

Agregar un panel compacto:

POSICIONES

Total: 41

Libres: XX

Ocupadas: XX

Inhabilitadas: XX

Próximas a liberar: XX

Los valores deben calcularse dinámicamente.

==================================================
LEYENDA
==================================================

Leyenda colapsable:

Libre
Ocupada
Inhabilitada
Próxima a liberarse

Y una segunda explicación:

"Configuración combinada"

Debe explicar visualmente la relación entre posiciones.

==================================================
CONTROLES DEL MAPA
==================================================

Controles minimalistas:

+

-

Reset North

Centrar PUJ

2D / 3D

Fullscreen

No utilizar controles pesados.

==================================================
TERMINALES
==================================================

Al seleccionar:

Terminal A

hacer fly-to al conjunto A + AN.

Terminal B

hacer fly-to al conjunto B.

FBO

hacer fly-to a BN6-BN13.

Todas

encuadrar todas las posiciones.

La animación debe ser suave.

==================================================
INTERACCIÓN CON MONITOREO DE VUELOS
==================================================

Si una posición tiene un vuelo:

mostrar:

"Ver vuelo en Monitoreo"

La navegación debe integrarse con el módulo existente.

No duplicar lógica de vuelos.

El mapa de posiciones solamente consume la información necesaria.

==================================================
ESTADOS VISUALES
==================================================

Implementar:

1. Loading del mapa.

2. Loading de posiciones.

3. Mapa funcionando.

4. Sin posiciones.

5. Error de carga de posiciones.

6. Error del proveedor cartográfico.

7. Datos desactualizados.

8. Posición seleccionada.

9. Búsqueda encontrada.

10. Búsqueda sin resultados.

11. Cluster.

12. Posición ocupada.

13. Posición libre.

14. Posición inhabilitada.

15. Posición próxima a liberarse.

16. Configuración Alfa/Bravo activa.

==================================================
NOTIFICACIÓN DE INHABILITACIÓN
==================================================

Cuando el estado recibido por el frontend indique que una configuración combinada acaba de provocar la inhabilitación de una posición:

mostrar un toast discreto:

"Posición A10 inhabilitada"

"Configuración 9-Alfa activa."

No inventar el evento desde frontend.

El frontend solamente reacciona al cambio recibido desde los datos.

La animación debe ser:

fade + highlight/pulse breve.

NO parpadeo agresivo.

==================================================
MICROINTERACCIONES
==================================================

Implementar:

- hover sobre posición;
- selección;
- fly-to;
- cambio 2D/3D;
- apertura del detalle;
- apertura del panel lateral;
- filtros;
- clustering;
- transición de cluster a posiciones;
- actualización de estado;
- toast de inhabilitación.

Todo debe ser sutil.

==================================================
LIGHT / DARK MODE
==================================================

Reutilizar el sistema existente.

No crear un nuevo theme.

El mapa debe adaptarse al modo.

Light:

mapa claro, desaturado, editorial.

Dark:

mapa oscuro/nocturno.

Las posiciones deben mantener contraste suficiente.

==================================================
RESPONSIVE
==================================================

Desktop:

Mapa prácticamente full-screen.

Paneles flotantes.

Tablet:

Panel lateral colapsado por defecto.

Detalle como drawer.

Mobile:

No prioritario, pero debe degradar correctamente.

==================================================
API / BACKEND
==================================================

Preparar una capa desacoplada:

positionsService

Ejemplo:

getPositions()

getPositionById()

getPositionStatus()

El frontend debe estar preparado para REST.

Posteriormente:

WebSocket.

NO inventar endpoints definitivos.

Los mocks deben representar la estructura esperada de los datos.

Separar:

UI
Map state
Position state
API state
Filter state

==================================================
PERFORMANCE
==================================================

Prioridad alta.

Evitar:

- re-render del mapa por cada cambio de UI;
- crear componentes React innecesarios por cada posición;
- recrear la instancia del mapa;
- recalcular todos los datos en cada interacción.

La instancia del mapa debe mantenerse estable.

Separar:

mapInstance

positionSource

positionLayers

selectedPosition

filters

UI state

==================================================
ARQUITECTURA DE COMPONENTES
==================================================

Reutiliza componentes existentes.

Si no existen equivalentes, crear:

PositionMapPage

PositionMap

PositionLayer / PositionMarkers

PositionMarker

PositionDetailPopover

PositionSearchBar

TerminalSelector

PositionsSidePanel

PositionSummary

PositionLegend

CombinedPositionBanner

MapControls

No duplicar componentes existentes.

==================================================
RUTAS
==================================================

Integrar la nueva página dentro del AppShell.

Debe ser accesible desde:

Mapa de posiciones

del Sidebar.

No reconstruir routing.

==================================================
ENTREGABLES
==================================================

Debe quedar implementado:

1. Mapa georreferenciado real de PUJ.

2. OpenStreetMap como mapa base.

3. Vista 2D.

4. Vista 3D.

5. Terminal A.

6. Terminal B.

7. FBO.

8. Todas las posiciones con coordenadas exactas.

9. Marcadores personalizados.

10. Estados de posición.

11. Clustering.

12. Renderizado optimizado/virtualizado.

13. Buscador.

14. Selector de terminal.

15. Panel resumen.

16. Leyenda.

17. Panel lateral.

18. Detalle de posición.

19. Lógica visual para posiciones combinadas.

20. Estado de inhabilitación automática.

21. Toast de inhabilitación.

22. Integración con Monitoreo de Vuelos.

23. Light mode.

24. Dark mode.

25. Loading.

26. Empty state.

27. Error state.

28. Arquitectura REST-ready.

29. Arquitectura WebSocket-ready.

==================================================
RESTRICCIONES ABSOLUTAS
==================================================

NO:

- reconstruir Dashboard;
- reconstruir AppShell;
- reconstruir Sidebar;
- reconstruir Topbar;
- cambiar la paleta;
- utilizar emojis;
- utilizar pins genéricos;
- utilizar Google Maps;
- utilizar Mapbox como mapa base;
- inventar coordenadas;
- inventar información real de vuelos;
- inventar relaciones Alfa/Bravo;
- inventar lógica backend;
- crear una maqueta falsa del aeropuerto;
- duplicar FlightMap innecesariamente;
- introducir una librería de mapas adicional sin antes comprobar qué existe en el proyecto.

SÍ:

- reutilizar código existente;
- reutilizar FlightMap cuando técnicamente corresponda;
- reutilizar tokens;
- reutilizar patrones de drawers;
- utilizar OpenStreetMap;
- utilizar la tecnología de mapas ya instalada si es adecuada;
- mantener separación frontend/backend;
- mantener arquitectura escalable;
- priorizar rendimiento;
- mantener coherencia visual con ELEVANT.

==================================================
VALIDACIÓN FINAL
==================================================

Antes de terminar:

1. Ejecuta el proyecto.

2. Verifica la nueva ruta.

3. Verifica que el mapa carga.

4. Verifica atribución de OpenStreetMap.

5. Verifica todas las coordenadas.

6. Verifica Terminal A.

7. Verifica Terminal B.

8. Verifica FBO.

9. Verifica clustering.

10. Verifica búsqueda.

11. Verifica filtros.

12. Verifica selección de posición.

13. Verifica detalle.

14. Verifica 2D.

15. Verifica 3D.

16. Verifica dark mode.

17. Verifica light mode.

18. Verifica estados de posición.

19. Verifica posición inhabilitada por configuración combinada.

20. Verifica toast de inhabilitación.

21. Verifica navegación hacia Monitoreo de Vuelos.

22. Verifica responsive.

23. Verifica que los módulos existentes continúan funcionando.

24. Corrige errores de TypeScript, React, Tailwind, routing o mapas.

AL FINAL, entrega un resumen breve indicando:

- qué implementaste;
- qué componentes reutilizaste;
- qué componentes nuevos creaste;
- qué quedó preparado para backend;
- qué depende todavía de APIs/backend;
- cualquier limitación real de la fuente cartográfica 3D.

NO finalices simplemente diciendo "módulo creado". Comprueba el proyecto realmente.