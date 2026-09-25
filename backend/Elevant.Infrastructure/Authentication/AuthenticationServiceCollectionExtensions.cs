using Elevant.Application.Abstractions.Identity;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.Infrastructure.Authentication;

internal static class AuthenticationServiceCollectionExtensions
{
    public static IServiceCollection AddJwtAccessTokens(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        services
            .AddOptions<JwtAccessTokenOptions>()
            .Bind(configuration.GetSection(JwtAccessTokenOptions.SectionName))
            .Validate(
                static options => options.IsValid(),
                "Authentication JWT settings must provide issuer, audience, a base64 signing key that decodes to 32-128 bytes, and a lifetime from 1 to 60 minutes.")
            .ValidateOnStart();

        services.AddScoped<IAccessTokenIssuer, JwtAccessTokenIssuer>();
        return services;
    }
}
