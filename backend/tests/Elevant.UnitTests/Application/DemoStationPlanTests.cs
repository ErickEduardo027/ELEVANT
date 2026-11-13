using Elevant.Application.Operations.DemoStation;

namespace Elevant.UnitTests.Application;

/// <summary>
/// ADR-0041, contracts 1.2: «Cargar posiciones de Punta Cana» only creates. It adopts what the station already has by
/// the normalized code, never changes, reactivates, deactivates or deletes a row, and answers the resulting state.
/// </summary>
public sealed class DemoStationPlanTests
{
    private static readonly string[] Catalogue = PuntaCanaStationLayout.Stands.Select(stand => stand.Code).ToArray();

    private static ExistingTerminal Terminal(long id, string code, bool active = true) => new(id, code, active);

    private static ExistingStand Stand(long id, string code, long? terminalId, bool active = true, bool placed = false) =>
        new(id, code, terminalId, active, placed);

    /// <summary>The Development seed: terminals A and B, A01 and A02 in A, B01 and B02 in B, nothing placed.</summary>
    private static (ExistingTerminal[] Terminals, ExistingStand[] Stands) Seed() =>
        ([Terminal(1, "A"), Terminal(2, "B")],
            [Stand(1, "A01", 1), Stand(2, "A02", 1), Stand(3, "B01", 2), Stand(4, "B02", 2)]);

    private static string[] Except(params string[] codes) => Catalogue.Except(codes, StringComparer.Ordinal).ToArray();

    private static (string, long)[] Pairs(IReadOnlyDictionary<string, long> map) =>
        map.OrderBy(pair => pair.Key, StringComparer.Ordinal).Select(pair => (pair.Key, pair.Value)).ToArray();

