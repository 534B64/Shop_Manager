import { describe, it, expect } from 'vitest';
import { autoRollWidth, trueRollWidth } from './rolls';

describe('roll usable width', () => {
  it('is the nominal width minus 1.5"', () => {
    expect(trueRollWidth(15)).toBe(13.5);
    expect(trueRollWidth(24)).toBe(22.5);
    expect(trueRollWidth(30)).toBe(28.5);
    expect(trueRollWidth(48)).toBe(46.5);
  });
});

describe('roll auto-select — least waste across either orientation', () => {
  it('25×13 picks the 15" roll (13 fits with 0.5" waste)', () => {
    expect(autoRollWidth(25, 13)).toBe(15);
    expect(autoRollWidth(13, 25)).toBe(15); // order independent
  });
  it('24×2 picks the 30" roll (24 across beats 2 across on waste)', () => {
    // 24 across: 30" roll usable 28.5 → 4.5" waste. 2 across: 15" roll → 11.5" waste.
    expect(autoRollWidth(24, 2)).toBe(30);
    expect(autoRollWidth(2, 24)).toBe(30);
  });
  it('small part takes the smallest roll', () => {
    expect(autoRollWidth(12, 12)).toBe(15); // 12 < 13.5 usable
  });
  it('single dimension still selects', () => {
    expect(autoRollWidth(20)).toBe(24); // 20 < 22.5 usable, 24 is smallest fit
  });
  it('oversized part falls back to the widest roll', () => {
    expect(autoRollWidth(50, 60)).toBe(48);
  });
  it('no usable dimensions → null', () => {
    expect(autoRollWidth()).toBeNull();
    expect(autoRollWidth(0, 0)).toBeNull();
  });
});
