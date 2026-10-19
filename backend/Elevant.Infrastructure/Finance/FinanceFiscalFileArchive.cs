using System.Security.Cryptography;
using System.Text;
using Elevant.Application.Abstractions.Finance;
namespace Elevant.Infrastructure.Finance;

/// <summary>Explicit Development/Test private archive. Hash-addressed keys, atomic immutable originals; never web-served.</summary>
public sealed class FinanceFiscalFileArchive : IFiscalArtifactArchive
{
    private readonly string root;
    public FinanceFiscalFileArchive(string directory)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(directory);
        root = Path.GetFullPath(directory);
        Directory.CreateDirectory(root);
    }
    private string Location(string key)
    {
        if (string.IsNullOrWhiteSpace(key) || key.Length > 512 || key.Contains('\\') || key.Contains(':') ||
            key.Split('/').Any(segment => segment is "" or "." or "..")) throw new ArgumentException("Invalid private archive key.", nameof(key));
        return Path.Combine(root, Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(key))) + ".blob");
    }
    public async Task PutAsync(string key, byte[] content, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(content);
        var target = Location(key);
        var temporary = Path.Combine(root, ".tmp-" + Guid.NewGuid().ToString("N"));
        try
        {
            await using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                81920, FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                await stream.WriteAsync(content, cancellationToken);
                await stream.FlushAsync(cancellationToken);
                stream.Flush(flushToDisk: true);
            }
            try { File.Move(temporary, target, overwrite: false); }
            catch (IOException) when (File.Exists(target))
            {
                var existing = await File.ReadAllBytesAsync(target, cancellationToken);
                if (!CryptographicOperations.FixedTimeEquals(SHA256.HashData(existing), SHA256.HashData(content)))
                    throw new IOException("An immutable fiscal artifact already exists with different bytes.");
            }
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    public async Task<byte[]?> GetAsync(string key, CancellationToken cancellationToken = default)
    {
        var target = Location(key);
        return File.Exists(target) ? await File.ReadAllBytesAsync(target, cancellationToken) : null;
    }
}
