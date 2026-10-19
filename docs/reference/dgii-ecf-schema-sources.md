# DGII e-CF: pinned official schemas and offline preflight

Retrieved and inspected on **2026-10-19 UTC** (2026-10-18 in America/La_Paz). Version **1.0** is the version published in the DGII filenames and allowed `Version` field, not a claim of certification or an immutable DGII release.

The official [DGII documentation index](https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/Paginas/documentacionSobreE-CF.aspx) links the four source files below. Files are retained **byte for byte**, including original CRLF endings. The local `XmlSchemas/.gitattributes` disables text conversion. The adapter verifies embedded bytes against SHA-256 before compiling. Missing resources or hash mismatches are configuration failures, not passing validations.

| Schema ID / version | Official source | Local file | SHA-256 |
| --- | --- | --- | --- |
| DGII.ECF.E31 / 1.0 | [DGII e-CF 31 v.1.0](https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/Documentacin%20sobre%20eCF/Documentaci%C3%B3n%20T%C3%A9cnica%20(XSD)/e-CF%2031%20v.1.0.xsd) | [e-CF-31-v1.0.xsd](../../backend/Elevant.Infrastructure/Finance/XmlSchemas/e-CF-31-v1.0.xsd) | 6f2909a93d84919518d2ae3c77fead4b35c3e8c95996b8af67b0040c2e2be298 |
| DGII.ECF.E32 / 1.0 | [DGII e-CF 32 v.1.0](https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/Documentacin%20sobre%20eCF/Documentaci%C3%B3n%20T%C3%A9cnica%20(XSD)/e-CF%2032%20v.1.0.xsd) | [e-CF-32-v1.0.xsd](../../backend/Elevant.Infrastructure/Finance/XmlSchemas/e-CF-32-v1.0.xsd) | 151676df03c61335b4ac1eca97f99395488d57ea92793b49353602871e651f3c |
| DGII.ECF.E33 / 1.0 | [DGII e-CF 33 v.1.0](https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/Documentacin%20sobre%20eCF/Documentaci%C3%B3n%20T%C3%A9cnica%20(XSD)/e-CF%2033%20v.1.0.xsd) | [e-CF-33-v1.0.xsd](../../backend/Elevant.Infrastructure/Finance/XmlSchemas/e-CF-33-v1.0.xsd) | 087cd71beba11c19cf548e22b96363cb4aa210dc6f5c3c8a62122a42c88d2866 |
| DGII.ECF.E34 / 1.0 | [DGII e-CF 34 v.1.0](https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/Documentacin%20sobre%20eCF/Documentaci%C3%B3n%20T%C3%A9cnica%20(XSD)/e-CF%2034%20v.1.0.xsd) | [e-CF-34-v1.0.xsd](../../backend/Elevant.Infrastructure/Finance/XmlSchemas/e-CF-34-v1.0.xsd) | 6c62ebabdea9a6f6d62ae85d9e1c2eb788f44f3f0b61945fe116700c4eaac2da |

All four downloaded XSDs have no `xs:include`, `xs:import` or `xs:redefine` dependencies. They share global type names and the root `ECF`; they are deliberately compiled into four **separate** schema sets. Any future dependency requires a reviewed embedded resource mapping. The current loader rejects all dependencies and has a null resolver.

## Official format and signature references

The following PDFs were downloaded from that index and read locally; they are references, not embedded runtime dependencies.

- [Formato Comprobante Fiscal Electrónico (e-CF) V1.0](https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/Documentacin%20sobre%20eCF/Formatos%20XML/Formato%20Comprobante%20Fiscal%20Electr%C3%B3nico%20(e-CF)%20V1.0.pdf): SHA-256 `c811c91a9e6a61a65d0637920cea51ef474160d7cd7bc7087fbf895597e17d5a`. PDF pages 4–5 (printed pages 3–4) require a digital signature for every issued e-CF; PDF page 59 (printed page 58) describes the signature area.
- [Firmado de e-CF](https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/Documentacin%20sobre%20eCF/Instructivos%20sobre%20Facturaci%C3%B3n%20Electr%C3%B3nica/Firmado%20de%20e-CF.pdf): SHA-256 `bb32bb04c170ac3e954166414dae583b28c4e3314578acdd532d15119d04b98e`. PDF pages 3–5 describe SHA-256, an empty document reference URI and enveloped XMLDSig. The signature namespace is `http://www.w3.org/2000/09/xmldsig#`. This adapter does not implement signing or verification.

