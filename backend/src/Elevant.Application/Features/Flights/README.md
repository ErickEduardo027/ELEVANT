# Flights

Las funcionalidades futuras de vuelos se organizarán mediante vertical slices. Cada
caso de uso reunirá su entrada, validación, handler y respuesta, sin crear servicios
globales por capa.

Ejemplo documental; estos archivos todavía no se implementan:

```text
Features/Flights/CreateFlight/
├── CreateFlightCommand.cs
├── CreateFlightHandler.cs
├── CreateFlightValidator.cs
└── CreateFlightResponse.cs
```
