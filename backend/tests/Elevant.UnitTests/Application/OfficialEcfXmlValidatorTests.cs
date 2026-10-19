using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Xml.Linq;
using Elevant.Application.Abstractions.Finance;
using Elevant.Infrastructure.Finance;

namespace Elevant.UnitTests.Application;

public sealed class OfficialEcfXmlValidatorTests
{
    private readonly IOfficialEcfXmlValidator validator = new OfficialEcfXmlValidator();

    [Theory]
    [InlineData(OfficialEcfDocumentType.E31)]
    [InlineData(OfficialEcfDocumentType.E32)]
    [InlineData(OfficialEcfDocumentType.E33)]
    [InlineData(OfficialEcfDocumentType.E34)]
    public void OfficialSchemaAcceptsExplicitUnsignedTestMarkerButPreflightStillRequiresSignature(OfficialEcfDocumentType type)
    {
        // The actual DGII XSD has a mandatory xs:any processContents="skip".
        // This explicit TEST marker characterizes that gap; it is never a signature.
        var result = Validate(type, Fixture(type, includeUnsignedTestMarker: true));

        Assert.Equal($"DGII.ECF.{type}", result.SchemaId);
        Assert.Equal("1.0", result.SchemaVersion);
        Assert.Equal(64, result.SchemaSha256.Length);
        Assert.Equal(OfficialEcfSchemaValidation.Passed, result.SchemaValidation);
        Assert.False(result.IsStructurallyValid);
        Assert.False(result.SignatureElementPresent);
        Assert.Equal("SignatureMissing", Assert.Single(result.StructuralErrors).Code);
        Assert.Equal(OfficialEcfCryptographicValidation.NotPerformed, result.CryptographicValidation);
    }

    [Theory]
    [InlineData(OfficialEcfDocumentType.E31)]
    [InlineData(OfficialEcfDocumentType.E32)]
    [InlineData(OfficialEcfDocumentType.E33)]
    [InlineData(OfficialEcfDocumentType.E34)]
    public void UnsignedDocumentFailsUnmodifiedOfficialSchemaWithoutFabricatingSignature(OfficialEcfDocumentType type)
    {
        var result = Validate(type, Fixture(type));
        Assert.Equal(OfficialEcfSchemaValidation.Failed, result.SchemaValidation);
        Assert.Contains(result.StructuralErrors, e => e.Code == "XsdValidation");
        Assert.Contains(result.StructuralErrors, e => e.Code == "SignatureMissing");
        Assert.False(result.IsStructurallyValid);
        Assert.Equal(OfficialEcfCryptographicValidation.NotPerformed, result.CryptographicValidation);
    }

    [Theory]
    [InlineData(OfficialEcfDocumentType.E31)]
    [InlineData(OfficialEcfDocumentType.E32)]
    [InlineData(OfficialEcfDocumentType.E33)]
    [InlineData(OfficialEcfDocumentType.E34)]
    public void RequiredTotalCannotBeOmitted(OfficialEcfDocumentType type)
    {
        var xml = XDocument.Parse(Fixture(type, true));
        xml.Descendants("MontoTotal").Single().Remove();
        AssertXsdFailure(Validate(type, xml.ToString()));
    }

    [Theory]
    [InlineData("-1.00")]
    [InlineData("1.001")]
    [InlineData("not-a-number")]
    [InlineData("1234567890123456789.00")]
    public void OfficialDecimalRestrictionsRejectBadTotals(string total)
    {
        var xml = XDocument.Parse(Fixture(OfficialEcfDocumentType.E31, true));
        xml.Descendants("MontoTotal").Single().Value = total;
        AssertXsdFailure(Validate(OfficialEcfDocumentType.E31, xml.ToString()));
    }

    [Fact]
    public void XsdDoesNotClaimToCheckArithmeticAcrossLinesAndTotals()
    {
        var xml = XDocument.Parse(Fixture(OfficialEcfDocumentType.E31, true));
        xml.Descendants("MontoTotal").Single().Value = "999.00"; // Item remains 100.00.
        var result = Validate(OfficialEcfDocumentType.E31, xml.ToString());
        Assert.Equal(OfficialEcfSchemaValidation.Passed, result.SchemaValidation);
        Assert.False(result.IsStructurallyValid); // Missing signature is still blocking.
    }

