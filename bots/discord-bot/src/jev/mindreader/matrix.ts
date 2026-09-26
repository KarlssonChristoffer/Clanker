/**
 * P(yes | candidate, property) matrix for /tankeläsare, computed by Jev and cached in
 * bot.mindreader_matrix per model version. One Jev call per candidate: the candidate is the state
 * and every property is a Noul question. Warm-up runs in the background at startup and only fills
 * what is missing, so a restart costs nothing and a new JEV_MODEL recomputes once.
 */
import type { Queryable } from '../../db.js';
import type { Logger } from '../../core/logger.js';
import { isJevUnavailable, type JevClient } from '../client.js';
import { noul, type NoulQuestion } from '../types.js';
import { CANDIDATES, MATRIX_VERSION, PROPERTIES, type Candidate } from './data.js';

export function matrixKey(model: string): string {
  return `${model}#v${MATRIX_VERSION}`;
}

export type LoadedMatrix = { candidates: Candidate[]; matrix: number[][] };

/** Candidates with a value for every property (incomplete ones are left out of games). */
export async function loadMatrix(db: Queryable, model: string): Promise<LoadedMatrix> {
  const res = await db.query<{ candidate_id: string; property_id: string; p_yes: number }>(
    'SELECT candidate_id, property_id, p_yes FROM bot.mindreader_matrix WHERE model = $1',
    [matrixKey(model)],
  );
  const byCandidate = new Map<string, Map<string, number>>();
  for (const r of res.rows) {
    let m = byCandidate.get(r.candidate_id);
    if (!m) byCandidate.set(r.candidate_id, (m = new Map()));
    m.set(r.property_id, Number(r.p_yes));
  }
  const candidates: Candidate[] = [];
  const matrix: number[][] = [];
  for (const cand of CANDIDATES) {
    const row = byCandidate.get(cand.id);
    if (!row || PROPERTIES.some((p) => !row.has(p.id))) continue;
    candidates.push(cand);
    matrix.push(PROPERTIES.map((p) => row.get(p.id)!));
  }
  return { candidates, matrix };
}

export async function missingCandidates(db: Queryable, model: string): Promise<Candidate[]> {
  const res = await db.query<{ candidate_id: string; n: string }>(
    'SELECT candidate_id, count(*)::text AS n FROM bot.mindreader_matrix WHERE model = $1 GROUP BY candidate_id',
    [matrixKey(model)],
  );
  const complete = new Set(res.rows.filter((r) => Number(r.n) >= PROPERTIES.length).map((r) => r.candidate_id));
  return CANDIDATES.filter((cand) => !complete.has(cand.id));
}

function questionsFor(): Record<string, NoulQuestion> {
  return Object.fromEntries(PROPERTIES.map((p) => [p.id, noul(p.en, p.criteria)]));
}

export async function computeCandidate(db: Queryable, jev: JevClient, cand: Candidate): Promise<void> {
  const res = await jev.ask(
    { thing: cand.en, category: cand.category === 'wow' ? 'World of Warcraft' : cand.category },
    questionsFor(),
    { feature: 'mindreader-matrix' },
  );
  const key = matrixKey(jev.model);
  for (const prop of PROPERTIES) {
    const value = res.answers[prop.id]?.noul;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    await db.query(
      `INSERT INTO bot.mindreader_matrix (model, candidate_id, property_id, p_yes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (model, candidate_id, property_id) DO UPDATE SET p_yes = EXCLUDED.p_yes, computed_at = now()`,
      [key, cand.id, prop.id, Math.min(1, Math.max(0, value))],
    );
  }
}

/** Fills missing rows, two candidates at a time. Stops early when Jev is unavailable. */
export async function warmupMatrix(db: Queryable, jev: JevClient, log: Logger): Promise<{ computed: number; remaining: number }> {
  const missing = await missingCandidates(db, jev.model);
  if (!missing.length) {
    log.info({ model: jev.model }, 'mind-reader matrix already complete');
    return { computed: 0, remaining: 0 };
  }
  log.info({ model: jev.model, missing: missing.length }, 'warming up mind-reader matrix');
  let computed = 0;
  let stop = false;
  const queue = [...missing];
  const worker = async () => {
    while (!stop && queue.length) {
      const cand = queue.shift()!;
      try {
        await computeCandidate(db, jev, cand);
        computed += 1;
      } catch (err) {
        if (isJevUnavailable(err)) stop = true;
        log.warn({ err, candidate: cand.id }, 'mind-reader matrix: candidate failed');
      }
    }
  };
  await Promise.all([worker(), worker()]);
  const remaining = (await missingCandidates(db, jev.model)).length;
  log.info({ computed, remaining }, 'mind-reader matrix warm-up finished');
  return { computed, remaining };
}
