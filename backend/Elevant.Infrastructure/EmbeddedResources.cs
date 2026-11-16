namespace Elevant.Infrastructure;

/// <summary>Files embedded in this assembly at build time (fonts, logo, offline registries).</summary>
internal static class EmbeddedResources
{
    /// <summary>Reads an embedded resource by its file name.</summary>
    public static byte[] Read(string fileName)
    {
        var assembly = typeof(EmbeddedResources).Assembly;
        var resource = assembly.GetManifestResourceNames().Single(name =>
            name.EndsWith(fileName, StringComparison.Ordinal));
        using var stream = assembly.GetManifestResourceStream(resource)!;
        using var buffer = new MemoryStream();
        stream.CopyTo(buffer);
        return buffer.ToArray();
    }
}
