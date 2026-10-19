using Elevant.Domain.Enumerations;
namespace Elevant.Domain.Entities.Commercial;
public sealed class EmployeeExpenseClaim : AuditableEntity
{
    public long EmployeeId { get; set; }
    public Department Department { get; set; }
    public string Description { get; set; } = string.Empty;
    public DateOnly ExpenseDate { get; set; }
    public EmployeeExpenseStatus Status { get; set; }
    public long ScopeStationId { get; set; }
    public long? StationId { get; set; }
    public long? AirlineId { get; set; }
    public long? TurnaroundId { get; set; }
    public long? ServiceDefinitionId { get; set; }
    public string CurrencyCode { get; set; } = string.Empty;
    public decimal FxToDop { get; set; }
    public string FxSource { get; set; } = string.Empty;
    public DateOnly FxDate { get; set; }
    public decimal Total { get; set; }
    public decimal TotalDop { get; set; }
    public long CreatedByAccountId { get; set; }
}
