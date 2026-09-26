import { useRef, useState } from "react";
import { cn } from "@clanker/ui/lib/utils";

export type MusicSeekProgressTrack = {
  duration_sec: number | null;
  is_paused: boolean;
  started_at: string;
};

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Progress bar for Discord bot music state. When `onSeek` is set, supports
 * click and drag-to-scrub via pointer capture (listeners attach synchronously
 * on pointerdown so quick clicks are not lost).
 */
export function MusicSeekProgressBar({
  track,
  nowMs,
  onSeek,
  timeTextClassName,
}: {
  track: MusicSeekProgressTrack;
  nowMs: number;
  onSeek?: (sec: number) => void;
  /** When set, overrides `text-muted-foreground` for elapsed/total labels */
  timeTextClassName?: string;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  /** Non-null while the user is holding the scrubber (pointer captured). */
  const [scrubPct, setScrubPct] = useState<number | null>(null);

  if (!track.duration_sec) {
    return (
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full w-full animate-pulse bg-primary/40" />
      </div>
    );
  }

  const elapsed = track.is_paused
    ? Math.min((new Date(track.started_at).getTime() - Date.now() + nowMs) / 1000, track.duration_sec)
    : Math.min((nowMs - new Date(track.started_at).getTime()) / 1000, track.duration_sec);
  const pct =
    scrubPct !== null
      ? scrubPct
      : Math.max(0, Math.min(100, (elapsed / track.duration_sec) * 100));
  const displaySec = (pct / 100) * track.duration_sec;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onSeek || e.button !== 0) return;
    e.preventDefault();
    const el = barRef.current;
    if (!el) return;

    const getPct = (clientX: number): number => {
      const rect = el.getBoundingClientRect();
      const w = rect.width;
      if (w <= 0) return 0;
      return Math.max(0, Math.min(100, ((clientX - rect.left) / w) * 100));
    };

    const pid = e.pointerId;
    el.setPointerCapture(pid);
    setScrubPct(getPct(e.clientX));

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      setScrubPct(getPct(ev.clientX));
    };

    const cleanup = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      try {
        if (el.hasPointerCapture(pid)) el.releasePointerCapture(pid);
      } catch {
        /* release may throw if node detached */
      }
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onCancel);
    };

    const onUp = (ev: PointerEvent) => {
      cleanup(ev);
      setScrubPct(null);
      const p = getPct(ev.clientX);
      onSeek(Math.round((p / 100) * (track.duration_sec ?? 0)));
    };

    const onCancel = (ev: PointerEvent) => {
      cleanup(ev);
      setScrubPct(null);
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onCancel);
  };

  return (
    <div className="space-y-1">
      <div
        ref={barRef}
        className={cn(
          "group relative h-1.5 w-full touch-none rounded-full bg-muted select-none",
          onSeek ? "cursor-pointer hover:h-2 transition-[height] duration-100" : "overflow-hidden",
        )}
        onPointerDown={handlePointerDown}
      >
        <div
          className="h-full rounded-full bg-primary/80"
          style={{ width: `${pct}%`, transition: scrubPct !== null ? "none" : "width 1s linear" }}
        />
        {onSeek && (
          <div
            className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary opacity-0 shadow transition-opacity group-hover:opacity-100"
            style={{ left: `${pct}%` }}
          />
        )}
      </div>
      <div
        className={cn(
          "flex justify-between text-[10px] tabular-nums text-muted-foreground",
          timeTextClassName,
        )}
      >
        <span>{fmtDuration(Math.max(0, displaySec))}</span>
        <span>{fmtDuration(track.duration_sec)}</span>
      </div>
    </div>
  );
}