    [Theory]
    [InlineData("RNCEmisor")]
    [InlineData("RazonSocialEmisor")]
    [InlineData("FechaEmision")]
    [InlineData("CantidadItem")]
    [InlineData("Version")]
    public void OtherRequiredFieldsCannotBeOmitted(string field)
    {
        var xml = XDocument.Parse(Fixture(OfficialEcfDocumentType.E31, true));
        xml.Descendants(field).Single().Remove();
        AssertXsdFailure(Validate(OfficialEcfDocumentType.E31, xml.ToString()));
    }

    [Theory]
    [InlineData(OfficialEcfDocumentType.E33)]
    [InlineData(OfficialEcfDocumentType.E34)]
    public void AdjustmentDocumentsRequireTheirReference(OfficialEcfDocumentType type)
    {
        var xml = XDocument.Parse(Fixture(type, true));
        xml.Descendants("InformacionReferencia").Single().Remove();
        AssertXsdFailure(Validate(type, xml.ToString()));
    }

    [Fact]
    public void ExplicitExpectedTypePreventsSelectingALooserDifferentOfficialSchema()
    {
        var xml = XDocument.Parse(Fixture(OfficialEcfDocumentType.E31, true));
        xml.Descendants("TipoeCF").Single().Value = "32"; // XSD's shared enum alone permits this.
        var result = Validate(OfficialEcfDocumentType.E31, xml.ToString());
        Assert.Contains(result.StructuralErrors, e => e.Code == "DocumentTypeMismatch");
        Assert.False(result.IsStructurallyValid);
    }

    [Theory]
    [InlineData("")]
    [InlineData("<ECF>")]
    [InlineData("<ECF/><ECF/>")]
    [InlineData("not XML")]
    public void MalformedOrEmptyXmlFailsClosed(string xml)
    {
        var result = Validate(OfficialEcfDocumentType.E31, xml);
        Assert.False(result.IsStructurallyValid);
        Assert.NotEmpty(result.StructuralErrors);
        Assert.Equal(OfficialEcfCryptographicValidation.NotPerformed, result.CryptographicValidation);
    }

    [Fact]
    public void NeutralSimulationXmlIsNotAnOfficialEcf()
    {
        var result = Validate(OfficialEcfDocumentType.E31, "<FiscalSimulation><CanonicalSnapshot>{}</CanonicalSnapshot></FiscalSimulation>");
        AssertXsdFailure(result);
    }

    [Fact]
    public void ExternalAndInternalDtdsAreProhibited()
    {
        foreach (var declaration in new[]
        {
            "<!DOCTYPE ECF [<!ENTITY xxe SYSTEM 'file:///synthetic-test-secret.txt'>]>",
            "<!DOCTYPE ECF [<!ENTITY expansion 'synthetic'>]>",
        })
        {
            var result = Validate(OfficialEcfDocumentType.E31, declaration + "<ECF>&xxe;</ECF>");
            Assert.Contains(result.StructuralErrors, e => e.Code == "XmlRejected");
            Assert.False(result.IsStructurallyValid);
        }
    }

