using Elevant.Api.Extensions;
using Elevant.Application;
using Elevant.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddApplication()
    .AddInfrastructure(builder.Configuration)
    .AddApiServices(builder.Configuration);

var app = builder.Build();

app.UseApiPipeline();

app.Run();

/// <summary>Entry point exposed for in-memory integration tests.</summary>
public partial class Program;
