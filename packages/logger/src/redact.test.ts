import { describe, expect, it } from 'vitest';
import { REDACTED, redact, redactString } from './redact.js';

describe('redact', () => {
  it('replaces values under secret-looking keys', () => {
    const out = redact({ user: 'aman', password: 'hunter2', apiKey: 'abc', nested: { token: 'xyz' } }) as any;
    expect(out.user).toBe('aman');
    expect(out.password).toBe(REDACTED);
    expect(out.apiKey).toBe(REDACTED);
    expect(out.nested.token).toBe(REDACTED);
  });

  it('matches secret keys regardless of case and separators', () => {
    const out = redact({ 'client-secret': 'a', SECRET_KEY: 'b', sessionToken: 'c' }) as any;
    expect(Object.values(out)).toEqual([REDACTED, REDACTED, REDACTED]);
  });

  it('redacts kubeconfig credential blocks', () => {
    const out = redact({ 'client-key-data': 'LS0tLS1', 'certificate-authority-data': 'LS0t' }) as any;
    expect(out['client-key-data']).toBe(REDACTED);
    expect(out['certificate-authority-data']).toBe(REDACTED);
  });

  it('catches value-shaped secrets with innocent keys', () => {
    expect(redactString('id is AKIAIOSFODNN7EXAMPLE')).toContain('REDACTED');
    expect(redactString('Authorization: Bearer abcdefghijklmnopqrstuvwxyz')).toContain('Bearer REDACTED');
    expect(redactString('-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----')).toBe(
      'PRIVATE KEY REDACTED',
    );
  });

  it('drops managedFields, which is never wanted in a log', () => {
    const out = redact({ metadata: { name: 'pod', managedFields: [{ big: 'blob' }] } }) as any;
    expect(out.metadata.name).toBe('pod');
    expect(out.metadata.managedFields).toBeUndefined();
  });

  it('survives cycles and deep nesting without throwing', () => {
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic['self'] = cyclic;
    expect(() => redact(cyclic)).not.toThrow();
    expect((redact(cyclic) as any).self).toBe('[circular]');

    let deep: Record<string, unknown> = { end: true };
    for (let i = 0; i < 20; i += 1) deep = { deep };
    expect(() => redact(deep)).not.toThrow();
  });

  it('preserves errors while redacting their message', () => {
    const out = redact(new Error('failed with AKIAIOSFODNN7EXAMPLE')) as any;
    expect(out.name).toBe('Error');
    expect(out.message).toContain('REDACTED');
  });
});
