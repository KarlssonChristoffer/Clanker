import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  GridStack,
  type GridStackEngine,
  type GridStackMoveOpts,
  type GridStackNode,
  type GridStackOptions,
  type GridStackWidget,
} from "gridstack/dist/gridstack.js";
import { Button } from "@clanker/ui/components/button";
import { Card, CardContent } from "@clanker/ui/components/card";
import { Badge } from "@clanker/ui/components/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@clanker/ui/components/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@clanker/ui/components/context-menu";
import { cn } from "@clanker/ui/lib/utils";
import { Minus, Pencil, Plus, RotateCcw } from "lucide-react";
import { useHubLocale } from "@/components/locale-provider";
import { useTheme } from "@/components/theme-provider";
import { hubEnterMotion, hubPopMotion } from "@/lib/hub-motion";
import { hubContextData } from "@/lib/hub-shell-context";
import { classifyTarget, getCapabilities, type HubEntityCapabilities } from "@/lib/hub-shell-classification";
import {
  HUB_DESKTOP_LAYOUT_GRID,
  HUB_GRIDSTACK_WIDGET_MARGIN_PX,
  effectiveSnapStep,
  type HubDesktopWidgetLayout,
  type HubSnapStrength,
} from "@/lib/hub-desktop-layout";
import {
  DEFAULT_WIDGET_VISUAL_PREFS,
  effectiveWidgetTone,
  type HubGridCompaction,
  type HubWidgetVisualPrefs,
} from "@/lib/hub-prefs";
import { hubMotionDurationScale } from "@/lib/hub-motion";
import { clampWidgetDimensions, getHubWidgetSizeBounds } from "@/lib/hub-widget-size-bounds";

/** Outside layout mode: hold pointer still, then synthetic mousedown arms GridStack drag. */
const HUB_WIDGET_HOLD_MS = 420;
const HUB_WIDGET_HOLD_MOVE_CANCEL_PX = 14;
const HUB_WIDGET_HOLD_CANCEL_SELECTOR =
  'button,a[href],input,textarea,select,option,[contenteditable="true"],[role="button"],label,.ui-resizable-handle,.hub-widget-hide-toolbar,[data-hub-no-drag]';

/** `moveNode` is private in GridStack's typings, so an intersection with `GridStack` collapses to `never`. */
type GridStackWithMoveWrite = {
  engine: GridStackEngine;
  cellWidth(): number;
  getCellHeight(forcePixel?: boolean): number;
  moveNode(n: GridStackNode, m: GridStackMoveOpts): void;
  _writeAttr(el: HTMLElement, n: GridStackNode): void;
};

type GridStackEngineWithCache = GridStackEngine & {
  cacheRects(w: number, h: number, top: number, right: number, bottom: number, left: number): GridStackEngine;
};

type OutsideLayoutDragNode = GridStackNode & { _moving?: boolean };

/** Only one widget may be in a press-and-hold pickup at a time (aborts previous on new pointerdown). */
let hubWidgetHoldAbortGlobal: (() => void) | null = null;

/** Commit outside-layout pointer drag before a new hold (set by HubDesktopSurface). */
let hubExternalDragTeardownGlobal: (() => void) | null = null;

export type HubDesktopWidget = {
  id: string;
  label: string;
  description: string;
  tone: "useful" | "social" | "chaos";
  icon: ComponentType<{ className?: string }>;
  content: ReactNode;
};

export type HubDesktopContainer = {
  id: string;
  label: string;
  description: string;
  tone: "useful" | "social" | "chaos";
  icon: ComponentType<{ className?: string }>;
  content: ReactNode;
};

export type { HubDesktopWidgetLayout };

type HubSurfaceCardItem =
  | ({ kind: "widget"; hideable: true } & HubDesktopWidget)
  | ({ kind: "container"; hideable: false } & HubDesktopContainer);

function blurClass(blurStrength: 0 | 1 | 2 | 3): string {
  if (blurStrength === 0) return "";
  if (blurStrength === 1) return "backdrop-blur-sm";
  if (blurStrength === 3) return "backdrop-blur-xl";
  return "backdrop-blur";
}

function sizeMinH(sizePreset: HubWidgetVisualPrefs["sizePreset"]): number {
  if (sizePreset === "compact") return 120;
  if (sizePreset === "expanded") return 280;
  return 180;
}

