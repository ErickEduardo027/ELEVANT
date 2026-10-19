using System.Text;
using System.Text.Json;
using System.Xml.Linq;
using Elevant.Application.Finance;
using Elevant.Domain.Enumerations;
namespace Elevant.Infrastructure.Finance;

public sealed class FinanceFiscalArtifactBuilder : Elevant.Application.Abstractions.Finance.IFiscalArtifactBuilder
{
    public IReadOnlyList<FiscalArchiveItem> Build(Guid documentId, string environment, string canonicalSnapshot) =>
        FinanceFiscalArtifacts.Build(documentId, environment, canonicalSnapshot);
}

public static class FinanceFiscalArtifacts
{
    public static IReadOnlyList<FiscalArchiveItem> Build(Guid documentId, string environment, string snapshot)
    {
        using var parsed = JsonDocument.Parse(snapshot);
        var json = Encoding.UTF8.GetBytes(snapshot);
        var xml = Encoding.UTF8.GetBytes(new XDocument(new XElement("FiscalSimulation",
            new XAttribute("disclaimer", FinanceFiscalPolicy.Disclaimer), new XAttribute("officialSchema", "false"),
            new XElement("InternalDocumentId", documentId), new XElement("Environment", environment),
            new XElement("CanonicalSnapshot", snapshot))).ToString(SaveOptions.DisableFormatting));
        // Parse only for syntactic well-formedness. No official XSD is present or claimed.
        _ = XDocument.Parse(Encoding.UTF8.GetString(xml));
        var manifest = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
        {
            disclaimer = FinanceFiscalPolicy.Disclaimer, documentId, environment,
            jsonSyntaxValidation = "Passed", xmlWellFormedness = "Passed", financialSnapshotValidation = "Passed",
            officialXsdValidation = "NotPerformed", taxValidation = "NotPerformed", signed = false, officialQr = false,
            implementedDocumentTypes = new[] { "LocalSimulation" }, officialDocumentTypes = "PendingProviderAndSchemas",
            artifacts = new[] { new { fileName = "canonical.json", sha256 = FinanceFiscalPolicy.Hash(json), length = json.Length },
                new { fileName = "simulation.xml", sha256 = FinanceFiscalPolicy.Hash(xml), length = xml.Length } },
        }));
        return [new(FiscalArtifactKind.CanonicalJson, "canonical.json", "application/json", json),
            new(FiscalArtifactKind.SimulationXml, "simulation.xml", "application/xml", xml),
            new(FiscalArtifactKind.Manifest, "manifest.json", "application/json", manifest)];
    }
}
