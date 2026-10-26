using Adobe.PDFServicesSDK;
using Adobe.PDFServicesSDK.auth;
using Adobe.PDFServicesSDK.io;
using Adobe.PDFServicesSDK.pdfjobs.jobs;
using Adobe.PDFServicesSDK.pdfjobs.parameters.documentmerge;
using Adobe.PDFServicesSDK.pdfjobs.results;
using Elevant.Application.Abstractions.Commercial;
using Microsoft.Extensions.Configuration;
using Newtonsoft.Json.Linq;

namespace Elevant.Infrastructure.Commercial;

/// <summary>Uses the approved DOCX and Adobe Document Generation to produce the exact PDF.</summary>
internal sealed class AdobeContractDocumentGenerator(IConfiguration configuration)
    : IContractDocumentGenerator
{
    public Task<byte[]> GenerateAsync(byte[] templateDocx, string mergeJson,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(templateDocx);
        ArgumentException.ThrowIfNullOrWhiteSpace(mergeJson);
        cancellationToken.ThrowIfCancellationRequested();
        var clientId = configuration["ContractSigning:AdobePdf:ClientId"];
        var credential = configuration["ContractSigning:AdobePdf:ClientSecret"];
        if (string.IsNullOrWhiteSpace(clientId) || string.IsNullOrWhiteSpace(credential))
            throw new InvalidOperationException("Adobe PDF Services is not configured.");
        // The SDK is synchronous; isolate it from the request thread.
        return Task.Run(() =>
        {
            ICredentials credentials = new ServicePrincipalCredentials(clientId, credential);
            var services = new PDFServices(credentials);
            using var input = new MemoryStream(templateDocx, writable: false);
            var asset = services.Upload(input, PDFServicesMediaType.DOCX.GetMIMETypeValue());
            var parameters = DocumentMergeParams.DocumentMergeParamsBuilder()
                .WithJsonDataForMerge(JObject.Parse(mergeJson))
                .WithOutputFormat(OutputFormat.PDF)
                .Build();
            var job = new DocumentMergeJob(asset, parameters);
            var location = services.Submit(job);
            var result = services.GetJobResult<DocumentMergeResult>(
                location, typeof(DocumentMergeResult));
            var content = services.GetContent(result.Result.Asset);
            using var output = new MemoryStream();
            content.Stream.CopyTo(output);
            return output.ToArray();
        }, cancellationToken);
    }
}
