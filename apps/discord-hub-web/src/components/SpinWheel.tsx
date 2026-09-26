import { cn } from "@clanker/ui/lib/utils";
import { animate, motion, useMotionValue, useMotionValueEvent } from "framer-motion";
import { memo, useEffect, useId, useMemo, useRef, useState } from "react";

function polarToCartesian(cx: number, cy: number, r: number, angleRad: number) {
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
}

function wedgePath(params: {
  cx: number;
  cy: number;
  r: number;
  startRad: number;
  endRad: number;
}) {
  const { cx, cy, r, startRad, endRad } = params;
  const p1 = polarToCartesian(cx, cy, r, startRad);
  const p2 = polarToCartesian(cx, cy, r, endRad);
  const largeArc = endRad - startRad > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${p1.x} ${p1.y} A ${r} ${r} 0 ${largeArc} 1 ${p2.x} ${p2.y} Z`;
}

/** Repeating fairground palette: yellow → red → blue → green */
const SLICE_PALETTE = [
  { fill: "#facc15", textDark: true },
  { fill: "#dc2626", textDark: false },
  { fill: "#2563eb", textDark: false },
  { fill: "#16a34a", textDark: true },
] as const;

const EMPTY_SLICE = { fill: "#9ca3af", textDark: false } as const;

function sliceIndexAtRightPointer(rotationDeg: number, sliceCount: number): number {
  if (sliceCount <= 0) return 0;
  const span = 360 / sliceCount;
  const fromTop = ((90 - rotationDeg) % 360 + 360) % 360;
  return Math.min(sliceCount - 1, Math.max(0, Math.floor(fromTop / span)));
}

export type SpinWheelProps = {
  participants: readonly string[];
  emptySliceLabel: string;
  rotationDeg: number;
  highlightIndex: number | null;
  spinning: boolean;
  /**
   * When set (≥2 angles in degrees), animates through these keyframes instead of a single target
   * (e.g. fake stop → roll back → real winner). Last value should match `rotationDeg`.
   */
  resolveKeyframes?: readonly number[] | null;
  /** Timeline positions for each keyframe, e.g. [0, 0.44, 1]. Defaults to evenly spaced. */
  resolveKeyframeTimes?: readonly number[] | null;
  /** Duration in seconds for the resolve animation. Defaults to 1.12. */
  resolveKeyframeDuration?: number | null;
  onAnimationComplete?: () => void;
  /** Click / tap the wheel (e.g. same action as spin-only). */
  onSpinRequest?: () => void;
  spinDisabled?: boolean;
  spinAriaLabel?: string;
  className?: string;
};

function SpinWheelInner(props: SpinWheelProps) {
  const {
    participants,
    emptySliceLabel,
    rotationDeg,
    highlightIndex,
    spinning,
    resolveKeyframes = null,
    resolveKeyframeTimes = null,
    resolveKeyframeDuration = null,
    onAnimationComplete,
    onSpinRequest,
    spinDisabled = false,
    spinAriaLabel = "Spin",
    className,
  } = props;

  const onCompleteRef = useRef(onAnimationComplete);
  onCompleteRef.current = onAnimationComplete;

  const uid = useId().replace(/:/g, "");
  const fid = `hw-${uid}`;

  const isEmpty = participants.length === 0;
  const labels = isEmpty ? [emptySliceLabel] : participants;
  const slices = Math.max(1, labels.length);
  const r = 176;
  const cx = 200;
  const cy = 200;

  const rotate = useMotionValue(rotationDeg);
  const spinningRef = useRef(spinning);
  spinningRef.current = spinning;

  const slicesRef = useRef(slices);
  slicesRef.current = slices;

  const [pointerSliceIndex, setPointerSliceIndex] = useState(() =>
    sliceIndexAtRightPointer(rotationDeg, slices),
  );

  useMotionValueEvent(rotate, "change", (v) => {
    setPointerSliceIndex(sliceIndexAtRightPointer(v, slicesRef.current));
  });

  useEffect(() => {
    setPointerSliceIndex(sliceIndexAtRightPointer(rotate.get(), slices));
  }, [slices]);

  useEffect(() => {
    if (resolveKeyframes && resolveKeyframes.length >= 2) {
      const n = resolveKeyframes.length;
      const times = resolveKeyframeTimes ?? Array.from({ length: n }, (_, i) => i / (n - 1));
      const segCount = n - 1;
      const ease = Array.from({ length: segCount }, (_, i) =>
        i === 0
          ? ([0.45, 0, 0.55, 1] as [number, number, number, number])
          : ([0.25, 0.1, 0.25, 1.0] as [number, number, number, number]),
      );
      const controls = animate(rotate, [...resolveKeyframes], {
        duration: resolveKeyframeDuration ?? 1.12,
        times: [...times],
        ease,
      });
      void controls
        .then(() => {
          onCompleteRef.current?.();
        })
        .catch(() => {
          /* stopped by cleanup / replaced animation */
        });
      return () => controls.stop();
    }

    const longSpin = spinningRef.current;
    const duration = longSpin ? 2.8 : 0.35;
    const ease = longSpin ? ([0.12, 0.92, 0.18, 1] as const) : "easeOut";
    const controls = animate(rotate, rotationDeg, { duration, ease });
    void controls
      .then(() => {
        onCompleteRef.current?.();
      })
      .catch(() => {
        /* stopped by cleanup / replaced animation */
      });
    return () => controls.stop();
  }, [rotate, rotationDeg, resolveKeyframes]);

  const dimNonWinners = !spinning && highlightIndex !== null;

  const segments = useMemo(() => {
    const sliceRad = (2 * Math.PI) / slices;
    const startBase = -Math.PI / 2;
    return labels.map((label, i) => {
      const startRad = startBase + i * sliceRad;
      const endRad = startBase + (i + 1) * sliceRad;
      const midRad = (startRad + endRad) / 2;
      const meta = isEmpty ? EMPTY_SLICE : SLICE_PALETTE[i % SLICE_PALETTE.length]!;
      const fullDisc = slices === 1;
      return {
        i,
        label,
        path: fullDisc ? "" : wedgePath({ cx, cy, r, startRad, endRad }),
        fullDisc,
        midRad,
        fill: meta.fill,
        textDark: meta.textDark,
        empty: isEmpty,
      };
    });
  }, [isEmpty, labels, slices]);

  const pointerFill = isEmpty
    ? EMPTY_SLICE.fill
    : SLICE_PALETTE[pointerSliceIndex % SLICE_PALETTE.length]!.fill;

  return (
    <div
      className={[
        "relative mx-auto w-full select-none",
        className ?? "max-w-[min(100%,34rem)]",
      ].join(" ")}
    >
      <div className="pointer-events-none absolute right-0 top-1/2 z-10 -translate-y-1/2 translate-x-[2px]">
        <div
          className="h-0 w-0 border-y-[12px] border-y-transparent border-r-[22px] drop-shadow-[2px_0_4px_rgba(0,0,0,0.35)]"
          style={{ borderRightColor: pointerFill }}
        />
      </div>

      <div className="relative aspect-square w-full">
        <motion.div
          className="pointer-events-none absolute inset-0"
          style={{ rotate, transformOrigin: "50% 50%" }}
        >
          <svg viewBox="0 0 400 400" className="h-full w-full">
            <defs>
              <filter id={`${fid}-wheel-shadow`} x="-35%" y="-35%" width="170%" height="170%">
                <feDropShadow dx="0" dy="8" stdDeviation="10" floodColor="#000" floodOpacity="0.28" />
              </filter>
            </defs>

            <g filter={`url(#${fid}-wheel-shadow)`}>
              <g>
                {segments.map((seg) =>
                  seg.fullDisc ? (
                    <circle
                      key={seg.i}
                      cx={cx}
                      cy={cy}
                      r={r}
                      fill={seg.fill}
                      stroke="none"
                      opacity={
                        seg.empty
                          ? 0.92
                          : dimNonWinners && highlightIndex !== seg.i
                            ? 0.45
                            : 1
                      }
                    />
                  ) : (
                    <path
                      key={seg.i}
                      d={seg.path}
                      fill={seg.fill}
                      stroke="none"
                      opacity={
                        seg.empty
                          ? 0.92
                          : dimNonWinners && highlightIndex !== seg.i
                            ? 0.45
                            : 1
                      }
                    />
                  ),
                )}
              </g>

              <g
                fontFamily="ui-sans-serif, system-ui, sans-serif"
                fontWeight={700}
                letterSpacing="0.01em"
              >
                {segments.map((seg) => {
                  const labelR = r * 0.62;
                  const tx = cx + labelR * Math.cos(seg.midRad);
                  const ty = cy + labelR * Math.sin(seg.midRad);
                  const rotDeg = (seg.midRad * 180) / Math.PI;
                  const fill = seg.textDark ? "#171717" : "#fafafa";
                  const strokeCol = seg.textDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.25)";
                  return (
                    <g
                      key={`t-${seg.i}`}
                      transform={`translate(${tx}, ${ty}) rotate(${rotDeg})`}
                      opacity={seg.empty ? 1 : dimNonWinners && highlightIndex !== seg.i ? 0.55 : 1}
                    >
                      <text
                        x={0}
                        y={0}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill={fill}
                        fontSize={seg.empty ? 13 : slices > 12 ? 10 : slices > 8 ? 11 : 12}
                        style={{ paintOrder: "stroke", stroke: strokeCol, strokeWidth: 0.7 }}
                      >
                        {seg.label.length > 16 ? `${seg.label.slice(0, 16)}…` : seg.label}
                      </text>
                    </g>
                  );
                })}
              </g>

              <circle cx={cx} cy={cy} r={52} fill="#ffffff" />
            </g>
          </svg>
        </motion.div>
        {onSpinRequest ? (
          <button
            type="button"
            aria-label={spinAriaLabel}
            disabled={spinDisabled}
            onClick={() => onSpinRequest()}
            className={cn(
              "absolute inset-0 z-[6] rounded-full border-0 bg-transparent p-0 transition",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              spinDisabled
                ? "cursor-not-allowed"
                : "cursor-pointer hover:bg-foreground/[0.04] active:scale-[0.99] motion-reduce:active:scale-100",
            )}
          />
        ) : null}
      </div>
    </div>
  );
}

const SpinWheel = memo(SpinWheelInner);
export default SpinWheel;
