using System.Text.Json;

namespace Elevant.Application.Operations;

/// <summary>
/// CN-27: what a signature on an AVIAM form attests. The stored version keeps its exact canonical JSON and hash
/// (ADR-0032), but a signature stays valid while the <em>operational facts</em> it attested are the same: times and
/// milestones, flight numbers and dates, registration, stand, passengers and MTOW, services with their codes,
/// quantities, units, prices and amounts, charges, checklist answers, damages, delays, observations and the people.
/// Renaming master data (the station, the airline, the aircraft model, a service, a charge, a checklist item) only
/// changes the descriptive labels the form prints, so it does not ask for the form to be signed again; the codes
/// those labels describe are kept and still count.
/// </summary>
public static class OperationDocumentSignedFacts
{
    /// <summary>
    /// The descriptive label fields left out of the comparison, by their canonical JSON path. Everything else in the
    /// content is an attested fact.
    /// </summary>
    public static readonly IReadOnlyList<string> DescriptiveLabelFields =
    [
        "flight.stationName",
        "flight.airlineName",
        "flight.aircraftType (the model name; the ICAO type code in parentheses is kept)",
        "services[].name (the service name; the mark of a line OCC excluded from billing is kept)",
        "surcharges[].name",
        "checklist[].section",
        "checklist[].label",
        "milestones[].label",
    ];

    /// <summary>What a line OCC excluded from billing says on the forms (3-N11): a fact, so it is kept.</summary>
    public const string ExcludedLineSuffix = " · Excluido de la facturación por OCC";

    /// <summary>The content with its descriptive labels blanked: what two versions must share to attest the same.</summary>
    public static OperationDocumentContent WithoutDescriptiveLabels(OperationDocumentContent content) => content with
    {
        Flight = content.Flight with
        {
            StationName = string.Empty,
            AirlineName = string.Empty,
            AircraftType = AircraftTypeCode(content.Flight.AircraftType),
        },
        Services = content.Services
            .Select(line => line with
            {
                Name = line.Name.EndsWith(ExcludedLineSuffix, StringComparison.Ordinal) ? ExcludedLineSuffix : string.Empty,
            }).ToArray(),
        Surcharges = content.Surcharges.Select(item => item with { Name = string.Empty }).ToArray(),
        Checklist = content.Checklist.Select(item => item with { Section = string.Empty, Label = string.Empty }).ToArray(),
        Milestones = content.Milestones.Select(item => item with { Label = string.Empty }).ToArray(),
    };

    /// <summary>The canonical JSON of the attested facts.</summary>
    public static string Facts(OperationDocumentContent content) =>
        OperationDocumentRules.CanonicalJson(WithoutDescriptiveLabels(content));

    /// <summary>Whether two contents attest the same operational facts (they may differ only in labels).</summary>
    public static bool AttestSameFacts(OperationDocumentContent signed, OperationDocumentContent current) =>
        string.Equals(Facts(signed), Facts(current), StringComparison.Ordinal);

    /// <summary>
    /// Whether a stored version (its canonical JSON and hash) attests the same facts as the content assembled now:
    /// the exact hash first, then the facts without labels. A stored content that cannot be read never matches.
    /// </summary>
    public static bool Matches(string storedSha256, string storedJson, string currentSha256, string currentFacts)
    {
        if (string.Equals(storedSha256, currentSha256, StringComparison.Ordinal)) return true;
        try
        {
            return string.Equals(Facts(OperationDocumentRules.Parse(storedJson)), currentFacts, StringComparison.Ordinal);
        }
        catch (JsonException)
        {
            return false;
        }
        catch (InvalidOperationException)
        {
            return false;
        }
    }

    /// <summary>«A320neo (A20N)» → «A20N»: the type code the label describes; any other label is kept whole.</summary>
    private static string? AircraftTypeCode(string? label)
    {
        if (label is null) return null;
        var open = label.LastIndexOf('(');
        return open >= 0 && label.EndsWith(')') && label.Length - open > 2 ? label[(open + 1)..^1] : label;
    }
}
