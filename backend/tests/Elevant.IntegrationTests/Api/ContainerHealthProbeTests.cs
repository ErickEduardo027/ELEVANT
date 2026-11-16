using System.Net;
using Elevant.Api.HealthChecks;

namespace Elevant.IntegrationTests.Api;

public sealed class ContainerHealthProbeTests
{
    [Fact]
    public void DedicatedArgumentIsRequired()
    {
        Assert.True(ContainerHealthProbe.IsRequested(["--health-probe"]));
        Assert.False(ContainerHealthProbe.IsRequested([]));
        Assert.False(ContainerHealthProbe.IsRequested(["--health-probe", "unexpected"]));
        Assert.False(ContainerHealthProbe.IsRequested(["--other"]));
        Assert.True(ContainerHealthProbe.IsSmokeRequested(["--smoke-probe"]));
        Assert.False(ContainerHealthProbe.IsSmokeRequested(["--health-probe"]));
        Assert.False(ContainerHealthProbe.IsSmokeRequested(["--smoke-probe", "unexpected"]));
    }

    [Theory]
    [InlineData(HttpStatusCode.OK, 0)]
    [InlineData(HttpStatusCode.ServiceUnavailable, 1)]
    [InlineData(HttpStatusCode.NoContent, 1)]
    public async Task ProbeConvertsReadinessStatusIntoExitCode(
        HttpStatusCode statusCode,
        int expectedExitCode)
    {
        using var handler = new StubHttpMessageHandler(
            new HttpResponseMessage(statusCode));

        var exitCode = await ContainerHealthProbe.RunAsync(
            handler,
            TestContext.Current.CancellationToken);

        Assert.Equal(expectedExitCode, exitCode);
        Assert.Equal(new Uri("http://127.0.0.1:8080/health/ready"), handler.RequestUri);
    }

    [Fact]
    public async Task ProbeFailsClosedWhenTheEndpointCannotBeReached()
    {
        using var handler = new StubHttpMessageHandler(
            new HttpRequestException("Synthetic connection failure."));

        var exitCode = await ContainerHealthProbe.RunAsync(
            handler,
            TestContext.Current.CancellationToken);

        Assert.Equal(1, exitCode);
    }

    [Fact]
    public async Task SmokeProbeChecksEveryRolloutEndpoint()
    {
        using var handler = new SequenceHttpMessageHandler(
            HttpStatusCode.OK,
            HttpStatusCode.OK,
            HttpStatusCode.OK,
            HttpStatusCode.OK);

        var exitCode = await ContainerHealthProbe.RunSmokeAsync(
            handler,
            TestContext.Current.CancellationToken);

        Assert.Equal(0, exitCode);
        Assert.Equal(
            [
                new Uri("http://127.0.0.1:8080/health"),
                new Uri("http://127.0.0.1:8080/health/ready"),
                new Uri("http://127.0.0.1:8080/api/v1/system/ping"),
                new Uri("http://127.0.0.1:8080/swagger/v1/swagger.json"),
            ],
            handler.RequestUris);
    }

    [Fact]
    public async Task SmokeProbeStopsAndFailsOnTheFirstUnhealthyEndpoint()
    {
        using var handler = new SequenceHttpMessageHandler(
            HttpStatusCode.OK,
            HttpStatusCode.ServiceUnavailable,
            HttpStatusCode.OK,
            HttpStatusCode.OK);

        var exitCode = await ContainerHealthProbe.RunSmokeAsync(
            handler,
            TestContext.Current.CancellationToken);

        Assert.Equal(1, exitCode);
        Assert.Equal(2, handler.RequestUris.Count);
    }

    private sealed class StubHttpMessageHandler : HttpMessageHandler
    {
        private readonly HttpResponseMessage? response;
        private readonly Exception? exception;

        public StubHttpMessageHandler(HttpResponseMessage response) => this.response = response;

        public StubHttpMessageHandler(Exception exception) => this.exception = exception;

        public Uri? RequestUri { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            RequestUri = request.RequestUri;

            return exception is not null
                ? Task.FromException<HttpResponseMessage>(exception)
                : Task.FromResult(response!);
        }
    }

    private sealed class SequenceHttpMessageHandler(params HttpStatusCode[] statusCodes)
        : HttpMessageHandler
    {
        private readonly Queue<HttpStatusCode> statuses = new(statusCodes);

        public List<Uri> RequestUris { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            RequestUris.Add(request.RequestUri!);

            return Task.FromResult(new HttpResponseMessage(statuses.Dequeue()));
        }
    }
}
