# OpenAPI

Swashbuckle publishes `v1` at `/swagger/v1/swagger.json`. The document is available by default only in Development and can be enabled in Testing configuration; Production never maps Swagger.

The Bearer definition describes the active short-lived JWT authentication.
`POST /api/v1/auth/session` is anonymous and `GET /api/v1/auth/session` declares
the Bearer requirement; system ping and platform health endpoints remain
anonymous. The host applies authenticated fallback authorization to mapped
controllers and hubs that are not explicitly anonymous. Public DTOs come from
`Elevant.Contracts`, and generated clients should treat the published document
as their input.

`CreateSession` publishes `413` for request bodies above 4096 bytes and `415`
for unsupported media types, in addition
to its validation, authentication, throttling, dependency, and unexpected-error
responses. The default host policy permits 10 creation attempts per remote IP in
a fixed 60-second window; clients must honor `429` rather than treating the
limit as throughput capacity.

Every operation must define a stable route name used as its `operationId`, exact
success and Problem Details response media types, and all responses that the
pipeline can produce. Non-nullable DTO members are emitted as required. These
are client compatibility contracts: rename or removal requires an explicit
coordinated release rather than an incidental controller refactor.
