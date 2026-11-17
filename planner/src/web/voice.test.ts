import { describe, expect, it } from 'vitest';
import { splitSentences } from './voice';

describe('splitSentences', () => {
  it('splits replies into speakable chunks, merging tiny ones', () => {
    expect(splitSentences("Done, sir. I've moved the gym to tomorrow at 18:00. Anything else?")).toEqual([
      "Done, sir. I've moved the gym to tomorrow at 18:00.",
      'Anything else?',
    ]);
    expect(splitSentences('No punctuation at all')).toEqual(['No punctuation at all']);
    expect(splitSentences('One. Two! Three?')).toEqual(['One. Two! Three?']);
  });
});
