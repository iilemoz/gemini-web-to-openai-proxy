/**
 * Adapter for formatting tools into prompt instructions for Gemini Web.
 */
export class GeminiToolAdapter {
  static formatSystemInstruction(tools = []) {
    if (!Array.isArray(tools) || tools.length === 0) return '';

    const toolDefs = tools.map(t => {
      const fn = t.function || t;
      return {
        name: fn.name,
        description: fn.description || '',
        parameters: fn.parameters || {}
      };
    });

    return `\n[TOOL CALLING PIPELINE]
You are an autonomous AI coding assistant integrated with an active tool execution pipeline.
All tools listed below are AVAILABLE AND READY for you to use in this workspace:
${JSON.stringify(toolDefs, null, 2)}

Instructions for tool calling:
- When the task requires executing a tool, invoke the matching tool from the list above.
- Output your tool call in this exact format:
<tool_call>
{"name": "tool_name", "arguments": {"param1": "value1"}}
</tool_call>
- Never make up tools that are not in the list above.`;
  }
}
