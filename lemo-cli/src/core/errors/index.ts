/**
 * Consistent Error Hierarchy for Lemo CLI
 */

export class LemoError extends Error {
  public readonly code: string;
  public readonly details?: unknown;

  constructor(message: string, code = 'LEMO_ERROR', details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Error related to configuration loading, validation, or saving */
export class ConfigError extends LemoError {
  constructor(message: string, details?: unknown) {
    super(message, 'CONFIG_ERROR', details);
  }
}

/** Error related to invalid arguments, options, or user input */
export class ValidationError extends LemoError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', details);
  }
}

/** Error communicating with the Lemo Backend */
export class NetworkError extends LemoError {
  public readonly status: number | undefined;

  constructor(message: string, status?: number, details?: unknown) {
    super(message, 'NETWORK_ERROR', details);
    this.status = status;
  }
}

/** Authentication failure when communicating with the Backend */
export class AuthenticationError extends LemoError {
  constructor(message = 'Authentication failed. Please check your Lemo API key.') {
    super(message, 'AUTH_ERROR');
  }
}

/** Model resolution or unsupported capability error */
export class ModelError extends LemoError {
  constructor(message: string, details?: unknown) {
    super(message, 'MODEL_ERROR', details);
  }
}

/** Error related to tool registration, argument validation, or execution */
export class ToolError extends LemoError {
  constructor(message: string, details?: unknown) {
    super(message, 'TOOL_ERROR', details);
  }
}

/** Error related to agent execution loop, limits, or aborts */
export class AgentExecutionError extends LemoError {
  constructor(message: string, details?: unknown) {
    super(message, 'AGENT_EXECUTION_ERROR', details);
  }
}

/** Error related to approval policy rejections */
export class PolicyViolationError extends LemoError {
  constructor(message: string, details?: unknown) {
    super(message, 'POLICY_VIOLATION_ERROR', details);
  }
}

/**
 * Formats an error into a clean user-facing terminal message,
 * ensuring no sensitive stack traces or raw tokens are exposed.
 */
export function formatErrorMessage(err: unknown, debug = false): string {
  if (err instanceof LemoError) {
    let msg = `[${err.code}] ${err.message}`;
    if (debug && err.stack) {
      msg += `\n${err.stack}`;
    }
    return msg;
  }

  if (err instanceof Error) {
    let msg = `Error: ${err.message}`;
    if (debug && err.stack) {
      msg += `\n${err.stack}`;
    }
    return msg;
  }

  return `Unexpected error: ${String(err)}`;
}
