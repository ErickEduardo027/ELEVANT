namespace Elevant.Domain.Governance;

/// <summary>Validity of a dated workforce document (qualification or airport permit) on a given day.</summary>
public enum DocumentValidity
{
    /// <summary>Starts after the reference day.</summary>
    Upcoming,

    /// <summary>In force and not close to expiring.</summary>
    Valid,

    /// <summary>In force but expires within <see cref="DocumentValidityRules.ExpiringSoonDays"/>.</summary>
    ExpiringSoon,

    /// <summary>Expired before the reference day.</summary>
    Expired,
}

/// <summary>Pure classification shared by listings, summaries and their SQL translations.</summary>
public static class DocumentValidityRules
{
    public const int ExpiringSoonDays = 30;

    /// <summary>Last expiry date that still counts as expiring soon for <paramref name="asOf"/>.</summary>
    public static DateOnly ExpiringSoonLimit(DateOnly asOf) =>
        asOf <= DateOnly.MaxValue.AddDays(-ExpiringSoonDays) ? asOf.AddDays(ExpiringSoonDays) : DateOnly.MaxValue;

    public static DocumentValidity Classify(DateOnly startsOn, DateOnly expiresOn, DateOnly asOf)
    {
        if (expiresOn < asOf) return DocumentValidity.Expired;
        if (startsOn > asOf) return DocumentValidity.Upcoming;
        return expiresOn <= ExpiringSoonLimit(asOf) ? DocumentValidity.ExpiringSoon : DocumentValidity.Valid;
    }

    /// <summary>Accepts only the exact member names, never numbers or other casing.</summary>
    public static bool TryParse(string? value, out DocumentValidity validity)
    {
        validity = default;
        return value is not null && Enum.GetNames<DocumentValidity>().Contains(value) &&
            Enum.TryParse(value, ignoreCase: false, out validity);
    }
}
