/**
 * Tool Schema representation and validator.
 */
export class ToolSchema {
  constructor({
    name,
    description,
    parameters = { type: 'object', properties: {} },
    requiredPermissions = ['none'],
    timeoutMs = 30000,
    executionTarget = 'local'
  }) {
    if (!name || typeof name !== 'string') {
      throw new Error('Tool must have a valid string name');
    }
    this.name = name;
    this.description = description || '';
    this.parameters = parameters;
    this.requiredPermissions = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];
    this.timeoutMs = timeoutMs;
    this.executionTarget = executionTarget;
  }

  toJSON() {
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters,
      requiredPermissions: this.requiredPermissions,
      timeoutMs: this.timeoutMs,
      executionTarget: this.executionTarget
    };
  }

  toOpenAIFunction() {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters
      }
    };
  }
}
