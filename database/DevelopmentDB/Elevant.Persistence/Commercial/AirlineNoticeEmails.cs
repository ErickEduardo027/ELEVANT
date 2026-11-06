using Elevant.Application.Abstractions.Messaging;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

/// <summary>
/// Emails to an airline about its contracts and permits (2-N09, 2-N12, 2-N13): one per active portal
/// account of the airline (an active AirlineClient membership of its organization) that has an email,
/// whatever its role, so nobody depends on opening the portal to learn about a deadline. They are queued
/// in the caller's unit of work: a command replay or a second sweep never repeats them, and the outbox
/// sends them (no screen says they went out).
/// </summary>
internal static class AirlineNoticeEmails
{
    /// <summary>Queues <paramref name="build"/>(recipient, airline name) for every recipient; returns how many.</summary>
    public static async Task<int> QueueAsync(ElevantDbContext context, long airlineId, EmailPurpose purpose,
        Func<string, string, EmailMessage> build, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var airline = await context.Airlines.AsNoTracking().Where(item => item.Id == airlineId)
            .Select(item => new { item.Name, item.OrganizationId }).SingleAsync(cancellationToken);
        var accounts = context.OrganizationMemberships.AsNoTracking()
            .Where(item => item.OrganizationId == airline.OrganizationId && item.Kind == MembershipKind.AirlineClient &&
                item.Status == MembershipStatus.Active)
            .Select(item => item.AccountId);
        var emails = await context.Users.AsNoTracking()
            .Where(user => accounts.Contains(user.Id) && user.Status == AccountLifecycleStatus.Active && user.Email != null)
            .Select(user => user.Email!).ToArrayAsync(cancellationToken);
        var recipients = emails.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        foreach (var email in recipients)
            EfEmailOutboxStore.Add(context, build(email, airline.Name), purpose, now);
        return recipients.Length;
    }
}
