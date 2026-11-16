using Microsoft.OpenApi;
using Swashbuckle.AspNetCore.SwaggerGen;

namespace Elevant.Api.OpenApi;

/// <summary>Documents OCC optimistic-concurrency headers without changing JSON bodies.</summary>
internal sealed class OccPlanningConcurrencyOperationFilter : IOperationFilter
{
    private const string OptionsOperationId = "GetOccPlanningOptions";
    private const string AssignmentOperationId = "AssignOccPlanningOperation";

    public void Apply(OpenApiOperation operation, OperationFilterContext context)
    {
        if (operation.OperationId is not (OptionsOperationId or AssignmentOperationId))
        {
            return;
        }

        if (operation.Responses is not null &&
            operation.Responses.TryGetValue("200", out var successResponse) &&
            successResponse is OpenApiResponse concreteResponse)
        {
            concreteResponse.Headers ??= new Dictionary<string, IOpenApiHeader>();
            concreteResponse.Headers["ETag"] = new OpenApiHeader
            {
                Description = "Strong, opaque version of the current OCC planning representation.",
                Schema = new OpenApiSchema { Type = JsonSchemaType.String },
            };
        }

        if (operation.OperationId != AssignmentOperationId || operation.Parameters is null)
        {
            return;
        }

        var ifMatch = operation.Parameters
            .OfType<OpenApiParameter>()
            .SingleOrDefault(parameter =>
            string.Equals(parameter.Name, "If-Match", StringComparison.OrdinalIgnoreCase));
        if (ifMatch is not null)
        {
            ifMatch.Required = true;
            ifMatch.Description =
                "Strong ETag returned by the latest OCC planning options response.";
        }
    }
}
