import { describe, expect, it } from 'vitest';
import { plainNotes } from './updater.ts';

/**
 * Release notes, as a dialog can show them.
 *
 * They arrive from a manifest as whatever the release tool put there, which
 * is HTML about half the time and Markdown the rest. A dialog renders neither,
 * so tags in the middle of a sentence is what somebody reads while deciding
 * whether to restart what they are doing.
 */
describe('release notes in a dialog', () => {
  it('turns HTML into lines rather than showing the tags', () => {
    const notes = plainNotes('<h2>0.2.0</h2><ul><li>Time travel</li><li>Certificates</li></ul>');
    expect(notes).toBe('0.2.0\n- Time travel\n- Certificates');
  });

  it('keeps markdown readable without its punctuation', () => {
    expect(plainNotes('## 0.2.0\n\n- Time travel\n- Certificates')).toBe('0.2.0\n\n- Time travel\n- Certificates');
  });

  it('collapses the blank lines a generated changelog leaves behind', () => {
    expect(plainNotes('One\n\n\n\n\nTwo')).toBe('One\n\nTwo');
  });

  it('says nothing rather than "null" when a release had no notes', () => {
    // The manifest field is optional and electron-updater passes it through
    // as-is, so this is the normal case for a build cut in a hurry.
    expect(plainNotes(null)).toBe('');
    expect(plainNotes(undefined)).toBe('');
    expect(plainNotes('')).toBe('');
  });

  it('handles the line break tag every release tool emits differently', () => {
    expect(plainNotes('One<br>Two<br/>Three<BR />Four')).toBe('One\nTwo\nThree\nFour');
  });
});
