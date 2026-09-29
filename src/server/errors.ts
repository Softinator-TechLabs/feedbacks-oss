export type ErrorDetails = {
  operation?: string;
  requiredScopes?: string[];
  reason?: string;
  recovery?: string;
};
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: ErrorDetails,
  ) {
    super(message);
  }
}
export function fail(
  code: string,
  message: string,
  status = 400,
  details?: ErrorDetails,
): never {
  throw new DomainError(code, message, status, details);
}
