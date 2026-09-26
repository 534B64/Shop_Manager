import { describe, it, expect } from 'vitest';
import { describeOverShort, previewOverShort } from './overShort';

describe('over/short wording', () => {
  it('says over, short or even with a sign — not color alone', () => {
    expect(describeOverShort(250)).toEqual({ tone: 'over', text: 'Over by $2.50', signed: '+$2.50' });
    expect(describeOverShort(-50)).toEqual({ tone: 'short', text: 'Short by $0.50', signed: '−$0.50' });
    expect(describeOverShort(0)?.tone).toBe('even');
    expect(describeOverShort(null)).toBeNull();
  });

  it('previews counted − expected', () => {
    expect(previewOverShort(16000, 15950)).toBe(-50);
    expect(previewOverShort(16000, null)).toBeNull();
  });
});
