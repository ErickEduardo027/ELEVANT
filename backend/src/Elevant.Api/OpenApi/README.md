# OpenAPI

Swashbuckle publishes `v1` at `/swagger/v1/swagger.json`. The document is available by default only in Development and can be enabled in Testing configuration; Production never maps Swagger.

The Bearer definition reserves the future authentication shape but does not enable authentication. Public DTOs come from `Elevant.Contracts`, and generated clients should treat the published document as their input.
