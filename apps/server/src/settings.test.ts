import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsStore } from './settings.ts';

/**
 * The store deep-merges, which is right for "change one field" and used to
 * make "remove one entry" impossible: an empty object merged to a no-op, so
 * handing a flag back wrote the same overrides straight back. `null` removes,
 * as JSON Merge Patch defines it.
 */
function store(): { settings: SettingsStore; clean: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'mjolnir-settings-'));
  return { settings: new SettingsStore(dir), clean: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('SettingsStore.update', () => {
  it('merges without disturbing its neighbours', () => {
    const { settings, clean } = store();
    try {
      settings.update({ flags: { overrides: { a: true, b: false } } });
      settings.update({ flags: { overrides: { c: true } } });
      expect(settings.get().flags.overrides).toEqual({ a: true, b: false, c: true });
      expect(settings.get().flags.remote.enabled).toBe(settings.get().flags.remote.enabled);
    } finally {
      clean();
    }
  });

  it('removes one entry when it is set to null', () => {
    const { settings, clean } = store();
    try {
      settings.update({ flags: { overrides: { a: true, b: false } } });
      settings.update({ flags: { overrides: { a: null } } });
      expect(settings.get().flags.overrides).toEqual({ b: false });
    } finally {
      clean();
    }
  });

  it('does not treat an empty object as a clear', () => {
    const { settings, clean } = store();
    try {
      settings.update({ flags: { overrides: { a: true } } });
      settings.update({ flags: { overrides: {} } });
      expect(settings.get().flags.overrides).toEqual({ a: true });
    } finally {
      clean();
    }
  });

  it('keeps a secret that comes back as the word "set"', () => {
    const { settings, clean } = store();
    try {
      settings.update({ ai: { apiKey: 'real-key' } });
      settings.update({ ai: { apiKey: 'set', model: 'other' } });
      expect(settings.get().ai.apiKey).toBe('real-key');
      expect(settings.get().ai.model).toBe('other');
    } finally {
      clean();
    }
  });
});
