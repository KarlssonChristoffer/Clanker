import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  Command,
  Inspect,
  LayoutGrid,
  SearchIcon,
  Settings2,
} from "lucide-react";
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@clanker/ui/components/button";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@clanker/ui/components/avatar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@clanker/ui/components/card";
import { cn } from "@clanker/ui/lib/utils";
import { useHubAudio } from "@/components/HubAudioProvider";
import HubCommandPalette from "@/components/HubCommandPalette";
import HubDock from "@/components/HubDock";
import HubGlobalContextMenu from "@/components/HubGlobalContextMenu";
import HubPrimaryNavDialog from "@/components/HubPrimaryNavDialog";
import HubShellObject from "@/components/HubShellObject";
import HubLiveTicker from "@/components/HubLiveTicker";
import { useHubToasts } from "@/components/HubToastProvider";
import { useHubLocale } from "@/components/locale-provider";
import { ModeToggle } from "@/components/mode-toggle";
import { useTheme } from "@/components/theme-provider";
import { buildHubActions, createHubActionApi, type HubAction } from "@/config/hub-actions";
import { HUB_TOOLS, localizeHubTools, localizeMeTool, type HubTool } from "@/config/hub-tools";
import { apiUrl } from "@/config";
import type {
  HubDesktopShellState,
  HubLayoutContextValue,
  HubProfile,
  HubSessionState,
} from "@/hooks/use-hub-layout";
import type { HubCopy } from "@/i18n/hub-copy";
import { discordAvatarUrl } from "@/lib/discordCdn";
import { hubContextData, isTextEditingTarget, resolveHubContextTarget, type HubContextTarget } from "@/lib/hub-shell-context";
import { buildHubShellMenu } from "@/lib/hub-shell-menu";
import { classifyTarget, getCapabilities, isEditable } from "@/lib/hub-shell-classification";
import HubNavBookmarkDialog from "@/components/HubNavBookmarkDialog";
import HubPrefsPanel from "@/components/HubPrefsPanel";
import HubShellInspectCursor from "@/components/HubShellInspectCursor";
import { useHubPrefs } from "@/components/HubPrefsProvider";
import { useHubSettingsSync } from "@/hooks/use-hub-settings-sync";
import { HubShellReorderablePrimaryNav } from "@/components/HubShellReorderableChrome";
import {
  createBookmarkNavId,
  loadNavBookmarks,
  loadPrimaryNavOrder,
  saveNavBookmarks,
  type HubNavBookmark,
} from "@/lib/hub-nav-bookmarks";
import {
  loadPrimaryNavOverrides,
  normalizeInternalPath,
  savePrimaryNavOverrides,
  type HubPrimaryNavOverride,
} from "@/lib/hub-primary-nav-overrides";
import { normalizeNavBookmarkIconKey, type HubNavBookmarkIconKey } from "@/lib/hub-nav-bookmark-icons";
import {
  HUB_PRIMARY_NAV_ORDER_KEY,
  saveOrder,
  type HubPrimaryNavItemId,
} from "@/lib/hub-shell-layout-order";

/** Text-raden i headern (rullande kompisrader). Sätt till `false` för att dölja. */
const SHOW_HUB_LIVE_TICKER = true;
/**
 * `true`: högerklick öppnar HubGlobalContextMenu (skalmeny). `false`: vanlig webbläsarmeny;
 * HubGlobalContextMenu och openShellContextMenu finns kvar för framtida återaktivering.
 */
const HUB_SHELL_CONTEXT_MENU_ON_RIGHT_CLICK = false;
/** `true`: visa HubDock längst ned. Komponenten och props finns kvar nedan. */
const SHOW_HUB_DOCK = false;
const DOCK_STORAGE_KEY = "hub.dock.pins.v1";
const LAYOUT_EDIT_KEY = "hub.shell.layoutEdit.v1";
const GRID_SNAP_KEY = "hub.shell.gridSnap.v1";
const GRID_VISIBLE_KEY = "hub.shell.gridVisible.v1";
const NATIVE_BROWSER_CONTEXT_KEY = "hub.dev.native-browser-context.v1";

function readNativeBrowserContextMenu(): boolean {
  if (!import.meta.env.DEV) {
    return false;
  }
  try {
    return localStorage.getItem(NATIVE_BROWSER_CONTEXT_KEY) === "true";
  } catch {
    return false;
  }
}

function readGridSnapEnabled(): boolean {
  try {
    return localStorage.getItem(GRID_SNAP_KEY) === "true";
  } catch {
    return false;
  }
}