## Result contract

`IOfficialEcfXmlValidator.Validate(OfficialEcfDocumentType, ReadOnlyMemory<byte>)` accepts E31, E32, E33 or E34 and original XML bytes. There is no schema URL, file path, resolver, HTTP client, key, taxpayer lookup, official number allocation or provider call in this port. Other enum values throw `ArgumentOutOfRangeException`.

The result returns schema ID/version/hash, raw `SchemaValidation`, bounded `StructuralErrors`, signature element presence and `CryptographicValidation = NotPerformed`. `IsStructurallyValid` requires a complete XSD pass and zero structural/profile errors. It never establishes DGII acceptance or submission authorization.

- Raw XSD checks order, mandatory elements, allowed values and the numeric facets encoded by each official file. Missing required fields fail.
- The preflight additionally checks `Encabezado/IdDoc/TipoeCF` against the explicitly requested schema: the XSD's shared enum permits multiple types.
- Each XSD ends with mandatory `xs:any minOccurs="1" maxOccurs="1" processContents="skip"` after mandatory `FechaHoraFirma`. The XSD therefore does **not** establish that the last element is a digital signature and does not check XMLDSig internals. The preflight adds `SignatureMissing` when a direct root child `Signature` in the XMLDSig namespace is absent.
- A present XMLDSig element is **presence only**. An empty or corrupt signature shell may pass the XSD because of that wildcard. Algorithms, digests, reference integrity, certificates, trust, expiry and revocation remain unchecked; cryptography is always `NotPerformed`.
- Cross-field arithmetic, tax policy, taxpayer identity, authorized e-NCF ranges, calendar/business rules and commercial reference validity remain separate requirements. A lexical total of 999.00 with a line amount of 100.00 passes these XSDs. Negative/overprecision/nondecimal/oversized totals and missing totals fail where the XSD defines those facets.
- No result represents fiscal acceptance. Fiscal types outside this bounded capability remain unsupported.

## Synthetic fixtures and the signature boundary

The validator fixture builder lives in [OfficialEcfXmlValidatorTests.cs](../../backend/tests/Elevant.UnitTests/Application/OfficialEcfXmlValidatorTests.cs). It is test-only and unsigned, with zero synthetic RNCs, explicitly synthetic sample sequences/names and fixed dates. Fixture values never enter operational fiscal output.

Both forms are tested against the **unmodified** official schemas:

| Fixture | Raw XSD result | Preflight result | Crypto |
| --- | --- | --- | --- |
| Unsigned E31/E32/E33/E34, without trailing element | Failed: mandatory wildcard unsatisfied | Failed | NotPerformed |
| Same unsigned synthetic document with explicit `urn:elevant:tests:unsigned` marker | Passed: characterizes the official wildcard | Failed: SignatureMissing | NotPerformed |

The marker says TEST ONLY and NO SIGNATURE OR FISCAL VALIDITY. It is not a substitute signature. No schema or mandatory field is weakened. A hostile-input test uses a visibly incomplete XMLDSig shell with a loopback reference to prove the adapter never follows signature URIs; it has no signature value, certificate or key and makes no cryptographic validity claim.

`FinanceFiscalArtifacts` continues to generate neutral canonical JSON and `FiscalSimulation` XML because no reviewed typed e-CF mapping from invoices is enabled. This preflight is a separate capability for future valid typed e-CF data. Do not replace simulation output with these fixtures, fabricate official identifiers from invoices, feed neutral simulation XML into this port or change manifests to claim official XSD validation.

## Runtime bounds and XML security

- Maximum 2 MiB input bytes, 2 MiB parsed characters, reader depth 64, 100 diagnostics and 2048 characters per diagnostic message.
- DTDs are prohibited for instance and schema readers. Readers and schema sets use `XmlResolver = null`. Both internal and external DTDs/XXE are rejected.
- `ProcessSchemaLocation` and `ProcessInlineSchema` are disabled. Instance hints, inline includes and signature reference URIs cannot select or fetch resources.
- Compiled schema sets are lazy, shared and never mutated after compilation. Every request has its own reader and diagnostics.
- Schema warnings fail closed; malformed XML, wrong roots and namespace mismatches cannot succeed.

## Runtime integration

The Infrastructure project embeds the original schema bytes with stable resource names:

