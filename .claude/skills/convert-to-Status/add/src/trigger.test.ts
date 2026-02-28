import { describe, expect, it } from 'vitest';

import { ASSISTANT_NAME } from './config.js';
import { matchesGroupTrigger } from './trigger.js';

describe('matchesGroupTrigger', () => {
  it('matches a single trigger at message start', () => {
    expect(matchesGroupTrigger('@Assistant hello', '@Assistant')).toBe(true);
    expect(matchesGroupTrigger('hello @Assistant', '@Assistant')).toBe(false);
  });

  it('matches multiple triggers separated by |', () => {
    const trigger = '@Assistant|@0x04abc';
    expect(matchesGroupTrigger('@Assistant hi', trigger)).toBe(true);
    expect(matchesGroupTrigger('@0x04abc hi', trigger)).toBe(true);
    expect(matchesGroupTrigger('@Other hi', trigger)).toBe(false);
  });

  it('matches multiple triggers separated by comma', () => {
    const trigger = '@Assistant, @0x04abc';
    expect(matchesGroupTrigger('@0x04abc hi', trigger)).toBe(true);
  });

  it('falls back to configured assistant name when trigger is empty', () => {
    expect(matchesGroupTrigger(`@${ASSISTANT_NAME} ping`, '')).toBe(true);
  });
});
