CONTEXTO:
Gestión Humana ya cuenta con Home/Sidebar, Dashboard, Gestión de Usuarios, Habilitaciones, Carnets y Horarios. Admin/OCC ya tiene un módulo de Reportes funcional.

ANTES DE CODIFICAR:
Inspecciona el proyecto y localiza el módulo de Reportes de Admin/OCC. Reutiliza/extiende directamente sus componentes y patrones: ReportTabs, DateRangePicker, ReportFilterBar, ExportButton, tablas, paginación y librería de gráficos. NO dupliques este sistema ni reconstruyas componentes existentes. Integra el nuevo módulo en la ruta de Reportes de Gestión Humana sin modificar el shell existente.

Actúa como senior frontend engineer y product designer. Implementa el módulo Reportes de Gestión Humana de ELEVANT manteniendo exactamente los tokens, estilos, dark/light mode y patrones visuales existentes.

OBJETIVO:
Centralizar reportes de:
1. Vencimientos de carnets, licencias y habilitaciones.
2. Altas/bajas y activaciones/desactivaciones de cuentas.
3. Personal por terminal y turno.
4. Cobertura de habilitaciones por equipo.

REPORTES:

1. VENCIMIENTOS
- Consolidar carnet, licencia y habilitaciones.
- Tabla: agente, documento/habilitación, terminal, vencimiento, días restantes, estado.
- Filtros por tipo y severidad.
- Ordenar por urgencia.
- Vencidos con highlight sutil.
- Click debe poder llevar al módulo/detalle correspondiente.

2. ALTAS Y BAJAS
- Tabla: usuario, movimiento, fecha, rol, realizado por.
- Movimientos: alta/activación y baja/desactivación.
- Gráfico de tendencia altas vs. bajas.
- Respetar DateRangePicker existente.

3. PERSONAL POR TERMINAL Y TURNO
- Gráficos de distribución por Terminal A, Terminal B y FBO.
- Distribución por mañana, tarde y madrugada.
- Tabla de detalle.
- Reutilizar la librería y estilos de gráficos existentes.

4. COBERTURA DE HABILITACIONES
- Por tipo de equipo.
- Mostrar agentes habilitados vigentes vs. necesidad/cobertura.
- Porcentaje de cobertura.
- Indicadores verde/ámbar/rojo.
- Filtro de terminal y fecha de corte.
- Basarse en los mismos datos/conceptos del módulo Habilitaciones.

FUNCIONALIDAD COMÚN:
- Tabs de reportes.
- DateRangePicker cuando corresponda.
- Filtros contextuales.
- Buscador, ordenamiento y paginación en tablas.
- ExportButton existente preparado para PDF/Excel.
- Loading/skeleton.
- Empty state.
- Error + retry.
- Estado de exportación.
- Tooltips con valores exactos en gráficos.
- Transiciones sutiles al cambiar filtros.

API:
Usa mocks realistas, pero NO acoples los datos a la UI. Crea/usa una capa de servicios existente y tipos/interfaces para que posteriormente pueda conectarse a REST sin modificar los componentes.

Ejemplo conceptual:
getExpirationReport()
getAccountMovementsReport()
getStaffDistributionReport()
getQualificationCoverageReport()

Los filtros deben poder transformarse posteriormente en query params.

RESPONSIVE:
Desktop prioritario. Tablet con gráficos apilados y tablas con scroll/columnas secundarias ocultables. Mobile no prioritario.

ENTREGABLE:
- Reportes integrado en Gestión Humana.
- Vencimientos completo.
- Altas/bajas con tendencia.
- Personal por terminal/turno.
- Cobertura de habilitaciones.
- Light/dark.
- Loading, empty y exportación.
- Sin romper ningún módulo existente.

REGLAS:
- No reconstruir componentes existentes.
- No crear un segundo sistema de reportes.
- No modificar Admin/OCC salvo que sea estrictamente necesario para generalizar/reutilizar un componente.
- No cambiar tokens ni estilos existentes.
- Cero emojis.
- Cero colores nuevos.
- Mantener arquitectura preparada para API REST real.

ANTES DE FINALIZAR:
Ejecuta lint/typecheck/build disponibles, corrige errores y verifica que las rutas de Admin/OCC y Gestión Humana sigan funcionando.