/**
 * Stop Sequences & Streaming Text Truncation Utilities.
 * Pure text processing for enforcing stop sequences in non-streaming and streaming responses.
 */

/**
 * Truncate text according to stop sequences.
 * @param {string} text
 * @param {string|string[]} stop
 * @returns {{ text: string, stopped: boolean, stopSequence: string|null }}
 */
export function applyStopSequences(text, stop) {
  if (!text || !stop) {
    return { text: text || '', stopped: false, stopSequence: null };
  }

  const stopList = Array.isArray(stop) ? stop : [stop];
  let earliestIndex = -1;
  let matchedSeq = null;

  for (const s of stopList) {
    if (!s || typeof s !== 'string') continue;
    const idx = text.indexOf(s);
    if (idx !== -1 && (earliestIndex === -1 || idx < earliestIndex)) {
      earliestIndex = idx;
      matchedSeq = s;
    }
  }

  if (earliestIndex !== -1) {
    return {
      text: text.slice(0, earliestIndex),
      stopped: true,
      stopSequence: matchedSeq
    };
  }

  return { text, stopped: false, stopSequence: null };
}

/**
 * Creates a streaming filter that buffers potential stop sequence prefixes and
 * truncates when a complete stop sequence is encountered.
 *
 * @param {string|string[]} stop
 * @param {(text: string) => void} onTextChunk
 * @returns {{ push: (chunk: string) => void, flush: () => void, isStopped: () => boolean }}
 */
export function createStreamingStopFilter(stop, onTextChunk) {
  if (!stop) {
    return {
      push: (text) => onTextChunk(text),
      flush: () => {},
      isStopped: () => false
    };
  }

  const stopList = (Array.isArray(stop) ? stop : [stop]).filter(s => typeof s === 'string' && s.length > 0);
  if (stopList.length === 0) {
    return {
      push: (text) => onTextChunk(text),
      flush: () => {},
      isStopped: () => false
    };
  }

  let buffer = '';
  let stopped = false;
  const maxStopLen = Math.max(...stopList.map(s => s.length));

  return {
    push: (chunk) => {
      if (stopped || !chunk) return;
      buffer += chunk;

      // Check if any stop sequence is fully present
      let earliestIdx = -1;
      for (const s of stopList) {
        const idx = buffer.indexOf(s);
        if (idx !== -1 && (earliestIdx === -1 || idx < earliestIdx)) {
          earliestIdx = idx;
        }
      }

      if (earliestIdx !== -1) {
        stopped = true;
        const textToEmit = buffer.slice(0, earliestIdx);
        if (textToEmit) onTextChunk(textToEmit);
        buffer = '';
        return;
      }

      // Check if tail matches prefix of any stop sequence
      let keepLen = 0;
      for (let len = Math.min(buffer.length, maxStopLen - 1); len > 0; len--) {
        const tail = buffer.slice(-len);
        if (stopList.some(s => s.startsWith(tail))) {
          keepLen = len;
          break;
        }
      }

      const emitLen = buffer.length - keepLen;
      if (emitLen > 0) {
        const textToEmit = buffer.slice(0, emitLen);
        onTextChunk(textToEmit);
        buffer = buffer.slice(emitLen);
      }
    },
    flush: () => {
      if (!stopped && buffer.length > 0) {
        onTextChunk(buffer);
        buffer = '';
      }
    },
    isStopped: () => stopped
  };
}
