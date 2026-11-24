/**
 * Formats tool execution outcomes into standard structured responses for agents,
 * OpenAI API responses, and MCP results.
 */
export class ToolResultFormatter {
  static formatSuccess({ toolCallId, toolName, result, durationMs }) {
    let contentString;
    if (typeof result === 'string') {
      contentString = result;
    } else {
      try {
        contentString = JSON.stringify(result, null, 2);
      } catch {
        contentString = String(result);
      }
    }

    return {
      tool_call_id: toolCallId,
      role: 'tool',
      name: toolName,
      content: contentString,
      is_error: false,
      meta: {
        durationMs,
        timestamp: Date.now()
      }
    };
  }

  static formatError({ toolCallId, toolName, error, durationMs }) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      tool_call_id: toolCallId,
      role: 'tool',
      name: toolName,
      content: `Error executing tool '${toolName}': ${errorMessage}`,
      is_error: true,
      meta: {
        durationMs,
        timestamp: Date.now()
      }
    };
  }
}
