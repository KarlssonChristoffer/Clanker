/**
 * /tankeläsare maths (pure, no Discord, no I/O).
 *
 * The bot keeps a posterior π over candidates. Each property j has, per candidate c, a Jev-estimated
 * p = P(yes | c, j). Answers are noisy (people misremember, Jev misjudges), so with error rate ε:
 *
 *   L(yes | c)   = ε + (1 − 2ε) · p
 *   L(no | c)    = ε + (1 − 2ε) · (1 − p)
 *   L(maybe | c) = ε + (1 − 2ε) · (1 − |2p − 1|)     (favours candidates where the property is fuzzy)
 *   L(unknown)   = 1                                  (no information)
 *
 *   π'(c) ∝ π(c) · L(answer | c)
 *
 * The next question maximises expected information gain over yes/no:
 *   EIG(j) = H(π) − Σ_{a∈{yes,no}} P(a) · H(π | a),   P(a) = Σ_c π(c) · L(a | c) (renormalised)
 */

export type Answer = 'yes' | 'no' | 'maybe' | 'unknown';

/** matrix[candidate][property] = P(yes). */
export type Matrix = readonly (readonly number[])[];

export const DEFAULT_EPSILON = 0.1;
export const GUESS_THRESHOLD = 0.7;
export const MAX_QUESTIONS = 15;

export function likelihood(p: number, answer: Answer, eps = DEFAULT_EPSILON): number {
  const q = Math.min(1, Math.max(0, p));
  switch (answer) {
    case 'yes':
      return eps + (1 - 2 * eps) * q;
    case 'no':
      return eps + (1 - 2 * eps) * (1 - q);
    case 'maybe':
      return eps + (1 - 2 * eps) * (1 - Math.abs(2 * q - 1));
    case 'unknown':
      return 1;
  }
}

export function uniform(n: number): number[] {
  if (n <= 0) return [];
  return new Array<number>(n).fill(1 / n);
}

export function normalise(weights: readonly number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return uniform(weights.length);
  return weights.map((w) => w / total);
}

export function entropy(dist: readonly number[]): number {
  let h = 0;
  for (const p of dist) if (p > 0) h -= p * Math.log2(p);
  return h;
}

export function update(
  posterior: readonly number[],
  matrix: Matrix,
  property: number,
  answer: Answer,
  eps = DEFAULT_EPSILON,
): number[] {
  if (answer === 'unknown') return [...posterior];
  return normalise(posterior.map((pi, c) => pi * likelihood(matrix[c]![property]!, answer, eps)));
}

export function expectedInformationGain(
  posterior: readonly number[],
  matrix: Matrix,
  property: number,
  eps = DEFAULT_EPSILON,
): number {
  const h = entropy(posterior);
  let pYes = 0;
  let pNo = 0;
  const yes: number[] = [];
  const no: number[] = [];
  posterior.forEach((pi, c) => {
    const p = matrix[c]![property]!;
    const ly = pi * likelihood(p, 'yes', eps);
    const ln = pi * likelihood(p, 'no', eps);
    yes.push(ly);
    no.push(ln);
    pYes += ly;
    pNo += ln;
  });
  const total = pYes + pNo;
  if (!(total > 0)) return 0;
  return h - (pYes / total) * entropy(normalise(yes)) - (pNo / total) * entropy(normalise(no));
}

/** Best unasked property by expected information gain; ties → lowest index. Null when all are asked. */
export function nextQuestion(
  posterior: readonly number[],
  matrix: Matrix,
  asked: ReadonlySet<number>,
  eps = DEFAULT_EPSILON,
): number | null {
  const properties = matrix[0]?.length ?? 0;
  let best: number | null = null;
  let bestGain = -Infinity;
  for (let j = 0; j < properties; j++) {
    if (asked.has(j)) continue;
    const gain = expectedInformationGain(posterior, matrix, j, eps);
    if (gain > bestGain + 1e-12) {
      bestGain = gain;
      best = j;
    }
  }
  return best;
}

export function topK(posterior: readonly number[], k: number): { index: number; p: number }[] {
  return posterior
    .map((p, index) => ({ index, p }))
    .sort((a, b) => b.p - a.p || a.index - b.index)
    .slice(0, k);
}

export function shouldGuess(posterior: readonly number[], questionsAsked: number): boolean {
  const top = topK(posterior, 1)[0];
  return (top !== undefined && top.p > GUESS_THRESHOLD) || questionsAsked >= MAX_QUESTIONS;
}

/** After a wrong guess: remove the candidate and renormalise. */
export function eliminate(posterior: readonly number[], candidate: number): number[] {
  return normalise(posterior.map((p, i) => (i === candidate ? 0 : p)));
}
