using System.Net;
using Amazon;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Elevant.Application.Operations;
using Microsoft.Extensions.Configuration;

namespace Elevant.Persistence.Operations;

/// <summary>Private object storage for walk-around photos (ADR-0032); never served publicly.</summary>
internal interface IOperationalEvidenceStore
{
    Task PutAsync(string key, byte[] content, string contentType, CancellationToken cancellationToken = default);

    Task<byte[]?> GetAsync(string key, CancellationToken cancellationToken = default);
}

/// <summary>S3-compatible store on the same MediaStorage bucket as the other private objects.</summary>
internal sealed class S3OperationalEvidenceStore(IConfiguration configuration) : IOperationalEvidenceStore
{
    public async Task PutAsync(string key, byte[] content, string contentType, CancellationToken cancellationToken = default)
    {
        try
        {
            using var client = CreateClient();
            using var stream = new MemoryStream(content, writable: false);
            await client.PutObjectAsync(new PutObjectRequest
            {
                BucketName = Bucket(), Key = key, InputStream = stream, ContentType = contentType,
                UseChunkEncoding = false,
            }, cancellationToken);
        }
        catch (OperationCanceledException) { throw; }
        catch (OperationalEvidenceUnavailableException) { throw; }
        catch (Exception exception) { throw new OperationalEvidenceUnavailableException(exception); }
    }

    public async Task<byte[]?> GetAsync(string key, CancellationToken cancellationToken = default)
    {
        try
        {
            using var client = CreateClient();
            using var response = await client.GetObjectAsync(new GetObjectRequest { BucketName = Bucket(), Key = key },
                cancellationToken);
            using var buffer = new MemoryStream();
            var chunk = new byte[64 * 1024];
            int read;
            while ((read = await response.ResponseStream.ReadAsync(chunk, cancellationToken)) != 0)
            {
                if (buffer.Length + read > OperationDocumentRules.MaxPhotoBytes)
                    throw new OperationalEvidenceUnavailableException();
                await buffer.WriteAsync(chunk.AsMemory(0, read), cancellationToken);
            }
            return buffer.ToArray();
        }
        catch (AmazonS3Exception exception) when (exception.StatusCode == HttpStatusCode.NotFound ||
                                                  exception.ErrorCode == "NoSuchKey")
        {
            return null;
        }
        catch (OperationCanceledException) { throw; }
        catch (OperationalEvidenceUnavailableException) { throw; }
        catch (Exception exception) { throw new OperationalEvidenceUnavailableException(exception); }
    }

    private string Bucket() => configuration["MediaStorage:Bucket"] is { Length: > 0 } bucket
        ? bucket : throw new OperationalEvidenceUnavailableException();

    private AmazonS3Client CreateClient()
    {
        var endpoint = configuration["MediaStorage:Endpoint"];
        var accessKey = configuration["MediaStorage:AccessKey"];
        var privateCredential = configuration["MediaStorage:SecretKey"];
        if (string.IsNullOrWhiteSpace(endpoint) || string.IsNullOrWhiteSpace(accessKey) ||
            string.IsNullOrWhiteSpace(privateCredential))
            throw new OperationalEvidenceUnavailableException();
        return new AmazonS3Client(new BasicAWSCredentials(accessKey, privateCredential), new AmazonS3Config
        {
            ServiceURL = endpoint, ForcePathStyle = true,
            AuthenticationRegion = configuration["MediaStorage:Region"] ?? "garage",
            RequestChecksumCalculation = RequestChecksumCalculation.WHEN_REQUIRED,
        });
    }
}
