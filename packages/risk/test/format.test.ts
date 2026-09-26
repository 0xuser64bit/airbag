import { describe, expect, it } from 'vitest';
import { fmt } from '../src/index.ts';

describe('display formatting', () => {
  it('prints money the way the design does', () => {
    expect(fmt.usd(97_000)).toBe('$97,000');
    expect(fmt.usd(-1_467.15)).toBe('−$1,467');
    expect(fmt.usd(12.345)).toBe('$12.35');
    expect(fmt.usd(0.026311)).toBe('$0.02631');
    expect(fmt.usd(null)).toBe('—');
    expect(fmt.fee(undefined)).toBe('unconfirmed');
    expect(fmt.fee(0)).toBe('$0');
    expect(fmt.fee(16.425)).toBe('$16.43');
  });

  it('prints percentages, sizes, leverage and blocks', () => {
    expect(fmt.pct(0.0545)).toBe('5.45%');
    expect(fmt.pct(0.1)).toBe('10.00%');
    expect(fmt.pct(-0.0309)).toBe('−3.09%');
    expect(fmt.size(0.48905)).toBe('0.489');
    expect(fmt.size(1_200, 0)).toBe('1,200');
    expect(fmt.lev(13.857)).toBe('13.9x');
    expect(fmt.block(48_201_337)).toBe('#48,201,337');
    expect(fmt.short('0x9c4e00000000000000000000000000000000a71b')).toBe('0x9c4e…a71b');
  });

  it('prints durations', () => {
    expect(fmt.duration(300)).toBe('0.3 s');
    expect(fmt.duration(2_100)).toBe('2.1 s');
    expect(fmt.duration(40_000)).toBe('40 s');
    expect(fmt.duration(180_000)).toBe('3 min');
  });
});
