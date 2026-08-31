CONTEXTO DE CONTINUIDAD — LEER ANTES DE EMPEZAR:

El proyecto frontend de ELEVANT ya tiene implementados:

- Login.
- AppShell / layout principal.
- Sidebar del entorno Administrador/OCC.
- Topbar.
- Dashboard.
- Módulo de Monitoreo de Vuelos.
- Módulo de Revisión.
- Sistema de modo claro/oscuro.
- Tokens de diseño y paleta corporativa.
- StatusBadge y otros componentes reutilizables.
- Patrones de tablas, filtros, drawers/paneles de detalle, timelines y estados de carga.

Estoy trabajando EXCLUSIVAMENTE en el frontend y UX/UI.

NO reconstruyas ni reemplaces funcionalidades existentes.

Antes de modificar o crear archivos:

1. Inspecciona la estructura real del proyecto.
2. Revisa cómo están implementados Dashboard, Monitoreo de Vuelos y Revisión.
3. Identifica los componentes reutilizables que ya existen.
4. Identifica la librería de gráficos que ya utiliza Dashboard.
5. Identifica el sistema de rutas existente.
6. Identifica los tokens de diseño, colores, tipografía, spacing, bordes, sombras y modo oscuro.
7. Reutiliza todo lo que sea posible.
8. No introduzcas una librería nueva si ya existe una solución equivalente en el proyecto.
9. No modifiques Dashboard, Monitoreo de Vuelos ni Revisión salvo que sea estrictamente necesario para reutilizar componentes.
10. Si encuentras algo que contradice esta especificación, analiza primero el código existente y conserva la implementación estable cuando sea posible.

El nuevo módulo debe integrarse dentro del AppShell existente y ser accesible desde el ítem "Reportes" del Sidebar.

--------------------------------------------------
OBJETIVO DEL MÓDULO
--------------------------------------------------

Actúa como un Senior Frontend Engineer + Product Designer especializado en software enterprise aeronáutico.

Construye el módulo de "Reportes" del entorno Administrador/OCC de ELEVANT.

ELEVANT es una plataforma corporativa de gestión de operaciones de ground handling para AVIAM Ltd., utilizada en el aeropuerto de Punta Cana (PUJ).

Este módulo digitaliza los reportes operativos que actualmente el OCC puede tener que recopilar manualmente.

El objetivo es permitir al Administrador/OCC:

- Consultar información operacional histórica.
- Analizar indicadores.
- Detectar desviaciones.
- Comparar lo contratado vs. lo ejecutado.
- Analizar tiempos de operación.
- Generar reportes.
- Filtrar información.
- Visualizar tendencias.
- Exportar información.

El módulo debe sentirse como una herramienta enterprise de análisis operacional, no como un dashboard genérico.

--------------------------------------------------
DIRECCIÓN VISUAL
--------------------------------------------------

Mantén EXACTAMENTE el lenguaje visual establecido en los módulos anteriores.

Características:

- Premium.
- Corporativo.
- Minimalista.
- Aeronáutico.
- Enterprise.
- Alta densidad de información, pero con excelente jerarquía visual.
- Glassmorphism moderado.
- Cero emojis.
- Cero iconografía decorativa.
- Iconografía únicamente outline, técnica y consistente.
- Tipografía sans-serif corporativa.
- Inter, IBM Plex Sans o la tipografía ya existente en el proyecto.
- Animaciones discretas.
- Nada excesivamente colorido.
- Nada que parezca una aplicación consumer.

--------------------------------------------------
PALETA
--------------------------------------------------

Reutiliza los tokens existentes.

Primario:
#0B1F3F

Azul de acento:
#145DC4

Naranja:
#F2661E

Light mode:

Background:
#F7F9FB

Cards:
#FFFFFF

Texto principal:
#0B1F3F

Texto secundario:
#6B7684

Dark mode:

Background:
#0A1220

Cards:
rgba(11,31,63,0.55)

Texto principal:
#F4F6F9

Texto secundario:
#94A3B8

Estados:

Normal / completado:
#1E9E6B

Advertencia:
#D9A441

Crítico:
#C4453C

Informativo:
#145DC4

No introduzcas colores arbitrarios fuera del sistema existente.

--------------------------------------------------
ESTRUCTURA GENERAL
--------------------------------------------------

El módulo debe tener una estructura clara:

1. Header del módulo.
2. Barra de selección de reporte.
3. Barra de filtros.
4. Área principal del reporte.
5. Acciones de exportación.
6. Estados de carga/vacío/error.
7. Paginación cuando corresponda.

No agregues otra topbar global.

