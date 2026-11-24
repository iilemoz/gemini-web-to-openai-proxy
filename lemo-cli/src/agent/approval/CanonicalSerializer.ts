/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) Serializer
 * Produces deterministic, byte-for-byte canonical JSON representations.
 */

export function canonicalize(obj: unknown): string {
  if (obj === null) {
    return 'null';
  }

  const type = typeof obj;

  if (type === 'boolean') {
    return obj ? 'true' : 'false';
  }

  if (type === 'number') {
    if (!Number.isFinite(obj)) {
      throw new TypeError('Cannot canonicalize non-finite numbers (NaN, Infinity)');
    }
    // Number formatting in ES6 matches RFC 8785 specification
    return JSON.stringify(obj);
  }

  if (type === 'string') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    const elements = obj.map((item) => {
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol') {
        return 'null';
      }
      return canonicalize(item);
    });
    return `[${elements.join(',')}]`;
  }

  if (type === 'object') {
    // If object has a toJSON method, call it first
    const target = typeof (obj as { toJSON?: unknown }).toJSON === 'function'
      ? (obj as { toJSON: () => unknown }).toJSON()
      : obj;

    if (target === null || typeof target !== 'object') {
      return canonicalize(target);
    }

    const record = target as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((k) => {
        const val = record[k];
        return val !== undefined && typeof val !== 'function' && typeof val !== 'symbol';
      })
      .sort(); // Lexicographical UTF-16 code unit sort (RFC 8785 Section 3.2.3)

    const entries = keys.map((key) => {
      const valStr = canonicalize(record[key]);
      return `${JSON.stringify(key)}:${valStr}`;
    });

    return `{${entries.join(',')}}`;
  }

  throw new TypeError(`Unsupported type for canonicalization: ${type}`);
}
