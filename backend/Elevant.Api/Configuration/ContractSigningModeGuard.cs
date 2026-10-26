namespace Elevant.Api.Configuration;

/// <summary>Rejects an unsafe private archive before the API accepts requests.</summary>
internal static class ContractSigningModeGuard
{
    public static void Validate(IConfiguration configuration, IHostEnvironment environment)
    {
        var mode = configuration["ContractSigning:Mode"];
        if (!string.IsNullOrWhiteSpace(mode) &&
            !string.Equals(mode, "Adobe", StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(mode, "AcademicLocal", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Unsupported contract signing mode.");
        if (!string.Equals(mode, "AcademicLocal",
                StringComparison.OrdinalIgnoreCase)) return;
        if (!environment.IsDevelopment() && !environment.IsEnvironment("Test"))
            throw new InvalidOperationException(
                "AcademicLocal contract signing is restricted to Development and Test.");
        var configured = configuration["ContractSigning:LocalArchiveDirectory"];
        if (string.IsNullOrWhiteSpace(configured) || !Path.IsPathFullyQualified(configured))
            throw new InvalidOperationException(
                "AcademicLocal requires an absolute private LocalArchiveDirectory.");
        var directory = Path.GetFullPath(configured);
        var contentRoot = Path.GetFullPath(environment.ContentRootPath);
        var repository = FindRepository(contentRoot);
        if (Inside(directory, repository) || Inside(directory, contentRoot))
            throw new InvalidOperationException(
                "The contract archive must be outside the repository and web content.");
        var path = new DirectoryInfo(directory);
        for (var cursor = path; cursor is not null; cursor = cursor.Parent)
            if (cursor.Exists && cursor.Attributes.HasFlag(FileAttributes.ReparsePoint))
                throw new InvalidOperationException(
                    "The contract archive cannot contain linked directories.");
    }

    private static string FindRepository(string contentRoot)
    {
        for (var cursor = new DirectoryInfo(contentRoot); cursor is not null;
             cursor = cursor.Parent)
            if (File.Exists(Path.Combine(cursor.FullName, ".git")) ||
                Directory.Exists(Path.Combine(cursor.FullName, ".git")))
                return cursor.FullName;
        return contentRoot;
    }

    private static bool Inside(string path, string root) =>
        string.Equals(path, root, StringComparison.OrdinalIgnoreCase) ||
        path.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) +
            Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
}