Debe convivir correctamente con la Topbar existente del AppShell.

--------------------------------------------------
HEADER DEL MÓDULO
--------------------------------------------------

Crear un encabezado profesional:

Título:

"Reportes"

Subtítulo breve:

"Consulta y analiza el desempeño operacional."

El header puede incluir información contextual del período seleccionado.

Ejemplo:

"01 Ago 2026 — 07 Ago 2026"

A la derecha:

Botón "Exportar"

El botón debe permitir posteriormente:

- PDF
- Excel

No es necesario implementar backend real.

Utiliza mocks o funciones preparadas para conectar posteriormente con API.

--------------------------------------------------
SELECTOR DE REPORTES
--------------------------------------------------

Crear navegación interna mediante tabs o selector de tipo de reporte.

Reportes disponibles:

1. Cierre operacional
2. Conciliación de servicios
3. Tiempo en tierra
4. Resumen operativo

El primer reporte seleccionado por defecto debe ser:

"Cierre operacional"

La navegación debe ser clara y consistente con el diseño de ELEVANT.

--------------------------------------------------
FILTROS
--------------------------------------------------

Crear un ReportFilterBar reutilizable.

Filtros generales:

- Rango de fechas.
- Aerolínea.
- Agente.
- Terminal.
- Posición.

Selector de rango de fechas con opciones rápidas:

- Hoy
- Ayer
- Esta semana
- Este mes
- Rango personalizado

El filtro debe permitir seleccionar una fecha inicial y final.

Los filtros contextuales deben cambiar dependiendo del reporte seleccionado cuando sea necesario.

Agregar:

"Limpiar filtros"

cuando existan filtros activos.

Mostrar visualmente los filtros activos.

--------------------------------------------------
REPORTE 1 — CIERRE OPERACIONAL
--------------------------------------------------

Este es el reporte principal.

Su objetivo es detectar cambios de posición y determinar cuánto tiempo tuvo el OCC para reaccionar antes del bloqueo/estacionamiento real de la aeronave.

La tabla debe contener:

- Vuelo.
- Aerolínea.
- Posición inicial asignada.
- Posición final real.
- Hora en que se recibió el cambio de posición.
- Hora real de bloqueo/estacionamiento.
- Tiempo de anticipación.
- Agente que atendió.
- Estado/severidad.

El tiempo de anticipación debe mostrarse como un delta calculado.

Ejemplo:

"32 min"

"18 min"

"7 min"

Clasificación visual:

Verde:
margen suficiente.

Ámbar:
margen ajustado.

Rojo:
situación crítica.

Considerar como referencia una situación crítica cuando el tiempo sea inferior aproximadamente a 15–20 minutos.

No hardcodear esta lógica de forma que impida cambiarla posteriormente.

Preparar el componente para recibir la severidad desde API.

Las filas críticas deben tener un highlight muy sutil.

No utilizar fondos rojos intensos.

--------------------------------------------------
REPORTE 2 — CONCILIACIÓN DE SERVICIOS
--------------------------------------------------

Crear una tabla de comparación entre:

CONTRATADO vs EJECUTADO.

Agrupar por:

- Aerolínea.
- Vuelo.
- Período.

Información:

- Servicio.
- Cantidad contratada.
- Cantidad ejecutada.
- Diferencia.
- Estado.

Ejemplo:

Servicio | Contratado | Ejecutado | Diferencia

GPU | 1 | 1 | 0

Belt Loader | 1 | 2 | +1

Baggage Cart | 4 | 3 | -1

Las diferencias deben reutilizar el patrón visual utilizado en Revisión para conciliación.

Las discrepancias deben resaltarse de forma sutil.

No asumir que toda diferencia es necesariamente un error.

Mostrar estados como:

- Conforme.
- Diferencia.
- No ejecutado.

--------------------------------------------------
REPORTE 3 — TIEMPO EN TIERRA
--------------------------------------------------

Crear un reporte para comparar:

Tiempo real en tierra

vs.

Tiempo contratado / SLA.

Permitir análisis por:

- Aerolínea.
- Tipo de aeronave.
- Período.

Columnas sugeridas:

- Vuelo.
- Aerolínea.
- Tipo de aeronave.
- Tiempo contratado.
- Tiempo real.
- Diferencia.
- Estado.

Estados:

Dentro del SLA:
verde.

Cerca del límite:
ámbar.

Excedido:
rojo.

Mostrar claramente los vuelos que excedieron el SLA.

--------------------------------------------------
REPORTE 4 — RESUMEN OPERATIVO
--------------------------------------------------