    /// <summary>The station once the store applied the plan: new rows with new ids, each stand in its terminal.</summary>
    private static (ExistingTerminal[] Terminals, ExistingStand[] Stands) Apply(DemoStationPlan plan,
        IReadOnlyCollection<ExistingTerminal> terminals, IReadOnlyCollection<ExistingStand> stands)
    {
        var terminalsAfter = terminals.ToList();
        var targets = plan.TerminalIds.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal);
        var nextTerminalId = 500L;
        foreach (var terminal in plan.TerminalsToCreate)
        {
            terminalsAfter.Add(Terminal(++nextTerminalId, terminal.Code));
            targets[terminal.Code] = nextTerminalId;
        }
        var standsAfter = stands.ToList();
        var nextStandId = 900L;
        foreach (var stand in plan.StandsToCreate) standsAfter.Add(Stand(++nextStandId, stand.Code, targets[stand.TerminalCode]));
        return ([.. terminalsAfter], [.. standsAfter]);
    }

    private static void AssertState(DemoStationLayoutState state, int terminals, int stands, int activeStands,
        int locatedStands, string[] missing, string[] unmatched, bool complete)
    {
        Assert.Equal((3, 41), (state.CatalogTerminals, state.CatalogStands));
        Assert.Equal((terminals, stands, activeStands, locatedStands),
            (state.Terminals, state.Stands, state.ActiveStands, state.LocatedStands));
        Assert.Equal(missing, state.MissingStands);
        Assert.Equal(unmatched, state.UnmatchedStands);
        Assert.Equal(complete, state.Complete);
    }

    private static void AssertSameState(DemoStationLayoutState expected, DemoStationLayoutState actual) =>
        AssertState(actual, expected.Terminals, expected.Stands, expected.ActiveStands, expected.LocatedStands,
            [.. expected.MissingStands], [.. expected.UnmatchedStands], expected.Complete);

    [Fact]
    public void AnEmptyStationGetsEveryTerminalAndStand()
    {
        var plan = DemoStationPlan.For([], []);

        Assert.Equal(PuntaCanaStationLayout.Terminals, plan.TerminalsToCreate);
        Assert.Equal(PuntaCanaStationLayout.Stands, plan.StandsToCreate);
        Assert.Empty(plan.Adopted);
        Assert.Empty(plan.TerminalIds);
        AssertState(plan.State, terminals: 3, stands: 41, activeStands: 41, locatedStands: 41, missing: [], unmatched: [],
            complete: true);
        // Before the command nothing is there.
        AssertState(DemoStationPlan.Describe([], []), 0, 0, 0, 0, Catalogue, [], false);
    }

    [Fact]
    public void OnTheSeedThirtyNineStandsAreCreatedAndTwoAdopted()
    {
        var (terminals, stands) = Seed();

        var plan = DemoStationPlan.For(terminals, stands);

        Assert.Equal([new DemoLayoutTerminal("FBO", "FBO / Aviación local")], plan.TerminalsToCreate);
        Assert.Equal(Except("A1", "A2"), plan.StandsToCreate.Select(stand => stand.Code));
        Assert.Equal(39, plan.StandsToCreate.Count);
        Assert.Equal([("A1", 1L), ("A2", 2L)], Pairs(plan.Adopted));
        Assert.Equal([("A", 1L), ("B", 2L)], Pairs(plan.TerminalIds));
        // B01 and B02 are the stands «B1» and «B2», which the catalogue does not have: they stay as they are, reported.
        AssertState(plan.State, 3, 41, 43, 41, [], ["B01", "B02"], true);
        // What the card shows before loading: two of the catalogue's stands and two of its terminals.
        AssertState(DemoStationPlan.Describe(terminals, stands), 2, 2, 4, 2, Except("A1", "A2"), ["B01", "B02"], false);
    }

    [Fact]
    public void AnExistingStandIsAdoptedByItsNormalizedCodeEvenInAnotherTerminal()
    {
        ExistingTerminal[] terminals = [Terminal(1, "A"), Terminal(2, "B"), Terminal(3, "FBO")];
        ExistingStand[] stands = [Stand(10, "b-20", 1), Stand(11, "BN 06", 2, placed: true)];

        var plan = DemoStationPlan.For(terminals, stands);

        // Adopted as OCC left them: their code, terminal and attributes are OCC's; nothing is created in their place.
        Assert.Empty(plan.TerminalsToCreate);
        Assert.Equal(Except("B20", "BN6"), plan.StandsToCreate.Select(stand => stand.Code));
        Assert.Equal([("B20", 10L), ("BN6", 11L)], Pairs(plan.Adopted));
        AssertState(plan.State, 3, 41, 41, 41, [], [], true);
    }

    [Fact]
    public void TwoStandsWithOneNormalizedCodeAdoptTheActiveLowestIdAndReportTheOther()
    {
        ExistingTerminal[] terminals = [Terminal(1, "A"), Terminal(2, "B"), Terminal(3, "FBO")];
        ExistingStand[] stands =
        [
            // Both active: the one with the lowest id is the catalogue's A1, whatever the notation.
            Stand(7, "A1", 1), Stand(4, "A01", 1),
            // The lowest id is inactive: it is never adopted, and the lowest active one is.
            Stand(2, "a02", 1, active: false), Stand(9, "A 02", 1), Stand(5, "A-2", 2),
        ];

        var plan = DemoStationPlan.For(terminals, stands);

        Assert.Equal([("A1", 4L), ("A2", 5L)], Pairs(plan.Adopted));
        Assert.Equal(Except("A1", "A2"), plan.StandsToCreate.Select(stand => stand.Code));
        // The other active one is reported with the code it has; the inactive one is history and is not.
        AssertState(plan.State, 3, 41, 43, 43, [], ["A1", "A 02"], true);
    }

    [Fact]
    public void TheAdoptedStandIsTheOneOfAnActiveTerminal()
    {
        ExistingTerminal[] terminals =
            [Terminal(1, "A"), Terminal(2, "B"), Terminal(3, "FBO"), Terminal(4, "OLD", active: false)];
        ExistingStand[] stands = [Stand(1, "A01", 4), Stand(2, "A1", 1), Stand(3, "A2", null)];

        var plan = DemoStationPlan.For(terminals, stands);

        // A01 is older but its terminal is inactive: terminal A's A1 is the catalogue's stand, and A01 is nobody's.
        Assert.Equal([("A1", 2L), ("A2", 3L)], Pairs(plan.Adopted));
        // A stand without a terminal is never created again, but nobody can use it: A2 stays missing.
        Assert.Equal(Except("A1", "A2"), plan.StandsToCreate.Select(stand => stand.Code));
        AssertState(plan.State, 3, 40, 40, 40, ["A2"], [], false);
    }

    [Fact]
    public void AnInactiveTerminalIsNotRecreatedAndItsStandsAreMissing()
    {
        // OCC deactivated the FBO (its code compared in capitals): it stays so, and nothing is created in it.
        ExistingTerminal[] terminals = [Terminal(1, "A"), Terminal(2, "B"), Terminal(3, "fbo", active: false)];
        ExistingStand[] stands = [Stand(1, "BN06", 3)];

        var plan = DemoStationPlan.For(terminals, stands);

        Assert.Empty(plan.TerminalsToCreate);
        Assert.Equal([("A", 1L), ("B", 2L)], Pairs(plan.TerminalIds));
        Assert.Equal(33, plan.StandsToCreate.Count);
        Assert.DoesNotContain(plan.StandsToCreate, stand => stand.TerminalCode == "FBO");
        // BN06 is active, so it is adopted as it is, but its terminal is inactive: it is missing like the others.
        Assert.Equal([("BN6", 1L)], Pairs(plan.Adopted));
        string[] fbo = ["BN6", "BN7", "BN8", "BN9", "BN10", "BN11", "BN12", "BN13"];
        AssertState(plan.State, 2, 33, 33, 33, fbo, [], false);
    }

    [Fact]
    public void AnInactiveCatalogueStandIsMissingAndNeverRecreated()
    {
        ExistingTerminal[] terminals = [Terminal(1, "A"), Terminal(2, "B"), Terminal(3, "FBO")];
        ExistingStand[] stands = [Stand(1, "A01", 1, active: false, placed: true), Stand(2, "B33", 2)];

        var plan = DemoStationPlan.For(terminals, stands);

        // OCC deactivated A01: the plan neither reactivates it nor creates a second «A1» next to it.
        Assert.DoesNotContain(plan.StandsToCreate, stand => stand.Code == "A1");
        Assert.Equal(40, plan.StandsToCreate.Count);
        Assert.Empty(plan.Adopted);
        // B33 is outside the catalogue: it is reported and left active.
        AssertState(plan.State, 3, 40, 41, 40, ["A1"], ["B33"], false);
    }

    [Fact]
    public void PlanningOverTheResultCreatesNothing()
    {
        (ExistingTerminal[] Terminals, ExistingStand[] Stands)[] stations =
        [
            ([], []),
            Seed(),
            ([Terminal(1, "A"), Terminal(2, "B"), Terminal(3, "FBO", active: false)],
                [Stand(1, "A01", 1), Stand(2, "A1", 2), Stand(3, "B33", 2), Stand(4, "B20", 2, active: false)]),
        ];

        foreach (var (terminals, stands) in stations)
        {
            var plan = DemoStationPlan.For(terminals, stands);
            var (terminalsAfter, standsAfter) = Apply(plan, terminals, stands);

            var again = DemoStationPlan.For(terminalsAfter, standsAfter);

            Assert.Empty(again.TerminalsToCreate);
            Assert.Empty(again.StandsToCreate);
            // The answer is the station's state, not what one call did: a second run and a replay answer the same,
            // and so does reading the rows the plan left.
            AssertSameState(plan.State, again.State);
            AssertSameState(plan.State, DemoStationPlan.Describe(terminalsAfter, standsAfter));
        }
    }

    [Fact]
    public void LocatedCountsCatalogueStandsAndStandsOccPlaced()
    {
        ExistingTerminal[] terminals = [Terminal(1, "A"), Terminal(2, "B"), Terminal(3, "X", active: false)];
        ExistingStand[] stands =
        [
            Stand(1, "A01", 1), // in the catalogue: the map draws it by its code
            Stand(2, "B01", 2, placed: true), // outside the catalogue, but OCC placed it
            Stand(3, "B02", 2), // outside the catalogue and never placed
            Stand(4, "A02", 1, active: false, placed: true), // inactive
            Stand(5, "X1", 3, placed: true), // in an inactive terminal
        ];

        var state = DemoStationPlan.Describe(terminals, stands);

        Assert.Equal((3, 2), (state.ActiveStands, state.LocatedStands));
        // Once loaded, every new stand is located by its code; B02 still is not, and A02 stays inactive and missing.
        var plan = DemoStationPlan.For(terminals, stands);
        Assert.Equal(39, plan.StandsToCreate.Count);
        AssertState(plan.State, 3, 40, 42, 41, ["A2"], ["B01", "B02"], false);
    }
}
