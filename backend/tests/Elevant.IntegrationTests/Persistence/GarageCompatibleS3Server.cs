using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>Rejects optional AWS upload framing while serving ordinary signed S3 requests.</summary>
internal sealed class GarageCompatibleS3Server : IAsyncDisposable
{
    private readonly WebApplication app;
    private readonly Dictionary<string, byte[]> objects = new(StringComparer.Ordinal);

    private GarageCompatibleS3Server(WebApplication app) => this.app = app;

    public string Endpoint { get; private set; } = string.Empty;
    public string? LastUploadedPath { get; private set; }
    public byte[]? LastUploadedContent { get; private set; }

    public static async Task<GarageCompatibleS3Server> StartAsync(CancellationToken cancellationToken)
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.Logging.ClearProviders();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        var app = builder.Build();
        var server = new GarageCompatibleS3Server(app);
        app.Run(server.HandleAsync);
        await app.StartAsync(cancellationToken);
        server.Endpoint = app.Services.GetRequiredService<IServer>().Features
            .Get<IServerAddressesFeature>()!.Addresses.Single();
        return server;
    }

    private async Task HandleAsync(HttpContext context)
    {
        var path = context.Request.Path.Value!;
        if (HttpMethods.IsPut(context.Request.Method))
        {
            var headers = context.Request.Headers;
            var unsupportedChecksum = headers.ContainsKey("x-amz-sdk-checksum-algorithm") ||
                headers.Keys.Any(name => name.StartsWith("x-amz-checksum-", StringComparison.OrdinalIgnoreCase));
            var unsupportedStreaming = headers.ContainsKey("x-amz-trailer") ||
                headers.ContentEncoding.ToString().Contains("aws-chunked", StringComparison.OrdinalIgnoreCase);
            if (unsupportedChecksum || unsupportedStreaming)
            {
                context.Response.StatusCode = 400;
                context.Response.ContentType = "application/xml";
                await context.Response.WriteAsync($"<Error><Code>InvalidRequest</Code><Message>Unsupported upload framing: checksum={unsupportedChecksum}, streaming={unsupportedStreaming}.</Message></Error>");
                return;
            }

            using var buffer = new MemoryStream();
            await context.Request.Body.CopyToAsync(buffer);
            var content = buffer.ToArray();
            objects[path] = content;
            LastUploadedPath = path;
            LastUploadedContent = content;
            context.Response.Headers.ETag = "\"synthetic-etag\"";
            return;
        }

        if (HttpMethods.IsGet(context.Request.Method) && objects.TryGetValue(path, out var stored))
        {
            context.Response.ContentType = path.EndsWith(".pdf", StringComparison.Ordinal)
                ? "application/pdf" : "image/png";
            context.Response.ContentLength = stored.Length;
            await context.Response.Body.WriteAsync(stored);
            return;
        }

        if (HttpMethods.IsDelete(context.Request.Method))
        {
            objects.Remove(path);
            context.Response.StatusCode = 204;
            return;
        }

        context.Response.StatusCode = 404;
        context.Response.ContentType = "application/xml";
        await context.Response.WriteAsync("<Error><Code>NoSuchKey</Code></Error>");
    }

    public ValueTask DisposeAsync() => app.DisposeAsync();
}
