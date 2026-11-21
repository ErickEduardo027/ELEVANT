using System.Globalization;
using Elevant.Application.Common;
using Elevant.Application.Documents;

namespace Elevant.Infrastructure.Documents;

/// <summary>
/// How ELEVANT documents write figures, dates and nouns (PR E): dates dd/MM/yyyy, times in the local zone of AVIAM or of
/// the station (never UTC), amounts with thousands and two decimals (more only when a snapshot has them, the same for a
/// whole column so the decimal points stand under each other), quantities as numbers and not as money, and nouns that
/// agree with their number («1 mes», «2 meses»).
/// </summary>
internal static class DocumentText
{
    private static readonly NumberFormatInfo Numbers = new()
    {
        NumberDecimalSeparator = ".", NumberGroupSeparator = ",", NumberGroupSizes = [3], NegativeSign = "-",
    };

    public static string Date(DateOnly value) => ReportFormat.Date(value);

    /// <summary>The business day of <paramref name="value"/> in the zone (Santo Domingo by default), dd/MM/yyyy.</summary>
    public static string Date(DateTimeOffset value, string? ianaTimeZone = null) =>
        Date(BusinessCalendar.Today(value, ianaTimeZone));

    /// <summary>«30/11/2026 21:30» in the zone (Santo Domingo by default).</summary>
    public static string Stamp(DateTimeOffset value, string? ianaTimeZone = null) =>
        TimeZoneInfo.ConvertTime(value, BusinessCalendar.Zone(ianaTimeZone)).ToString("dd/MM/yyyy HH:mm", CultureInfo.InvariantCulture);

    /// <summary>«30/11/2026 21:30 (hora de Santo Domingo)».</summary>
    public static string LocalStamp(DateTimeOffset value) => Stamp(value) + " (hora de Santo Domingo)";

    /// <summary>The decimals an amount needs: two, or up to four when the snapshot kept them.</summary>
    public static int Decimals(decimal amount)
    {
        var value = Math.Abs(amount);
        for (var decimals = 2; decimals < 4; decimals++)
            if (decimal.Round(value, decimals) == value) return decimals;
        return 4;
    }

    /// <summary>The decimals of a column of amounts: the most any of them needs, so all print alike.</summary>
    public static int Decimals(IEnumerable<decimal> amounts) => amounts.Select(Decimals).DefaultIfEmpty(2).Max();

    /// <summary>«12,345.60» with <paramref name="decimals"/> decimals.</summary>
    public static string Amount(decimal amount, int decimals = 2) =>
        decimal.Round(amount, decimals, MidpointRounding.AwayFromZero)
            .ToString("#,##0." + new string('0', decimals), Numbers);

    /// <summary>A quantity is not money: «1», «0.5», «1,250».</summary>
    public static string Quantity(decimal quantity) => quantity.ToString("#,##0.####", Numbers);

    /// <summary>«1 mes», «3 meses».</summary>
    public static string Count(long count, string singular, string plural) =>
        $"{count.ToString("#,##0", Numbers)} {(count == 1 ? singular : plural)}";

    public static string Days(long count) => Count(count, "día", "días");

    public static string Months(long count) => Count(count, "mes", "meses");

    /// <summary>The Spanish noun of a billing unit, agreeing with the quantity; another code prints as stored.</summary>
    public static string Unit(string? code, decimal quantity = 1)
    {
        var one = quantity == 1;
        return code?.Trim().ToLowerInvariant() switch
        {
            "operation" or "operación" => one ? "operación" : "operaciones",
            "aircraft" or "aeronave" => one ? "aeronave" : "aeronaves",
            "passenger" or "pasajero" => one ? "pasajero" : "pasajeros",
            "ton" or "tonelada" => one ? "tonelada" : "toneladas",
            "hour" or "hora" => one ? "hora" : "horas",
            "minute" or "minuto" => one ? "minuto" : "minutos",
            "unit" or "unidad" => one ? "unidad" : "unidades",
            "service" or "servicio" => one ? "servicio" : "servicios",
            "day" or "día" => one ? "día" : "días",
            null or "" => "—",
            _ => code.Trim(),
        };
    }

    /// <summary>The method of a payment in Spanish.</summary>
    public static string PaymentMethod(string? method) => method?.Trim() switch
    {
        "Transfer" => "Transferencia bancaria",
        "Check" => "Cheque",
        "Cash" => "Efectivo",
        "Card" => "Tarjeta",
        "Other" => "Otro",
        null or "" => "No registrado",
        var other => other,
    };
}
