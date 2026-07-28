# Flujo de desarrollo web

La web todavía no tiene framework. Antes de inicializarla, registrar la decisión y fijar Node/pnpm. Después:

1. seleccionar una feature pequeña y su contrato OpenAPI;
2. generar o actualizar el cliente compartido;
3. definir estados de carga, éxito, vacío, error y sesión;
4. desarrollar contra un adaptador mock reemplazable;
5. verificar contra la API remota del ambiente local o Development;
6. añadir pruebas y accesibilidad básica;
7. habilitar el pipeline a partir de la plantilla.

Los mocks representan contratos, no una base paralela de negocio. La URL API llega por ambiente y ningún valor público contiene secretos. Un error inesperado se muestra con un mensaje seguro y un identificador de correlación si el backend lo proporciona.
