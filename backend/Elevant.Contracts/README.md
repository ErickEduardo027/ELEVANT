# HTTP contracts

This project contains stable public request and response shapes. Application integration records are not HTTP contracts. Errors use the platform `ProblemDetails` and `ValidationProblemDetails` types instead of a custom envelope.

`Operations/OccPlanningResponses.cs` is the first approved operational read
contract. It exposes UUIDs and canonical nested projections, never EF entities or
internal `bigint` keys. Generated clients must consume the published OpenAPI
document rather than infer contracts from application types.
