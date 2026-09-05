# OpenAPI

Swashbuckle publishes `v1` at `/swagger/v1/swagger.json`. The document is available by default only in Development and can be enabled in Testing configuration; Production never maps Swagger.

The Bearer definition reserves the future authentication shape but does not enable authentication. Public DTOs come from `Elevant.Contracts`, and generated clients should treat the published document as their input.

Every operation must define a stable route name used as its `operationId`, exact
success and Problem Details response media types, and all responses that the
pipeline can produce. Non-nullable DTO members are emitted as required. These
are client compatibility contracts: rename or removal requires an explicit
coordinated release rather than an incidental controller refactor.
