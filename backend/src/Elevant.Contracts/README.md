# HTTP contracts

This project contains stable public request and response shapes. Application integration records are not HTTP contracts. Errors use the platform `ProblemDetails` and `ValidationProblemDetails` types instead of a custom envelope.

Flight DTOs are deliberately deferred until the first approved endpoint. Generated clients must consume the published OpenAPI document rather than infer contracts from application types.
