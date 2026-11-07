using System.Data;
using System.Text.RegularExpressions;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Common;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Domain.Governance;
using Elevant.Domain.Validation;
using Elevant.Infrastructure.Identity;
using Elevant.Persistence.Commercial;
using Elevant.Persistence.Operations;
using Elevant.Persistence.Realtime;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

/// <summary>Human Resources employee records (ADR-0017): every internal account belongs to one employee.</summary>
internal sealed partial class EfDepartmentGovernanceStore : IEmployeeGovernanceStore
{
    private const string EmployeesRead = "human_resources.employees.read";
    private const string EmployeesCreate = "human_resources.employees.create";
    private const string EmployeesUpdate = "human_resources.employees.update";
    private const string EmployeesTerminate = "human_resources.employees.delete";
    private static readonly Regex EmployeeNumberPattern = new("^[A-Z0-9-]{2,32}$", RegexOptions.CultureInvariant);

    private sealed record EmployeeFacts(Employee Employee, Person Person, JobPosition Position);

    public async Task<EmployeePageData?> ListEmployeesAsync(Guid actorId, string? department, string? status,
        Guid? positionId, bool? hasAccount, string? search, int page, int limit,
        CancellationToken cancellationToken = default)
    {
        if (page < 1 || limit is < 1 or > 100) return null;
        Department? parsedDepartment = null;
        if (department is not null)
        {
            if (!TryParse(department, out var value)) return null;
            parsedDepartment = value;
        }
        EmployeeStatus? parsedStatus = null;
        if (status is not null)
        {
            if (!Enum.TryParse<EmployeeStatus>(status, false, out var value)) return null;
            parsedStatus = value;
        }
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.Can(EmployeesRead)) return null;
        var term = search?.Trim();
        var rows = await (
            from employee in context.Employees.AsNoTracking()
            join person in context.Persons.AsNoTracking() on employee.PersonId equals person.Id
            join position in context.JobPositions.AsNoTracking() on employee.JobPositionId equals position.Id
            where (parsedDepartment == null || employee.Department == parsedDepartment) &&
                  (parsedStatus == null || employee.Status == parsedStatus) &&
                  (positionId == null || position.PublicId == positionId) &&
                  (string.IsNullOrEmpty(term) || (person.FirstName + " " + person.LastName).Contains(term) ||
                      employee.EmployeeNumber.Contains(term) || (person.PrimaryEmail ?? "").Contains(term))
            orderby employee.Status, person.LastName, person.FirstName
            select new EmployeeFacts(employee, person, position)).ToArrayAsync(cancellationToken);
        var summaries = await SummariesAsync(rows, cancellationToken);
        var filtered = summaries.Where(item => hasAccount is null || (item.Account is not null) == hasAccount).ToArray();
        return new EmployeePageData(page, limit, filtered.Length, page * limit < filtered.Length,
            filtered.Skip((page - 1) * limit).Take(limit).ToArray());
    }

    private async Task<IReadOnlyList<EmployeeSummaryData>> SummariesAsync(IReadOnlyList<EmployeeFacts> rows,
        CancellationToken cancellationToken)
    {
        var employeeIds = rows.Select(row => row.Employee.Id).ToArray();
        var personIds = rows.Select(row => row.Person.Id).ToArray();
        var stations = (await (from link in context.EmployeeStations.AsNoTracking()
                               join station in context.Stations.AsNoTracking() on link.StationId equals station.Id
                               where employeeIds.Contains(link.EmployeeId) && link.ValidTo == null
                               orderby station.Code
                               select new { link.EmployeeId, station.PublicId, station.Code }).ToArrayAsync(cancellationToken))
            .ToLookup(item => item.EmployeeId, item => new GovernanceStationData(item.PublicId, item.Code));
        var accounts = await context.Users.AsNoTracking().Where(user => personIds.Contains(user.PersonId))
            .Select(user => new { user.PersonId, user.PublicId, user.Status })
            .ToDictionaryAsync(user => user.PersonId, cancellationToken);
        var requisitionIds = rows.Where(row => row.Employee.RequisitionId != null)
            .Select(row => row.Employee.RequisitionId!.Value).ToArray();
        var requisitions = await context.PersonnelRequisitions.AsNoTracking()
            .Where(item => requisitionIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, item => item.PublicId, cancellationToken);
        return rows.Select(row => new EmployeeSummaryData(
            row.Employee.PublicId, row.Employee.EmployeeNumber, row.Person.FirstName, row.Person.LastName,
            KeyOf(row.Employee.Department),
            new JobPositionRefData(row.Position.PublicId, row.Position.Name, row.Position.IsRampPosition),
            row.Employee.Status.ToString(), row.Employee.HireDate, stations[row.Employee.Id].ToArray(),
            accounts.TryGetValue(row.Person.Id, out var account)
                ? new EmployeeAccountRefData(account.PublicId, account.Status.ToString()) : null,
            row.Person.PrimaryEmail,
            row.Employee.RequisitionId is { } requisition ? requisitions[requisition] : null,
            GovernanceSupport.Version(row.Employee.RowVersion))).ToArray();
    }

    public async Task<EmployeeDetailData?> GetEmployeeAsync(Guid actorId, Guid employeeId,
        CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.Can(EmployeesRead)) return null;
        var facts = await FactsAsync(employeeId, tracked: false, cancellationToken);
        if (facts is null) return null;
        var summary = (await SummariesAsync([facts], cancellationToken))[0];
        var assignments = await (from assignment in context.EmployeeAssignments.AsNoTracking()
                                 join position in context.JobPositions.AsNoTracking() on assignment.JobPositionId equals position.Id
                                 join user in context.Users.AsNoTracking() on assignment.ChangedByAccountId equals user.Id
                                 join person in context.Persons.AsNoTracking() on user.PersonId equals person.Id
                                 where assignment.EmployeeId == facts.Employee.Id
                                 orderby assignment.ValidFrom descending
                                 select new { assignment.Department, position.Name, assignment.ValidFrom, assignment.ValidTo,
                                     ChangedBy = person.FirstName + " " + person.LastName, assignment.Reason })
            .ToArrayAsync(cancellationToken);
        var today = BusinessCalendar.Today(timeProvider.GetUtcNow());
        var agentId = await context.RampAgents.AsNoTracking().Where(agent => agent.PersonId == facts.Person.Id)
            .Select(agent => (long?)agent.Id).SingleOrDefaultAsync(cancellationToken);
        var futureShifts = agentId is null ? 0 : await context.ShiftAssignments.CountAsync(shift =>
            shift.RampAgentId == agentId && shift.WorkDate >= today, cancellationToken);
        var pending = await context.UserAccessRequests.CountAsync(request =>
            request.EmployeeId == facts.Employee.Id && request.Status == UserAccessRequestStatus.Pending, cancellationToken);
        return new EmployeeDetailData(summary, facts.Person.IdentificationType, facts.Person.IdentificationNumber,
            IdentificationTypes.IsSynthetic(facts.Person.IdentificationType), facts.Person.PhoneNumber,
            facts.Employee.TerminatedOn, facts.Employee.TerminationReason, futureShifts, pending,
            assignments.Select(item => new EmployeeAssignmentData(KeyOf(item.Department), item.Name, item.ValidFrom,
                item.ValidTo, item.ChangedBy, item.Reason)).ToArray());
    }

    public async Task<EmployeeOptionsData?> GetEmployeeOptionsAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.Can(EmployeesRead)) return null;
        var own = actor.StationIds.ToArray();
        var stations = await context.Stations.AsNoTracking()
            .Where(station => station.IsActive && (actor.IsSuper || own.Contains(station.PublicId)))
            .OrderBy(station => station.Code)
            .Select(station => new GovernanceStationData(station.PublicId, station.Code)).ToArrayAsync(cancellationToken);
        var positions = await PositionsAsync(null, activeOnly: true, cancellationToken);
        var open = await RequisitionsAsync(null, [RequisitionStatus.Open, RequisitionStatus.InProgress], cancellationToken);
        return new EmployeeOptionsData(IdentificationTypes.All, positions, stations, open);
    }

    private async Task<EmployeeFacts?> FactsAsync(Guid employeeId, bool tracked, CancellationToken cancellationToken)
    {
        // AsNoTracking on any source makes the whole query untracked, so every source follows the flag.
        var employees = tracked ? context.Employees : context.Employees.AsNoTracking();
        var persons = tracked ? context.Persons : context.Persons.AsNoTracking();
        var positions = tracked ? context.JobPositions : context.JobPositions.AsNoTracking();
        return await (from employee in employees
                      join person in persons on employee.PersonId equals person.Id
                      join position in positions on employee.JobPositionId equals position.Id
                      where employee.PublicId == employeeId
                      select new EmployeeFacts(employee, person, position)).SingleOrDefaultAsync(cancellationToken);
    }

    private sealed record EmployeeShape(string FirstName, string LastName, string IdentificationType, string IdentificationNumber,
        string EmployeeNumber, Department Department, JobPosition Position, long[] Stations, DateOnly HireDate,
        string? Phone, string? Email, long? RequisitionId);

    /// <summary>Validates and canonicalises an employee form; the failure code tells the client which rule failed.</summary>
    private async Task<(EmployeeShape? Shape, GovernanceResult? Failure)> ShapeAsync(Actor actor, SaveEmployeeInput? input,
        CancellationToken cancellationToken)
    {
        if (input is null || !GovernanceSupport.ValidName(input.FirstName) || !GovernanceSupport.ValidName(input.LastName) ||
            !TryParse(input.Department, out var department) || input.StationIds is not { Count: > 0 and <= 20 })
            return (null, GovernanceResult.Failed(GovernanceFailure.Invalid));
        if (!IdentificationTypes.IsValid(input.IdentificationType) ||
            IdentificationTypes.Normalize(input.IdentificationType, input.IdentificationNumber) is not { } identification)
            return (null, GovernanceResult.Failed(GovernanceFailure.Invalid, "identification_invalid"));
        var number = input.EmployeeNumber?.Trim().ToUpperInvariant();
        if (number is null || !EmployeeNumberPattern.IsMatch(number))
            return (null, GovernanceResult.Failed(GovernanceFailure.Invalid, "employee_number_invalid"));
        var phone = string.IsNullOrWhiteSpace(input.PhoneNumber) ? null : PhoneNumbers.Normalize(input.PhoneNumber);
        if (phone is null && !string.IsNullOrWhiteSpace(input.PhoneNumber))
            return (null, GovernanceResult.Failed(GovernanceFailure.Invalid, "phone_invalid"));
        var email = string.IsNullOrWhiteSpace(input.CorporateEmail) ? null : input.CorporateEmail.Trim();
        if (email is not null && !GovernanceSupport.ValidEmail(email))
            return (null, GovernanceResult.Failed(GovernanceFailure.Invalid, "email_invalid"));
        var today = BusinessCalendar.Today(timeProvider.GetUtcNow());
        if (input.HireDate == default || input.HireDate > today.AddDays(30) || input.HireDate < new DateOnly(1950, 1, 1))
            return (null, GovernanceResult.Failed(GovernanceFailure.Invalid, "hire_date_invalid"));
        var position = await context.JobPositions.AsNoTracking().SingleOrDefaultAsync(item =>
            item.PublicId == input.PositionId && item.Department == department && item.IsActive, cancellationToken);
        if (position is null) return (null, GovernanceResult.Failed(GovernanceFailure.Invalid, "position_invalid"));
        var stations = await ResolveStationsAsync(actor, input.StationIds, cancellationToken);
        if (stations is null) return (null, GovernanceResult.Failed(GovernanceFailure.Invalid, "stations_invalid"));
        long? requisitionId = null;
        if (input.RequisitionId is { } requisitionPublicId)
        {
            requisitionId = await context.PersonnelRequisitions.AsNoTracking().Where(item =>
                    item.PublicId == requisitionPublicId && item.Department == department &&
                    item.JobPositionId == position.Id &&
                    (item.Status == RequisitionStatus.Open || item.Status == RequisitionStatus.InProgress))
                .Select(item => (long?)item.Id).SingleOrDefaultAsync(cancellationToken);
            if (requisitionId is null) return (null, GovernanceResult.Failed(GovernanceFailure.Invalid, "requisition_invalid"));
        }
        return (new EmployeeShape(input.FirstName!.Trim(), input.LastName!.Trim(), input.IdentificationType,
            identification, number, department, position, stations, input.HireDate, phone, email, requisitionId), null);
    }

    /// <summary>Uniqueness of identification, employee number and corporate email, excluding the employee's own person.</summary>
    private async Task<GovernanceResult?> UniquenessAsync(EmployeeShape shape, long? personId,
        CancellationToken cancellationToken)
    {
        if (await context.Persons.AnyAsync(person => person.Id != personId &&
                person.IdentificationType == shape.IdentificationType &&
                person.IdentificationNumber == shape.IdentificationNumber, cancellationToken))
            return GovernanceResult.Failed(GovernanceFailure.Conflict, "identification_in_use");
        if (await context.Employees.AnyAsync(employee => employee.PersonId != personId &&
                employee.EmployeeNumber == shape.EmployeeNumber, cancellationToken) ||
            await context.RampAgents.AnyAsync(agent => agent.PersonId != personId &&
                agent.EmployeeNumber == shape.EmployeeNumber, cancellationToken))
            return GovernanceResult.Failed(GovernanceFailure.Conflict, "employee_number_in_use");
        if (shape.Email is { } email)
        {
            var normalized = email.ToUpperInvariant();
            if (await context.Persons.AnyAsync(person => person.Id != personId && person.PrimaryEmail == email,
                    cancellationToken) ||
                await context.Users.AnyAsync(user => user.PersonId != personId && user.NormalizedEmail == normalized,
                    cancellationToken))
                return GovernanceResult.Failed(GovernanceFailure.Conflict, "email_in_use");
        }
        return null;
    }

    public async Task<GovernanceResult> CreateEmployeeAsync(Guid actorId, SaveEmployeeInput input,
        CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.Can(EmployeesCreate)) return GovernanceResult.Failed(GovernanceFailure.Forbidden);
        var (shape, failure) = await ShapeAsync(actor, input, cancellationToken);
        if (failure is not null) return failure;

        return await InSerializableTransactionAsync(async () =>
        {
            if (await UniquenessAsync(shape!, null, cancellationToken) is { } conflict) return conflict;
            var now = timeProvider.GetUtcNow();
            var employee = await AddEmployeeAsync(actor, shape!, now, cancellationToken);
            GovernanceSupport.AddAudit(context, actor.Id, "hr.employee.created", "hr.employees", employee.PublicId, null,
                shape!.Stations.Select(station => (long?)station).ToArray(), now, shape.Department,
                new AuditFieldChangeData("employee.number", null, employee.EmployeeNumber),
                new AuditFieldChangeData("employee.position", null, shape.Position.Name));
            await NotifyEmployeesAsync(shape.Department, employee.PublicId, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return GovernanceResult.Success(employee.PublicId);
        }, cancellationToken);
    }

    /// <summary>Adds the person and employee rows with their stations, ramp profile and requisition progress.</summary>
    private async Task<Employee> AddEmployeeAsync(Actor actor, EmployeeShape shape, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
            var person = new Person
            {
                PublicId = Guid.CreateVersion7(), FirstName = shape!.FirstName, LastName = shape.LastName,
                PrimaryEmail = shape.Email, PhoneNumber = shape.Phone,
                IdentificationType = shape.IdentificationType, IdentificationNumber = shape.IdentificationNumber,
            };
            context.Persons.Add(person);
            await context.SaveChangesAsync(cancellationToken);
            var employee = new Employee
            {
                PublicId = Guid.CreateVersion7(), CreatedAt = now, UpdatedAt = now, PersonId = person.Id,
                EmployeeNumber = shape.EmployeeNumber, Department = shape.Department, JobPositionId = shape.Position.Id,
                HireDate = shape.HireDate, Status = EmployeeStatus.Active, RequisitionId = shape.RequisitionId,
                CreatedByAccountId = actor.Id,
            };
            context.Employees.Add(employee);
            await context.SaveChangesAsync(cancellationToken);
            OpenAssignment(employee, actor.Id, now, "Alta del empleado");
            await SetEmployeeStationsAsync(employee.Id, shape.Stations, [], now, cancellationToken);
            if (shape.Position.IsRampPosition)
                await EnsureRampAgentAsync(person.Id, employee, shape.Position, shape.Stations, now, cancellationToken);
            if (shape.RequisitionId is { } requisitionId)
            {
                var requisition = await context.PersonnelRequisitions.SingleAsync(item => item.Id == requisitionId,
                    cancellationToken);
                if (requisition.Status == RequisitionStatus.Open)
                {
                    requisition.Status = RequisitionStatus.InProgress;
                    requisition.AttendedByAccountId ??= actor.Id;
                    requisition.UpdatedAt = now;
                }
            }
            return employee;
    }

    public async Task<GovernanceResult> UpdateEmployeeAsync(Guid actorId, Guid employeeId, SaveEmployeeInput input,
        CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.Can(EmployeesUpdate)) return GovernanceResult.Failed(GovernanceFailure.Forbidden);
        if (string.IsNullOrWhiteSpace(input?.ExpectedVersion)) return GovernanceResult.Failed(GovernanceFailure.Invalid);
        var (shape, failure) = await ShapeAsync(actor, input, cancellationToken);
        if (failure is not null) return failure;

        return await InSerializableTransactionAsync(async () =>
        {
            var facts = await FactsAsync(employeeId, tracked: true, cancellationToken);
            if (facts is null) return GovernanceResult.Failed(GovernanceFailure.NotFound);
            var (employee, person) = (facts.Employee, facts.Person);
            if (GovernanceSupport.Version(employee.RowVersion) != input!.ExpectedVersion)
                return GovernanceResult.Failed(GovernanceFailure.Conflict);
            if (employee.Status != EmployeeStatus.Active)
                return GovernanceResult.Failed(GovernanceFailure.Conflict, "employee_terminated");
            // Changing department is a transfer, which revokes access; it has its own command.
            if (shape!.Department != employee.Department)
                return GovernanceResult.Failed(GovernanceFailure.Invalid, "use_transfer");
            if (await UniquenessAsync(shape, person.Id, cancellationToken) is { } conflict) return conflict;
            var account = await context.Users.SingleOrDefaultAsync(user => user.PersonId == person.Id, cancellationToken);
            if (account is not null && !string.Equals(person.PrimaryEmail, shape.Email, StringComparison.OrdinalIgnoreCase))
                return GovernanceResult.Failed(GovernanceFailure.Conflict, "employee_email_locked");
            if (account?.Status == AccountLifecycleStatus.Active &&
                shape.Position.IsRampPosition != facts.Position.IsRampPosition)
                return GovernanceResult.Failed(GovernanceFailure.Conflict, "ramp_position_requires_inactive_account");

            var now = timeProvider.GetUtcNow();
            // Moving to an office position ends the ramp duty first (2-N06): nothing changes if it cannot.
            if (!shape.Position.IsRampPosition &&
                await EndRampDutyAsync(person.Id, actor.Id, RampAgentRelease.Cause.OfficePosition, now,
                    cancellationToken) is { } blocked)
                return blocked;
            var changes = new List<AuditFieldChangeData>();
            if (person.FirstName != shape.FirstName || person.LastName != shape.LastName)
                changes.Add(new AuditFieldChangeData("employee.name", $"{person.FirstName} {person.LastName}",
                    $"{shape.FirstName} {shape.LastName}"));
            if (person.IdentificationType != shape.IdentificationType || person.IdentificationNumber != shape.IdentificationNumber)
                changes.Add(new AuditFieldChangeData("employee.identification", person.IdentificationType, shape.IdentificationType));
            if (employee.EmployeeNumber != shape.EmployeeNumber)
                changes.Add(new AuditFieldChangeData("employee.number", employee.EmployeeNumber, shape.EmployeeNumber));
            person.FirstName = shape.FirstName;
            person.LastName = shape.LastName;
            person.IdentificationType = shape.IdentificationType;
            person.IdentificationNumber = shape.IdentificationNumber;
            person.PhoneNumber = shape.Phone;
            person.PrimaryEmail = shape.Email;
            employee.EmployeeNumber = shape.EmployeeNumber;
            employee.HireDate = shape.HireDate;
            employee.UpdatedAt = now;
            if (employee.JobPositionId != shape.Position.Id)
            {
                changes.Add(new AuditFieldChangeData("employee.position", facts.Position.Name, shape.Position.Name));
                await CloseAssignmentAsync(employee.Id, now, cancellationToken);
                employee.JobPositionId = shape.Position.Id;
                OpenAssignment(employee, actor.Id, now, "Cambio de puesto");
            }
            var current = await context.EmployeeStations
                .Where(item => item.EmployeeId == employee.Id && item.ValidTo == null).ToArrayAsync(cancellationToken);
            await SetEmployeeStationsAsync(employee.Id, shape.Stations, current, now, cancellationToken);
            // Account scopes can never exceed the employee's stations.
            if (account is not null)
            {
                var accountStations = await context.AccountStationScopes
                    .Where(scope => scope.AccountId == account.Id && scope.RevokedAt == null)
                    .Select(scope => scope.StationId).ToArrayAsync(cancellationToken);
                var kept = accountStations.Intersect(shape.Stations).ToArray();
                if (kept.Length != accountStations.Length)
                    await SyncStationsAsync(account.Id, kept, person.Id, now, cancellationToken);
            }
            if (shape.Position.IsRampPosition)
                await EnsureRampAgentAsync(person.Id, employee, shape.Position,
                    account?.Status == AccountLifecycleStatus.Active ? null : shape.Stations, now, cancellationToken);
            GovernanceSupport.AddAudit(context, actor.Id, "hr.employee.updated", "hr.employees", employee.PublicId, null,
                shape.Stations.Select(station => (long?)station).ToArray(), now, employee.Department, [.. changes]);
            await NotifyEmployeesAsync(employee.Department, employee.PublicId, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return GovernanceResult.Success(employee.PublicId);
        }, cancellationToken);
    }

    public async Task<GovernanceResult> TransferEmployeeAsync(Guid actorId, Guid employeeId, TransferEmployeeInput input,
        Guid? idempotencyKey, CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.Can(EmployeesTerminate)) return GovernanceResult.Failed(GovernanceFailure.Forbidden);
        // Expand phase: the key is optional; the expected version always comes in the body.
        if (idempotencyKey == Guid.Empty) return GovernanceResult.Failed(GovernanceFailure.Invalid, "idempotency_key_required");
        if (string.IsNullOrWhiteSpace(input?.ExpectedVersion))
            return GovernanceResult.Failed(GovernanceFailure.Invalid, "expected_version_required");
        if (!TryParse(input.Department, out var department) || input.StationIds is not { Count: > 0 and <= 20 })
            return GovernanceResult.Failed(GovernanceFailure.Invalid, "invalid_transfer");
        if (input.Reason?.Trim().Length is not (>= 3 and <= 500))
            return GovernanceResult.Failed(GovernanceFailure.Invalid, "reason_required");
        var position = await context.JobPositions.AsNoTracking().SingleOrDefaultAsync(item =>
            item.PublicId == input.PositionId && item.Department == department && item.IsActive, cancellationToken);
        if (position is null) return GovernanceResult.Failed(GovernanceFailure.Invalid, "position_invalid");
        var stations = await ResolveStationsAsync(actor, input.StationIds, cancellationToken);
        if (stations is null) return GovernanceResult.Failed(GovernanceFailure.Invalid, "stations_invalid");
        var reason = input.Reason!.Trim();
        var hash = CommercialCommandReceipts.Hash(new
        {
            employeeId, department = input.Department, input.PositionId, stations = input.StationIds.Order().ToArray(), reason,
            input.ExpectedVersion,
        });

        return await InKeyedTransactionAsync(actor, idempotencyKey, "hr.employee.transfer", hash, async () =>
        {
            var facts = await FactsAsync(employeeId, tracked: true, cancellationToken);
            if (facts is null) return GovernanceResult.Failed(GovernanceFailure.NotFound, "not_found");
            var employee = facts.Employee;
            if (GovernanceSupport.Version(employee.RowVersion) != input.ExpectedVersion)
                return GovernanceResult.Failed(GovernanceFailure.Conflict, "version_conflict");
            if (employee.Status != EmployeeStatus.Active)
                return GovernanceResult.Failed(GovernanceFailure.Conflict, "employee_terminated");
            if (employee.Department == department)
                return GovernanceResult.Failed(GovernanceFailure.Invalid, "same_department");
            if (await IsProtectedPersonAsync(actor, facts.Person.Id, cancellationToken))
                return GovernanceResult.Failed(GovernanceFailure.Protected, "protected_person");

            var now = timeProvider.GetUtcNow();
            // Leaving the ramp releases the agent's work first (2-N06); nothing changes if it cannot.
            if (!position.IsRampPosition &&
                await EndRampDutyAsync(facts.Person.Id, actor.Id, RampAgentRelease.Cause.Transfer, now,
                    cancellationToken) is { } blocked)
                return blocked;
            var previous = employee.Department;
            await CloseAssignmentAsync(employee.Id, now, cancellationToken);
            employee.Department = department;
            employee.JobPositionId = position.Id;
            employee.UpdatedAt = now;
            OpenAssignment(employee, actor.Id, now, reason);
            var current = await context.EmployeeStations
                .Where(item => item.EmployeeId == employee.Id && item.ValidTo == null).ToArrayAsync(cancellationToken);
            await SetEmployeeStationsAsync(employee.Id, stations, current, now, cancellationToken);
            // Access belongs to the old department: it ends until the new department requests it, and its roles go
            // with it, so the department it leaves can neither list nor reactivate the account (2-N07).
            var revoked = await SuspendAccessAsync(actor.Id, facts.Person.Id, employee.Id, "Traslado de departamento",
                now, cancellationToken, retireRoles: true);
            if (position.IsRampPosition)
                await EnsureRampAgentAsync(facts.Person.Id, employee, position, stations, now, cancellationToken);
            foreach (var affected in new[] { previous, department })
                GovernanceSupport.AddAudit(context, actor.Id, "hr.employee.transferred", "hr.employees", employee.PublicId,
                    reason, [], now, affected,
                    new AuditFieldChangeData("employee.department", KeyOf(previous), KeyOf(department)),
                    new AuditFieldChangeData("employee.position", facts.Position.Name, position.Name),
                    new AuditFieldChangeData("account.disabled", null, revoked ? "true" : "false"));
            await NotifyEmployeesAsync(previous, employee.PublicId, now, cancellationToken);
            await NotifyEmployeesAsync(department, employee.PublicId, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return GovernanceResult.Success(employee.PublicId);
        }, cancellationToken);
    }

    public async Task<GovernanceResult> TerminateEmployeeAsync(Guid actorId, Guid employeeId, TerminateEmployeeInput input,
        Guid? idempotencyKey, CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.Can(EmployeesTerminate)) return GovernanceResult.Failed(GovernanceFailure.Forbidden);
        // Expand phase: the key is optional; the expected version always comes in the body.
        if (idempotencyKey == Guid.Empty) return GovernanceResult.Failed(GovernanceFailure.Invalid, "idempotency_key_required");
        if (string.IsNullOrWhiteSpace(input?.ExpectedVersion))
            return GovernanceResult.Failed(GovernanceFailure.Invalid, "expected_version_required");
        // 2-N31: «today» is AVIAM's business day, never the UTC one (from 20:00 it is already tomorrow).
        if (input.TerminatedOn == default || input.TerminatedOn > BusinessCalendar.Today(timeProvider.GetUtcNow()))
            return GovernanceResult.Failed(GovernanceFailure.Invalid, "termination_date_invalid");
        if (input.Reason?.Trim().Length is not (>= 3 and <= 500))
            return GovernanceResult.Failed(GovernanceFailure.Invalid, "reason_required");
        var reason = input.Reason!.Trim();
        var hash = CommercialCommandReceipts.Hash(new { employeeId, input.TerminatedOn, reason, input.ExpectedVersion });

        return await InKeyedTransactionAsync(actor, idempotencyKey, "hr.employee.terminate", hash, async () =>
        {
            var facts = await FactsAsync(employeeId, tracked: true, cancellationToken);
            if (facts is null) return GovernanceResult.Failed(GovernanceFailure.NotFound, "not_found");
            var employee = facts.Employee;
            if (GovernanceSupport.Version(employee.RowVersion) != input.ExpectedVersion)
                return GovernanceResult.Failed(GovernanceFailure.Conflict, "version_conflict");
            if (employee.Status != EmployeeStatus.Active)
                return GovernanceResult.Failed(GovernanceFailure.Conflict, "employee_terminated");
            if (input.TerminatedOn < employee.HireDate)
                return GovernanceResult.Failed(GovernanceFailure.Invalid, "termination_before_hire");
            if (await IsProtectedPersonAsync(actor, facts.Person.Id, cancellationToken))
                return GovernanceResult.Failed(GovernanceFailure.Protected, "protected_person");

            var now = timeProvider.GetUtcNow();
            // The agent's work is released first (2-N06); nothing changes if an operation keeps them.
            if (await EndRampDutyAsync(facts.Person.Id, actor.Id, RampAgentRelease.Cause.Termination, now,
                    cancellationToken) is { } blocked)
                return blocked;
            employee.Status = EmployeeStatus.Terminated;
            employee.TerminatedOn = input.TerminatedOn;
            employee.TerminationReason = reason;
            employee.TerminatedByAccountId = actor.Id;
            employee.UpdatedAt = now;
            await CloseAssignmentAsync(employee.Id, now, cancellationToken);
            var current = await context.EmployeeStations
                .Where(item => item.EmployeeId == employee.Id && item.ValidTo == null).ToArrayAsync(cancellationToken);
            await SetEmployeeStationsAsync(employee.Id, [], current, now, cancellationToken);
            var revoked = await SuspendAccessAsync(actor.Id, facts.Person.Id, employee.Id, "Empleado dado de baja", now,
                cancellationToken);
            GovernanceSupport.AddAudit(context, actor.Id, "hr.employee.terminated", "hr.employees", employee.PublicId,
                reason, [], now, employee.Department,
                new AuditFieldChangeData("employee.status", nameof(EmployeeStatus.Active), nameof(EmployeeStatus.Terminated)),
                new AuditFieldChangeData("account.disabled", null, revoked ? "true" : "false"));
            await NotifyEmployeesAsync(employee.Department, employee.PublicId, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return GovernanceResult.Success(employee.PublicId);
        }, cancellationToken);
    }

    /// <summary>
    /// The receipt pattern of the phase 2 commands (<see cref="CommercialCommandReceipts"/>) for the employee
    /// commands that take an Idempotency-Key: one serializable transaction holds the receipt lookup, the work and
    /// the receipt, so a replay answers the first result and never repeats its release, audit or notices.
    /// </summary>
    private async Task<GovernanceResult> InKeyedTransactionAsync(Actor actor, Guid? key, string action, string hash,
        Func<Task<GovernanceResult>> work, CancellationToken cancellationToken)
    {
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable,
                    cancellationToken);
                if (key is { } receipt)
                {
                    var prior = await CommercialCommandReceipts.FindAsync(context, receipt, actor.Id, action, hash,
                        cancellationToken);
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Conflict)
                        return GovernanceResult.Failed(GovernanceFailure.Conflict, "idempotency_conflict");
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Replay)
                        return GovernanceResult.Success(prior.ResultId);
                }
                var result = await work();
                if (!result.IsSuccess)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    context.ChangeTracker.Clear();
                    return result;
                }
                if (key is { } done)
                    CommercialCommandReceipts.Add(context, done, actor.Id, action, hash, result.Id!.Value,
                        timeProvider.GetUtcNow());
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return result;
            });
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return GovernanceResult.Failed(GovernanceFailure.Conflict, "version_conflict");
        }
        catch (DbUpdateException exception) when (key is { } concurrentKey && CommercialCommandReceipts.IsDuplicateKey(exception))
        {
            context.ChangeTracker.Clear();
            var concurrent = await CommercialCommandReceipts.FindAsync(context, concurrentKey, actor.Id, action, hash,
                cancellationToken);
            return concurrent.Outcome == CommercialCommandReceipts.Outcome.Replay
                ? GovernanceResult.Success(concurrent.ResultId)
                : GovernanceResult.Failed(GovernanceFailure.Conflict, "idempotency_conflict");
        }
        catch (DbUpdateException)
        {
            context.ChangeTracker.Clear();
            return GovernanceResult.Failed(GovernanceFailure.Conflict, "version_conflict");
        }
    }

    /// <summary>Nobody transfers or terminates themselves or the super administrator's record.</summary>
    private async Task<bool> IsProtectedPersonAsync(Actor actor, long personId, CancellationToken cancellationToken)
    {
        var account = await context.Users.AsNoTracking().Where(user => user.PersonId == personId)
            .Select(user => (long?)user.Id).SingleOrDefaultAsync(cancellationToken);
        if (account is null) return false;
        return account == actor.Id || await context.DepartmentAssignments.AnyAsync(assignment =>
            assignment.AccountId == account && assignment.Kind == DepartmentAssignmentKind.SuperAdministrator,
            cancellationToken);
    }

    /// <summary>
    /// Disables the person's account, ends its sessions and station scopes and cancels the pending access requests
    /// of the employee and the ones the account asked for as an administrator (2-N33). A transfer also retires the
    /// roles of the department the account leaves (<paramref name="retireRoles"/>, 2-N07): its assignment stays,
    /// inert, until the new department's request is validated. Returns whether an active account was disabled.
    /// </summary>
    private async Task<bool> SuspendAccessAsync(long actorAccountId, long personId, long employeeId, string reason,
        DateTimeOffset now, CancellationToken cancellationToken, bool retireRoles = false)
    {
        var account = await context.Users.SingleOrDefaultAsync(user => user.PersonId == personId, cancellationToken);
        var requester = account?.Id;
        var pending = await context.UserAccessRequests.Where(request => request.Status == UserAccessRequestStatus.Pending &&
                (request.EmployeeId == employeeId || requester != null && request.RequestedByAccountId == requester))
            .ToArrayAsync(cancellationToken);
        foreach (var request in pending)
        {
            request.Status = UserAccessRequestStatus.Cancelled;
            request.DecidedAt = now;
            request.DecidedByAccountId = actorAccountId;
            request.DecisionReason = request.EmployeeId == employeeId
                ? reason : "Quien la solicitó ya no administra el departamento";
            request.UpdatedAt = now;
            GovernanceSupport.AddAudit(context, actorAccountId, "governance.access_request.cancelled",
                "iam.user_access_requests", request.PublicId, request.DecisionReason, [], now, request.Department,
                new AuditFieldChangeData("request.status", nameof(UserAccessRequestStatus.Pending), request.Status.ToString()));
            await NotifyRequestAsync(request, now, cancellationToken);
        }
        if (account is null) return false;
        if (retireRoles) await RetireDepartmentRolesAsync(actorAccountId, account, reason, now, cancellationToken);
        var wasActive = account.Status == AccountLifecycleStatus.Active;
        account.Status = AccountLifecycleStatus.Disabled;
        await userManager.UpdateSecurityStampAsync(account);
        var scopes = await context.AccountStationScopes.Where(scope => scope.AccountId == account.Id && scope.RevokedAt == null)
            .ToArrayAsync(cancellationToken);
        foreach (var scope in scopes) scope.RevokedAt = now;
        if (wasActive)
            GovernanceSupport.AddAudit(context, actorAccountId, "governance.department_user.deactivated", "iam.accounts",
                account.PublicId, reason, [], now,
                new AuditFieldChangeData("user.status", nameof(AccountLifecycleStatus.Active), nameof(AccountLifecycleStatus.Disabled)));
        AccountChangeOutboxWriter.Add(context, account.Id, null, "department_users", account.PublicId, now);
        return wasActive;
    }

    /// <summary>
    /// 2-N07: the account leaves the roles that gave it access in its old department (department, ramp and legacy
    /// roles). Without them its assignment grants nothing, so the old department no longer lists it; the validated
    /// request of the new department gives it the new role. Audited, never deleted from history.
    /// </summary>
    private async Task RetireDepartmentRolesAsync(long actorAccountId, ApplicationUser account, string reason,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        var links = await (from link in context.Set<IdentityUserRole<long>>()
                           join role in context.Roles on link.RoleId equals role.Id
                           where link.UserId == account.Id && role.NormalizedName != "SUPERADMIN"
                           select new { Link = link, Code = role.NormalizedName! }).ToArrayAsync(cancellationToken);
        if (links.Length == 0) return;
        context.Set<IdentityUserRole<long>>().RemoveRange(links.Select(item => item.Link));
        GovernanceSupport.AddAudit(context, actorAccountId, "governance.department_user.access_retired", "iam.accounts",
            account.PublicId, reason, [], now,
            new AuditFieldChangeData("user.roles", string.Join(',', links.Select(item => item.Code).Order(StringComparer.Ordinal)),
                null));
    }

    private void OpenAssignment(Employee employee, long actorAccountId, DateTimeOffset now, string? reason) =>
        context.EmployeeAssignments.Add(new EmployeeAssignment
        {
            EmployeeId = employee.Id, Department = employee.Department, JobPositionId = employee.JobPositionId,
            ValidFrom = now, ChangedByAccountId = actorAccountId, Reason = reason,
        });

    private async Task CloseAssignmentAsync(long employeeId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var open = await context.EmployeeAssignments.SingleOrDefaultAsync(item =>
            item.EmployeeId == employeeId && item.ValidTo == null, cancellationToken);
        if (open is not null) open.ValidTo = now;
        // The filtered unique index allows one open row; close it before opening the next.
        await context.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// The employee's stations follow <paramref name="stations"/>: the ones that leave end today and the new ones
    /// start today, each in its station's calendar (2-N31).
    /// </summary>
    private async Task SetEmployeeStationsAsync(long employeeId, long[] stations, IReadOnlyList<EmployeeStation> current,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        var today = await StationTodayAsync(stations.Concat(current.Select(item => item.StationId)), now, cancellationToken);
        foreach (var item in current.Where(item => !stations.Contains(item.StationId)))
            item.ValidTo = today(item.StationId) < item.ValidFrom ? item.ValidFrom : today(item.StationId);
        foreach (var station in stations.Except(current.Select(item => item.StationId)))
            context.EmployeeStations.Add(new EmployeeStation
            { EmployeeId = employeeId, StationId = station, ValidFrom = today(station) });
    }

    /// <summary>«Today» of each station in its own time zone, never the UTC day (2-N31).</summary>
    private async Task<Func<long, DateOnly>> StationTodayAsync(IEnumerable<long> stationIds, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var ids = stationIds.Distinct().ToArray();
        var zones = ids.Length == 0 ? [] : await context.Stations.AsNoTracking().Where(station => ids.Contains(station.Id))
            .ToDictionaryAsync(station => station.Id, station => station.IanaTimeZone, cancellationToken);
        return stationId => BusinessCalendar.Today(now, zones.GetValueOrDefault(stationId));
    }

    /// <summary>
    /// Ramp positions keep a ramp-agent record (qualifications, permits and shifts hang from it). When
    /// <paramref name="stations"/> is given the agent's station scopes follow them; with an active
    /// account the account's scopes already drive them.
    /// </summary>
    private async Task EnsureRampAgentAsync(long personId, Employee employee, JobPosition position, long[]? stations,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        var agent = await context.RampAgents.SingleOrDefaultAsync(item => item.PersonId == personId, cancellationToken);
        if (agent is null)
        {
            agent = new RampAgent
            {
                PublicId = Guid.CreateVersion7(), CreatedAt = now, UpdatedAt = now, PersonId = personId,
                EmployeeNumber = employee.EmployeeNumber, Category = position.Name, HireDate = employee.HireDate,
                IsActive = true,
            };
            context.RampAgents.Add(agent);
            await context.SaveChangesAsync(cancellationToken);
        }
        else
        {
            agent.EmployeeNumber = employee.EmployeeNumber;
            agent.Category = position.Name;
            agent.HireDate = employee.HireDate;
            agent.IsActive = true;
            agent.UpdatedAt = now;
        }
        if (stations is null) return;
        var scopes = await context.Set<RampAgentStationScope>()
            .Where(scope => scope.RampAgentId == agent.Id && scope.ValidTo == null).ToArrayAsync(cancellationToken);
        var today = await StationTodayAsync(stations.Concat(scopes.Select(scope => scope.StationId)), now, cancellationToken);
        foreach (var scope in scopes.Where(scope => !stations.Contains(scope.StationId)))
            scope.ValidTo = today(scope.StationId) < scope.ValidFrom ? scope.ValidFrom : today(scope.StationId);
        foreach (var station in stations.Except(scopes.Select(scope => scope.StationId)))
            context.Set<RampAgentStationScope>().Add(new RampAgentStationScope
            { RampAgentId = agent.Id, StationId = station, ValidFrom = today(station) });
    }

    /// <summary>
    /// The end of the person's ramp duty (termination, transfer out of the ramp, office position) through the one
    /// release path (<see cref="RampAgentRelease.EndRampDutyAsync"/>). Null when it ended or there was no active
    /// ramp agent; otherwise the failure that keeps the command from changing anything.
    /// </summary>
    private async Task<GovernanceResult?> EndRampDutyAsync(long personId, long actorAccountId, RampAgentRelease.Cause cause,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        var agentId = await context.RampAgents.Where(item => item.PersonId == personId && item.IsActive)
            .Select(item => (long?)item.Id).SingleOrDefaultAsync(cancellationToken);
        if (agentId is null) return null;
        var outcome = await RampAgentRelease.EndRampDutyAsync(context, agentId.Value, actorAccountId, cause, now,
            cancellationToken);
        return outcome.Blocked
            ? GovernanceResult.Failed(GovernanceFailure.Conflict, RampAgentRelease.OperationInProgressCode)
            : null;
    }

    /// <summary>Human Resources readers and the department's administrators re-read employees.</summary>
    private async Task NotifyEmployeesAsync(Department department, Guid employeeId, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var accounts = await DepartmentAccessQueries.ActiveInternalAccounts(context).ToArrayAsync(cancellationToken);
        var accesses = await DepartmentAccessQueries.ReadManyAsync(context, accounts, cancellationToken);
        foreach (var (accountId, access) in accesses)
            if (access.Has(EmployeesRead) || access.Administers(department))
                AccountChangeOutboxWriter.Add(context, accountId, null, "employees", employeeId, now);
    }

    /// <summary>True when the account belongs to a terminated employee: such accounts never come back.</summary>
    private Task<bool> IsTerminatedAccountAsync(long accountId, CancellationToken cancellationToken) =>
        (from user in context.Users
         join employee in context.Employees on user.PersonId equals employee.PersonId
         where user.Id == accountId && employee.Status == EmployeeStatus.Terminated
         select employee.Id).AnyAsync(cancellationToken);

    public async Task<IReadOnlyList<UnregisteredPersonData>?> ListUnregisteredAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.Can(EmployeesCreate)) return null;
        var users = await DepartmentUsersAsync(null, cancellationToken);
        var personIds = await context.Users.AsNoTracking().Where(user => users.Select(row => row.Id).Contains(user.Id))
            .ToDictionaryAsync(user => user.Id, user => user.PersonId, cancellationToken);
        var registered = (await context.Employees.AsNoTracking().Select(employee => employee.PersonId)
            .ToArrayAsync(cancellationToken)).ToHashSet();
        var stations = await StationsOfAsync(users.Select(user => user.Id).ToArray(), cancellationToken);
        var agents = await context.RampAgents.AsNoTracking().ToDictionaryAsync(agent => agent.PersonId, cancellationToken);
        var result = users.Where(user => !registered.Contains(personIds[user.Id]))
            .Select(user => new UnregisteredPersonData(user.PublicId,
                agents.TryGetValue(personIds[user.Id], out var agent) ? agent.PublicId : null,
                user.FirstName, user.LastName, user.Email,
                user.Access.Department is { } department ? KeyOf(department) : null,
                agents.TryGetValue(personIds[user.Id], out var numbered) ? numbered.EmployeeNumber : null,
                stations[user.Id]))
            .ToList();
        var accountPersons = personIds.Values.ToHashSet();
        var allAccountPersons = (await context.Users.AsNoTracking().Select(user => user.PersonId)
            .ToArrayAsync(cancellationToken)).ToHashSet();
        var orphanAgents = await (from agent in context.RampAgents.AsNoTracking()
                                  join person in context.Persons.AsNoTracking() on agent.PersonId equals person.Id
                                  where agent.IsActive
                                  select new { agent.PublicId, agent.PersonId, agent.EmployeeNumber, person.FirstName,
                                      person.LastName, person.PrimaryEmail }).ToArrayAsync(cancellationToken);
        result.AddRange(orphanAgents
            .Where(agent => !registered.Contains(agent.PersonId) && !accountPersons.Contains(agent.PersonId) &&
                !allAccountPersons.Contains(agent.PersonId))
            .Select(agent => new UnregisteredPersonData(null, agent.PublicId, agent.FirstName, agent.LastName,
                agent.PrimaryEmail, KeyOf(Department.Operations), agent.EmployeeNumber, [])));
        return result.OrderBy(item => item.LastName, StringComparer.CurrentCulture)
            .ThenBy(item => item.FirstName, StringComparer.CurrentCulture).ToArray();
    }

    /// <summary>
    /// Creates the HR record of an account or ramp agent that predates employees. The placeholder
    /// identification is replaced by the real one; a ramp agent keeps its employee number.
    /// </summary>
    public async Task<GovernanceResult> RegisterEmployeeAsync(Guid actorId, RegisterEmployeeInput input,
        CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, cancellationToken);
        if (actor is null || !actor.Can(EmployeesCreate)) return GovernanceResult.Failed(GovernanceFailure.Forbidden);
        // An account wins over its ramp agent: both point to the same person.
        if (input is null || input.AccountId is null && input.RampAgentId is null)
            return GovernanceResult.Failed(GovernanceFailure.Invalid);

        long personId;
        Department department;
        if (input.AccountId is { } accountPublicId)
        {
            var row = (await DepartmentUsersAsync(null, cancellationToken)).SingleOrDefault(user => user.PublicId == accountPublicId);
            if (row?.Access.Department is not { } owned) return GovernanceResult.Failed(GovernanceFailure.NotFound);
            department = owned;
            personId = await context.Users.Where(user => user.Id == row.Id).Select(user => user.PersonId)
                .SingleAsync(cancellationToken);
        }
        else
        {
            var agent = await context.RampAgents.AsNoTracking().SingleOrDefaultAsync(item =>
                item.PublicId == input.RampAgentId, cancellationToken);
            if (agent is null) return GovernanceResult.Failed(GovernanceFailure.NotFound);
            department = Department.Operations;
            personId = agent.PersonId;
        }
        var person = await context.Persons.AsNoTracking().SingleAsync(item => item.Id == personId, cancellationToken);
        var existingAgent = await context.RampAgents.AsNoTracking().SingleOrDefaultAsync(item =>
            item.PersonId == personId, cancellationToken);
        var shapeInput = new SaveEmployeeInput(person.FirstName, person.LastName, input.IdentificationType,
            input.IdentificationNumber, existingAgent?.EmployeeNumber ?? input.EmployeeNumber, KeyOf(department),
            input.PositionId, input.StationIds, input.HireDate, input.PhoneNumber ?? person.PhoneNumber, person.PrimaryEmail);
        var (shape, failure) = await ShapeAsync(actor, shapeInput, cancellationToken);
        if (failure is not null) return failure;
        if (existingAgent is not null && !shape!.Position.IsRampPosition)
            return GovernanceResult.Failed(GovernanceFailure.Invalid, "ramp_agent_requires_ramp_position");
        if (!IdentificationTypes.IsSynthetic(person.IdentificationType) &&
            (person.IdentificationType != shape!.IdentificationType || person.IdentificationNumber != shape.IdentificationNumber))
            return GovernanceResult.Failed(GovernanceFailure.Conflict, "identification_mismatch");

        return await InSerializableTransactionAsync(async () =>
        {
            if (await context.Employees.AnyAsync(item => item.PersonId == personId, cancellationToken))
                return GovernanceResult.Failed(GovernanceFailure.Conflict, "already_registered");
            if (await UniquenessAsync(shape!, personId, cancellationToken) is { } conflict) return conflict;
            var now = timeProvider.GetUtcNow();
            var tracked = await context.Persons.SingleAsync(item => item.Id == personId, cancellationToken);
            tracked.IdentificationType = shape!.IdentificationType;
            tracked.IdentificationNumber = shape.IdentificationNumber;
            tracked.PhoneNumber = shape.Phone;
            var employee = new Employee
            {
                PublicId = Guid.CreateVersion7(), CreatedAt = now, UpdatedAt = now, PersonId = personId,
                EmployeeNumber = shape.EmployeeNumber, Department = department, JobPositionId = shape.Position.Id,
                HireDate = shape.HireDate, Status = EmployeeStatus.Active, CreatedByAccountId = actor.Id,
            };
            context.Employees.Add(employee);
            await context.SaveChangesAsync(cancellationToken);
            OpenAssignment(employee, actor.Id, now, "Registro de expediente de una cuenta existente");
            await SetEmployeeStationsAsync(employee.Id, shape.Stations, [], now, cancellationToken);
            if (shape.Position.IsRampPosition)
                await EnsureRampAgentAsync(personId, employee, shape.Position, null, now, cancellationToken);
            GovernanceSupport.AddAudit(context, actor.Id, "hr.employee.registered", "hr.employees", employee.PublicId, null,
                shape.Stations.Select(station => (long?)station).ToArray(), now, department,
                new AuditFieldChangeData("employee.number", null, employee.EmployeeNumber),
                new AuditFieldChangeData("employee.position", null, shape.Position.Name));
            await NotifyEmployeesAsync(department, employee.PublicId, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return GovernanceResult.Success(employee.PublicId);
        }, cancellationToken);
    }
}
