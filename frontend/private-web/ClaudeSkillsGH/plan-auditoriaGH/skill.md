Implementa ahora el módulo Trazabilidad / Auditoría de Gestión Humana.

ANTES DE MODIFICAR:
- Inspecciona la rama/proyecto actual y reutiliza componentes existentes.
- Revisa especialmente el Dashboard, Gestión de Usuarios, Habilitaciones, Carnets, Horarios, Reportes y sus patrones de actividad/filtros.
- NO recrees AppShell, Sidebar, KpiCard, StatusBadge, ExportButton, modales, tablas ni patrones ya existentes.
- Usa el skill frontend-design disponible, pero sin rehacer ni alterar el sistema visual existente.
- No cambies módulos funcionales anteriores ni hagas refactors innecesarios.

OBJETIVO:
Crear la nueva ruta de Trazabilidad/Auditoría dentro del shell de Gestión Humana.

Debe permitir consultar acciones críticas de TODO el sistema:
- creación/activación/desactivación de cuentas
- cambios de roles/permisos
- modificaciones de datos de usuarios
- asignación/remoción operativa de agentes
- renovaciones de habilitaciones y carnets

UI:
1. Header con:
   - búsqueda por usuario afectado o ejecutor
   - filtros por tipo de acción
   - rango de fechas
   - usuario ejecutor
   - Exportar reutilizando ExportButton existente

2. Resumen superior:
   - total de acciones
   - cuentas
   - roles/permisos
   - habilitaciones/carnets
   - asignaciones
   Reutiliza KpiCard.

3. Timeline/lista cronológica:
   - agrupar Hoy, Ayer, Esta semana y Anteriores
   - cada entrada muestra acción, usuario afectado, ejecutor, fecha/hora y tipo
   - colores discretos existentes:
     alta #1E9E6B, edición #145DC4, baja #C4453C,
     roles #F2661E, asignaciones #D9A441
   - acciones críticas ligeramente más destacadas

4. Al expandir una entrada:
   - detalle de la acción
   - campos modificados
   - valor anterior → valor nuevo
   - IP/dispositivo solo si existe en los datos

5. Exportación:
   - reutiliza ExportButton existente
   - loading + toast de éxito

ESTADOS:
- loading/skeleton
- resultados normales
- filtro sin resultados
- entrada expandida
- exportación en progreso/completada

RESPONSIVE:
Mantén los patrones responsive existentes. Desktop con filtros horizontales; tablet puede colapsarlos.

ARQUITECTURA:
- React + Tailwind
- crea únicamente componentes nuevos que realmente hagan falta, por ejemplo:
  AuditTimeline, AuditEntryItem, AuditEntryDetail, AuditFilterBar
- reutiliza componentes existentes siempre que sea posible
- usa mocks realistas SOLO como fuente temporal de datos
- estructura los datos y servicios para sustituir los mocks por API REST posteriormente sin rehacer la UI
- no conectes todavía una API inexistente
- no inventes endpoints reales

REGLAS:
- cero emojis
- cero colores nuevos
- mantener exactamente los tokens visuales actuales
- no duplicar componentes
- no modificar funcionalidades existentes
- no instalar dependencias si ya existe una solución en el proyecto
- evita refactors fuera del alcance
- prioriza terminar el módulo funcional antes que agregar mejoras opcionales

AL FINAL:
Verifica rutas, imports, TypeScript, build/lint disponible y que el módulo no rompa los demás roles. Corrige únicamente errores relacionados con este cambio.