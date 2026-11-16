namespace Elevant.Application.Identity;

/// <summary>
/// Configuration of the daily sweep of ramp agents' documents (2-N25), section <c>HumanResources</c>: how many
/// days before a current airport permit, ramp licence or qualification expires Gestión Humana is told.
/// </summary>
public sealed class HumanResourcesDocumentOptions
{
    public const string SectionName = "HumanResources";

    /// <summary>The notice when nothing (or an out-of-range value) is configured.</summary>
    public const int DefaultExpiryNoticeDays = 30;

    /// <summary><c>HumanResources:DocumentExpiryNoticeDays</c>; 1 to 365 days.</summary>
    public int DocumentExpiryNoticeDays { get; init; } = DefaultExpiryNoticeDays;

    /// <summary>The notice days the sweep applies.</summary>
    public int NoticeDays => DocumentExpiryNoticeDays is >= 1 and <= 365 ? DocumentExpiryNoticeDays : DefaultExpiryNoticeDays;
}
