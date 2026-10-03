using System.Net;
using Amazon;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Elevant.Application.Finance;
using Microsoft.Extensions.Configuration;

namespace Elevant.Persistence.Finance;

internal sealed class S3PrivateFinancialObjectStore(IConfiguration configuration)
    : IPrivateFinancialObjectStore
{
    public async Task PutAsync(string key, byte[] content,
        CancellationToken cancellationToken = default)
    {
        using var client = CreateClient();
        using var stream = new MemoryStream(content, writable: false);
        try
        {
            await client.PutObjectAsync(new PutObjectRequest
            {
                BucketName = Bucket(), Key = key, InputStream = stream,
                ContentType = "application/pdf",
            }, cancellationToken);
        }
        catch (OperationCanceledException) { throw; }
        catch (FinancialDocumentUnavailableException) { throw; }
        catch (Exception exception)
        {
            throw new FinancialDocumentUnavailableException(
                FinancialDocumentFailureStage.StorageWrite, exception);
        }
    }

    public async Task<byte[]?> GetAsync(string key,
        CancellationToken cancellationToken = default)
    {
        using var client = CreateClient();
        try
        {
            using var response = await client.GetObjectAsync(new GetObjectRequest
            {
                BucketName = Bucket(), Key = key,
            }, cancellationToken);
            using var buffer = new MemoryStream();
            var chunk = new byte[64 * 1024];
            int read;
            while ((read = await response.ResponseStream.ReadAsync(
                chunk, cancellationToken)) != 0)
            {
                if (buffer.Length + read > FinancialDocumentIntegrity.MaxBytes)
                    throw new FinancialDocumentUnavailableException(
                        FinancialDocumentFailureStage.StoredContent);
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
        catch (FinancialDocumentUnavailableException) { throw; }
        catch (Exception exception)
        {
            throw new FinancialDocumentUnavailableException(
                FinancialDocumentFailureStage.StorageRead, exception);
        }
    }

    public async Task DeleteAsync(string key,
        CancellationToken cancellationToken = default)
    {
        using var client = CreateClient();
        try
        {
            await client.DeleteObjectAsync(new DeleteObjectRequest
            {
                BucketName = Bucket(), Key = key,
            }, cancellationToken);
        }
        catch (OperationCanceledException) { throw; }
        catch (FinancialDocumentUnavailableException) { throw; }
        catch (Exception exception)
        {
            throw new FinancialDocumentUnavailableException(
                FinancialDocumentFailureStage.StorageDelete, exception);
        }
    }

    private string Bucket() => configuration["MediaStorage:Bucket"] is { Length: > 0 } bucket
        ? bucket : throw new FinancialDocumentUnavailableException(
            FinancialDocumentFailureStage.StorageConfiguration);

    private AmazonS3Client CreateClient()
    {
        try
        {
            var endpoint = configuration["MediaStorage:Endpoint"];
            var accessKey = configuration["MediaStorage:AccessKey"];
            var privateCredential = configuration["MediaStorage:SecretKey"];
            if (string.IsNullOrWhiteSpace(endpoint) || string.IsNullOrWhiteSpace(accessKey) ||
                string.IsNullOrWhiteSpace(privateCredential))
                throw new FinancialDocumentUnavailableException(
                    FinancialDocumentFailureStage.StorageConfiguration);
            return new AmazonS3Client(new BasicAWSCredentials(accessKey, privateCredential),
                new AmazonS3Config
                {
                    ServiceURL = endpoint, ForcePathStyle = true,
                    AuthenticationRegion = configuration["MediaStorage:Region"] ?? "garage",
                });
        }
        catch (FinancialDocumentUnavailableException) { throw; }
        catch (Exception exception)
        {
            throw new FinancialDocumentUnavailableException(
                FinancialDocumentFailureStage.StorageConfiguration, exception);
        }
    }
}
