/** Circuit breaker and semaphore used by the Jev client (pure; clock injectable for tests). */

export type BreakerState = 'closed' | 'open' | 'half-open';

/**
 * Opens after `threshold` consecutive failures and rejects calls for `openMs`. After that one trial
 * call is let through (half-open): success closes the breaker, failure opens it again.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private trialInFlight = false;

  constructor(
    private readonly threshold = 5,
    private readonly openMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  get state(): BreakerState {
    if (this.openedAt === null) return 'closed';
    return this.now() - this.openedAt >= this.openMs ? 'half-open' : 'open';
  }

  get consecutiveFailures(): number {
    return this.failures;
  }

  /** Milliseconds until a trial call is allowed (0 when closed/half-open). */
  get retryInMs(): number {
    if (this.openedAt === null) return 0;
    return Math.max(0, this.openMs - (this.now() - this.openedAt));
  }

  /** Returns false when the call must be rejected without contacting the API. */
  tryAcquire(): boolean {
    const state = this.state;
    if (state === 'closed') return true;
    if (state === 'open') return false;
    if (this.trialInFlight) return false;
    this.trialInFlight = true;
    return true;
  }

  onSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
    this.trialInFlight = false;
  }

  /** Ends a call that says nothing about API health (e.g. our own 422): frees a half-open trial slot. */
  release(): void {
    this.trialInFlight = false;
  }

  onFailure(): void {
    this.failures += 1;
    const wasTrial = this.trialInFlight;
    this.trialInFlight = false;
    if (wasTrial || this.failures >= this.threshold) {
      this.openedAt = this.now();
    }
  }
}

/** Limits concurrent work; waiters are served FIFO. */
export class Semaphore {
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly max: number) {
    if (max < 1) throw new Error('Semaphore max must be >= 1');
  }

  get inUse(): number {
    return this.active;
  }

  get waiting(): number {
    return this.queue.length;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    } else {
      this.active += 1;
    }
    try {
      return await fn();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active -= 1;
    }
  }
}
