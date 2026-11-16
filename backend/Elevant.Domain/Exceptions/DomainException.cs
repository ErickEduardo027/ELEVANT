namespace Elevant.Domain.Exceptions;

/// <summary>Base exception for violated domain rules.</summary>
public abstract class DomainException : Exception
{
    protected DomainException(string message)
        : base(message)
    {
    }

    protected DomainException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
