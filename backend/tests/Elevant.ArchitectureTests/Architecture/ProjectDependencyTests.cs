using System.Xml.Linq;

namespace Elevant.ArchitectureTests.Architecture;

public sealed class ProjectDependencyTests
{
    private static readonly Dictionary<string, IReadOnlySet<string>> ExpectedReferences =
        new Dictionary<string, IReadOnlySet<string>>(StringComparer.Ordinal)
        {
            ["Elevant.Domain"] = new HashSet<string>(StringComparer.Ordinal),
            ["Elevant.Application"] = new HashSet<string>(["Elevant.Domain"], StringComparer.Ordinal),
            ["Elevant.Contracts"] = new HashSet<string>(StringComparer.Ordinal),
            ["Elevant.Infrastructure"] = new HashSet<string>(
                ["Elevant.Application", "Elevant.Domain"],
                StringComparer.Ordinal),
            ["Elevant.Api"] = new HashSet<string>(
                ["Elevant.Application", "Elevant.Contracts", "Elevant.Infrastructure"],
                StringComparer.Ordinal),
        };

    [Fact]
    public void DomainAndContractsHaveNoInternalDependencies()
    {
        AssertProjectReferences("Elevant.Domain");
        AssertProjectReferences("Elevant.Contracts");
    }

    [Fact]
    public void ApplicationDependsOnlyOnDomain() =>
        AssertProjectReferences("Elevant.Application");

    [Fact]
    public void InfrastructureDependsOnlyOnApplicationAndDomain() =>
        AssertProjectReferences("Elevant.Infrastructure");

    [Fact]
    public void ApiDependsOnlyOnApplicationContractsAndInfrastructure() =>
        AssertProjectReferences("Elevant.Api");

    [Fact]
    public void ProductProjectGraphHasNoCycles()
    {
        var graph = ExpectedReferences.ToDictionary(
            pair => pair.Key,
            pair => ReadProjectReferences(pair.Key),
            StringComparer.Ordinal);
        var states = graph.Keys.ToDictionary(key => key, _ => VisitState.Unvisited, StringComparer.Ordinal);

        foreach (var project in graph.Keys)
        {
            Visit(project, graph, states, []);
        }
    }

    private static void AssertProjectReferences(string projectName)
    {
        var actual = ReadProjectReferences(projectName);
        var expected = ExpectedReferences[projectName];

        Assert.True(
            expected.SetEquals(actual),
            $"{projectName} references [{string.Join(", ", actual.Order())}] but expected " +
            $"[{string.Join(", ", expected.Order())}].");
    }

    private static HashSet<string> ReadProjectReferences(string projectName)
    {
        var backendRoot = FindBackendRoot();
        var projectPath = Path.Combine(
            backendRoot,
            "src",
            projectName,
            $"{projectName}.csproj");
        var document = XDocument.Load(projectPath);

        return document
            .Descendants()
            .Where(element => element.Name.LocalName == "ProjectReference")
            .Select(element => element.Attribute("Include")?.Value)
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => Path.GetFileNameWithoutExtension(value!))
            .ToHashSet(StringComparer.Ordinal);
    }

    private static string FindBackendRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null)
        {
            if (File.Exists(Path.Combine(directory.FullName, "Elevant.sln")))
            {
                return directory.FullName;
            }

            directory = directory.Parent;
        }

        throw new DirectoryNotFoundException("Could not find the backend root containing Elevant.sln.");
    }

    private static void Visit(
        string project,
        IReadOnlyDictionary<string, HashSet<string>> graph,
        IDictionary<string, VisitState> states,
        List<string> path)
    {
        if (states[project] == VisitState.Visited)
        {
            return;
        }

        if (states[project] == VisitState.Visiting)
        {
            path.Add(project);
            Assert.Fail($"Project-reference cycle detected: {string.Join(" -> ", path)}");
        }

        states[project] = VisitState.Visiting;
        path.Add(project);

        foreach (var dependency in graph[project])
        {
            Visit(dependency, graph, states, path);
        }

        path.RemoveAt(path.Count - 1);
        states[project] = VisitState.Visited;
    }

    private enum VisitState
    {
        Unvisited,
        Visiting,
        Visited,
    }
}
