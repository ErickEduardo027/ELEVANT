# Arquitectura general

Elevant comienza como un monolito modular en .NET 10. Un único backend desplegable concentra reglas, persistencia e integraciones, pero Clean Architecture mantiene fronteras explícitas entre Domain, Application, Contracts, Infrastructure y Api. Esta forma reduce complejidad operativa temprana sin impedir extraer un módulo cuando exista una necesidad medida.

## Componentes

1. **Web** y **Mobile Agent** son clientes no confiables. Consumen HTTPS y SignalR, y no poseen credenciales de infraestructura.
2. **Elevant.Api** es el host HTTP. Compone dependencias, aplica políticas transversales y publica endpoints, health checks y hubs.
3. **Elevant.Application** contiene casos de uso y puertos requeridos por estos casos.
4. **Elevant.Domain** contiene invariantes, entidades y eventos de dominio sin dependencias de infraestructura.
5. **Elevant.Contracts** contiene contratos públicos estables de la API; no expone entidades de persistencia.
6. **Elevant.Infrastructure** implementa persistencia e integraciones externas.
7. **SQL Server 2022** almacena el estado del backend y solo es accesible desde servicios autorizados.
8. **FlightAware** representa una integración futura detrás de un puerto de Application; no es consumido por clientes.

## Flujo típico

Un cliente envía una solicitud versionada. Api valida el transporte y delega un caso de uso a Application. El caso aplica reglas en Domain y solicita persistencia o información externa mediante abstracciones. Infrastructure implementa esos puertos. La respuesta se proyecta a un contrato público y no devuelve entidades internas.

SignalR complementa este flujo para notificaciones servidor-cliente. Un mensaje en tiempo real indica que el cliente debe actualizar su vista o consultar el estado canónico por REST; no constituye por sí solo confirmación de una transacción.

## Principios

- una dependencia apunta hacia el dominio, no hacia detalles externos;
- una feature posee su comportamiento de extremo a extremo;
- la API es la frontera de datos para todos los clientes;
- los contratos públicos evolucionan de manera compatible o mediante versión;
- configuración y secretos entran desde el ambiente;
- las operaciones peligrosas, como migrar Production, requieren una acción explícita;
- observabilidad no revela tokens, cadenas de conexión ni datos personales.

El diseño actual no incluye autenticación, entidades de negocio, migraciones iniciales ni tráfico real a FlightAware. Esos elementos se agregan solo con requisitos y criterios de aceptación concretos.
