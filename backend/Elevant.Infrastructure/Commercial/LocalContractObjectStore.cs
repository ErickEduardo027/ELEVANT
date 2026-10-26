using Elevant.Application.Abstractions.Commercial;

namespace Elevant.Infrastructure.Commercial;

/// <summary>Private Development/Test archive. Keys are relative and writes are immutable.</summary>
public sealed class LocalContractObjectStore(string directory) : IContractObjectStore
{
    private const int MaxBytes = 8 * 1024 * 1024;
    private readonly string root = Path.GetFullPath(directory);

    public async Task PutAsync(string key, byte[] bytes,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(bytes);
        if (bytes.Length is < 1 or > MaxBytes) throw new InvalidDataException("Contract object size is invalid.");
        var path = PathFor(key);
        RejectLinks(path);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        RejectLinks(path);
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            await using (var stream = new FileStream(temporary, FileMode.CreateNew,
                             FileAccess.Write, FileShare.None, 64 * 1024,
                             FileOptions.Asynchronous | FileOptions.WriteThrough))
                await stream.WriteAsync(bytes, cancellationToken);
            try { File.Move(temporary, path); }
            catch (IOException) when (File.Exists(path))
            {
                var stored = await GetAsync(key, cancellationToken);
                if (stored is null || !stored.AsSpan().SequenceEqual(bytes))
                    throw new InvalidDataException("An immutable contract object differs from the stored bytes.");
            }
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    public async Task<byte[]?> GetAsync(string key,
        CancellationToken cancellationToken = default)
    {
        var path = PathFor(key);
        if (!File.Exists(path)) return null;
        RejectLinks(path);
        var info = new FileInfo(path);
        if (info.Length is < 1 or > MaxBytes) throw new InvalidDataException("Stored contract object size is invalid.");
        return await File.ReadAllBytesAsync(path, cancellationToken);
    }

    private string PathFor(string key)
    {
        if (string.IsNullOrWhiteSpace(key) || key.Length > 240 || key.StartsWith('/') ||
            key.Contains('\\') || key.Split('/').Any(segment => segment.Length == 0 ||
                segment is "." or ".." || segment.Any(character =>
                    !(char.IsAsciiLetterOrDigit(character) || character is '-' or '_' or '.'))))
            throw new ArgumentException("Invalid contract object key.", nameof(key));
        var path = Path.GetFullPath(Path.Combine(root, key.Replace('/', Path.DirectorySeparatorChar)));
        if (!Path.GetRelativePath(root, path).Split(Path.DirectorySeparatorChar)
                .All(segment => segment != ".."))
            throw new ArgumentException("Contract object key escapes the private archive.", nameof(key));
        return path;
    }

    private void RejectLinks(string path)
    {
        var current = root;
        if (Directory.Exists(current) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidDataException("Linked contract archive roots are forbidden.");
        foreach (var segment in Path.GetRelativePath(root, path).Split(Path.DirectorySeparatorChar))
        {
            current = Path.Combine(current, segment);
            if ((File.Exists(current) || Directory.Exists(current)) &&
                (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidDataException("Linked contract archive entries are forbidden.");
        }
    }
}
