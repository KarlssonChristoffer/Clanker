import { describe, expect, it } from 'vitest';
import {
  eliminate,
  entropy,
  expectedInformationGain,
  likelihood,
  nextQuestion,
  normalise,
  shouldGuess,
  topK,
  uniform,
  update,
  type Answer,
  type Matrix,
} from '../src/jev/mindreader/engine.js';

// 4 candidates × 3 properties.
// p0 splits {0,1} vs {2,3}; p1 is 0.5 for everyone (useless); p2 singles out candidate 3.
const M: Matrix = [
  [1, 0.5, 0],
  [1, 0.5, 0],
  [0, 0.5, 0],
  [0, 0.5, 1],
];

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 10);

describe('likelihood with noise ε', () => {
  it('matches the formulas', () => {
    close(likelihood(1, 'yes', 0.1), 0.9);
    close(likelihood(0, 'yes', 0.1), 0.1);
    close(likelihood(1, 'no', 0.1), 0.1);
    close(likelihood(0.5, 'maybe', 0.1), 0.9);
    close(likelihood(1, 'maybe', 0.1), 0.1);
    expect(likelihood(0.3, 'unknown', 0.1)).toBe(1);
  });

  it('never reaches zero, so one wrong answer cannot eliminate the right candidate', () => {
    const post = update(uniform(4), M, 0, 'no', 0.1);
    expect(Math.min(...post)).toBeGreaterThan(0);
  });
});

describe('Bayesian update', () => {
  it('shifts mass towards candidates consistent with the answer', () => {
    const post = update(uniform(4), M, 0, 'yes', 0.1);
    close(post.reduce((a, b) => a + b, 0), 1);
    close(post[0]!, 0.45);
    close(post[2]!, 0.05);
  });

  it('ignores "unknown" and treats the useless property as neutral', () => {
    expect(update(uniform(4), M, 0, 'unknown')).toEqual(uniform(4));
    const post = update(uniform(4), M, 1, 'yes');
    post.forEach((p) => close(p, 0.25));
  });

  it('normalise falls back to uniform when everything is zero', () => {
    expect(normalise([0, 0])).toEqual([0.5, 0.5]);
  });
});

describe('information gain', () => {
  it('is zero for a property everyone shares and maximal for an even split', () => {
    close(expectedInformationGain(uniform(4), M, 1), 0);
    const split = expectedInformationGain(uniform(4), M, 0);
    const single = expectedInformationGain(uniform(4), M, 2);
    expect(split).toBeGreaterThan(single);
    expect(split).toBeLessThanOrEqual(entropy(uniform(4)));
  });

  it('picks the most informative unasked question', () => {
    expect(nextQuestion(uniform(4), M, new Set())).toBe(0);
    expect(nextQuestion(uniform(4), M, new Set([0]))).toBe(2);
    expect(nextQuestion(uniform(4), M, new Set([0, 1, 2]))).toBeNull();
  });
});

describe('game flow', () => {
  it('finds candidate 3 in two answers and decides to guess', () => {
    let post = uniform(4);
    const answers: [number, Answer][] = [
      [0, 'no'],
      [2, 'yes'],
    ];
    for (const [q, a] of answers) post = update(post, M, q, a, 0.1);
    expect(topK(post, 1)[0]!.index).toBe(3);
    expect(shouldGuess(post, 2)).toBe(true);
  });

  it('guesses anyway after 15 questions, and elimination removes a wrong guess', () => {
    expect(shouldGuess(uniform(4), 14)).toBe(false);
    expect(shouldGuess(uniform(4), 15)).toBe(true);
    const post = eliminate([0.7, 0.2, 0.1, 0], 0);
    close(post[0]!, 0);
    close(post[1]!, 2 / 3);
  });

  it('topK is sorted and stable', () => {
    expect(topK([0.1, 0.4, 0.4, 0.1], 3).map((x) => x.index)).toEqual([1, 2, 0]);
  });
});
