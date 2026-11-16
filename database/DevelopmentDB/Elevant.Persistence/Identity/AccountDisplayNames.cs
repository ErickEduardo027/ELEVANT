using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

/// <summary>
/// The name of the person behind an internal account, as OCC's screens and the forms print who acted (who reopened a
/// review, corrected a Service Order or managed an incident); the account's user name when it has no person, and
/// «OCC» when the account is unknown.
/// </summary>
internal static class AccountDisplayNames
{
    public const string Unknown = "OCC";

    public static async Task<string> OfAsync(ElevantDbContext context, long? accountId, CancellationToken cancellationToken)
    {
        if (accountId is not long id) return Unknown;
        return (await OfAsync(context, [id], cancellationToken)).GetValueOrDefault(id, Unknown);
    }

    public static async Task<IReadOnlyDictionary<long, string>> OfAsync(ElevantDbContext context,
        IReadOnlyCollection<long> accountIds, CancellationToken cancellationToken)
    {
        if (accountIds.Count == 0) return new Dictionary<long, string>();
        var ids = accountIds.Distinct().ToArray();
        var rows = await (from account in context.Users.AsNoTracking()
                          join person in context.Persons.AsNoTracking() on account.PersonId equals person.Id into people
                          from person in people.DefaultIfEmpty()
                          where ids.Contains(account.Id)
                          select new
                          {
                              account.Id, account.UserName,
                              FirstName = person == null ? null : person.FirstName,
                              LastName = person == null ? null : person.LastName,
                          }).ToArrayAsync(cancellationToken);
        return rows.ToDictionary(row => row.Id, row =>
        {
            var name = $"{row.FirstName} {row.LastName}".Trim();
            return name.Length > 0 ? name : string.IsNullOrWhiteSpace(row.UserName) ? Unknown : row.UserName;
        });
    }
}
