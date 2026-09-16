using Elevant.Contracts.Identity;
using Microsoft.OpenApi;
using Swashbuckle.AspNetCore.SwaggerGen;

namespace Elevant.Api.OpenApi;

/// <summary>Marks credential input as write-only secret material in the public contract.</summary>
internal sealed class SessionCredentialSchemaFilter : ISchemaFilter
{
    public void Apply(IOpenApiSchema schema, SchemaFilterContext context)
    {
        if (context.Type == typeof(CreateSessionRequest) &&
            schema is OpenApiSchema concreteSchema &&
            concreteSchema.Properties?.TryGetValue("password", out var password) == true &&
            password is OpenApiSchema concretePassword)
        {
            concretePassword.Format = "password";
            concretePassword.WriteOnly = true;
        }
    }
}
