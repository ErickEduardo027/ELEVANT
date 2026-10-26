using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Commercial;
using Microsoft.Extensions.Configuration;

namespace Elevant.Infrastructure.Commercial;

/// <summary>Server-only Acrobat Sign REST v6 adapter with OAuth refresh and no token logging.</summary>
internal sealed class AdobeContractSignGateway(IConfiguration configuration) : IContractSignGateway,
    IDisposable
{
    private readonly HttpClient _http = new(new HttpClientHandler { AllowAutoRedirect = false })
    { Timeout = TimeSpan.FromSeconds(60) };
    private readonly SemaphoreSlim _tokenLock = new(1, 1);
    private string? _accessToken;
    private DateTimeOffset _expiresAt;

    public async Task<string?> FindByExternalIdAsync(string externalId,
        CancellationToken cancellationToken = default)
    {
        using var json = await GetJsonAsync($"agreements?externalId={Uri.EscapeDataString(externalId)}",
            cancellationToken);
        if (!json.RootElement.TryGetProperty("userAgreementList", out var list) ||
            list.ValueKind != JsonValueKind.Array) return null;
        foreach (var item in list.EnumerateArray())
            if (item.TryGetProperty("id", out var id) && id.GetString() is { Length: > 0 } value)
                return value;
        return null;
    }

    public async Task<string> CreateAsync(string externalId, string title, byte[] pdf,
        string aviamEmail, string airlineEmail,
        CancellationToken cancellationToken = default)
    {
        using var multipart = new MultipartFormDataContent();
        var part = new ByteArrayContent(pdf);
        part.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        multipart.Add(part, "File", "contract.pdf");
        using var uploaded = await SendAsync(HttpMethod.Post, "transientDocuments",
            multipart, cancellationToken);
        using var uploadJson = await JsonDocument.ParseAsync(
            await uploaded.Content.ReadAsStreamAsync(cancellationToken),
            cancellationToken: cancellationToken);
        var transientId = uploadJson.RootElement.GetProperty("transientDocumentId").GetString();
        if (string.IsNullOrWhiteSpace(transientId)) throw new InvalidDataException();
        var body = new
        {
            fileInfos = new[] { new { transientDocumentId = transientId } },
            name = title,
            externalId = new { id = externalId },
            participantSetsInfo = new object[]
            {
                new { memberInfos = new[] { new { email = aviamEmail } }, order = 1, role = "SIGNER" },
                new { memberInfos = new[] { new { email = airlineEmail } }, order = 2, role = "SIGNER" },
            },
            signatureType = "ESIGN",
            state = "IN_PROCESS",
        };
        using var content = new StringContent(JsonSerializer.Serialize(body),
            Encoding.UTF8, "application/json");
        using var created = await SendAsync(HttpMethod.Post, "agreements",
            content, cancellationToken);
        using var createdJson = await JsonDocument.ParseAsync(
            await created.Content.ReadAsStreamAsync(cancellationToken),
            cancellationToken: cancellationToken);
        var id = createdJson.RootElement.GetProperty("id").GetString();
        return !string.IsNullOrWhiteSpace(id) ? id : throw new InvalidDataException();
    }

    public async Task<SigningAgreementState> GetStateAsync(string agreementId,
        CancellationToken cancellationToken = default)
    {
        using var json = await GetJsonAsync($"agreements/{Uri.EscapeDataString(agreementId)}",
            cancellationToken);
        var root = json.RootElement;
        var status = root.GetProperty("status").GetString() ?? string.Empty;
        var signerSets = new List<(int Order, string Email)>();
        if (root.TryGetProperty("participantSetsInfo", out var sets) &&
            sets.ValueKind == JsonValueKind.Array)
            foreach (var set in sets.EnumerateArray())
            {
                if (set.GetProperty("role").GetString() != "SIGNER") continue;
                var members = set.GetProperty("memberInfos");
                if (members.GetArrayLength() != 1) continue;
                signerSets.Add((set.GetProperty("order").GetInt32(),
                    members[0].GetProperty("email").GetString() ?? string.Empty));
            }
        return new SigningAgreementState(status,
            signerSets.OrderBy(set => set.Order).Select(set => set.Email).ToArray());
    }

    public async Task<Uri?> GetSigningUrlAsync(string agreementId, string email,
        CancellationToken cancellationToken = default)
    {
        using var json = await GetJsonAsync(
            $"agreements/{Uri.EscapeDataString(agreementId)}/signingUrls", cancellationToken);
        if (!json.RootElement.TryGetProperty("signingUrlSetInfos", out var sets) ||
            sets.ValueKind != JsonValueKind.Array) return null;
        foreach (var set in sets.EnumerateArray())
            if (set.TryGetProperty("signingUrls", out var urls) &&
                urls.ValueKind == JsonValueKind.Array)
                foreach (var item in urls.EnumerateArray())
                    if (string.Equals(item.GetProperty("email").GetString(), email,
                            StringComparison.OrdinalIgnoreCase) &&
                        Uri.TryCreate(item.GetProperty("esignUrl").GetString(),
                            UriKind.Absolute, out var uri))
                        return uri;
        return null;
    }

    public Task<byte[]> GetSignedPdfAsync(string agreementId,
        CancellationToken cancellationToken = default) =>
        GetBytesAsync($"agreements/{Uri.EscapeDataString(agreementId)}/combinedDocument",
            cancellationToken);

    public Task<byte[]> GetAuditPdfAsync(string agreementId,
        CancellationToken cancellationToken = default) =>
        GetBytesAsync($"agreements/{Uri.EscapeDataString(agreementId)}/auditTrail",
            cancellationToken);

    private async Task<byte[]> GetBytesAsync(string path, CancellationToken cancellationToken)
    {
        using var response = await SendAsync(HttpMethod.Get, path, null, cancellationToken);
        var content = await response.Content.ReadAsByteArrayAsync(cancellationToken);
        if (content.Length is < 5 or > 8 * 1024 * 1024) throw new InvalidDataException();
        return content;
    }

    private async Task<JsonDocument> GetJsonAsync(string path,
        CancellationToken cancellationToken)
    {
        using var response = await SendAsync(HttpMethod.Get, path, null, cancellationToken);
        return await JsonDocument.ParseAsync(
            await response.Content.ReadAsStreamAsync(cancellationToken),
            cancellationToken: cancellationToken);
    }

    private async Task<HttpResponseMessage> SendAsync(HttpMethod method, string path,
        HttpContent? content, CancellationToken cancellationToken)
    {
        var baseUri = BaseUri();
        using var request = new HttpRequestMessage(method,
            new Uri(baseUri, $"/api/rest/v6/{path}"));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer",
            await TokenAsync(cancellationToken));
        request.Content = content;
        var response = await _http.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            response.Dispose();
            throw new HttpRequestException("Acrobat Sign request failed.");
        }
        return response;
    }

    private async Task<string> TokenAsync(CancellationToken cancellationToken)
    {
        if (_accessToken is not null && DateTimeOffset.UtcNow < _expiresAt)
            return _accessToken;
        await _tokenLock.WaitAsync(cancellationToken);
        try
        {
            if (_accessToken is not null && DateTimeOffset.UtcNow < _expiresAt)
                return _accessToken;
            var clientId = configuration["ContractSigning:AdobeSign:ClientId"];
            var credential = configuration["ContractSigning:AdobeSign:ClientSecret"];
            var refreshToken = configuration["ContractSigning:AdobeSign:RefreshToken"];
            if (string.IsNullOrWhiteSpace(clientId) || string.IsNullOrWhiteSpace(credential) ||
                string.IsNullOrWhiteSpace(refreshToken))
                throw new InvalidOperationException("Acrobat Sign OAuth is not configured.");
            using var request = new HttpRequestMessage(HttpMethod.Post,
                new Uri(BaseUri(), "/oauth/v2/refresh"));
            request.Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "refresh_token", ["refresh_token"] = refreshToken,
                ["client_id"] = clientId, ["client_secret"] = credential,
            });
            using var response = await _http.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
                throw new HttpRequestException("Acrobat Sign OAuth refresh failed.");
            using var json = await JsonDocument.ParseAsync(
                await response.Content.ReadAsStreamAsync(cancellationToken),
                cancellationToken: cancellationToken);
            _accessToken = json.RootElement.GetProperty("access_token").GetString();
            var lifetime = json.RootElement.GetProperty("expires_in").GetInt32();
            _expiresAt = DateTimeOffset.UtcNow.AddSeconds(Math.Max(60, lifetime - 300));
            return _accessToken ?? throw new InvalidDataException();
        }
        finally { _tokenLock.Release(); }
    }

    private Uri BaseUri()
    {
        var value = configuration["ContractSigning:AdobeSign:ApiBaseUrl"];
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            uri.Scheme != Uri.UriSchemeHttps || uri.UserInfo.Length != 0 ||
            !(uri.Host.EndsWith(".adobesign.com", StringComparison.OrdinalIgnoreCase) ||
              uri.Host.EndsWith(".echosign.com", StringComparison.OrdinalIgnoreCase)))
            throw new InvalidOperationException("Acrobat Sign API URL is not configured.");
        return uri;
    }

    public void Dispose()
    {
        _http.Dispose();
        _tokenLock.Dispose();
    }
}
