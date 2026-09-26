/**
 * TypeSafe System One ("Jev") request/response types, as documented at docs.typesafe.ai (verified 2026-09-26).
 *
 *   POST {base}/v1/systemone   Authorization: Bearer <key>
 *   { state, model, questions: { [id]: Question } }  →  { model, answers: { [id]: Answer }, usage }
 *
 * Every question sees the same state and is evaluated independently (no answer feeds another).
 */

/** Anything JSON-serialisable; plain text or structured data. */
export type JevState = string | Record<string, unknown> | unknown[];
type Entry = string | Record<string, unknown> | unknown[];

export type NoulQuestion = {
  type: 'noul';
  instructions: Entry;
  criteria?: { true?: Entry; false?: Entry };
};

export type ChoiceQuestion<O extends string = string> = {
  type: 'choice';
  instructions: Entry;
  /** Option name → description (1–255 options). Names and descriptions are both sent to the model. */
  criteria: Record<O, Entry | null>;
};

export type ScoreQuestion = {
  type: 'score';
  instructions: Entry;
  /** Ordered low → high, 2–10 levels. The level number is the array index. */
  criteria: Entry[];
};

export type JevQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;
export type JevQuestions = Record<string, JevQuestion>;

export type NoulAnswer = { type: 'noul'; noul: number };
export type ChoiceAnswer<O extends string = string> = {
  type: 'choice';
  choice: O;
  probabilities: Record<O, number>;
  confidence: number;
};
export type ScoreAnswer = {
  type: 'score';
  /** Expected level Σ index × p, a float in [0, levels − 1]. */
  score: number;
  legend: Record<string, Entry>;
  probabilities: Record<string, number>;
  confidence: number;
};

type AnswerFor<Q> = Q extends NoulQuestion
  ? NoulAnswer
  : Q extends ChoiceQuestion<infer O>
    ? ChoiceAnswer<O>
    : Q extends ScoreQuestion
      ? ScoreAnswer
      : never;

export type JevAnswers<Q extends JevQuestions> = { [K in keyof Q]: AnswerFor<Q[K]> };

export type JevUsage = { input_tokens: number; output_tokens: number };

export type JevResponse<Q extends JevQuestions> = {
  model: string;
  answers: JevAnswers<Q>;
  usage: JevUsage;
  requestId: string | null;
  latencyMs: number;
};

/** Helpers so call sites keep literal option types. */
export function noul(instructions: Entry, criteria?: NoulQuestion['criteria']): NoulQuestion {
  return criteria ? { type: 'noul', instructions, criteria } : { type: 'noul', instructions };
}

export function choice<O extends string>(instructions: Entry, criteria: Record<O, Entry | null>): ChoiceQuestion<O> {
  return { type: 'choice', instructions, criteria };
}

export function score(instructions: Entry, criteria: Entry[]): ScoreQuestion {
  if (criteria.length < 2 || criteria.length > 10) throw new Error('score criteria must have 2–10 levels');
  return { type: 'score', instructions, criteria };
}