function toneAccentClass(tone: "useful" | "social" | "chaos", withBorder: boolean): string {
  if (tone === "chaos") {
    return withBorder ? "border-destructive/40 bg-destructive/6" : "bg-destructive/6";
  }
  if (tone === "social") {
    return withBorder ? "border-secondary/40 bg-secondary/6" : "bg-secondary/6";
  }
  return "";
}


function DesktopWidgetCard({
  item,
  visualPrefs,
  layoutEditMode,
  onFocus,
  onHide,
  onSelect,
  itemCapabilities,
  outsideLayoutDragActive = false,
  onHoldDragReady,
  onEditWidget,
  onResetWidgetPosition,
  showWidgetBorder,
}: {
  item: HubSurfaceCardItem;
  visualPrefs: HubWidgetVisualPrefs;
  showWidgetBorder: boolean;
  layoutEditMode: boolean;
  onFocus: (id: string) => void;
  onHide: (id: string) => void;
  onSelect: (id: string, additive: boolean) => void;
  itemCapabilities: HubEntityCapabilities;
  outsideLayoutDragActive?: boolean;
  onHoldDragReady?: (info: { widgetId: string; pointerId: number; clientX: number; clientY: number }) => void;
  onEditWidget?: (id: string) => void;
  onResetWidgetPosition?: (id: string) => void;
}) {
  const { copy } = useHubLocale();
  const ds = copy.desktopSurface;
  const effectiveTone = effectiveWidgetTone(item.tone, visualPrefs.toneOverride);
  const cardOpacity = visualPrefs.glassOpacity / 100;
  const cardBgStyle = {
    backgroundColor: `color-mix(in oklab, var(--card) ${Math.round(cardOpacity * 100)}%, transparent)`,
  };

  const shellRef = useRef<HTMLDivElement | null>(null);
  const holdTimerRef = useRef(0);
  const holdOriginRef = useRef({ x: 0, y: 0 });
  const holdPointerIdRef = useRef(0);
  const lastPtrRef = useRef({ clientX: 0, clientY: 0, screenX: 0, screenY: 0 });
  const docListenersRef = useRef<{
    move: (e: PointerEvent) => void;
    end: () => void;
    wheel: () => void;
  } | null>(null);
  const activeHoldAbortRef = useRef<(() => void) | null>(null);
  const [holdPending, setHoldPending] = useState(false);

  const tearDownHoldDocListeners = useCallback(() => {
    const l = docListenersRef.current;
    if (!l) return;
    document.removeEventListener("pointermove", l.move);
    document.removeEventListener("pointerup", l.end);
    document.removeEventListener("pointercancel", l.end);
    document.removeEventListener("wheel", l.wheel, { capture: true });
    docListenersRef.current = null;
  }, []);

  useEffect(
    () => () => {
      const a = activeHoldAbortRef.current;
      if (a && hubWidgetHoldAbortGlobal === a) {
        hubWidgetHoldAbortGlobal = null;
        a();
      }
    },
    [],
  );

  const handleDragSurfacePointerDown = (event: ReactPointerEvent) => {
    if (!itemCapabilities.movable || !layoutEditMode) return;
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    onSelect(item.id, additive);
    onFocus(item.id);
  };

  const dragSurfaceActive = Boolean(itemCapabilities.movable && layoutEditMode);

  const onShellPointerDownCapture = (event: ReactPointerEvent) => {
    if (layoutEditMode) return;
    if (!itemCapabilities.movable) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const t = event.target;
    if (t instanceof Element && t.closest(HUB_WIDGET_HOLD_CANCEL_SELECTOR)) return;

    const surface = shellRef.current?.querySelector<HTMLElement>(".hub-widget-drag-surface");
    if (!surface) return;

    hubExternalDragTeardownGlobal?.();
    hubWidgetHoldAbortGlobal?.();

    function abortThisHold() {
      if (hubWidgetHoldAbortGlobal === abortThisHold) {
        hubWidgetHoldAbortGlobal = null;
      }
      activeHoldAbortRef.current = null;
      if (holdTimerRef.current) {
        window.clearTimeout(holdTimerRef.current);
        holdTimerRef.current = 0;
      }
      setHoldPending(false);
      tearDownHoldDocListeners();
    }

    activeHoldAbortRef.current = abortThisHold;
    hubWidgetHoldAbortGlobal = abortThisHold;

    holdPointerIdRef.current = event.pointerId;
    holdOriginRef.current = { x: event.clientX, y: event.clientY };
    lastPtrRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      screenX: event.screenX,
      screenY: event.screenY,
    };
    setHoldPending(true);

    const onMove = (e: PointerEvent) => {
      lastPtrRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        screenX: e.screenX,
        screenY: e.screenY,
      };
      const o = holdOriginRef.current;
      if (Math.abs(e.clientX - o.x) + Math.abs(e.clientY - o.y) > HUB_WIDGET_HOLD_MOVE_CANCEL_PX) {
        abortThisHold();
      }
    };

    const onEnd = () => {
      abortThisHold();
    };

    const onWheel = () => {
      abortThisHold();
    };

    docListenersRef.current = { move: onMove, end: onEnd, wheel: onWheel };
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerup", onEnd);
    document.addEventListener("pointercancel", onEnd);
    document.addEventListener("wheel", onWheel, { passive: true, capture: true });

    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = 0;
      if (hubWidgetHoldAbortGlobal === abortThisHold) {
        hubWidgetHoldAbortGlobal = null;
      }
      activeHoldAbortRef.current = null;
      tearDownHoldDocListeners();
      setHoldPending(false);

      const { clientX, clientY } = lastPtrRef.current;
      const pid = holdPointerIdRef.current;
      onHoldDragReady?.({ widgetId: item.id, pointerId: pid, clientX, clientY });
      onFocus(item.id);
    }, HUB_WIDGET_HOLD_MS);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={shellRef}
          className="group h-full [container-type:inline-size] [container-name:widget]"
          onPointerDownCapture={onShellPointerDownCapture}
          {...hubContextData({
            type: "widget",
            widgetId: item.id,
            widgetLabel: item.label,
            widgetTone: item.tone,
          })}
        >
          <Card
            className={cn(
              "relative h-full rounded-[1.4rem] shadow-sm transition",
              showWidgetBorder
                ? "border border-border/70 hover:-translate-y-0.5 hover:border-border/90 hover:shadow-md motion-reduce:hover:translate-y-0"
                : "border-0 hover:-translate-y-0.5 hover:shadow-md motion-reduce:hover:translate-y-0",
              blurClass(visualPrefs.blurStrength),
              toneAccentClass(effectiveTone, showWidgetBorder),
              holdPending &&
                !layoutEditMode &&
                itemCapabilities.movable &&
                "cursor-grab ring-2 ring-primary/35 motion-reduce:cursor-default",
              outsideLayoutDragActive &&
                !layoutEditMode &&
                itemCapabilities.movable &&
                "cursor-grabbing transition-none duration-0 motion-reduce:cursor-auto",
            )}
            style={{ ...cardBgStyle, minHeight: sizeMinH(visualPrefs.sizePreset) }}
          >
            {/* GridStack drag handle — pointer-events only in layout mode; normal mode uses hold → synthetic mousedown */}
            {itemCapabilities.movable ? (
              <div
                className={cn(
                  "hub-widget-drag-surface absolute inset-0 z-[25] rounded-[1.4rem]",
                  dragSurfaceActive
                    ? "cursor-grab touch-manipulation active:cursor-grabbing"
                    : "pointer-events-none",
                )}
                onPointerDown={handleDragSurfacePointerDown}
                aria-hidden={!dragSurfaceActive}
                aria-label={dragSurfaceActive ? ds.dragAria(item.label) : undefined}
              />
            ) : null}
            {/* Hide control — above drag surface */}
            {itemCapabilities.hideable ? (
              <div
                className={cn(
                  "hub-widget-hide-toolbar absolute top-2 right-2 z-30 flex items-center gap-1 transition-opacity",
                  layoutEditMode ? "opacity-0 group-hover:opacity-100" : "opacity-0 pointer-events-none",
                )}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onHide(item.id)}
                      aria-label={ds.hideAria(item.label)}
                    >
                      <Minus />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{ds.hideTooltip}</TooltipContent>
                </Tooltip>
              </div>
            ) : null}
            <CardContent className="relative z-20 h-full overflow-hidden p-5 [container-type:inline-size] [container-name:widget]">{item.content}</CardContent>
          </Card>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>{item.label}</ContextMenuLabel>
        <ContextMenuSeparator />
        {onEditWidget ? (
          <ContextMenuItem onSelect={() => onEditWidget(item.id)}>
            <Pencil />
            {ds.widgetContextMenuEdit}
          </ContextMenuItem>
        ) : null}
        {itemCapabilities.hideable ? (
          <ContextMenuItem onSelect={() => onHide(item.id)}>
            <Minus />
            {ds.widgetContextMenuHide}
          </ContextMenuItem>
        ) : null}
        {onResetWidgetPosition ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => onResetWidgetPosition(item.id)}>
              <RotateCcw />
              {ds.widgetContextMenuResetPos}
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function policyCapabilitiesForSurfaceItem(params: {
  kind: "widget" | "container";
  id: string;
  label: string;
  tone: "useful" | "social" | "chaos";
  variant: "desktop" | "panel";
  layoutEditMode: boolean;
}): HubEntityCapabilities {
  const route = params.variant === "desktop" ? "/dashboard" : "/route";
  const mode = params.layoutEditMode ? "layout" : "normal";
  const target =
    params.kind === "widget"
      ? ({ type: "widget", widgetId: params.id, widgetLabel: params.label, widgetTone: params.tone } as const)
      : ({ type: "shell.surface", area: "desktop" } as const);
  const classification = classifyTarget(target, route);
  return getCapabilities(classification, mode, route);
}

