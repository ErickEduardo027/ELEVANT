using Elevant.Application.Operations;
using Elevant.Contracts.Operations;

namespace Elevant.Api.Controllers;

internal static class OperationDocumentResponseMapper
{
    public static OperationDocumentsResponse Map(OperationDocumentsView view) => new(view.OperationId,
        view.Documents.Select(Map).ToArray(),
        view.DamageMarks.Select(mark => new DamageMarkResponse(mark.Id, mark.X, mark.Y, mark.Note, mark.ReportedAt,
            mark.HasPhoto)).ToArray());

    public static OperationDocumentSignatureResponse Map(OperationDocumentSignatureData signature) =>
        new(signature.Role.ToString(), signature.SignerName, signature.SignedAt);

    private static OperationDocumentResponse Map(OperationDocumentData document)
    {
        var content = document.Content;
        var flight = content.Flight;
        return new OperationDocumentResponse(content.Kind.ToString(), content.Number, content.Title, content.FormCode,
            document.ContentSha256, document.RequiredRoles.Select(role => role.ToString()).ToArray(),
            document.Signatures.Select(Map).ToArray(), document.StaleRoles.Select(role => role.ToString()).ToArray(),
            document.IsFullySigned,
            new OperationDocumentSummaryResponse(flight.FlightIn, flight.FlightOut, flight.Registration, flight.AircraftType,
                flight.Position, flight.PassengersIn, flight.PassengersOut, flight.MtowKg,
                content.Services.Select(line => new OperationDocumentServiceLineResponse(line.Code, line.Name, line.Quantity,
                    line.Unit, line.Amount)).ToArray(),
                content.Surcharges.Select(item => $"{item.Name} · {item.ServiceCode}").ToArray(), content.CurrencyCode,
                content.TotalAmount, content.Milestones.Count, content.Checklist.Count(item => item.Value is not null),
                content.Checklist.Count, content.Damages.Count));
    }
}
