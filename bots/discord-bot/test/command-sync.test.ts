import { describe, expect, it } from 'vitest';
import { hashCommandDefinitions, stableStringify } from '../src/core/command-sync.js';

describe('command definition hashing', () => {
  it('ignores object key order and undefined values', () => {
    expect(stableStringify({ b: 1, a: [{ y: 2, x: 1 }], c: undefined })).toBe('{"a":[{"x":1,"y":2}],"b":1}');
  });

  it('changes when a definition changes', () => {
    const a = hashCommandDefinitions([{ name: 'ping', description: 'Pong' }]);
    const b = hashCommandDefinitions([{ description: 'Pong', name: 'ping' }]);
    const c = hashCommandDefinitions([{ name: 'ping', description: 'Pong!' }]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