```xml
<ItemGroup>
  <EmbeddedResource Include="Finance/XmlSchemas/*.xsd">
    <LogicalName>Elevant.Infrastructure.Finance.XmlSchemas.%(Filename)%(Extension)</LogicalName>
  </EmbeddedResource>
</ItemGroup>
```

Infrastructure registers the validator independently of provider dispatch:

```csharp
services.AddSingleton<IOfficialEcfXmlValidator, OfficialEcfXmlValidator>();
```

Keep the port separate from dispatch and the neutral simulator until reviewed typed fiscal data and fiscal policy exist.

Run its focused tests from the repository root:

```powershell
dotnet test backend/tests/Elevant.UnitTests/Elevant.UnitTests.csproj --filter FullyQualifiedName~OfficialEcfXmlValidatorTests
```

The repository unit suite covers required fields, decimal facets, adjustment references, expected type, malformed XML, DTD/XXE, ignored hints/inline schemas, signature URIs, bounds and concurrency. Network tests use a local loopback trap and assert zero connection attempts. These tests establish structural and isolation behavior, without calling DGII or performing cryptographic verification.

## Separate HTTP preflight and panel

The runtime entry point is `POST /api/v1/finance/fiscal-xml/validate`, implemented in [FinanceFiscalXmlValidationController.cs](../../backend/Elevant.Api/Controllers/FinanceFiscalXmlValidationController.cs). It requires the application's valid JWT, server-resolved `finance.fiscal.read`, and an `AviamOperator / InternalStaff` membership. Simulation mode and provider configuration do not control this offline capability.

Dedicated [Contracts DTOs](../../backend/Elevant.Contracts/Finance/FinanceFiscalXmlValidationContracts.cs) accept exactly one of:

```json
{ "documentType": "E31", "xmlUtf8": "<ECF/>" }
```

```json
{ "documentType": "E31", "xmlBase64": "PEVDRi8+" }
```

Only exact `E31`, `E32`, `E33` and `E34` type identifiers are accepted. Decoded content must be UTF-8 and at most 2 MiB. Base64 preserves the original uploaded bytes, BOM and line endings; it does not permit UTF-16 or arbitrary binary content. The HTTP envelope is capped at 12 MiB + 4 KiB to accommodate JSON escaping; decoded XML retains its independent 2 MiB limit.

HTTP 400 means invalid input/encoding, 401 missing/invalid JWT, 403 missing permission or internal membership, 413 oversized input and 503 schema configuration unavailable. A well-formed API request returns HTTP 200 even when its XML fails XSD/preflight checks. The response exposes `schemaId`, `schemaVersion`, `schemaSha256`, `schemaValidation`, `isStructurallyValid`, `structuralErrors`, `signatureElementPresent`, `cryptographicValidation` and `fiscalAcceptance`. Both final statuses remain `NotPerformed`. It does not return the uploaded XML, a document ID or a dispatch job. Responses use `no-store`; the controller has no storage/provider dependency and does not log XML.

[HTTP tests](../../backend/tests/Elevant.IntegrationTests/Api/FinanceFiscalXmlValidationEndpointsTests.cs) run the real API middleware, JWT handler and registered official validator. Their additional unsigned synthetic E31–E34 fixtures are confined to that test file and retain the explicit unsigned marker/`SignatureMissing` boundary.

[FiscalDocumentsPage](../../frontend/private-web/src/features/finance/fiscal/FiscalDocumentsPage.jsx) mounts [FiscalXmlValidationPanel](../../frontend/private-web/src/features/finance/fiscal/FiscalXmlValidationPanel.jsx) in its offline validation disclosure, inside the existing `DepartmentAccessProvider`.

The panel uses [financeFiscalXmlValidationService](../../frontend/private-web/src/services/financeFiscalXmlValidationService.js), supports a local UTF-8 file or pasted XML, sends only on explicit validation, clears stale results when input/type changes and offers a Clear action. File bytes are read locally and sent as base64 only after the user requests validation. It stores no XML in browser storage, emits no XML logs and presents signature presence, cryptography and fiscal acceptance separately.

Focused validation:

```powershell
dotnet test backend/tests/Elevant.IntegrationTests/Elevant.IntegrationTests.csproj --filter FullyQualifiedName~FinanceFiscalXmlValidationEndpointsTests
```

```powershell
# frontend/private-web
npm.cmd test -- src/services/financeFiscalXmlValidationService.test.js src/features/finance/fiscal/FiscalXmlValidationPanel.test.jsx
```
