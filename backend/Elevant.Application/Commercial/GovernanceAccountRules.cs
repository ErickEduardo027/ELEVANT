using Elevant.Application.Abstractions.Commercial;

namespace Elevant.Application.Commercial;

/// <summary>
/// Stable Problem Details codes of the portal accounts the superadministrator opens, links and
/// resets (phase 1, block E). The screens explain the code, never the title.
/// </summary>
public static class GovernanceAccountIssues
{
    /// <summary>The email already has a portal account that can be linked to the request (1-N13).</summary>
    public const string EmailHasAccount = "email_has_account";

    /// <summary>The email belongs to a person or an account that is not a portal account.</summary>
    public const string EmailInUse = "email_in_use";

    /// <summary>The email is the portal account of another airline.</summary>
    public const string EmailInUseOtherAirline = "email_in_use_other_airline";

    /// <summary>The email is an internal AVIAM account.</summary>
    public const string EmailInUseInternal = "email_in_use_internal";

    /// <summary>The existing account is disabled; it is reactivated from Clientes before linking it.</summary>
    public const string AccountDisabled = "account_disabled";

    /// <summary>No account uses the email given to link.</summary>
    public const string AccountNotFound = "account_not_found";

    /// <summary>The request is no longer waiting for its portal account (provisioned, or its contract discarded).</summary>
    public const string RequestUnavailable = "request_unavailable";

    /// <summary>Default code of invalid provisioning data.</summary>
    public const string InvalidProvisioning = "invalid_provisioning";

    /// <summary>The portal origin is not configured, so no activation link can be built.</summary>
    public const string InvitationsUnavailable = "invitations_unavailable";

    /// <summary>The account already activated its invitation.</summary>
    public const string InvitationAlreadyAccepted = "invitation_already_accepted";

    /// <summary>The temporary password does not meet the password policy.</summary>
    public const string PasswordPolicy = "password_policy";

    /// <summary>Default code of invalid portal user data in Clientes.</summary>
    public const string InvalidClientUser = "invalid_client_user";

    /// <summary>The airline already operates with AVIAM: its legal name, codes and verification are fixed (1-N20).</summary>
    public const string AirlineIdentityLocked = "airline_identity_locked";
}

/// <summary>What the database says about an account that already uses an email.</summary>
/// <param name="IsActive">The account is not disabled or blocked.</param>
/// <param name="IsInternal">It has an internal AVIAM role or membership.</param>
/// <param name="IsPortalAccount">It has the airline portal role.</param>
/// <param name="BelongsToOtherAirline">It is an active member of another airline's organization.</param>
public sealed record ExistingAccountFacts(bool IsActive, bool IsInternal, bool IsPortalAccount, bool BelongsToOtherAirline);

/// <summary>
/// 1-N13: an approved request is completed with a new portal account or with an existing one. Only a
/// portal account of the same airline, or one without an airline, can be linked, explicitly and
/// without touching its credentials; every other case says why it cannot.
/// </summary>
public static class ProvisioningAccountRules
{
    /// <summary>Why the existing account cannot be linked to the airline; null when it can.</summary>
    public static string? LinkIssue(ExistingAccountFacts facts)
    {
        ArgumentNullException.ThrowIfNull(facts);
        return facts.IsInternal ? GovernanceAccountIssues.EmailInUseInternal
            : facts.BelongsToOtherAirline ? GovernanceAccountIssues.EmailInUseOtherAirline
            : !facts.IsPortalAccount ? GovernanceAccountIssues.EmailInUse
            : !facts.IsActive ? GovernanceAccountIssues.AccountDisabled
            : null;
    }

    /// <summary>
    /// A new account cannot take an email that already has one: the code says whether the existing
    /// account can be linked instead (<see cref="GovernanceAccountIssues.EmailHasAccount"/>).
    /// </summary>
    public static string ProvisionIssue(ExistingAccountFacts facts) =>
        LinkIssue(facts) ?? GovernanceAccountIssues.EmailHasAccount;
}

/// <summary>
/// 1-N20: once a profile is the operating airline (it has its <c>ref.airlines</c> row or an approved
/// request), its legal name, IATA and ICAO are in contracts, invoices and flights, so Superadmin
/// cannot change them nor remove the verification. The display name, the logo, the publication and
/// the sources stay editable.
/// </summary>
public static class ManagedAirlineIdentityRules
{
    /// <summary>The save changes the legal name, a code or removes the verification of the stored profile.</summary>
    public static bool ChangesIdentity(ManagedAirlineIdentity stored, ManagedAirlineInput input)
    {
        ArgumentNullException.ThrowIfNull(stored);
        ArgumentNullException.ThrowIfNull(input);
        return !Same(stored.LegalName, input.LegalName) || !Same(stored.IataCode, input.IataCode) ||
            !Same(stored.IcaoCode, input.IcaoCode) || stored.IsVerified && !input.IsVerified;
    }

    /// <summary>
    /// The verification is stamped again (date and author) only when it starts or its evidence
    /// changes: saving a verified profile without changes keeps when and who verified it.
    /// </summary>
    public static bool RestampsVerification(ManagedAirlineIdentity stored, ManagedAirlineInput input)
    {
        ArgumentNullException.ThrowIfNull(stored);
        ArgumentNullException.ThrowIfNull(input);
        return input.IsVerified && (!stored.IsVerified || !Same(stored.LegalName, input.LegalName) ||
            !Same(stored.IataCode, input.IataCode) || !Same(stored.IcaoCode, input.IcaoCode) ||
            !Same(stored.VerificationSourceUrl, input.VerificationSourceUrl));
    }

    private static bool Same(string? stored, string? input) =>
        string.Equals(stored, string.IsNullOrWhiteSpace(input) ? null : input.Trim(), StringComparison.Ordinal);
}

/// <summary>The identity of a stored airline profile and whether it is verified.</summary>
public sealed record ManagedAirlineIdentity(string? LegalName, string? IataCode, string? IcaoCode,
    string? VerificationSourceUrl, bool IsVerified);