    [Fact]
    public async Task SchemaHintsInlineSchemasDtdAndSignatureUrisNeverCauseNetworkAccess()
    {
        // Local trap only. No Internet or DGII endpoint is contacted.
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var url = $"http://127.0.0.1:{((IPEndPoint)listener.LocalEndpoint).Port}/untrusted.xsd";
        var xml = XDocument.Parse(Fixture(OfficialEcfDocumentType.E31, true));
        XNamespace xsi = "http://www.w3.org/2001/XMLSchema-instance";
        xml.Root!.SetAttributeValue(xsi + "noNamespaceSchemaLocation", url);
        var hinted = Validate(OfficialEcfDocumentType.E31, xml.ToString());
        Assert.Equal(OfficialEcfSchemaValidation.Passed, hinted.SchemaValidation);

        var inline = new XDocument(xml);
        XNamespace xs = "http://www.w3.org/2001/XMLSchema";
        inline.Root!.Elements().Last().ReplaceWith(new XElement(xs + "schema",
            new XElement(xs + "include", new XAttribute("schemaLocation", url))));
        var inlineResult = Validate(OfficialEcfDocumentType.E31, inline.ToString());
        Assert.Equal(OfficialEcfSchemaValidation.Passed, inlineResult.SchemaValidation);
        Assert.False(inlineResult.SignatureElementPresent);

        // An empty XMLDSig element is NOT a valid signature. Characterize that the
        // official wildcard skips it and that this adapter never verifies/fetches it.
        var signatureShell = new XDocument(xml);
        XNamespace ds = "http://www.w3.org/2000/09/xmldsig#";
        signatureShell.Root!.Elements().Last().ReplaceWith(new XElement(ds + "Signature",
            new XElement(ds + "SignedInfo", new XElement(ds + "Reference", new XAttribute("URI", url)))));
        var shellResult = Validate(OfficialEcfDocumentType.E31, signatureShell.ToString());
        Assert.Equal(OfficialEcfSchemaValidation.Passed, shellResult.SchemaValidation);
        Assert.True(shellResult.SignatureElementPresent);
        Assert.Equal(OfficialEcfCryptographicValidation.NotPerformed, shellResult.CryptographicValidation);

        var dtdResult = Validate(OfficialEcfDocumentType.E31, $"<!DOCTYPE ECF SYSTEM '{url}'><ECF/>");
        Assert.Contains(dtdResult.StructuralErrors, e => e.Code == "XmlRejected");
        await Task.Delay(50, TestContext.Current.CancellationToken);
        Assert.False(listener.Pending(), "Untrusted XML caused a network connection.");
    }

