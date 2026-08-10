export type PortalErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "INVALID_STATE"
  | "CONFLICT";

export class PortalDomainError extends Error {
  constructor(
    readonly code: PortalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PortalDomainError";
  }
}

export function isPortalDomainError(
  error: unknown,
  code?: PortalErrorCode,
): error is PortalDomainError {
  return (
    error instanceof PortalDomainError &&
    (code === undefined || error.code === code)
  );
}
