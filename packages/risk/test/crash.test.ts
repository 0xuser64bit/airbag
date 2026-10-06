import { describe, expect, it } from 'vitest';
import {
  CRASH_BACK_AT,
  CRASH_FILL_AT,
  CRASH_LINE_AT,
  CRASH_LIQ_AT,
  CRASH_PATH,
} from '../src/crash.ts';

describe('crash path', () => {
  it('keeps the landing replay and the engine simulation on one shared path', () => {
    expect(CRASH_PATH).toHaveLength(41);
    expect([CRASH_LINE_AT, CRASH_FILL_AT, CRASH_LIQ_AT, CRASH_BACK_AT]).toEqual([14, 15, 21, 38]);
    expect([CRASH_PATH[14], CRASH_PATH[15], CRASH_PATH[21], CRASH_PATH[38]]).toEqual([
      97000, 97000, 94000, 100000,
    ]);
    expect(CRASH_PATH[0]).toBe(100000);
    expect(CRASH_PATH.at(-1)).toBe(100000);
  });
});
