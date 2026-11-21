using System.Reflection;

namespace Elevant.IntegrationTests.Api;

/// <summary>
/// A stub of a wide interface for endpoint tests: the calls go to one handler by method name, and any method the test
/// does not answer throws, so an unexpected read fails the test instead of passing silently.
/// </summary>
public class InterfaceStub : DispatchProxy
{
    private Func<string, object?[], object?>? handler;

    public List<string> Calls { get; } = [];

    public static T Create<T>(Func<string, object?[], object?> handler) where T : class
    {
        var proxy = Create<T, InterfaceStub>();
        ((InterfaceStub)(object)proxy).handler = handler;
        return proxy;
    }

    public static IReadOnlyList<string> CallsOf(object stub) => ((InterfaceStub)stub).Calls;

    protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
    {
        ArgumentNullException.ThrowIfNull(targetMethod);
        Calls.Add(targetMethod.Name);
        return handler!(targetMethod.Name, args ?? []) ??
            throw new NotSupportedException($"The stub does not answer {targetMethod.Name}.");
    }
}
