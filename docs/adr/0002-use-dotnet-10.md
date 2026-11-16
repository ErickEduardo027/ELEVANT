# ADR-0002: Usar .NET 10

## Estado

Accepted — 2026-07-18.

## Contexto

El entorno dispone de un SDK estable .NET 10 y el proyecto comienza sin una dependencia obligatoria que fuerce `net9.0`. .NET 10 es una versión LTS, mientras que bajar a .NET 9 reduciría el horizonte de soporte y obligaría a una actualización más temprana. La compatibilidad debe evaluarse con restauración, compilación y pruebas reales, no por cautela genérica.

## Decisión

Apuntar los proyectos productivos y de prueba a `net10.0`. Fijar la línea base del SDK mediante `global.json`, permitir roll-forward a revisiones estables compatibles y bloquear paquetes con administración central y archivos lock junto a cada proyecto de `backend` y `database/DevelopmentDB`.

Solo se reconsiderará `net9.0` si una dependencia indispensable presenta un fallo reproducible sin alternativa compatible con .NET 10 y el costo de sustituirla supera temporalmente el de bajar el target.

## Consecuencias

- Se utiliza el soporte LTS y las APIs actuales de la plataforma.
- Todo paquete se verifica específicamente con .NET 10 durante restore, build y tests.
- Los entornos de CI, desarrollo y contenedores deben ofrecer SDK/runtime 10.
- Una biblioteca que solo anuncie targets anteriores puede funcionar por compatibilidad, pero se valida en lugar de asumirse.
- Actualizaciones de feature band o paquetes requieren regenerar locks y revisión explícita.

## Alternativas consideradas

- .NET 9: rechazado sin un bloqueo reproducible, por su menor horizonte de soporte.
- Multi-target `net9.0;net10.0`: añade matriz y complejidad sin consumidor que la necesite.
- No fijar SDK: aumenta variaciones entre equipos y CI.