Crear una vista analítica utilizando la misma librería de gráficos existente en Dashboard.

NO instalar otra librería de gráficos si ya existe una en el proyecto.

La vista debe incluir:

1. Vuelos atendidos por período.
2. Distribución de vuelos por estado.
3. Servicios ejecutados por tipo.
4. Carga operativa por agente.
5. Indicadores generales.

Usar gráficos sobrios:

- Barras.
- Donas.
- Barras horizontales.
- Líneas cuando sea apropiado.

Evitar gráficos innecesarios.

Cada gráfico debe responder una pregunta operacional clara.

--------------------------------------------------
KPIs DEL RESUMEN OPERATIVO
--------------------------------------------------

Agregar una fila de indicadores principales:

- Vuelos atendidos.
- Servicios ejecutados.
- Operaciones con incidencias.
- Tiempo promedio en tierra.
- Cumplimiento de SLA.

Los KPI deben reutilizar el patrón visual de Dashboard cuando sea posible.

No crear un diseño de KPI completamente diferente.

--------------------------------------------------
TABLAS
--------------------------------------------------

Todas las tablas deben tener:

- Buscador.
- Ordenamiento por columna.
- Paginación.
- Estado de carga.
- Estado vacío.
- Hover.
- Selección de fila cuando sea útil.

Permitir expandir una fila para visualizar información adicional.

Reutilizar el patrón de detalle desarrollado en Revisión.

El detalle debe ser SOLO LECTURA.

No crear acciones de aprobación dentro de Reportes.

--------------------------------------------------
DETALLE EXPANDIBLE
--------------------------------------------------

Cuando el usuario expanda una fila:

mostrar información operacional relacionada.

Reutilizar componentes existentes de Revisión cuando sea posible.

Puede mostrar:

- Información del vuelo.
- Aerolínea.
- Posición.
- Horarios.
- Agentes.
- Servicios.
- Incidencias.
- Tiempos.
- Diferencias detectadas.

Debe sentirse como una extensión natural de la fila.

--------------------------------------------------
EXPORTACIÓN
--------------------------------------------------

Crear un componente:

ExportButton

Debe permitir:

- Exportar PDF.
- Exportar Excel.

Por ahora utilizar mocks.

Preparar la interfaz para posteriormente conectar:

GET /reports/...
POST /reports/export
o endpoints equivalentes definidos por backend.

Estados del botón:

Normal.

Generando.

Completado.

Error.

Durante generación:

mostrar loading discreto.

Al completar:

mostrar toast breve:

"Reporte generado correctamente."

No implementar descarga real si el backend todavía no existe.

--------------------------------------------------
MICROINTERACCIONES
--------------------------------------------------

Cuando cambien filtros:

- Mostrar skeleton breve.
- Aplicar fade transition.
- Actualizar contenido.

No utilizar parpadeos bruscos.

Hover en filas:

- Elevación mínima.
- Cambio sutil de background.

Filas críticas:

- Highlight sutil.

Gráficos:

- Tooltip al hover.
- Mostrar valores exactos.

Exportación:

- Loading.
- Success toast.
- Error state.

--------------------------------------------------
ESTADOS
--------------------------------------------------

Implementar:

1. Loading inicial.
2. Loading al cambiar filtros.
3. Datos normales.
4. Estado vacío:

"No hay datos para el período seleccionado."

5. Estado con información crítica.
6. Exportación en progreso.
7. Exportación completada.
8. Error de carga de datos.

Todos los estados deben respetar el lenguaje visual de ELEVANT.

--------------------------------------------------
RESPONSIVE
--------------------------------------------------

Desktop 1440px+:

- Tablas completas.
- Filtros en una línea cuando sea posible.
- Resumen operativo con gráficos en grid de 2 columnas.

Tablet 1024px:

- Reducir columnas secundarias.
- Permitir "Ver más".
- Detalle mediante expansión.
- Gráficos en una columna.
- Filtros pueden pasar a segunda línea.

Mobile:

No es prioridad, pero debe degradar correctamente.

--------------------------------------------------
COMPONENTES
--------------------------------------------------

Reutiliza componentes existentes.

Si no existen, crear componentes reutilizables como:

ReportTabs
DateRangePicker
ReportFilterBar
DailyClosureTable
ReconciliationSummaryTable
GroundTimeTable
OperationalOverviewCharts
ReportKpiGrid
ExpandableReportRow
ReportDetailPanel
ExportButton

No crear componentes innecesarios.

Mantener la estructura de carpetas existente del proyecto.

--------------------------------------------------
DATOS
--------------------------------------------------

