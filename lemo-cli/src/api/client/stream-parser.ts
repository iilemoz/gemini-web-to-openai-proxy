/**
 * Server-Sent Events (SSE) Stream Parser for Lemo CLI
 * Decodes and parses OpenAI-compatible streaming chunks from the Lemo Backend.
 */

import type { ChatCompletionChunk } from '../types/stream.js';
import { logger } from '../../core/logging/index.js';

/**
 * Parses an SSE byte stream into strongly-typed ChatCompletionChunk objects.
 * Handles:
 * - Network chunk fragmentation across event boundaries
 * - Multiple events in a single network chunk
 * - Empty lines and SSE comment lines (`:`)
 * - Final `[DONE]` termination marker
 * - Malformed JSON data recovery
 * - External AbortSignal cancellation
 *
 * @param byteStream Async iterable of byte chunks (e.g. res.body)
 * @param signal Optional AbortSignal for stream cancellation
 */
export async function* parseSseStream(
  byteStream: AsyncIterable<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<ChatCompletionChunk, void, unknown> {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  for await (const chunk of byteStream) {
    if (signal?.aborted) {
      return;
    }

    buffer += decoder.decode(chunk, { stream: true });

    // Split on either CRLF or LF
    const lines = buffer.split(/\r?\n/);
    // The trailing piece may be an incomplete line; hold it in buffer for the next chunk
    buffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      if (signal?.aborted) {
        return;
      }

      const line = rawLine.trim();

      // Ignore empty lines or SSE comment lines
      if (!line || line.startsWith(':')) {
        continue;
      }

      if (line.startsWith('data:')) {
        const data = line.slice(5).trim();

        if (data === '[DONE]') {
          return;
        }

        try {
          const chunkObj = JSON.parse(data) as ChatCompletionChunk;
          yield chunkObj;
        } catch {
          logger.debug(`[SSE Parser] Ignored malformed event data: ${data}`);
        }
      }
    }
  }

  // Handle trailing data after stream closes if any
  if (buffer.trim()) {
    const line = buffer.trim();
    if (line.startsWith('data:')) {
      const data = line.slice(5).trim();
      if (data !== '[DONE]') {
        try {
          const chunkObj = JSON.parse(data) as ChatCompletionChunk;
          yield chunkObj;
        } catch {
          logger.debug(`[SSE Parser] Ignored malformed trailing event data: ${data}`);
        }
      }
    }
  }
}

/**
 * Convenience helper to extract plain text delta content from a stream of chunks.
 */
export async function* extractDeltaText(
  chunkStream: AsyncIterable<ChatCompletionChunk>
): AsyncGenerator<string, void, unknown> {
  for await (const chunk of chunkStream) {
    const content = chunk.choices?.[0]?.delta?.content;
    if (typeof content === 'string' && content.length > 0) {
      yield content;
    }
  }
}