    [Fact]
    public void UnsupportedTypeCannotSelectAFileOrUrl()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => validator.Validate((OfficialEcfDocumentType)41, Encoding.UTF8.GetBytes("<ECF/>")));
    }

    [Fact]
    public void OversizeAndDeepInputsAreRejectedWithBoundedDiagnostics()
    {
        var large = Validate(OfficialEcfDocumentType.E31, new string('x', 2 * 1024 * 1024 + 1));
        Assert.Equal("DocumentTooLarge", Assert.Single(large.StructuralErrors).Code);
        var nested = "<ECF>" + string.Concat(Enumerable.Repeat("<nested>", 70)) +
            string.Concat(Enumerable.Repeat("</nested>", 70)) + "</ECF>";
        var deep = Validate(OfficialEcfDocumentType.E31, nested);
        Assert.Contains(deep.StructuralErrors, e => e.Code == "DepthLimitExceeded");
        var errors = Validate(OfficialEcfDocumentType.E31,
            "<ECF>" + string.Concat(Enumerable.Repeat("<unexpected/>", 1000)) + "</ECF>");
        Assert.InRange(errors.StructuralErrors.Count, 1, 100);
    }

    [Fact]
    public void DiagnosticLimitAlsoBoundsErrorsFromTheDocumentProfile()
    {
        var xml = XDocument.Parse(Fixture(OfficialEcfDocumentType.E31, true));
        xml.Descendants("TipoeCF").Single().Value = "32";
        var item = xml.Descendants("Item").Single();
        item.Element("CantidadItem")!.Value = "invalid";
        var items = Enumerable.Range(0, 99).Select(_ => new XElement(item)).ToArray();
        item.Parent!.ReplaceNodes(items);
        var result = Validate(OfficialEcfDocumentType.E31, xml.ToString());
        Assert.InRange(result.StructuralErrors.Count, 1, 100);
    }

    [Fact]
    public void DiagnosticMessagesCannotEchoAnUnboundedInvalidField()
    {
        var xml = XDocument.Parse(Fixture(OfficialEcfDocumentType.E31, true));
        xml.Descendants("MontoTotal").Single().Value = new string('x', 10000);
        var result = Validate(OfficialEcfDocumentType.E31, xml.ToString());
        Assert.All(result.StructuralErrors, error => Assert.InRange(error.Message.Length, 1, 2048));
    }

    [Fact]
    public async Task CompiledSchemasCanBeReusedAcrossConcurrentRequests()
    {
        var results = await Task.WhenAll(Enumerable.Range(0, 32).Select(i => Task.Run(() =>
        {
            var type = (OfficialEcfDocumentType)(31 + i % 4);
            return Validate(type, Fixture(type, true));
        }, TestContext.Current.CancellationToken)));
        Assert.All(results, result => Assert.Equal(OfficialEcfSchemaValidation.Passed, result.SchemaValidation));
    }

    private OfficialEcfXmlValidationResult Validate(OfficialEcfDocumentType type, string xml) =>
        validator.Validate(type, Encoding.UTF8.GetBytes(xml));

    private static void AssertXsdFailure(OfficialEcfXmlValidationResult result)
    {
        Assert.Equal(OfficialEcfSchemaValidation.Failed, result.SchemaValidation);
        Assert.False(result.IsStructurallyValid);
        Assert.Contains(result.StructuralErrors, e => e.Code == "XsdValidation" && e.LineNumber > 0);
    }

    // TEST ONLY: no real taxpayer, invoice, fiscal numbering, credentials or signature.
    // Explicitly synthetic sequence is confined to this test file and never archived
    // by FinanceFiscalArtifacts or sent to a provider.
    private static string Fixture(OfficialEcfDocumentType type, bool includeUnsignedTestMarker = false)
    {
        var number = (int)type;
        var expiry = type is OfficialEcfDocumentType.E31 or OfficialEcfDocumentType.E33
            ? "<FechaVencimientoSecuencia>31-12-2026</FechaVencimientoSecuencia>" : "";
        var credit = type == OfficialEcfDocumentType.E34 ? "<IndicadorNotaCredito>0</IndicadorNotaCredito>" : "";
        var income = type is OfficialEcfDocumentType.E31 or OfficialEcfDocumentType.E32 ? "<TipoIngresos>01</TipoIngresos>" : "";
        var buyer = type is OfficialEcfDocumentType.E31 or OfficialEcfDocumentType.E32
            ? "<Comprador><RNCComprador>000000000</RNCComprador><RazonSocialComprador>SYNTHETIC TEST BUYER</RazonSocialComprador></Comprador>" : "";
        var reference = type is OfficialEcfDocumentType.E33 or OfficialEcfDocumentType.E34
            ? "<InformacionReferencia><NCFModificado>E310000000001</NCFModificado><FechaNCFModificado>17-10-2026</FechaNCFModificado><CodigoModificacion>3</CodigoModificacion></InformacionReferencia>" : "";
        var marker = includeUnsignedTestMarker
            ? "<UnsignedSyntheticFixture xmlns=\"urn:elevant:tests:unsigned\">TEST ONLY - NO SIGNATURE OR FISCAL VALIDITY</UnsignedSyntheticFixture>" : "";
        return $"""
            <ECF>
              <Encabezado>
                <Version>1.0</Version>
                <IdDoc><TipoeCF>{number}</TipoeCF><eNCF>E{number}0000000001</eNCF>{expiry}{credit}{income}<TipoPago>1</TipoPago></IdDoc>
                <Emisor><RNCEmisor>000000000</RNCEmisor><RazonSocialEmisor>SYNTHETIC TEST EMITTER</RazonSocialEmisor><DireccionEmisor>TEST ONLY</DireccionEmisor><FechaEmision>18-10-2026</FechaEmision></Emisor>
                {buyer}
                <Totales><MontoExento>100.00</MontoExento><MontoTotal>100.00</MontoTotal></Totales>
              </Encabezado>
              <DetallesItems><Item><NumeroLinea>1</NumeroLinea><IndicadorFacturacion>4</IndicadorFacturacion><NombreItem>SYNTHETIC TEST SERVICE</NombreItem><IndicadorBienoServicio>2</IndicadorBienoServicio><CantidadItem>1.00</CantidadItem><PrecioUnitarioItem>100.00</PrecioUnitarioItem><MontoItem>100.00</MontoItem></Item></DetallesItems>
              {reference}
              <FechaHoraFirma>18-10-2026 12:00:00</FechaHoraFirma>
              {marker}
            </ECF>
            """;
    }
}