function readGridVisible(): boolean {
  try {
    const raw = localStorage.getItem(GRID_VISIBLE_KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

function readLayoutEditMode(): boolean {
  try {
    return localStorage.getItem(LAYOUT_EDIT_KEY) === "true";
  } catch {
    return false;
  }
}

function loadPins(defaultPins: string[]): string[] {
  try {
    const raw = localStorage.getItem(DOCK_STORAGE_KEY);
    if (!raw) return defaultPins;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultPins;
    const pins = parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    return pins.length > 0 ? pins : defaultPins;
  } catch {
    return defaultPins;
  }
}

function workspaceMeta(
  pathname: string,
  panel: HubCopy["chrome"],
): { id: string; label: string; detail: string } {
  if (pathname === "/dashboard") {
    return { id: "panel-desktop", label: panel.toolDesktop, detail: panel.panelDefault.detail };
  }
  if (pathname.startsWith("/tools/spin-the-wheel")) {
    return { id: "panel-wheel", label: panel.panelWheel.label, detail: panel.panelWheel.detail };
  }

  if (pathname.startsWith("/tools/music")) {
    return { id: "panel-music", label: panel.panelMusic.label, detail: panel.panelMusic.detail };
  }

  if (pathname.startsWith("/tools/league-stats")) {
    return {
      id: "panel-league-stats",
      label: panel.panelLeagueStats.label,
      detail: panel.panelLeagueStats.detail,
    };
  }

  if (pathname.startsWith("/profile/settings")) {
    return {
      id: "panel-settings",
      label: panel.panelSettings.label,
      detail: panel.panelSettings.detail,
    };
  }

  if (pathname.startsWith("/u/")) {
    return {
      id: "panel-profile",
      label: panel.panelProfile.label,
      detail: panel.panelProfile.detail,
    };
  }

  return {
    id: "panel-workspace",
    label: panel.panelDefault.label,
    detail: panel.panelDefault.detail,
  };
}

/** Element that actually received the click — not elementFromPoint (can disagree with contextmenu target). */
function contextMenuHitElement(event: ReactMouseEvent<HTMLElement>): Element | null {
  const native = event.nativeEvent;
  const raw = native instanceof MouseEvent ? native.target : event.target;
  if (raw instanceof Element) {
    return raw;
  }
  if (raw instanceof Text) {
    return raw.parentElement;
  }
  if (typeof document !== "undefined" && native instanceof MouseEvent) {
    return document.elementFromPoint(native.clientX, native.clientY);
  }
  return null;
}

export default function HubLayout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { copy } = useHubLocale();
  const toasts = useHubToasts();
  const { colorPalette, setColorPalette } = useTheme();
  const { enabled: audioEnabled, toggleEnabled: toggleAudio, play } = useHubAudio();
  const [me, setMe] = useState<HubSessionState>({ status: "loading" });
  const [commandOpen, setCommandOpen] = useState(false);
  const [desktopShellState, setDesktopShellState] = useState<HubDesktopShellState | null>(null);
  const [layoutEditMode, setLayoutEditMode] = useState(readLayoutEditMode);
  const [gridSnapEnabled, setGridSnapEnabled] = useState(readGridSnapEnabled);
  const [gridVisible, setGridVisible] = useState(readGridVisible);
  const [nativeBrowserContextMenu, setNativeBrowserContextMenu] = useState(readNativeBrowserContextMenu);
  const [prefsPanelOpen, setPrefsPanelOpen] = useState(false);
  const { prefs: hubPrefs } = useHubPrefs();
  useHubSettingsSync(me, hubPrefs);
  const [shellContextMenu, setShellContextMenu] = useState<{
    target: HubContextTarget;
    position: { x: number; y: number };
  } | null>(null);
  const topbarRef = useRef<HTMLElement | null>(null);
  const lastCommandTriggerRef = useRef<HTMLElement | null>(null);
  const leaderTimeoutRef = useRef<number | null>(null);
  const awaitingLeaderRef = useRef(false);
  const bootToastShownRef = useRef(false);
  const isDashboardRoute = pathname === "/dashboard";
  const authGateActive = me.status !== "user";
  const oauthError = searchParams.get("error") === "oauth";
  const apiUnreachable = me.status === "backend_error";
  /** Dev: anpassad skal-pekare när hubbens högerklick är aktivt — inte när webbläsarens meny är på. */
  const shellCustomCursorActive =
    import.meta.env.DEV && HUB_SHELL_CONTEXT_MENU_ON_RIGHT_CLICK && !nativeBrowserContextMenu;
  const panelMeta = workspaceMeta(pathname, copy.chrome);
  const defaultPinnedIds = useMemo(() => HUB_TOOLS.map((tool) => tool.id), []);
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => loadPins(defaultPinnedIds));
  const [navBookmarks, setNavBookmarks] = useState<Record<string, HubNavBookmark>>(() => loadNavBookmarks());
  const [primaryNavOverrides, setPrimaryNavOverrides] = useState<
    Partial<Record<HubPrimaryNavItemId, HubPrimaryNavOverride>>
  >(() => loadPrimaryNavOverrides());
  const [primaryNavOrder, setPrimaryNavOrder] = useState<string[]>(() =>
    loadPrimaryNavOrder(loadNavBookmarks()),
  );
  const [bookmarkDialog, setBookmarkDialog] = useState<null | { mode: "add" } | { mode: "edit"; id: string }>(
    null,
  );
  const [primaryNavDialog, setPrimaryNavDialog] = useState<null | { id: HubPrimaryNavItemId }>(null);

  const refreshMe = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/auth/me"), { credentials: "include" });
      if (res.ok) {
        const data = (await res.json()) as HubProfile;
        setMe({ status: "user", profile: data });
      } else if (res.status === 401) {
        setMe({ status: "guest" });
      } else {
        setMe({ status: "backend_error" });
      }
    } catch {
      setMe({ status: "backend_error" });
    }
  }, []);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  useEffect(() => {
    if (me.status !== "user") {
      return;
    }

    if (bootToastShownRef.current) {
      return;
    }

    const now = new Date();
    const dayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const storageKey = `hub.boot.toast.v1.${me.profile.id}.${dayKey}`;
    let shouldShow = true;

    try {
      if (localStorage.getItem(storageKey) === "1") {
        shouldShow = false;
      } else {
        localStorage.setItem(storageKey, "1");
      }
    } catch {
      // ignore storage failures
    }

    if (!shouldShow) {
      return;
    }

    bootToastShownRef.current = true;
    play("confirm");
    toasts.push({
      kind: "info",
      title: copy.chrome.bootToastTitle,
      message: copy.chrome.bootToastMessage,
    });
  }, [
    copy.chrome.bootToastMessage,
    copy.chrome.bootToastTitle,
    me.status,
    me.status === "user" ? me.profile.id : null,
    play,
    toasts,
  ]);

  useEffect(() => {
    if (me.status !== "backend_error") {
      return;
    }

    const retryTimer = window.setInterval(() => {
      void refreshMe();
    }, 5000);

    return () => window.clearInterval(retryTimer);
  }, [me.status, refreshMe]);

  useEffect(() => {
    localStorage.setItem(DOCK_STORAGE_KEY, JSON.stringify(pinnedIds));
  }, [pinnedIds]);

  useEffect(() => {
    saveOrder(HUB_PRIMARY_NAV_ORDER_KEY, primaryNavOrder);
  }, [primaryNavOrder]);

  useEffect(() => {
    saveNavBookmarks(navBookmarks);
  }, [navBookmarks]);

  useEffect(() => {
    savePrimaryNavOverrides(primaryNavOverrides);
  }, [primaryNavOverrides]);

  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_EDIT_KEY, layoutEditMode ? "true" : "false");
    } catch {
      /* ignore */
    }
  }, [layoutEditMode]);

  useEffect(() => {
    try {
      localStorage.setItem(GRID_SNAP_KEY, gridSnapEnabled ? "true" : "false");
    } catch {
      /* ignore */
    }
  }, [gridSnapEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem(GRID_VISIBLE_KEY, gridVisible ? "true" : "false");
    } catch {
      /* ignore */
    }
  }, [gridVisible]);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }
    try {
      localStorage.setItem(NATIVE_BROWSER_CONTEXT_KEY, nativeBrowserContextMenu ? "true" : "false");
    } catch {
      /* ignore */
    }
  }, [nativeBrowserContextMenu]);

  useEffect(() => {
    if (pathname === "/login" && me.status === "user") {
      navigate("/dashboard", { replace: true });
    }
  }, [navigate, pathname, me.status]);

  useLayoutEffect(() => {
    const el = topbarRef.current;
    if (!el) {
      return;
    }
    const apply = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      document.documentElement.style.setProperty("--hub-topbar-height", `${h}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty("--hub-topbar-height");
    };
  }, []);

  /** På <html>: HubLayout rot täcker inte ToastProvider m.m. — annars cursor:none bara delvis och pekaren känns omvänd. */
  useEffect(() => {
    if (!shellCustomCursorActive) {
      document.documentElement.classList.remove("hub-shell-inspect-cursor-active");
      return;
    }
    document.documentElement.classList.add("hub-shell-inspect-cursor-active");
    return () => {
      document.documentElement.classList.remove("hub-shell-inspect-cursor-active");
    };
  }, [shellCustomCursorActive]);

  const toggleLayoutEditMode = useCallback(() => {
    setLayoutEditMode((prev) => !prev);
    play("panel");
  }, [play]);

  const toggleGridSnap = useCallback(() => {
    setGridSnapEnabled((prev) => !prev);
    play("panel");
  }, [play]);

  const toggleGridVisible = useCallback(() => {
    setGridVisible((prev) => !prev);
    play("panel");
  }, [play]);

  const doneLayoutEdit = useCallback(() => {
    desktopShellState?.saveLayoutCommitted();
    setLayoutEditMode(false);
    play("panel");
  }, [desktopShellState, play]);

  const cancelLayoutEdit = useCallback(() => {
    desktopShellState?.discardLayoutDraft();
    setLayoutEditMode(false);
    play("panel");
  }, [desktopShellState, play]);

  const removeNavBookmark = useCallback(
    (bookmarkId: string) => {
      setShellContextMenu(null);
      setPrimaryNavOrder((p) => p.filter((x) => x !== bookmarkId));
      setNavBookmarks((b) => {
        const n = { ...b };
        delete n[bookmarkId];
        return n;
      });
      toasts.push({ kind: "info", title: copy.navBookmarks.toastRemoved });
      play("panel");
    },
    [copy.navBookmarks.toastRemoved, play, toasts],
  );

  const commitNavBookmark = useCallback(
    (payload: { bookmarkId?: string; label: string; path: string; iconKey: HubNavBookmarkIconKey }) => {
      const label = payload.label.trim();
      const path = payload.path.trim();
      const iconKey = normalizeNavBookmarkIconKey(payload.iconKey);
      if (!label || !path) {
        toasts.push({ kind: "info", title: copy.navBookmarks.validationBoth });
        return;
      }
      setShellContextMenu(null);
      if (payload.bookmarkId) {
        setNavBookmarks((b) => ({
          ...b,
          [payload.bookmarkId!]: { label, path, iconKey },
        }));
        toasts.push({ kind: "success", title: copy.navBookmarks.toastUpdated });
        play("confirm");
      } else {
        const id = createBookmarkNavId();
        setNavBookmarks((b) => ({ ...b, [id]: { label, path, iconKey } }));
        setPrimaryNavOrder((p) => [...p, id]);
        toasts.push({ kind: "success", title: copy.navBookmarks.toastAdded });
        play("confirm");
      }
      setBookmarkDialog(null);
    },
    [
      copy.navBookmarks.toastAdded,
      copy.navBookmarks.toastUpdated,
      copy.navBookmarks.validationBoth,
      play,
      toasts,
    ],
  );

  const openNavBookmarkAdd = useCallback(() => {
    setShellContextMenu(null);
    setBookmarkDialog({ mode: "add" });
    play("panel");
  }, [play]);

  const openNavBookmarkEdit = useCallback((bookmarkId: string) => {
    setShellContextMenu(null);
    setBookmarkDialog({ mode: "edit", id: bookmarkId });
    play("panel");
  }, [play]);

  const deleteNavBookmarkFromDialog = useCallback(() => {
    if (bookmarkDialog?.mode !== "edit") {
      return;
    }
    removeNavBookmark(bookmarkDialog.id);
    setBookmarkDialog(null);
  }, [bookmarkDialog, removeNavBookmark]);

  const openPrimaryNavEdit = useCallback(
    (navId: HubPrimaryNavItemId) => {
      setShellContextMenu(null);
      setPrimaryNavDialog({ id: navId });
      play("panel");
    },
    [play],
  );

  const commitPrimaryNavOverride = useCallback(
    (payload: { navId: HubPrimaryNavItemId; label: string; path: string; iconKey: HubNavBookmarkIconKey }) => {
      const label = payload.label.trim();
      const rawPath = payload.path.trim();
      const iconKey = normalizeNavBookmarkIconKey(payload.iconKey);
      if (!label || !rawPath) {
        toasts.push({ kind: "info", title: copy.primaryNav.validationBoth });
        return;
      }
      const path = normalizeInternalPath(rawPath);
      if (!path) {
        toasts.push({ kind: "info", title: copy.primaryNav.validationInternal });
        return;
      }
      setShellContextMenu(null);
      setPrimaryNavOverrides((prev) => ({
        ...prev,
        [payload.navId]: { label, path, iconKey },
      }));
      toasts.push({ kind: "success", title: copy.primaryNav.toastUpdated });
      play("confirm");
      setPrimaryNavDialog(null);
    },
    [
      copy.primaryNav.toastUpdated,
      copy.primaryNav.validationBoth,
      copy.primaryNav.validationInternal,
      play,
      toasts,
    ],
  );

  const logout = useCallback(async () => {
    await fetch(apiUrl("/api/auth/logout"), {
      method: "POST",
      credentials: "include",
    });
    setMe({ status: "guest" });
    navigate("/login", { replace: true });
  }, [navigate]);

  const displayName = me.status === "user" ? me.profile.global_name ?? me.profile.username : null;
  const profilePath =
    me.status === "user" ? `/u/${encodeURIComponent(me.profile.id)}` : null;
  const profileId = me.status === "user" ? me.profile.id : null;
  const profileHandle = me.status === "user" ? `@${me.profile.username}` : null;

  const primaryNavDefaults = useMemo(
    () => ({
      desktop: {
        label: copy.chrome.navDesktop,
        path: "/dashboard",
        iconKey: "LayoutDashboard" as HubNavBookmarkIconKey,
      },
      profile: {
        label: copy.chrome.myProfile,
        path: profilePath ?? "",
        iconKey: "User" as HubNavBookmarkIconKey,
      },
      settings: {
        label: copy.chrome.settings,
        path: "/profile/settings",
        iconKey: "Settings" as HubNavBookmarkIconKey,
      },
      wheel: {
        label: copy.chrome.wheel,
        path: "/tools/spin-the-wheel",
        iconKey: "Workflow" as HubNavBookmarkIconKey,
      },
      radio: {
        label: copy.chrome.navRadio,
        path: "/tools/music",
        iconKey: "Radio" as HubNavBookmarkIconKey,
      },
      leagueStats: {
        label: copy.chrome.navLeagueStats,
        path: "/tools/league-stats",
        iconKey: "Trophy" as HubNavBookmarkIconKey,
      },
    }),
    [copy.chrome, profilePath],
  );

  const openCommandPalette = useCallback((trigger?: EventTarget | null) => {
    const fallback =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null;
    lastCommandTriggerRef.current = trigger instanceof HTMLElement ? trigger : fallback;
    setCommandOpen(true);
  }, []);

  const handleCommandOpenChange = useCallback((nextOpen: boolean) => {
    setCommandOpen(nextOpen);
    if (!nextOpen) {
      window.setTimeout(() => {
        lastCommandTriggerRef.current?.focus();
      }, 0);
    }
  }, []);

  useEffect(() => {
    if (!layoutEditMode) return;
    if (commandOpen) {
      handleCommandOpenChange(false);
    }
  }, [layoutEditMode, commandOpen, handleCommandOpenChange]);

  useEffect(() => {
    if (!layoutEditMode) {
      setBookmarkDialog(null);
      setPrimaryNavDialog(null);
    }
  }, [layoutEditMode]);

  useEffect(() => {
    const clearLeader = () => {
      awaitingLeaderRef.current = false;
      if (leaderTimeoutRef.current) {
        window.clearTimeout(leaderTimeoutRef.current);
        leaderTimeoutRef.current = null;
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (layoutEditMode) {
          if (commandOpen) {
            handleCommandOpenChange(false);
          }
          return;
        }
        if (commandOpen) {
          handleCommandOpenChange(false);
        } else {
          openCommandPalette(document.activeElement);
        }
        return;
      }

      if (commandOpen) {
        return;
      }

      const ds = desktopShellState;
      const onDashboard = pathname === "/dashboard";
      if (layoutEditMode && onDashboard && ds && !isTextEditingTarget(event.target)) {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
          event.preventDefault();
          if (event.shiftKey) {
            ds.redoLayout();
          } else {
            ds.undoLayout();
          }
          play("panel");
          return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
          event.preventDefault();
          ds.redoLayout();
          play("panel");
          return;
        }
        if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.repeat) {
          if (event.key === "Escape") {
            event.preventDefault();
            if (ds.selectedWidgetIds.length > 0) {
              ds.clearWidgetSelection();
              play("panel");
            }
            return;
          }
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            ds.nudgeSelectedWidgets(-1, 0);
            play("panel");
            return;
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            ds.nudgeSelectedWidgets(1, 0);
            play("panel");
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            ds.nudgeSelectedWidgets(0, -1);
            play("panel");
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            ds.nudgeSelectedWidgets(0, 1);
            play("panel");
            return;
          }
          if (event.key === "]") {
            event.preventDefault();
            ds.bringSelectedWidgetsToFront();
            play("panel");
            return;
          }
        }
      }

      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (event.repeat || isTextEditingTarget(event.target)) {
        clearLeader();
        return;
      }

      const key = event.key.toLowerCase();

      if (!layoutEditMode) {
        if (awaitingLeaderRef.current) {
          clearLeader();
          if (key === "d") {
            event.preventDefault();
            play("dock");
            navigate("/dashboard");
            return;
          }
          if (key === "w") {
            event.preventDefault();
            play("dock");
            navigate("/tools/spin-the-wheel");
            return;
          }
          if (key === "s") {
            event.preventDefault();
            play("dock");
            navigate("/profile/settings");
            return;
          }
        }

        if (key === "g") {
          awaitingLeaderRef.current = true;
          if (leaderTimeoutRef.current) {
            window.clearTimeout(leaderTimeoutRef.current);
          }
          leaderTimeoutRef.current = window.setTimeout(() => {
            awaitingLeaderRef.current = false;
            leaderTimeoutRef.current = null;
          }, 1000);
        }
      } else {
        clearLeader();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      clearLeader();
    };
  }, [
    commandOpen,
    desktopShellState,
    handleCommandOpenChange,
    layoutEditMode,
    navigate,
    openCommandPalette,
    pathname,
    play,
  ]);

  const localizedHubToolList = useMemo(() => localizeHubTools(copy), [copy]);

  const orderedDockTools = useMemo(() => {
    const byId = new Map(localizedHubToolList.map((tool) => [tool.id, tool] as const));
    const ordered = pinnedIds.map((id) => byId.get(id)).filter((tool): tool is HubTool => Boolean(tool));
    const seen = new Set(ordered.map((tool) => tool.id));
    for (const tool of localizedHubToolList) {
      if (!seen.has(tool.id)) {
        ordered.push(tool);
      }
    }
    return ordered;
  }, [localizedHubToolList, pinnedIds]);

  const toggleDockPin = useCallback((toolId: string) => {
    setPinnedIds((prev) => {
      if (prev.includes(toolId)) {
        const next = prev.filter((id) => id !== toolId);
        return next.length > 0 ? next : prev;
      }

      return [toolId, ...prev];
    });
  }, []);

  const contextValue = useMemo<HubLayoutContextValue>(
    () => ({
      me,
      logout,
      refreshMe,
      openCommandPalette: () => openCommandPalette(),
      setDesktopShellState,
      layoutEditMode,
      setLayoutEditMode,
      toggleLayoutEditMode,
      gridSnapEnabled,
      setGridSnapEnabled,
      toggleGridSnap,
      gridVisible,
      setGridVisible,
      toggleGridVisible,
    }),
    [
      gridSnapEnabled,
      gridVisible,
      layoutEditMode,
      logout,
      me,
      openCommandPalette,
      refreshMe,
      toggleGridSnap,
      toggleGridVisible,
      toggleLayoutEditMode,
    ],
  );

  const actionEnvironment = useMemo(
    () => ({
      copy,
      profilePath,
      profileId,
      profileHandle,
      navigate,
      refreshSession: refreshMe,
      logout,
      colorPalette,
      setColorPalette,
      audioEnabled,
      toggleAudio,
      play,
      notify: toasts.push,
      openCommandPalette: () => openCommandPalette(),
    }),
    [
      audioEnabled,
      colorPalette,
      copy,
      logout,
      navigate,
      openCommandPalette,
      play,
      profileHandle,
      profileId,
      profilePath,
      refreshMe,
      setColorPalette,
      toasts.push,
      toggleAudio,
    ],
  );

  const actionApi = useMemo(() => createHubActionApi(actionEnvironment), [actionEnvironment]);
  const baseActions = useMemo(() => buildHubActions(actionEnvironment), [actionEnvironment]);

  const sidebarNavButtonClassName = (isActive: boolean) =>
    cn(
      "relative flex w-full min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition",
      "border-transparent text-muted-foreground hover:bg-muted/70 hover:text-foreground",
      isActive && "border-primary/35 bg-primary/10 text-foreground shadow-sm",
    );

  /** Kompakt topbar — matchar ungefär halv tidigare vertikal höjd. */
  const hubTopbarButtonClass = cn(
    "hub-topbar-select-text",
    "h-7 min-h-7 gap-1 px-2 text-xs has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3.5",
  );

  const normalizeContextTarget = useCallback(
    (target: HubContextTarget): HubContextTarget => {
      if (target.type !== "profile") {
        return target;
      }

      const ownProfile =
        (profileId && target.profileId === profileId) ||
        (profilePath && target.profilePath === profilePath);

      return {
        ...target,
        isOwnProfile: Boolean(ownProfile),
      };
    },
    [profileId, profilePath],
  );

  const closeShellContextMenu = useCallback(() => {
    setShellContextMenu(null);
  }, []);

  const toggleDevNativeContextMenu = useCallback(() => {
    closeShellContextMenu();
    play("panel");
    const next = !nativeBrowserContextMenu;
    setNativeBrowserContextMenu(next);
    const t = copy.actions.toasts;
    toasts.push({
      kind: "info",
      title: next ? t.devNativeContextBrowserTitle : t.devNativeContextShellTitle,
      message: next ? t.devNativeContextBrowserMessage : t.devNativeContextShellMessage,
    });
  }, [
    closeShellContextMenu,
    copy.actions.toasts,
    nativeBrowserContextMenu,
    play,
    toasts,
  ]);

  const actions = useMemo((): HubAction[] => {
    if (!import.meta.env.DEV || !HUB_SHELL_CONTEXT_MENU_ON_RIGHT_CLICK) {
      return baseActions;
    }
    const d = copy.actions;
    const devKeywords = [...d.devNativeBrowserMenu.keywords, ...d.devShellContextMenu.keywords] as readonly string[];
    return [
      ...baseActions,
      {
        id: "dev-toggle-native-context",
        label: nativeBrowserContextMenu ? d.devShellContextMenu.label : d.devNativeBrowserMenu.label,
        description: nativeBrowserContextMenu ? d.devShellContextMenu.description : d.devNativeBrowserMenu.description,
        section: "System",
        tone: "useful",
        keywords: devKeywords,
        icon: Inspect,
        onSelect: toggleDevNativeContextMenu,
      },
    ];
  }, [baseActions, copy.actions, nativeBrowserContextMenu, toggleDevNativeContextMenu]);

  const openShellContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, forceTarget?: Element | null) => {
      if (nativeBrowserContextMenu) {
        closeShellContextMenu();
        return;
      }

      // Skip defaultPrevented check when called directly (e.g. from Reorder.Item
      // where Framer Motion sets preventDefault to suppress browser drag menu).
      if (!forceTarget && (event.defaultPrevented || isTextEditingTarget(event.target))) {
        closeShellContextMenu();
        return;
      }

      if (!forceTarget && (window.getSelection()?.toString().trim() ?? "").length > 0) {
        closeShellContextMenu();
        return;
      }

      event.preventDefault();
      play("panel");
      const hit = forceTarget ?? contextMenuHitElement(event);
      const target = normalizeContextTarget(resolveHubContextTarget(hit));
      if (import.meta.env.DEV) {
        console.log("[ctx]", hit?.tagName, hit?.getAttribute?.("data-hub-context"), "→", target.type);
      }
      setShellContextMenu({
        target,
        position: { x: event.clientX, y: event.clientY },
      });
    },
    [closeShellContextMenu, nativeBrowserContextMenu, normalizeContextTarget, play],
  );

  useEffect(() => {
    closeShellContextMenu();
  }, [closeShellContextMenu, pathname]);

  const shellMenuSections = useMemo(
    () =>
      shellContextMenu
        ? buildHubShellMenu({
            copy,
            target: shellContextMenu.target,
            actions: actionApi,
            desktopShell: desktopShellState,
            toggleDockPin,
            layoutEditMode,
            toggleLayoutEditMode,
            onInfoToast: (title, message) => {
              toasts.push({ kind: "info", title, message: message ?? undefined });
            },
            gridSnapEnabled,
            toggleGridSnap,
            isDashboardRoute,
            onNavBookmarkAdd: layoutEditMode ? openNavBookmarkAdd : undefined,
            onNavBookmarkEdit: openNavBookmarkEdit,
            onNavBookmarkDelete: removeNavBookmark,
            onPrimaryNavEdit: openPrimaryNavEdit,
          })
        : [],
    [
      actionApi,
      copy,
      desktopShellState,
      gridSnapEnabled,
      isDashboardRoute,
      layoutEditMode,
      openNavBookmarkAdd,
      openNavBookmarkEdit,
      openPrimaryNavEdit,
      removeNavBookmark,
      shellContextMenu,
      toggleDockPin,
      toggleGridSnap,
      toggleLayoutEditMode,
      toasts,
    ],
  );

  const policyRoute = isDashboardRoute ? "/dashboard" : pathname;
  const policyMode = layoutEditMode ? "layout" : "normal";
  const brandBlockEditable = isEditable(
    {
      type: "shell.object",
      kind: "brandBlock",
      objectId: "shell.brandRow",
      label: copy.chrome.shellObjectBrandBlock,
    },
    policyRoute,
    policyMode,
  );
  const routeContentClassification = classifyTarget(
    {
      type: "shell.surface",
      area: "workspace",
    },
    policyRoute,
  );
  const routeContentCaps = getCapabilities(routeContentClassification, policyMode, policyRoute);

  const renderIdentity = () =>
    me.status === "user" ? (
        <NavLink
          to={profilePath!}
          tabIndex={layoutEditMode ? -1 : undefined}
          onClick={(e) => {
            if (layoutEditMode) e.preventDefault();
          }}
          className={cn(
            "flex items-center gap-1.5 rounded-2xl border border-border/60 bg-background/55 px-2 py-1 shadow-sm transition hover:bg-muted/70 hover:shadow-md",
            layoutEditMode && "pointer-events-none select-none",
          )}
          title={copy.chrome.identityNavHint}
          {...hubContextData({
            type: "shell.identity",
            profileId,
            profilePath,
            profileHandle,
            displayName,
          })}
        >
          <Avatar size="sm">
            <AvatarImage
              src={discordAvatarUrl(me.profile.id, me.profile.avatar, 64)}
              alt=""
            />
            <AvatarFallback>
              {(displayName ?? me.profile.username).slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="hidden min-w-0 flex-col md:flex">
            <span className="truncate text-xs font-medium leading-tight">{displayName}</span>
            <span className="truncate text-[0.65rem] leading-tight text-muted-foreground">
              @{me.profile.username}
            </span>
          </div>
          <span className="hidden size-2 rounded-full bg-emerald-400 shadow-[0_0_0_3px_color-mix(in_oklab,var(--background)_88%,transparent)] md:inline-block" />
        </NavLink>
      ) : (
        <div className="hidden rounded-2xl border border-border/60 bg-background/55 px-2 py-1 text-xs text-muted-foreground md:block">
          {me.status === "loading"
            ? copy.layout.loadingAccount
            : me.status === "backend_error"
              ? copy.common.backendProblem
              : copy.layout.notLoggedIn}
        </div>
      );

  const renderActions = () => (
    <div className="flex items-center justify-end gap-1.5">
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={hubTopbarButtonClass}
          disabled={layoutEditMode}
          onClick={(event) => {
            play("panel");
            openCommandPalette(event.currentTarget);
          }}
        >
          <SearchIcon data-icon="inline-start" />
          {copy.common.command}
        </Button>
        <Button
          type="button"
          variant={prefsPanelOpen ? "secondary" : "outline"}
          size="sm"
          className={hubTopbarButtonClass}
          disabled={layoutEditMode}
          onClick={() => {
            play("panel");
            setPrefsPanelOpen((prev) => !prev);
          }}
          title={copy.hubPrefsPanel.openButton}
        >
          <Settings2 data-icon="inline-start" />
          <span className="hidden sm:inline">{copy.hubPrefsPanel.openButton}</span>
        </Button>
        <Button
          type="button"
          variant={layoutEditMode ? "secondary" : "ghost"}
          size="sm"
          className={cn(hubTopbarButtonClass, !layoutEditMode && "text-muted-foreground")}
          onClick={toggleLayoutEditMode}
          title={layoutEditMode ? copy.chrome.layoutEditExit : copy.chrome.layoutEditEnter}
        >
          <LayoutGrid data-icon="inline-start" />
          {layoutEditMode ? copy.chrome.layoutEditExit : copy.chrome.layoutEditEnter}
        </Button>
      </div>
      <div className="ms-1 flex items-center gap-1 border-l border-border/55 ps-1.5">
        {import.meta.env.DEV && HUB_SHELL_CONTEXT_MENU_ON_RIGHT_CLICK ? (
          <Button
            type="button"
            variant={nativeBrowserContextMenu ? "secondary" : "outline"}
            size="sm"
            className={hubTopbarButtonClass}
            onClick={toggleDevNativeContextMenu}
            title={
              nativeBrowserContextMenu
                ? copy.chrome.devNativeContextButtonBrowser
                : copy.chrome.devNativeContextButtonShell
            }
            aria-label={
              nativeBrowserContextMenu
                ? copy.chrome.devNativeContextButtonBrowser
                : copy.chrome.devNativeContextButtonShell
            }
          >
            <Inspect className="size-3.5" />
          </Button>
        ) : null}
        <ModeToggle triggerClassName="size-7 rounded-md [&_svg]:size-3.5" />
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        "hub-os-select-root relative flex h-dvh flex-col overflow-hidden bg-background text-foreground",
        layoutEditMode && "ring-2 ring-inset ring-primary/30",
      )}
      onContextMenu={HUB_SHELL_CONTEXT_MENU_ON_RIGHT_CLICK ? openShellContextMenu : undefined}
    >
      <HubShellInspectCursor active={shellCustomCursorActive} prefs={hubPrefs.inspectCursor} />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,color-mix(in_oklab,var(--primary)_18%,transparent),transparent_24%),radial-gradient(circle_at_bottom_right,color-mix(in_oklab,var(--accent)_14%,transparent),transparent_28%),linear-gradient(180deg,color-mix(in_oklab,var(--background)_94%,black),var(--background))]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,color-mix(in_oklab,var(--border)_18%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklab,var(--border)_14%,transparent)_1px,transparent_1px)] bg-[size:96px_96px] opacity-35 dark:hidden" />

      <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-row">
        <aside
          className="flex w-[min(100%,14rem)] shrink-0 flex-col border-r border-border/55 bg-background/85 backdrop-blur-md"
          {...hubContextData({ type: "shell.nav", area: "sidebar" })}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
            <HubShellObject
              as="div"
              objectId="shell.brandRow"
              objectKind="brandBlock"
              label={copy.chrome.shellObjectBrandBlock}
              layoutEditMode={layoutEditMode && brandBlockEditable}
              className="flex min-w-0 shrink-0 flex-col gap-1"
            >
              <Link
                to="/dashboard"
                tabIndex={layoutEditMode ? -1 : undefined}
                onClick={(e) => {
                  if (layoutEditMode) e.preventDefault();
                }}
                className={cn(
                  "flex items-center gap-2 rounded-xl px-2 py-1.5 transition-colors hover:text-primary/90",
                  layoutEditMode && "pointer-events-none select-none",
                )}
                {...hubContextData({
                  type: "tool",
                  toolId: "dashboard",
                  label: copy.chrome.toolDesktop,
                  path: "/dashboard",
                  pinned: true,
                })}
              >
                <div className="rounded-lg border border-border/60 bg-primary/14 p-1 text-primary">
                  <Command className="size-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold tracking-[0.04em] leading-tight">
                    {copy.chrome.brandTitle}
                  </div>
                  <div className="truncate text-[0.62rem] uppercase leading-tight tracking-[0.18em] text-muted-foreground">
                    {copy.chrome.brandTagline}
                  </div>
                </div>
              </Link>
            </HubShellObject>

            <HubShellObject
              as="nav"
              objectId="shell.nav.primary"
              objectKind="navGroup"
              label={copy.chrome.shellObjectNavGroup}
              layoutEditMode={layoutEditMode}
              layoutEditChrome="none"
              className="flex min-w-0 flex-1 flex-col gap-0"
              aria-label={copy.chrome.shellObjectNavGroup}
            >
              <HubShellReorderablePrimaryNav
                order={primaryNavOrder}
                onReorder={setPrimaryNavOrder}
                layoutEditMode={layoutEditMode}
                play={play}
                copy={copy}
                navButtonClassName={sidebarNavButtonClassName}
                profilePath={profilePath}
                navBookmarks={navBookmarks}
                primaryNavOverrides={primaryNavOverrides}
                orientation="vertical"
                onContextMenu={
                  HUB_SHELL_CONTEXT_MENU_ON_RIGHT_CLICK ? openShellContextMenu : undefined
                }
              />
            </HubShellObject>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header
            ref={topbarRef}
            className="hub-shell-header relative z-20"
            {...hubContextData({ type: "shell.nav", area: "topbar" })}
          >
            <div className="hub-shell-header-inner flex flex-col gap-1 px-3 py-0.5 md:px-4">
              <div className="flex flex-col gap-1 lg:flex-row lg:items-center lg:gap-2 lg:gap-y-0">
                {SHOW_HUB_LIVE_TICKER ? (
                  <div className="hidden min-w-0 shrink-0 grow basis-0 lg:flex">
                    <HubLiveTicker variant="top" />
                  </div>
                ) : null}
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 border-t border-border/45 pt-1.5 lg:ml-auto lg:border-t-0 lg:pt-0">
                  {renderActions()}
                  {renderIdentity()}
                  {me.status === "user" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className={hubTopbarButtonClass}
                      onClick={logout}
                    >
                      {copy.common.logOut}
                    </Button>
                  ) : (
                    <Button asChild size="sm" className={hubTopbarButtonClass}>
                      <Link to="/login">{copy.common.logIn}</Link>
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </header>

          <div className="relative flex min-h-0 flex-1">
            <main
              className={cn(
                "flex min-h-0 flex-1 overflow-auto",
                authGateActive && "pointer-events-none select-none opacity-40",
              )}
            >
              {isDashboardRoute ? (
                <Outlet context={contextValue} />
              ) : (
                <HubShellObject
                  as="section"
                  objectId={`shell.route.${panelMeta.id}`}
                  objectKind="routePanel"
                  label={panelMeta.label}
                  layoutEditMode={layoutEditMode}
                  layoutEditChrome="none"
                  className="flex min-h-0 w-full flex-1 flex-col"
                  aria-label={panelMeta.label}
                >
                  <div
                    className={cn(
                      "min-h-0 flex-1 overflow-auto px-3 pb-5 md:px-4 md:pb-6",
                      layoutEditMode &&
                        !routeContentCaps.editableInLayout &&
                        "[&_a]:pointer-events-none [&_button]:pointer-events-none [&_input]:pointer-events-none [&_select]:pointer-events-none [&_textarea]:pointer-events-none [&_[role=button]]:pointer-events-none",
                    )}
                  >
                    <Outlet context={contextValue} />
                  </div>
                </HubShellObject>
              )}
            </main>
            {authGateActive ? (
              <div className="absolute inset-0 z-20 flex items-center justify-center p-6">
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/50 via-background/80 to-background/95 backdrop-blur-sm" />
                <div className="relative z-10 w-full max-w-md">
                  <Card className="border-border/65 bg-background/90 shadow-2xl backdrop-blur-xl">
                    <CardHeader>
                      <CardTitle>{copy.login.title}</CardTitle>
                      <CardDescription>{copy.login.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                      {oauthError ? (
                        <p className="text-sm text-destructive" role="alert">
                          {copy.login.oauthFailed}
                        </p>
                      ) : null}
                      {apiUnreachable ? (
                        <p className="text-sm text-muted-foreground" role="status">
                          {copy.login.apiUnreachable}
                        </p>
                      ) : null}
                      {apiUnreachable ? (
                        <Button type="button" className="w-full" disabled>
                          {copy.login.continueDisabled}
                        </Button>
                      ) : (
                        <Button asChild className="w-full">
                          <a href={apiUrl("/api/auth/discord")}>{copy.login.continueDiscord}</a>
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 h-[var(--hub-shell-bottom-bar)]" />

      {SHOW_HUB_DOCK ? (
      <HubDock
        tools={orderedDockTools}
        pinnedIds={pinnedIds}
        meTool={profilePath ? localizeMeTool(copy, profilePath) : null}
        layoutEditMode={layoutEditMode}
        dockShellLabel={copy.chrome.shellObjectDockBar}
        isDashboardRoute={isDashboardRoute}
        desktopShell={desktopShellState}
        gridSnapEnabled={gridSnapEnabled}
        gridVisible={gridVisible}
        onToggleGridSnap={toggleGridSnap}
        onToggleGridVisible={toggleGridVisible}
        onCancelLayoutEdit={cancelLayoutEdit}
        onDoneLayoutEdit={doneLayoutEdit}
        onSaveLayoutCommitted={() => desktopShellState?.saveLayoutCommitted()}
        onDiscardLayoutDraft={() => desktopShellState?.discardLayoutDraft()}
        onUndoLayout={() => desktopShellState?.undoLayout()}
        onRedoLayout={() => desktopShellState?.redoLayout()}
        onToggleAutosaveLayout={() => desktopShellState?.toggleAutosaveLayout()}
        copy={copy}
        audioEnabled={audioEnabled}
        onToggleAudio={actionApi.toggleAudio}
        onCyclePalette={actionApi.cyclePalette}
        onOpenCommandPalette={actionApi.openCommandPalette}
        onSummonGoblin={actionApi.summonGoblin}
        onAppeaseHamster={actionApi.appeaseHamster}
        onOpenPrefs={() => setPrefsPanelOpen(true)}
        onDesktopOnlyAction={() => {
          toasts.push({ kind: "info", title: copy.editMode.desktopOnlyToast });
        }}
        dockPosition={hubPrefs.dock.position}
        dockScale={hubPrefs.dock.scale}
      />
      ) : null}
      <HubCommandPalette
        open={commandOpen}
        onOpenChange={handleCommandOpenChange}
        actions={actions}
      />
      <HubGlobalContextMenu
        open={Boolean(shellContextMenu)}
        position={shellContextMenu?.position ?? { x: 0, y: 0 }}
        sections={shellMenuSections}
        onClose={closeShellContextMenu}
      />
      {primaryNavDialog ? (
        <HubPrimaryNavDialog
          open
          navId={primaryNavDialog.id}
          initialLabel={
            primaryNavOverrides[primaryNavDialog.id]?.label ??
            primaryNavDefaults[primaryNavDialog.id].label
          }
          initialPath={
            primaryNavOverrides[primaryNavDialog.id]?.path ??
            primaryNavDefaults[primaryNavDialog.id].path
          }
          initialIconKey={normalizeNavBookmarkIconKey(
            primaryNavOverrides[primaryNavDialog.id]?.iconKey ??
              primaryNavDefaults[primaryNavDialog.id].iconKey,
          )}
          copy={copy.primaryNav}
          onOpenChange={(next) => {
            if (!next) {
              setPrimaryNavDialog(null);
            }
          }}
          onCommit={commitPrimaryNavOverride}
        />
      ) : null}
      <HubNavBookmarkDialog
        open={bookmarkDialog !== null}
        mode={bookmarkDialog?.mode === "edit" ? "edit" : "add"}
        initialBookmarkId={bookmarkDialog?.mode === "edit" ? bookmarkDialog.id : null}
        initialLabel={
          bookmarkDialog?.mode === "edit" ? (navBookmarks[bookmarkDialog.id]?.label ?? "") : ""
        }
        initialPath={
          bookmarkDialog?.mode === "edit" ? (navBookmarks[bookmarkDialog.id]?.path ?? "") : ""
        }
        initialIconKey={
          bookmarkDialog?.mode === "edit"
            ? normalizeNavBookmarkIconKey(navBookmarks[bookmarkDialog.id]?.iconKey)
            : "Bookmark"
        }
        copy={copy.navBookmarks}
        onOpenChange={(next) => {
          if (!next) {
            setBookmarkDialog(null);
          }
        }}
        onCommit={commitNavBookmark}
        onDelete={bookmarkDialog?.mode === "edit" ? deleteNavBookmarkFromDialog : undefined}
      />
      <HubPrefsPanel
        open={prefsPanelOpen}
        onClose={() => setPrefsPanelOpen(false)}
        widgets={desktopShellState?.widgets ?? []}
      />
    </div>
  );
}
