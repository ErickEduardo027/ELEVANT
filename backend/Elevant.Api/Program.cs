using Elevant.Api.Extensions;
using Elevant.Api.HealthChecks;
using Elevant.Application;
using Elevant.Infrastructure;
using Elevant.Persistence;

if (ContainerHealthProbe.IsRequested(args))
{
    Environment.ExitCode = await ContainerHealthProbe.RunAsync();
    return;
}

if (ContainerHealthProbe.IsSmokeRequested(args))
{
    Environment.ExitCode = await ContainerHealthProbe.RunSmokeAsync();
    return;
}

var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddApplication()
    .AddInfrastructure(builder.Configuration)
    .AddPersistence(builder.Configuration)
    .AddApiServices(builder.Configuration);

var app = builder.Build();

app.UseApiPipeline();

app.Run();

/// <summary>Entry point exposed for in-memory integration tests.</summary>
public partial class Program;
