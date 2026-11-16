# Configuración web

`elevantApiClient.js` lee `NEXT_PUBLIC_ELEVANT_API_URL` en un único punto y construye el cliente OpenAPI compartido. El login real lo usa para crear la sesión; los adaptadores de negocio lo reutilizarán gradualmente sin duplicar contratos ni URLs. La aplicación falla de forma visible si falta la URL requerida.