export default function HubDesktopSurface({
  widgets,
  containers = [],
  layouts,
  hiddenWidgetIds,
  widgetVisualPrefsById = {},
  showWidgetBorder = true,
  animationIntensity = 100,
  onMoveWidget,
  onResizeWidget,
  onFocusWidget,
  onOpenWidget,
  onHideWidget,
  layoutEditMode,
  gridStep = HUB_DESKTOP_LAYOUT_GRID,
  snapStrength = "standard" as HubSnapStrength,
  gridSnapEnabled = true,
  showGrid = false,
  onSelectWidget,
  onEditWidget,
  onResetWidgetPosition,
  variant = "desktop",
  gridCompaction = "none",
}: {
  widgets: readonly HubDesktopWidget[];
  containers?: readonly HubDesktopContainer[];
  layouts: Readonly<Record<string, HubDesktopWidgetLayout>>;
  hiddenWidgetIds: readonly string[];
  widgetVisualPrefsById?: Partial<Record<string, HubWidgetVisualPrefs>>;
  showWidgetBorder?: boolean;
  animationIntensity?: number;
  onMoveWidget: (id: string, position: Pick<HubDesktopWidgetLayout, "x" | "y">, options?: { snap?: boolean }) => void;
  onResizeWidget?: (id: string, size: { w: number; h: number }, options?: { snap?: boolean }) => void;
  onFocusWidget: (id: string) => void;
  onOpenWidget: (id: string) => void;
  onHideWidget: (id: string) => void;
  layoutEditMode: boolean;
  gridStep?: number;
  snapStrength?: HubSnapStrength;
  gridSnapEnabled?: boolean;
  showGrid?: boolean;
  onSelectWidget?: (id: string, additive: boolean) => void;
  onEditWidget?: (id: string) => void;
  onResetWidgetPosition?: (id: string) => void;
  variant?: "desktop" | "panel";
  gridCompaction?: HubGridCompaction;
}) {
  const { copy } = useHubLocale();
  const { theme } = useTheme();
  const ds = copy.desktopSurface;
  const reducedMotion = useReducedMotion() ?? false;
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const gridRootRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<GridStack | null>(null);
  const syncGuardRef = useRef(false);

  const [surfaceWidth, setSurfaceWidth] = useState(0);
  const containerPadding = 16;
  const pxCols = Math.max(240, Math.floor(surfaceWidth - containerPadding * 2));
  const gridVisualStep = gridSnapEnabled
    ? effectiveSnapStep(gridStep, snapStrength)
    : HUB_DESKTOP_LAYOUT_GRID;

  const [outsideLayoutDragId, setOutsideLayoutDragId] = useState<string | null>(null);
  const externalDragSessionRef = useRef<{
    widgetId: string;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    originX: number;
    originY: number;
    el: HTMLElement;
  } | null>(null);
  const teardownExternalDragListenersRef = useRef<(() => void) | null>(null);
  const onMoveWidgetRef = useRef(onMoveWidget);
  const gridSnapEnabledRef = useRef(gridSnapEnabled);

  useLayoutEffect(() => {
    onMoveWidgetRef.current = onMoveWidget;
    gridSnapEnabledRef.current = gridSnapEnabled;
  }, [onMoveWidget, gridSnapEnabled]);

  const stopOutsideLayoutDrag = useCallback((commit: boolean) => {
    teardownExternalDragListenersRef.current?.();
    teardownExternalDragListenersRef.current = null;
    const s = externalDragSessionRef.current;
    externalDragSessionRef.current = null;
    setOutsideLayoutDragId(null);
    if (s) {
      const dragNode = (s.el as HTMLElement & { gridstackNode?: OutsideLayoutDragNode }).gridstackNode;
      if (dragNode) delete dragNode._moving;
    }
    if (commit && s) {
      const node = (s.el as HTMLElement & { gridstackNode?: GridStackWidget }).gridstackNode;
      if (node?.id) {
        onMoveWidgetRef.current(
          String(node.id),
          { x: Math.round(node.x ?? 0), y: Math.round(node.y ?? 0) },
          { snap: gridSnapEnabledRef.current },
        );
      }
    }
    gridRef.current?.setAnimation(true);
  }, []);

  useEffect(() => {
    hubExternalDragTeardownGlobal = () => stopOutsideLayoutDrag(true);
    return () => {
      hubExternalDragTeardownGlobal = null;
      stopOutsideLayoutDrag(false);
    };
  }, [stopOutsideLayoutDrag]);

  useEffect(() => {
    if (layoutEditMode) {
      stopOutsideLayoutDrag(true);
    }
  }, [layoutEditMode, stopOutsideLayoutDrag]);

  const handleHoldDragReady = useCallback(
    (info: { widgetId: string; pointerId: number; clientX: number; clientY: number }) => {
      if (layoutEditMode) return;
      stopOutsideLayoutDrag(true);
      const grid = gridRef.current;
      const root = gridRootRef.current;
      if (!grid || !root) return;
      const el = root.querySelector<HTMLElement>(`.grid-stack-item[gs-id="${CSS.escape(info.widgetId)}"]`);
      const node = (el as HTMLElement & { gridstackNode?: GridStackWidget })?.gridstackNode;
      if (!el || !node || node.noMove) return;

      externalDragSessionRef.current = {
        widgetId: info.widgetId,
        pointerId: info.pointerId,
        startClientX: info.clientX,
        startClientY: info.clientY,
        originX: Math.round(node.x ?? 0),
        originY: Math.round(node.y ?? 0),
        el,
      };
      (node as OutsideLayoutDragNode)._moving = true;
      setOutsideLayoutDragId(info.widgetId);
      grid.setAnimation(false);

      const onMove = (e: PointerEvent) => {
        const s = externalDragSessionRef.current;
        if (!s || e.pointerId !== s.pointerId) return;
        const g = gridRef.current as unknown as GridStackWithMoveWrite | null;
        if (!g) return;
        const cw = Math.max(1, g.cellWidth());
        const ch = Math.max(1, g.getCellHeight(true));
        const dx = (e.clientX - s.startClientX) / cw;
        const dy = (e.clientY - s.startClientY) / ch;
        let nx = Math.round(s.originX + dx);
        let ny = Math.round(s.originY + dy);
        nx = Math.max(0, nx);
        ny = Math.max(0, ny);
        const cur = (s.el as HTMLElement & { gridstackNode?: GridStackNode }).gridstackNode;
        if (!cur) return;
        const cx = Math.round(cur.x ?? -999);
        const cy = Math.round(cur.y ?? -999);
        if (nx === cx && ny === cy) return;
        const w = Math.max(1, Math.round(cur.w ?? 1));
        const h = Math.max(1, Math.round(cur.h ?? 1));
        (g.engine as GridStackEngineWithCache).cacheRects(cw, ch, 0, 0, 0, 0);
        const rect: GridStackMoveOpts["rect"] = {
          x: nx * cw,
          y: ny * ch,
          w: w * cw,
          h: h * ch,
        };
        g.moveNode(cur, { x: nx, y: ny, w, h, pack: false, rect });
        g._writeAttr(s.el, cur);
      };

      const onUp = (e: PointerEvent) => {
        const s = externalDragSessionRef.current;
        if (!s || e.pointerId !== s.pointerId) return;
        stopOutsideLayoutDrag(true);
      };

      const teardown = () => {
        document.removeEventListener("pointermove", onMove, { capture: true });
        document.removeEventListener("pointerup", onUp, { capture: true });
        document.removeEventListener("pointercancel", onUp, { capture: true });
      };

      teardownExternalDragListenersRef.current = teardown;
      document.addEventListener("pointermove", onMove, { capture: true, passive: true });
      document.addEventListener("pointerup", onUp, { capture: true });
      document.addEventListener("pointercancel", onUp, { capture: true });
    },
    [layoutEditMode, stopOutsideLayoutDrag],
  );

  useLayoutEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const apply = () => setSurfaceWidth(el.getBoundingClientRect().width);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const resize =
    onResizeWidget ??
    (() => {
      /* no-op when resize not wired */
    });
  const selectWidget = onSelectWidget ?? (() => undefined);

  const items = useMemo(() => {
    const ws: HubSurfaceCardItem[] = widgets.map((w) => ({ ...w, kind: "widget", hideable: true }));
    const cs: HubSurfaceCardItem[] = containers.map((c) => ({ ...c, kind: "container", hideable: false }));
    return [...ws, ...cs];
  }, [containers, widgets]);

  const visibleWidgets = useMemo(() => {
    return items
      .filter((item) => item.kind === "container" || !hiddenWidgetIds.includes(item.id))
      .sort((left, right) => (layouts[left.id]?.z ?? 0) - (layouts[right.id]?.z ?? 0));
  }, [hiddenWidgetIds, items, layouts]);

  const desktopWidgets = useMemo(() => {
    return visibleWidgets
      .map((widget) => {
        const layout = layouts[widget.id];
        if (!layout) return null;
        const itemCaps = policyCapabilitiesForSurfaceItem({
          kind: widget.kind,
          id: widget.id,
          label: widget.label,
          tone: widget.tone,
          variant,
          layoutEditMode,
        });
        const visualPrefs =
          widget.kind === "widget"
            ? { ...DEFAULT_WIDGET_VISUAL_PREFS, ...widgetVisualPrefsById[widget.id] }
            : { ...DEFAULT_WIDGET_VISUAL_PREFS, showToneBadge: false, showSubtitle: false };
        return { widget, layout, itemCaps, visualPrefs };
      })
      .filter(
        (
          entry,
        ): entry is {
          widget: HubSurfaceCardItem;
          layout: HubDesktopWidgetLayout;
          itemCaps: HubEntityCapabilities;
          visualPrefs: HubWidgetVisualPrefs;
        } => Boolean(entry),
      );
  }, [layoutEditMode, layouts, variant, visibleWidgets, widgetVisualPrefsById]);

  useEffect(() => {
    const root = gridRootRef.current;
    if (!root || surfaceWidth <= 0) return;
    gridRef.current?.destroy(false);
    const grid = GridStack.init(
      {
        column: pxCols,
        cellHeight: 1,
        margin: HUB_GRIDSTACK_WIDGET_MARGIN_PX,
        float: gridCompaction === "none",
        overlap: true,
        draggable: { handle: ".hub-widget-drag-surface" },
      } as GridStackOptions,
      root,
    );
    gridRef.current = grid;

    const onDragStop = (_e: Event, el: HTMLElement) => {
      if (syncGuardRef.current) return;
      const node = (el as HTMLElement & { gridstackNode?: GridStackWidget }).gridstackNode;
      if (!node?.id) return;
      onMoveWidget(
        String(node.id),
        { x: Math.round(node.x ?? 0), y: Math.round(node.y ?? 0) },
        { snap: gridSnapEnabled },
      );
    };
    const onResizeStop = (_e: Event, el: HTMLElement) => {
      if (syncGuardRef.current) return;
      const node = (el as HTMLElement & { gridstackNode?: GridStackWidget }).gridstackNode;
      if (!node?.id) return;
      const id = String(node.id);
      const w = Math.round(node.w ?? 0);
      const h = Math.round(node.h ?? 0);
      resize(id, { w, h }, { snap: gridSnapEnabled });
      onMoveWidget(id, { x: Math.round(node.x ?? 0), y: Math.round(node.y ?? 0) }, { snap: gridSnapEnabled });
    };

    grid.on("dragstop", onDragStop);
    grid.on("resizestop", onResizeStop);

    return () => {
      grid.off("dragstop");
      grid.off("resizestop");
      grid.destroy(false);
      if (gridRef.current === grid) {
        gridRef.current = null;
      }
    };
  }, [onMoveWidget, pxCols, resize, surfaceWidth, gridCompaction, gridSnapEnabled, layoutEditMode]);

  useEffect(() => {
    const grid = gridRef.current;
    const root = gridRootRef.current;
    if (!grid || !root) return;
    syncGuardRef.current = true;
    grid.batchUpdate();
    grid.removeAll(false);
    const idSet = new Set(desktopWidgets.map(({ widget }) => widget.id));
    for (const { widget, layout, itemCaps } of desktopWidgets) {
      const selector = `.grid-stack-item[gs-id="${CSS.escape(widget.id)}"]`;
      const el = root.querySelector<HTMLElement>(selector);
      if (!el) continue;
      const sizeBounds = getHubWidgetSizeBounds(widget.id);
      const clamped = clampWidgetDimensions(widget.id, layout.w, layout.h);
      const options: GridStackWidget = {
        id: widget.id,
        x: Math.round(layout.x),
        y: Math.round(layout.y),
        w: clamped.w,
        h: clamped.h,
        noMove: !itemCaps.movable,
        noResize: !itemCaps.resizable,
        minW: sizeBounds.minW,
        minH: sizeBounds.minH,
        maxW: sizeBounds.maxW,
        maxH: sizeBounds.maxH,
      };
      grid.makeWidget(el, options);
      el.style.zIndex = String(Math.max(1, layout.z));
    }
    grid.batchUpdate(false);
    grid.enableMove(true);
    grid.enableResize(true);

    // Cleanup ghost nodes if React removed elements this frame.
    for (const node of [...grid.engine.nodes]) {
      const id = String(node.id ?? "");
      if (!id || idSet.has(id)) continue;
      if (node.el) {
        grid.removeWidget(node.el, false, false);
      }
    }
    syncGuardRef.current = false;
  }, [desktopWidgets, layoutEditMode]);

  const hiddenWidgets = useMemo(
    () =>
      widgets
        .filter((widget) => hiddenWidgetIds.includes(widget.id))
        .sort((left, right) => left.label.localeCompare(right.label)),
    [hiddenWidgetIds, widgets],
  );

  const durationScale = hubMotionDurationScale(animationIntensity);

  return (
    <motion.section
      {...hubEnterMotion(reducedMotion, 12, durationScale)}
      className={cn(
        "relative overflow-hidden",
        variant === "desktop" ? "flex min-h-full flex-1" : "rounded-[1.75rem] border border-border/55 bg-background/30",
      )}
      {...hubContextData({ type: "shell.surface", area: "desktop" })}
    >
      {variant === "desktop" ? (
        <>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,color-mix(in_oklab,var(--primary)_18%,transparent),transparent_30%),radial-gradient(circle_at_bottom_right,color-mix(in_oklab,var(--accent)_12%,transparent),transparent_32%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(to_right,color-mix(in_oklab,var(--border)_26%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklab,var(--border)_18%,transparent)_1px,transparent_1px)] bg-[size:132px_132px] opacity-45 dark:hidden" />
        </>
      ) : null}

      <div className="relative flex min-h-full flex-1 flex-col">

        <div className={cn("flex flex-1 flex-col", variant === "desktop" ? "gap-0 p-0" : "gap-4 p-4 md:p-5")}>
          <div className="block lg:hidden">
            <div className="grid gap-4">
              {visibleWidgets.map((widget) => {
                const vp =
                  widget.kind === "widget"
                    ? { ...DEFAULT_WIDGET_VISUAL_PREFS, ...widgetVisualPrefsById[widget.id] }
                    : { ...DEFAULT_WIDGET_VISUAL_PREFS, showToneBadge: false, showSubtitle: false };
                const effectiveToneMobile = effectiveWidgetTone(widget.tone, vp.toneOverride);
                const mobileCardOpacity = vp.glassOpacity / 100;
                const mobileCardBg = {
                  backgroundColor: `color-mix(in oklab, var(--card) ${Math.round(mobileCardOpacity * 100)}%, transparent)`,
                };

                return (
                  <Card
                    key={widget.id}
                    className={cn(
                      "rounded-[1.4rem] transition",
                      showWidgetBorder ? "border border-border/70" : "border-0",
                      blurClass(vp.blurStrength),
                      toneAccentClass(effectiveToneMobile, showWidgetBorder),
                    )}
                    style={mobileCardBg}
                    {...hubContextData({
                      type: "widget",
                      widgetId: widget.id,
                      widgetLabel: widget.label,
                      widgetTone: widget.tone,
                    })}
                  >
                    <CardContent className="overflow-hidden p-5 [container-type:inline-size] [container-name:widget]">{widget.content}</CardContent>
                  </Card>
                );
              })}
            </div>
          </div>

          <div
            ref={surfaceRef}
            className={cn(
              "relative hidden flex-1 overflow-hidden lg:block",
              variant === "desktop"
                ? "before:pointer-events-none before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_top_left,color-mix(in_oklab,var(--primary)_16%,transparent),transparent_26%)] before:content-['']"
                : "rounded-[2rem] border border-border/60 bg-background/28 before:pointer-events-none before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_top_left,color-mix(in_oklab,var(--primary)_16%,transparent),transparent_26%)] before:content-['']",
            )}
            style={{ minHeight: 580 }}
          >
            {layoutEditMode && showGrid ? (
              <div
                className={cn(
                  "pointer-events-none absolute inset-0 z-[5]",
                  theme === "light" ? "opacity-[0.14]" : "opacity-[0.22]",
                )}
                style={{
                  backgroundImage:
                    "linear-gradient(to right, color-mix(in oklab, var(--primary) 38%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklab, var(--primary) 38%, transparent) 1px, transparent 1px)",
                  backgroundSize: `${gridSnapEnabled ? gridVisualStep : HUB_DESKTOP_LAYOUT_GRID}px ${gridSnapEnabled ? gridVisualStep : HUB_DESKTOP_LAYOUT_GRID}px`,
                  backgroundPosition: `${containerPadding}px 0px`,
                }}
                aria-hidden
              />
            ) : null}

            <div
              ref={gridRootRef}
              className={cn("hub-desktop-grid grid-stack relative z-10", layoutEditMode && "layout-edit-mode")}
              style={{
                minHeight: 580,
                marginInline: `${containerPadding}px`,
                width: `calc(100% - ${containerPadding * 2}px)`,
              }}
            >
              {desktopWidgets.map(({ widget, visualPrefs, itemCaps }) => (
                <div key={widget.id} className="grid-stack-item" gs-id={widget.id}>
                  <div className="grid-stack-item-content h-full">
                    <DesktopWidgetCard
                      item={widget}
                      visualPrefs={visualPrefs}
                      showWidgetBorder={showWidgetBorder}
                      layoutEditMode={layoutEditMode}
                      onFocus={onFocusWidget}
                      onHide={onHideWidget}
                      onSelect={selectWidget}
                      itemCapabilities={itemCaps}
                      outsideLayoutDragActive={!layoutEditMode && outsideLayoutDragId === widget.id}
                      onHoldDragReady={layoutEditMode ? undefined : handleHoldDragReady}
                      onEditWidget={onEditWidget}
                      onResetWidgetPosition={onResetWidgetPosition}
                    />
                  </div>
                </div>
              ))}
            </div>

            {variant === "desktop" && !layoutEditMode ? (
              <p
                className="pointer-events-none relative z-[8] hidden select-none px-4 pb-2 text-center text-[10px] leading-tight text-muted-foreground/70 lg:block"
                aria-hidden
              >
                {ds.holdToDragOutsideLayoutHint}
              </p>
            ) : null}

            {visibleWidgets.length === 0 ? (
              <motion.div {...hubPopMotion(reducedMotion, durationScale)} className="absolute inset-0 flex items-center justify-center p-6">
                <div className="flex max-w-md flex-col items-center gap-4 rounded-[1.75rem] border border-dashed border-border/70 bg-background/75 px-6 py-8 text-center shadow-sm backdrop-blur">
                  <Badge variant="outline">{ds.emptyBadge}</Badge>
                  <div className="flex flex-col gap-2">
                    <h3 className="text-lg font-semibold tracking-tight">{ds.emptyTitle}</h3>
                    <p className="text-sm text-muted-foreground">{ds.emptyBody}</p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    {hiddenWidgets.slice(0, 3).map((widget) => (
                      <Button key={widget.id} type="button" variant="outline" size="sm" onClick={() => onOpenWidget(widget.id)}>
                        <Plus data-icon="inline-start" />
                        {widget.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </motion.div>
            ) : null}
          </div>
        </div>
      </div>
    </motion.section>
  );
}
