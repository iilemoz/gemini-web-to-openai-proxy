/**
 * Lemo Universal AI Backend API Client
 * Consumes OpenAI-compatible endpoints (/v1/models, /v1/chat/completions)
 * exposed by the Lemo Universal AI API Backend.
 */

import type { LemoConfig } from '../../core/types/config.js';
import type { BackendModel, ModelListResponse } from '../../core/types/models.js';
import type {
  ChatCompletionRequest,
  RequestOptions
} from '../types/request.js';
import type {
  ChatCompletionResponse,
  ApiErrorPayload
} from '../types/response.js';
import type { ChatCompletionChunk } from '../types/stream.js';
import {
  NetworkError,
  AuthenticationError,
  ModelError,
  ValidationError
} from '../../core/errors/index.js';
import { logger } from '../../core/logging/index.js';
import { parseSseStream } from './stream-parser.js';

export interface LemoApiClientOptions {
  /** Base URL of the backend (e.g. 'http://localhost:8080/v1' or 'http://localhost:8080') */
  baseUrl: string;
  /** Optional proxy API key */
  apiKey?: string | undefined;
  /** Request timeout in milliseconds (default: 30000) */
  timeoutMs?: number | undefined;
}

export class LemoApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;

  constructor(options: LemoApiClientOptions) {
    if (!options || typeof options.baseUrl !== 'string' || !options.baseUrl.trim()) {
      throw new ValidationError('LemoApiClient requires a valid baseUrl');
    }

    this.baseUrl = this.normalizeBaseUrl(options.baseUrl);
    this.apiKey = options.apiKey?.trim() || undefined;
    this.timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : 30000;
  }

  /**
   * Factory method to instantiate client from a LemoConfig instance.
   */
  public static fromConfig(config: LemoConfig): LemoApiClient {
    return new LemoApiClient({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      timeoutMs: config.timeoutMs
    });
  }

  /**
   * Normalizes the base URL, ensuring valid http/https protocol and stripping trailing slashes.
   */
  private normalizeBaseUrl(rawUrl: string): string {
    const trimmed = rawUrl.trim();
    let parsed: URL;

    try {
      parsed = new URL(trimmed);
    } catch {
      throw new ValidationError(`Invalid backend baseUrl: '${trimmed}'`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new ValidationError(`Unsupported protocol in backend baseUrl: '${parsed.protocol}'. Must be http: or https:`);
    }

    // Strip trailing slashes
    return trimmed.replace(/\/+$/, '');
  }

  /**
   * Resolves a target API path relative to baseUrl, avoiding duplicate /v1 prefixes.
   */
  public resolveEndpoint(path: string): string {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const baseHasV1 = this.baseUrl.endsWith('/v1');

    if (baseHasV1) {
      if (cleanPath.startsWith('/v1/')) {
        return `${this.baseUrl}${cleanPath.slice(3)}`;
      }
      return `${this.baseUrl}${cleanPath}`;
    }

    if (cleanPath.startsWith('/v1/')) {
      return `${this.baseUrl}${cleanPath}`;
    }

    return `${this.baseUrl}/v1${cleanPath}`;
  }

  /**
   * Builds default headers for API requests.
   * Authorization header is attached if apiKey is configured.
   */
  private buildHeaders(accept: string, customHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': accept,
      ...customHeaders
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    return headers;
  }

  /**
   * Combines external signal with internal timeout abort controller.
   */
  private createSignalWithTimeout(timeoutMs?: number, externalSignal?: AbortSignal) {
    const effectiveTimeout = timeoutMs && timeoutMs > 0 ? timeoutMs : this.timeoutMs;
    const controller = new AbortController();
    let didTimeout = false;

    const timer = setTimeout(() => {
      didTimeout = true;
      controller.abort(new Error(`Request timed out after ${effectiveTimeout}ms`));
    }, effectiveTimeout);

    const onExternalAbort = () => {
      controller.abort(externalSignal?.reason || new Error('Request was cancelled'));
    };

    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort(externalSignal.reason);
      } else {
        externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }

    const cleanup = () => {
      clearTimeout(timer);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
    };

    return {
      signal: controller.signal,
      cleanup,
      didTimeout: () => didTimeout,
      effectiveTimeout
    };
  }

  /**
   * Executes an HTTP request with error normalization and secret-safe error reporting.
   */
  private async executeFetch(
    url: string,
    init: RequestInit,
    timeoutMs?: number,
    externalSignal?: AbortSignal
  ): Promise<Response> {
    const { signal, cleanup, didTimeout, effectiveTimeout } = this.createSignalWithTimeout(timeoutMs, externalSignal);

    try {
      logger.debug(`[ApiClient] Request: ${init.method || 'GET'} ${url}`);
      const res = await fetch(url, {
        ...init,
        signal
      });
      return res;
    } catch (err: unknown) {
      if (didTimeout()) {
        throw new NetworkError(`Request timed out after ${effectiveTimeout}ms`, 408);
      }
      if (externalSignal?.aborted) {
        throw new NetworkError('Request was aborted by caller', undefined, externalSignal.reason);
      }

      const cause = (err as { cause?: { code?: string } })?.cause?.code || '';
      const errMsg = err instanceof Error ? err.message : String(err);
      const detail = cause ? ` (${cause})` : '';

      throw new NetworkError(
        `Failed to connect to backend at ${url}${detail}: ${errMsg}`,
        undefined,
        err
      );
    } finally {
      cleanup();
    }
  }

  /**
   * Parses backend error responses and maps them to appropriate typed errors.
   */
  private async handleHttpError(response: Response, endpoint: string): Promise<never> {
    const status = response.status;
    let errorMessage = `HTTP ${status} on ${endpoint}`;
    let errorCode: string | undefined;

    try {
      const body = await response.json() as ApiErrorPayload;
      if (body?.error?.message) {
        errorMessage = body.error.message;
        errorCode = body.error.code;
      }
    } catch {
      // Fallback to text if body is not JSON
      try {
        const text = await response.text();
        if (text) {
          errorMessage = text.slice(0, 300);
        }
      } catch {
        // Response cannot be read
      }
    }

    if (status === 401) {
      throw new AuthenticationError(errorMessage || 'Authentication failed. Please check your Lemo API key.');
    }

    if (status === 404 && errorCode === 'model_not_found') {
      throw new ModelError(errorMessage);
    }

    throw new NetworkError(errorMessage, status, { code: errorCode });
  }

  /**
   * Retrieves list of registered models from backend.
   * Endpoint: GET /v1/models
   */
  public async listModels(options?: RequestOptions): Promise<BackendModel[]> {
    const url = this.resolveEndpoint('/models');
    const headers = this.buildHeaders('application/json', options?.headers);

    const response = await this.executeFetch(
      url,
      {
        method: 'GET',
        headers
      },
      options?.timeoutMs,
      options?.signal
    );

    if (!response.ok) {
      await this.handleHttpError(response, '/v1/models');
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (parseErr) {
      throw new NetworkError(
        'Backend returned malformed JSON from /v1/models',
        response.status,
        parseErr
      );
    }

    const payload = json as ModelListResponse;
    if (!payload || !Array.isArray(payload.data)) {
      throw new NetworkError(
        'Invalid model list response format: expected object with "data" array',
        response.status,
        payload
      );
    }

    return payload.data;
  }

  /**
   * Executes a non-streaming chat completion request.
   * Endpoint: POST /v1/chat/completions
   */
  public async createChatCompletion(
    request: ChatCompletionRequest,
    options?: RequestOptions
  ): Promise<ChatCompletionResponse> {
    const url = this.resolveEndpoint('/chat/completions');
    const headers = this.buildHeaders('application/json', options?.headers);

    const bodyPayload = {
      ...request,
      stream: false
    };

    const response = await this.executeFetch(
      url,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyPayload)
      },
      options?.timeoutMs,
      options?.signal
    );

    if (!response.ok) {
      await this.handleHttpError(response, '/v1/chat/completions');
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (parseErr) {
      throw new NetworkError(
        'Backend returned malformed JSON from /v1/chat/completions',
        response.status,
        parseErr
      );
    }

    return json as ChatCompletionResponse;
  }

  /**
   * Initiates an SSE streaming chat completion request.
   * Returns an AsyncIterable yielding ChatCompletionChunk instances.
   * Endpoint: POST /v1/chat/completions
   */
  public async createChatCompletionStream(
    request: ChatCompletionRequest,
    options?: RequestOptions
  ): Promise<AsyncIterable<ChatCompletionChunk>> {
    const url = this.resolveEndpoint('/chat/completions');
    const headers = this.buildHeaders('text/event-stream', options?.headers);

    const bodyPayload = {
      ...request,
      stream: true
    };

    const response = await this.executeFetch(
      url,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyPayload)
      },
      options?.timeoutMs,
      options?.signal
    );

    if (!response.ok) {
      await this.handleHttpError(response, '/v1/chat/completions (stream)');
    }

    if (!response.body) {
      throw new NetworkError(
        'Streaming response has no readable body',
        response.status
      );
    }

    // Node 22 fetch response.body implements AsyncIterable<Uint8Array>
    return parseSseStream(response.body as unknown as AsyncIterable<Uint8Array>, options?.signal);
  }
}