Usar mocks realistas mientras no exista backend.

Los mocks deben tener una estructura similar a la respuesta futura de API.

No llenar el código con datos hardcodeados directamente dentro de componentes.

Crear archivos de datos/mock separados siguiendo la arquitectura existente.

Preparar todo para API REST.

No implementar backend.

--------------------------------------------------
PREPARACIÓN PARA API
--------------------------------------------------

La interfaz debe estar preparada para recibir posteriormente:

- Datos de cierre operacional.
- Datos de conciliación.
- Datos de tiempo en tierra.
- Datos del resumen operativo.
- Datos para gráficos.
- Resultados de exportación.

No inventes endpoints definitivos si el backend todavía no los ha establecido.

Si existen servicios/API clients en el proyecto, reutilízalos.

--------------------------------------------------
RUTAS
--------------------------------------------------

Integrar Reportes dentro del sistema de rutas existente.

El Sidebar ya tiene el módulo:

"Reportes"

No reconstruir Sidebar.

No modificar AppShell salvo que sea estrictamente necesario.

La ruta debe seguir la convención existente del proyecto.

--------------------------------------------------
UX
--------------------------------------------------

El usuario principal es un Administrador/OCC.

Por lo tanto:

- Prioriza información operacional.
- Reduce decoración.
- Facilita detectar anomalías.
- Facilita comparar datos.
- Facilita filtrar períodos.
- Facilita exportar.
- Evita exceso de gráficos.
- Evita tarjetas innecesarias.
- Evita información que no ayude a tomar decisiones.

La interfaz debe permitir responder rápidamente:

¿Qué pasó?

¿Cuándo pasó?

¿En qué vuelo?

¿Con qué aerolínea?

¿Qué impacto tuvo?

¿Hubo una desviación?

¿Se cumplió el SLA?

--------------------------------------------------
ENTREGABLES
--------------------------------------------------

Construir:

1. Reportes — Cierre operacional completo.
2. Reportes — Conciliación de servicios.
3. Reportes — Tiempo en tierra.
4. Reportes — Resumen operativo.
5. Modo claro.
6. Modo oscuro.
7. Loading.
8. Estado vacío.
9. Estado con información crítica.
10. Filtros.
11. Ordenamiento.
12. Paginación.
13. Detalle expandible.
14. Exportación mock PDF/Excel.
15. Estados de exportación.
16. Responsive desktop/tablet.
17. Integración con AppShell y Sidebar existentes.

--------------------------------------------------
RESTRICCIONES IMPORTANTES
--------------------------------------------------

NO:

- reconstruir Dashboard.
- reconstruir AppShell.
- reconstruir Sidebar.
- crear otra Topbar.
- cambiar la identidad visual.
- introducir nuevos colores arbitrarios.
- instalar otra librería de gráficos si ya existe una.
- crear backend.
- usar emojis.
- usar iconografía consumer.
- duplicar componentes existentes.
- reemplazar código funcional sin necesidad.

SÍ:

- reutilizar componentes.
- reutilizar tokens.
- reutilizar patrones de Dashboard.
- reutilizar patrones de Monitoreo de Vuelos.
- reutilizar patrones de Revisión.
- mantener arquitectura existente.
- mantener modo claro/oscuro.
- preparar todo para API REST.

--------------------------------------------------
FLUJO DE EJECUCIÓN
--------------------------------------------------

Antes de programar:

1. Inspecciona el proyecto.
2. Identifica arquitectura.
3. Identifica rutas.
4. Identifica componentes reutilizables.
5. Identifica la librería de gráficos existente.
6. Identifica cómo funcionan los mocks.
7. Identifica cómo se manejan los estados loading/empty/error.
8. Identifica cómo se implementó el modo claro/oscuro.
9. Identifica cómo funciona el módulo de Revisión.

Después:

10. Presenta brevemente qué encontraste.
11. Indica qué componentes vas a reutilizar.
12. Indica qué componentes nuevos son realmente necesarios.
13. Implementa el módulo de Reportes.
14. Integra la ruta.
15. Verifica que Dashboard, Monitoreo de Vuelos y Revisión sigan funcionando.
16. Ejecuta lint/build/tests disponibles.
17. Corrige errores introducidos.
18. No detengas el trabajo simplemente porque alguna API todavía no existe: utiliza mocks preparados para reemplazo posterior.

IMPORTANTE:

Si el proceso se interrumpe, al retomarlo NO empieces desde cero.

Primero inspecciona qué partes de este módulo ya fueron implementadas, determina qué falta respecto a esta especificación y continúa desde ahí.