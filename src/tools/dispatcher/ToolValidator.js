/**
 * Validates tool call inputs against registered JSON schema definitions.
 */
export class ToolValidator {
  static validate(schema, args) {
    if (!schema || !schema.parameters) {
      return { valid: true, sanitized: args || {} };
    }

    let parsedArgs = args;
    if (typeof parsedArgs === 'string') {
      try {
        parsedArgs = JSON.parse(parsedArgs);
      } catch (err) {
        return {
          valid: false,
          error: `Malformed JSON arguments: ${err.message}`
        };
      }
    }

    if (!parsedArgs || typeof parsedArgs !== 'object' || Array.isArray(parsedArgs)) {
      return {
        valid: false,
        error: 'Tool arguments must be a JSON object.'
      };
    }

    const { properties = {}, required = [] } = schema.parameters;

    // Check required fields
    for (const reqField of required) {
      if (parsedArgs[reqField] === undefined || parsedArgs[reqField] === null) {
        return {
          valid: false,
          error: `Missing required parameter '${reqField}'.`
        };
      }
    }

    // Type checking for declared properties
    for (const [key, value] of Object.entries(parsedArgs)) {
      const propDef = properties[key];
      if (propDef && propDef.type) {
        const expectedType = propDef.type;
        const actualType = typeof value;

        if (expectedType === 'string' && actualType !== 'string') {
          return { valid: false, error: `Parameter '${key}' must be a string.` };
        }
        if (expectedType === 'number' && actualType !== 'number') {
          return { valid: false, error: `Parameter '${key}' must be a number.` };
        }
        if (expectedType === 'boolean' && actualType !== 'boolean') {
          return { valid: false, error: `Parameter '${key}' must be a boolean.` };
        }
        if (expectedType === 'array' && !Array.isArray(value)) {
          return { valid: false, error: `Parameter '${key}' must be an array.` };
        }
      }
    }

    return { valid: true, sanitized: parsedArgs };
  }
}
