# Arquitectura general

ELEVANT organiza su único backend desplegable como monolito modular en .NET 10. Clean Architecture mantiene fronteras explícitas entre Domain, Application, Contracts, Infrastructure, Persistence y Api; `Elevant.DatabaseTool` es una herramienta one-shot separada del proceso HTTP. Esta forma reduce complejidad operativa temprana sin impedir extraer un módulo cuando exista una necesidad medida.

## Componentes

1. **Private Web**, **Public Web** y **Mobile Agent** son clientes no confiables. Su frontera prevista es HTTPS y, cuando haya eventos implementados, SignalR; no poseen credenciales de infraestructura.
2. **Elevant.Api** es el host HTTP. Compone dependencias, aplica políticas transversales y publica endpoints, health checks y hubs.
3. **Elevant.Application** define puertos y contiene los handlers de creación y consulta de sesión; aún no contiene handlers de negocio.
4. **Elevant.Domain** contiene entidades y bases para invariantes/eventos sin dependencias de infraestructura; todavía no dispone de comportamiento completo de agregado.
5. **Elevant.Contracts** contiene contratos públicos estables de la API; no expone entidades de persistencia.
6. **Elevant.Infrastructure** emite los access tokens JWT y prepara otros adaptadores externos no persistentes; FlightAware aún no tiene adaptador funcional.
7. **Elevant.Persistence** posee EF Core, SQL Server, Identity y seis migraciones v1 bajo `database/DevelopmentDB`; implementa los puertos de Application para verificar credenciales y resolver el actor.
8. **Elevant.DatabaseTool** verifica destinos y ejecuta el seed sintético explícito de Development; la API no migra ni siembra al arrancar.
9. **SQL Server 2022** almacena el estado del backend y solo es accesible desde servicios autorizados; Development contempla acceso humano privado y controlado para datos de prueba.
10. **FlightAware** representa una integración futura detrás de un puerto de Application; no es consumido por clientes.

## Flujo típico

El flujo es: un cliente envía una solicitud versionada; Api valida el transporte y delega un caso de uso a Application; éste aplica reglas en Domain y solicita persistencia o información externa mediante abstracciones; Persistence o Infrastructure implementan los puertos respectivos. La respuesta se proyecta a un contrato público y no devuelve entidades internas. Hoy completan ese flujo `CreateSession` y `GetCurrentSession`, además de la operación de diagnóstico `GetSystemPing`; aún no hay handlers ni endpoints de negocio.

SignalR está mapeado como shell técnico sin eventos de negocio. Cuando se implemente, un mensaje en tiempo real indicará al cliente que actualice su vista o consulte el estado canónico por REST; no constituirá por sí solo confirmación de una transacción.

## Principios

- una dependencia apunta hacia el dominio, no hacia detalles externos;
- una feature posee su comportamiento de extremo a extremo;
- la API es la frontera de datos para todos los clientes;
- los contratos públicos evolucionan de manera compatible o mediante versión;
- configuración y secretos entran desde el ambiente;
- las operaciones peligrosas, como migrar Production, requieren una acción explícita;
- observabilidad no revela tokens, cadenas de conexión ni datos personales.

El modelo Domain, la cadena de migraciones v1 y el slice básico de sesión ya existen. La autorización fina por rol, tenant y estación, refresh/logout y revocación de tokens, endpoints/handlers de negocio y tráfico real a FlightAware siguen pendientes. La [nota vigente de backend](../../Vault/04-arquitectura/backend-dotnet-capas-y-dependencias.md) distingue cada capa implementada de su intención futura.
