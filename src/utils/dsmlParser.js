import crypto from 'node:crypto';

const LT = '[<＜]';
const GT = '[>＞]';
const BAR = '[|｜]';
const DSML_PREFIX = `${LT}\\s*${BAR}\\s*(?:${BAR}\\s*)?DSML\\s*${BAR}\\s*(?:${BAR}\\s*)?`;
const DSML_CLOSE_PREFIX = `${LT}\\s*\\/\\s*${BAR}\\s*(?:${BAR}\\s*)?DSML\\s*${BAR}\\s*(?:${BAR}\\s*)?`;

/**
 * Checks if a text contains tool calling syntax (<tool_call> or DSML).
 */
export function containsDSML(text) {
  if (!text || typeof text !== 'string') return false;
  if (/<tool_call>/i.test(text)) return true;
  const startCallsRegex = new RegExp(`${DSML_PREFIX}calls`, 'i');
  return startCallsRegex.test(text);
}

/**
 * Extracts normal text and parsed OpenAI tool calls from <tool_call> tags or DSML output.
 * Supports both standard <tool_call> JSON format and DSML <｜DSML｜｜calls> format.
 */
export function parseDSML(text) {
  if (!text || typeof text !== 'string') {
    return { content: text || '', toolCalls: [] };
  }

  const toolCalls = [];
  let content = text;

  // 1. Check for <tool_call>...</tool_call> or unclosed <tool_call> blocks
  const toolCallRegex = /<tool_call>([\s\S]*?)(?:<\/tool_call>|$)/gi;
  if (/<tool_call>/i.test(content)) {
    let match;
    while ((match = toolCallRegex.exec(text)) !== null) {
      const rawBlock = match[1].trim();
      if (!rawBlock) continue;

      try {
        // Strip markdown backticks if wrapped in ```json ... ```
        const cleanJson = rawBlock.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleanJson);

        const name = parsed.name || parsed.function?.name || parsed.tool_name || parsed.tool;
        if (name) {
          let argsObj = parsed.arguments || parsed.parameters || {};
          if (typeof argsObj !== 'string') {
            argsObj = JSON.stringify(argsObj);
          }

          toolCalls.push({
            id: `call_${crypto.randomBytes(12).toString('hex')}`,
            type: 'function',
            function: {
              name: String(name).trim(),
              arguments: argsObj
            }
          });
        }
      } catch {
        // Fallback: extract name and arguments via regex if direct parse fails
        const nameMatch = rawBlock.match(/"name"\s*:\s*"([^"]+)"/);
        const argsMatch = rawBlock.match(/"arguments"\s*:\s*(\{[\s\S]*\})/);
        if (nameMatch) {
          toolCalls.push({
            id: `call_${crypto.randomBytes(12).toString('hex')}`,
            type: 'function',
            function: {
              name: nameMatch[1],
              arguments: argsMatch ? argsMatch[1] : '{}'
            }
          });
        }
      }
    }

    // Strip tool_call tags from content
    content = content.replace(/<tool_call>[\s\S]*?(?:<\/tool_call>|$)/gi, '').trim();
  }

  // 2. Also check for DSML calls if present
  const startCallsRegex = new RegExp(`${DSML_PREFIX}calls\\s*${GT}`, 'i');
  if (startCallsRegex.test(content)) {
    const dsmlResult = parseRawDSML(content);
    content = dsmlResult.content;
    toolCalls.push(...dsmlResult.toolCalls);
  }

  return {
    content,
    toolCalls
  };
}

/**
 * Internal parser for DSML syntax.
 */
function parseRawDSML(text) {
  const startCallsRegex = new RegExp(`${DSML_PREFIX}calls\\s*${GT}`, 'i');
  const startMatch = text.match(startCallsRegex);

  if (!startMatch) {
    return { content: text, toolCalls: [] };
  }

  const beforeText = text.slice(0, startMatch.index).trimEnd();
  const restText = text.slice(startMatch.index + startMatch[0].length);

  const endCallsRegex = new RegExp(`${DSML_CLOSE_PREFIX}calls\\s*${GT}`, 'i');
  const endMatch = restText.match(endCallsRegex);

  let callsBody = restText;
  let afterText = '';
  if (endMatch) {
    callsBody = restText.slice(0, endMatch.index);
    afterText = restText.slice(endMatch.index + endMatch[0].length).trimStart();
  }

  const content = (beforeText + (afterText ? '\n' + afterText : '')).trim();
  const toolCalls = [];

  const invokeStartRegex = new RegExp(`${DSML_PREFIX}invoke\\s+name=["']([^"']+)["']\\s*${GT}`, 'gi');
  const invokeEndPattern = `${DSML_CLOSE_PREFIX}invoke\\s*${GT}`;

  let match;
  const invokeMatches = [];
  while ((match = invokeStartRegex.exec(callsBody)) !== null) {
    invokeMatches.push({
      name: match[1].trim(),
      index: match.index,
      headerLength: match[0].length
    });
  }

  for (let i = 0; i < invokeMatches.length; i++) {
    const curr = invokeMatches[i];
    const startIndex = curr.index + curr.headerLength;
    const nextStart = i + 1 < invokeMatches.length ? invokeMatches[i + 1].index : callsBody.length;

    let invokeChunk = callsBody.slice(startIndex, nextStart);
    invokeChunk = invokeChunk.replace(new RegExp(`${invokeEndPattern}[\\s\\S]*$`, 'i'), '');

    const paramStartRegex = new RegExp(`${DSML_PREFIX}parameter\\s+name=["']([^"']+)["'](?:\\s+string=["'](true|false)["'])?\\s*${GT}`, 'gi');
    const paramEndPattern = `${DSML_CLOSE_PREFIX}parameter\\s*${GT}`;

    const paramMatches = [];
    let pMatch;
    while ((pMatch = paramStartRegex.exec(invokeChunk)) !== null) {
      paramMatches.push({
        name: pMatch[1].trim(),
        isString: pMatch[2] !== 'false',
        index: pMatch.index,
        headerLength: pMatch[0].length
      });
    }

    const args = {};
    for (let j = 0; j < paramMatches.length; j++) {
      const pCurr = paramMatches[j];
      const pStart = pCurr.index + pCurr.headerLength;
      const pNext = j + 1 < paramMatches.length ? paramMatches[j + 1].index : invokeChunk.length;

      let val = invokeChunk.slice(pStart, pNext);
      val = val.replace(new RegExp(`${paramEndPattern}[\\s\\S]*$`, 'i'), '');
      val = val.replace(/\r\n/g, '\n');

      if (!pCurr.isString) {
        try {
          args[pCurr.name] = JSON.parse(val.trim());
        } catch {
          args[pCurr.name] = val.trim();
        }
      } else {
        if (pCurr.name === 'content' || val.includes('\n')) {
          args[pCurr.name] = val.replace(/\n$/, '');
        } else {
          args[pCurr.name] = val.trim();
        }
      }
    }

    toolCalls.push({
      id: `call_${crypto.randomBytes(12).toString('hex')}`,
      type: 'function',
      function: {
        name: curr.name,
        arguments: JSON.stringify(args)
      }
    });
  }

  return { content, toolCalls };
}
