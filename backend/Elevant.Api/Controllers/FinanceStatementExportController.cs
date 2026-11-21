using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Documents;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Documents;
using Elevant.Application.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>
/// The statement of account of an airline at a cut-off as PDF or Excel (ADR-0048, «Reportes nuevos»): the same data as
/// <c>GET finance/statements</c> under the same permission, with the running balance and the aging of the balances.
/// Every export is audited (<c>finance.report.exported</c>, report <c>statement</c>).
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[ReportProblemDetails]
[Route("api/v{version:apiVersion}/finance/statements")]
public sealed class FinanceStatementExportController(
    IFinanceTreasuryStore treasury,
    IReportRenderer renderer,
    IReportExportAudit audit,
    IActorContextResolver actors,
    IStatementDocumentRenderer statements,
    Elevant.Application.Abstractions.Commercial.IAirlinePortalReportStore airlines,
    TimeProvider timeProvider) : ControllerBase
{
    [HttpGet("export", Name = "ExportFinanceStatement")]
    [Produces("application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")]
    [ProducesResponseType<FileContentResult>(StatusCodes.Status200OK, "application/pdf",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<IActionResult> Export([FromQuery, BindRequired] string format, [FromQuery, BindRequired] DateOnly asOf,
        [FromQuery, BindRequired] Guid airlineId, [FromQuery] Guid? stationId, [FromQuery] string? currency,
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var actorId) || actorId == Guid.Empty)
        {
            Response.Headers.WWWAuthenticate = "Bearer";
            return StatusCode(StatusCodes.Status401Unauthorized, new ProblemDetails
            {
                Status = StatusCodes.Status401Unauthorized, Title = "Authentication failed.", Instance = Request.Path,
            });
        }
        if (format is not ("pdf" or "xlsx") || airlineId == Guid.Empty || stationId == Guid.Empty ||
            asOf == DateOnly.MinValue || asOf == DateOnly.MaxValue || currency is not (null or "USD" or "DOP"))
            return ReportProblems.InvalidQuery(this);
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor is null || !actor.HasPermission("finance.receipts.read"))
            return StatusCode(StatusCodes.Status403Forbidden, new ProblemDetails
            {
                Status = StatusCodes.Status403Forbidden, Title = "No tiene permiso para este reporte.", Instance = Request.Path,
            });
        var data = await treasury.StatementAsync(actorId, asOf, stationId, airlineId, cancellationToken);
        var options = await treasury.OptionsAsync(actorId, cancellationToken);
        if (data is null || options is null) return ReportProblems.StationUnavailable(this);
        var airline = options.Airlines.FirstOrDefault(item => item.Id == airlineId);
        if (airline is null) return ReportProblems.NotFound(this);
        var station = stationId is { } only ? options.Stations.FirstOrDefault(item => item.Id == only)?.Code : null;
        var input = Input(airline.Name, station, data);
        var document = AccountStatementDocuments.ToDocument(input) with
        {
            GeneratedAt = timeProvider.GetUtcNow(),
            GeneratedBy = actor.DisplayName,
        };
        byte[] bytes;
        if (format == "pdf")
        {
            // PR E: the PDF is the printable statement, in one currency; the Excel keeps every currency on the engine.
            var customer = await airlines.CustomerAsync(airlineId, cancellationToken);
            bytes = statements.RenderStatement(AccountStatementDocuments.ToPrintable(input,
                AccountStatementDocuments.PrintableCurrency(input, currency),
                new AirlineCustomerHeader(airline.Name, customer?.Code ?? "—", customer?.TaxRegistration), document.GeneratedAt,
                actor.DisplayName));
        }
        else bytes = renderer.RenderXlsx(document);
        var query = new TabularReportQuery(null, asOf, new Dictionary<string, string>
        {
            ["airline"] = airlineId.ToString("D"),
        }.Concat(stationId is { } id ? [new KeyValuePair<string, string>("station", id.ToString("D"))] : [])
            .ToDictionary(item => item.Key, item => item.Value));
        await audit.RecordAsync(actorId, "finance", "statement", format, query, document.Rows.Count, cancellationToken);
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        return File(bytes, format == "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            $"estado-de-cuenta-{Slug(airline.Name)}-{asOf:yyyyMMdd}.{format}");
    }

    internal static AccountStatementInput Input(string airline, string? station, FinanceTreasuryStatementData data) =>
        new(airline, station, data.AsOf,
            data.Invoices.Select(invoice => new AccountStatementInvoice(invoice.Id, invoice.Number, invoice.FiscalNumber,
                invoice.CurrencyCode, invoice.Total, invoice.Balance, invoice.DueDate)).ToArray(),
            data.Movements.Select(movement => new AccountStatementMovement(movement.Kind, movement.InvoiceId,
                movement.CurrencyCode, movement.Amount, movement.EffectiveOn, movement.Reference)).ToArray(),
            data.Aging);

    /// <summary>«arajet», «jetblue-airways»: a file name without accents, spaces or symbols.</summary>
    internal static string Slug(string name)
    {
        var normalized = name.Normalize(System.Text.NormalizationForm.FormD);
        var builder = new System.Text.StringBuilder();
        foreach (var character in normalized)
        {
            if (char.IsAsciiLetterOrDigit(character)) builder.Append(char.ToLowerInvariant(character));
            else if (char.IsWhiteSpace(character) || character is '-' or '_' or '.') builder.Append('-');
        }
        var slug = string.Join('-', builder.ToString().Split('-', StringSplitOptions.RemoveEmptyEntries));
        return slug.Length == 0 ? "aerolinea" : slug;
    }
}
