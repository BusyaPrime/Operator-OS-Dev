/**
 * Base class for all agent-related errors thrown by
 * @operator-os/contracts consumers. Carries a stable `code`
 * for programmatic handling, a `retriable` flag the router
 * respects for backoff logic, and a free-form `details` bag.
 *
 * This is the only non-type-only export of `@operator-os/contracts`.
 * Error classes carry runtime constructor logic, but no other
 * runtime code lives in this package.
 */
export class AIAgentError extends Error {
  readonly code: string;
  readonly retriable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    options: {
      retriable?: boolean;
      details?: Record<string, unknown>;
      cause?: Error;
    } = {}
  ) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'AIAgentError';
    this.code = code;
    this.retriable = options.retriable ?? false;
    this.details = options.details;
  }
}

/**
 * Thrown when a caller asks an agent to do something the agent
 * did not declare in its `listCapabilities()` return. This is a
 * hard caller-side bug — not retriable.
 */
export class CapabilityNotSupportedError extends AIAgentError {
  constructor(capability: string, providerId: string) {
    super(
      'CAPABILITY_NOT_SUPPORTED',
      `Provider '${providerId}' does not support capability '${capability}'`,
      { retriable: false, details: { capability, providerId } }
    );
    this.name = 'CapabilityNotSupportedError';
  }
}

/**
 * Thrown by CostProvider.enforceBudget when the estimated cost
 * of a task would push the user over their budget. Never
 * retriable by the caller — requires either a plan upgrade or
 * explicit user override.
 */
export class BudgetExceededError extends AIAgentError {
  constructor(userId: string, spent: number, limit: number) {
    super(
      'BUDGET_EXCEEDED',
      `User ${userId} has exceeded budget: spent $${spent} of $${limit}`,
      { retriable: false, details: { userId, spent, limit } }
    );
    this.name = 'BudgetExceededError';
  }
}

/**
 * Thrown by FileSystemProvider.assertPathAllowed when a path is
 * outside the provider's scope.allowedRoots. Always a caller-side
 * bug; the agent must stay within declared scope.
 */
export class PathNotAllowedError extends AIAgentError {
  constructor(path: string, allowedRoots: readonly string[]) {
    super(
      'PATH_NOT_ALLOWED',
      `Path '${path}' is not within allowed scope`,
      { retriable: false, details: { path, allowedRoots } }
    );
    this.name = 'PathNotAllowedError';
  }
}
