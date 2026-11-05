using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace Elevant.Contracts.Finance;

/// <summary>Ground time Finance allows for an aircraft category (Narrowbody or Widebody), ADR-0034.</summary>
public sealed record GroundTimeAllowanceResponse(string Category, int AllowedMinutes, DateTimeOffset UpdatedAt,
    string Version);

public sealed record FinanceHolidayResponse(Guid Id, DateOnly Date, string Name);

/// <summary>What the automatic surcharges read: ground time allowances and the holiday calendar.</summary>
public sealed record FinanceCloseRulesResponse(
    IReadOnlyList<GroundTimeAllowanceResponse> Allowances, IReadOnlyList<FinanceHolidayResponse> Holidays);

/// <summary>Sets the allowance of a category; version is null only to create it.</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SetGroundTimeAllowanceRequest
{
    [Range(15, 720)]
    public int AllowedMinutes { get; init; }

    [MaxLength(64)]
    public string? Version { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record AddFinanceHolidayRequest
{
    public DateOnly Date { get; init; }

    [MaxLength(120)]
    public string? Name { get; init; }
}
