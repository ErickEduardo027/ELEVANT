CONTEXTO:
Estamos en la rama de Gestión Humana de ELEVANT. Ya existen:
- Home/Sidebar + Dashboard de Gestión Humana.
- Gestión de Usuarios y Cuentas.
- Habilitaciones y Certificaciones.
- Entorno Administrador/OCC en la rama feat/adminocc.

Antes de modificar código, inspecciona el módulo de Habilitaciones y Certificaciones y reutiliza sus componentes, tokens, estados, drawer, filtros, tablas, StatusBadge, KpiCard y patrones de API/mock. NO dupliques componentes ni reconstruyas el sistema visual.

Usa el skill frontend-design antes de implementar.

OBJETIVO:
Construir la ruta "Carnets y permisos aeroportuarios" para gestionar, por agente:
1. Carnet aeroportuario.
2. Licencia de conducir en rampa.

Debe quedar preparada para sustituir los mocks por API REST posteriormente.

FUNCIONALIDAD:

1. RESUMEN
Reutiliza KpiCard para mostrar:
- Carnets vigentes / próximos a vencer / vencidos.
- Licencias vigentes / próximas a vencer / vencidas.

2. TABLA
Columnas:
- Agente
- Terminal
- Carnet: estado + vencimiento
- Licencia: estado + vencimiento
- Acciones

Incluir:
- búsqueda por agente
- filtro por terminal
- filtro por estado
- filtro por documento: carnet/licencia/ambos
- opción "Solo vencidos/próximos" activa inicialmente
- orden por urgencia

Un carnet vencido debe tener mayor peso visual porque bloquea el acceso a rampa.

3. DETALLE
Reutiliza el drawer de Habilitaciones.
Mostrar:
- información del agente
- Carnet: número, emisión, vencimiento, estado
- Licencia: número, emisión, vencimiento, estado
- historial de renovaciones
- acción para renovar cada documento

4. RENOVACIÓN
Crear formulario/modal reutilizable:
- tipo de documento
- número
- fecha de emisión
- fecha de vencimiento
- documento soporte opcional

Al guardar:
- actualizar mock state
- recalcular estado
- mostrar toast
- preparar estructura para futura mutación API.

5. ESTADOS
Implementar:
- loading/skeleton
- datos normales
- carnet vencido + licencia vigente
- ambos vencidos
- filtro sin resultados
- renovación exitosa

REGLAS:
- Mantener exactamente el diseño y tokens existentes.
- Cero emojis.
- No crear una nueva librería de UI ni de gráficos.
- No duplicar componentes existentes.
- No modificar módulos funcionales anteriores salvo que sea estrictamente necesario para reutilización.
- Mantener modo claro/oscuro.
- Mantener responsive desktop/tablet.
- Usar datos mock realistas con interfaces/types claramente separadas de la capa de datos para facilitar futura integración REST.
- Si encuentras una implementación existente que contradice este requerimiento, analízala y reutilízala antes de crear otra.

IMPLEMENTA directamente en la ruta correspondiente del shell de Gestión Humana y verifica que navegación, build y tipos sigan funcionando.