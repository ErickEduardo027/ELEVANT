using System.Net;
using System.Text.Json;
using Elevant.Infrastructure.Integrations.AirTraffic;

namespace Elevant.Infrastructure.Integrations.AviationWeather;

/// <summary>
/// One GET of the Data API of aviationweather.gov (ADR-0043, contracts 1.4), shared by the airport and the region reads:
/// <c>Accept: application/json</c> and the generic <c>User-Agent</c> of the air picture, sent without any caller's
/// cancellation (the client's own limit ends it). A 200 is read with the pure parser it is given; an empty list or a 204
/// is an answer without a report; a 429 (with its <c>Retry-After</c>), any other status, a timeout, an answer too large
/// or one that cannot be read is a failure. Nothing is logged, so no message ever names the service.
/// </summary>
internal static class AviationWeatherHttp
{
    public static async Task<ReportAnswer<T>> GetAsync<T>(HttpClient http, Uri query,
        Func<JsonElement, (AviationWeatherReadKind Kind, T? Report)> parse, TimeProvider time) where T : class
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, query);
        request.Headers.Accept.ParseAdd("application/json");
        request.Headers.UserAgent.ParseAdd(ReadsbAirTrafficProvider.UserAgent);

        HttpResponseMessage response;
        try
        {
            // The whole answer is read here, so the client's limit covers it too.
            response = await http.SendAsync(request, HttpCompletionOption.ResponseContentRead, CancellationToken.None);
        }
        catch (Exception exception) when (exception is HttpRequestException or OperationCanceledException or IOException)
        {
            // A timeout, a refused connection or an answer too large: the message is never logged, it may name the host.
            return ReportAnswer<T>.Failure();
        }

        using (response)
        {
            switch (response.StatusCode)
            {
                case HttpStatusCode.OK:
                    return await ReadAnswerAsync(response, parse);
                case HttpStatusCode.NoContent:
                    return ReportAnswer<T>.NoReport;
                case HttpStatusCode.TooManyRequests:
                    return ReportAnswer<T>.Failure(RetryAfter(response, time.GetUtcNow()), rateLimited: true);
                default:
                    return ReportAnswer<T>.Failure();
            }
        }
    }

    private static async Task<ReportAnswer<T>> ReadAnswerAsync<T>(HttpResponseMessage response,
        Func<JsonElement, (AviationWeatherReadKind Kind, T? Report)> parse) where T : class
    {
        try
        {
            await using var stream = await response.Content.ReadAsStreamAsync();
            using var document = await JsonDocument.ParseAsync(stream);
            var (kind, report) = parse(document.RootElement);
            return kind switch
            {
                AviationWeatherReadKind.Report => ReportAnswer<T>.Of(report),
                AviationWeatherReadKind.NoReport => ReportAnswer<T>.NoReport,
                _ => ReportAnswer<T>.Failure(),
            };
        }
        catch (Exception exception) when (exception is JsonException or HttpRequestException or IOException or
                                          OperationCanceledException)
        {
            return ReportAnswer<T>.Failure();
        }
    }

    /// <summary>What <c>Retry-After</c> asks for, as a delay or as a date; never negative.</summary>
    private static TimeSpan? RetryAfter(HttpResponseMessage response, DateTimeOffset now)
    {
        var delay = response.Headers.RetryAfter?.Delta ??
            (response.Headers.RetryAfter?.Date is { } date ? date - now : null);
        return delay is { } value && value < TimeSpan.Zero ? TimeSpan.Zero : delay;
    }
}
