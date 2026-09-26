import {
  Clock4,
  Dices,
  Flame,
  Gauge,
  MicOff,
  MicVocal,
  MonitorPlay,
  NotebookPen,
  Orbit,
  Quote,
  Radio,
  RotateCcw,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Button } from "@clanker/ui/components/button";
import { Badge } from "@clanker/ui/components/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@clanker/ui/components/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@clanker/ui/components/dialog";
import { Separator } from "@clanker/ui/components/separator";
import { apiUrl } from "@/config";
import { MusicSeekProgressBar } from "@/components/MusicSeekProgressBar";
import HubDesktopSurface, { type HubDesktopWidget } from "@/components/HubDesktopSurface";
import HubCustomModuleBuilder from "@/components/HubCustomModuleBuilder";
import HubLoreQuoteWidget from "@/components/HubLoreQuoteWidget";
import HubMoodClockWidget from "@/components/HubMoodClockWidget";
import { useHubAudio } from "@/components/HubAudioProvider";
import { useHubToasts } from "@/components/HubToastProvider";
import { useHubLocale } from "@/components/locale-provider";
import { useTheme } from "@/components/theme-provider";
import { useHubLayout } from "@/hooks/use-hub-layout";
import { useHubSurfaceEngine } from "@/hooks/use-hub-surface-engine";
import { toBcp47, type HubLocale } from "@/i18n/hub-copy";
import { pickHubChaosLine, rollHubChaos } from "@/lib/hub-chaos";
import { useHubPrefs } from "@/components/HubPrefsProvider";
import {
  HubPrefRow,
  HubPrefSliderRow,
  HubPrefToggleRow,
  HubSegmentControl,
  type HubSegmentOption,
} from "@/components/HubPrefsControls";
import {
  DEFAULT_WIDGET_VISUAL_PREFS,
  gridStepForDensity,
  type HubWidgetSizePreset,
  type HubToneOverride,
} from "@/lib/hub-prefs";
import { HUB_WIDGET_TIERS } from "@/lib/hub-widget-tiers";
import { hubMusicPollIntervalMs } from "@/lib/hub-music-poll-interval";

const HUB_GUILD_ID = import.meta.env.VITE_DISCORD_HUB_GUILD_ID?.trim() ?? "";

type GuildSummaryResponse = {
  guild: {
    id: string;
    name: string;
    icon: string | null;
    approximate_member_count: number | null;
    approximate_presence_count: number | null;
  };
  channel_count: number;
};

type GuildLiveResponse = {
  guild_id: string;
  gateway_connected: boolean;
  gateway_degraded: boolean;
  gateway_degraded_reason: string | null;
  last_event_at: string | null;
  voice_users: { user_id: string; channel_id: string | null }[];
};

type VoiceStateMember = {
  user_id: string;
  channel_id: string;
  channel_name: string | null;
  username: string;
  global_name: string | null;
  avatar: string | null;
  is_muted: boolean;
  is_deafened: boolean;
  is_streaming: boolean;
  is_video: boolean;
  joined_at: string;
};

type VoiceStateChannel = {
  channel_id: string;
  channel_name: string | null;
  members: VoiceStateMember[];
};

type VoiceStatesResponse = {
  guild_id: string;
  channels: VoiceStateChannel[];
  total_users: number;
};

type MusicNowPlaying = {
  guild_id: string;
  track_url: string;
  title: string;
  artist: string | null;
  thumbnail: string | null;
  duration_sec: number | null;
  source: "youtube" | "soundcloud" | "spotify";
  requested_by: string;
  channel_id: string;
  is_paused: boolean;
  started_at: string;
};

type MusicQueueItem = {
  id: number;
  track_url: string;
  title: string;
  artist: string | null;
  thumbnail: string | null;
  duration_sec: number | null;
  source: "youtube" | "soundcloud" | "spotify";
  requested_by: string;
  added_at: string;
};

type MusicState = {
  now_playing: MusicNowPlaying | null;
  queue: MusicQueueItem[];
  total_in_queue: number;
};


type GuildWidgetData = {
  summary: GuildSummaryResponse | null;
  live: GuildLiveResponse | null;
  voiceStates: VoiceStatesResponse | null;
  music: MusicState | null;
  summaryError: string | null;
  liveError: string | null;
};

function pushHistory(values: readonly number[], next: number, max: number): number[] {
  if (max <= 0) return [];
  const trimmed = values.length >= max ? values.slice(values.length - (max - 1)) : [...values];
  return [...trimmed, next];
}

function HubPulseBars({
  values,
  barClassName = "bg-primary/55",
}: {
  values: readonly number[];
  barClassName?: string;
}) {
  if (values.length === 0) {
    return null;
  }
  const max = Math.max(1, ...values);

  return (
    <div className="flex h-7 items-end gap-0.5" aria-hidden>
      {values.map((value, index) => {
        const pct = Math.max(0.14, Math.max(0, value) / max);
        return (
          <div
            key={index}
            className={`w-1 rounded-sm ${barClassName}`}
            style={{ height: `${Math.round(pct * 100)}%` }}
          />
        );
      })}
    </div>
  );
}

function HubWidgetQuickEditDialog({
  widgetId,
  widgetLabel,
  onClose,
}: {
  widgetId: string;
  widgetLabel: string;
  onClose: () => void;
}) {
  const { copy } = useHubLocale();
  const p = copy.hubPrefsPanel;
  const { prefs, updateWidgetVisualPrefs, patchPrefs } = useHubPrefs();
  const wprefs = { ...DEFAULT_WIDGET_VISUAL_PREFS, ...prefs.widgetVisualById[widgetId] };

  const patch = (field: Parameters<typeof updateWidgetVisualPrefs>[1]) =>
    updateWidgetVisualPrefs(widgetId, field);

  const resetWidget = () =>
    patchPrefs({
      widgetVisualById: {
        ...prefs.widgetVisualById,
        [widgetId]: { ...DEFAULT_WIDGET_VISUAL_PREFS },
      },
    });

  const sizeOptions: HubSegmentOption<HubWidgetSizePreset>[] = [
    { value: "compact", label: p.widget.sizeCompact },
    { value: "cozy", label: p.widget.sizeCozy },
    { value: "expanded", label: p.widget.sizeExpanded },
  ];

  const toneOptions: HubSegmentOption<HubToneOverride>[] = [
    { value: "inherit", label: p.widget.toneInherit },
    { value: "useful", label: p.widget.toneUseful },
    { value: "social", label: p.widget.toneSocial },
    { value: "chaos", label: p.widget.toneChaos },
  ];

  const blurOptions: HubSegmentOption<"0" | "1" | "2" | "3">[] = [
    { value: "0", label: p.widget.blurNone },
    { value: "1", label: p.widget.blurLight },
    { value: "2", label: p.widget.blurMedium },
    { value: "3", label: p.widget.blurStrong },
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{copy.desktopSurface.widgetQuickEditTitle(widgetLabel)}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <HubPrefRow label={p.widget.sizePreset}>
            <HubSegmentControl
              options={sizeOptions}
              value={wprefs.sizePreset}
              onChange={(v) => patch({ sizePreset: v })}
            />
          </HubPrefRow>

          <HubPrefRow label={p.widget.toneOverride}>
            <HubSegmentControl
              options={toneOptions}
              value={wprefs.toneOverride}
              onChange={(v) => patch({ toneOverride: v })}
            />
          </HubPrefRow>

          <HubPrefSliderRow
            label={p.widget.glassOpacity}
            hint={p.widget.glassOpacityHint}
            min={0}
            max={100}
            step={5}
            value={wprefs.glassOpacity}
            onChange={(v) => patch({ glassOpacity: v })}
          />

          <HubPrefRow label={p.widget.blurStrength}>
            <HubSegmentControl
              options={blurOptions}
              value={String(wprefs.blurStrength) as "0" | "1" | "2" | "3"}
              onChange={(v) => patch({ blurStrength: Number(v) as 0 | 1 | 2 | 3 })}
            />
          </HubPrefRow>

          <Separator />

          <HubPrefToggleRow
            id={`quick-edit-subtitle-${widgetId}`}
            label={p.widget.showSubtitle}
            description={p.widget.showSubtitleDesc}
            checked={wprefs.showSubtitle}
            onCheckedChange={(v) => patch({ showSubtitle: v })}
          />
          <HubPrefToggleRow
            id={`quick-edit-tone-badge-${widgetId}`}
            label={p.widget.showToneBadge}
            description={p.widget.showToneBadgeDesc}
            checked={wprefs.showToneBadge}
            onCheckedChange={(v) => patch({ showToneBadge: v })}
          />

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full rounded-xl text-muted-foreground"
            onClick={resetWidget}
          >
            <RotateCcw className="size-3.5" />
            {p.widget.resetWidget}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function DashboardPage() {
  const { copy } = useHubLocale();
  const d = copy.dashboard;
  const chaosLines = d.chaosLines;
  const {
    me,
    openCommandPalette,
    refreshMe,
    setDesktopShellState,
    layoutEditMode,
    gridSnapEnabled,
    gridVisible,
  } = useHubLayout();
  const toasts = useHubToasts();
  const { play, enabled: audioEnabled, toggleEnabled: toggleAudio } = useHubAudio();
  const { colorPalette } = useTheme();
  const { prefs } = useHubPrefs();
  const [guildWidget, setGuildWidget] = useState<GuildWidgetData>({
    summary: null,
    live: null,
    voiceStates: null,
    music: null,
    summaryError: null,
    liveError: null,
  });
  const [pulseHistory, setPulseHistory] = useState<{ voice: number[]; online: number[] }>(() => ({
    voice: [],
    online: [],
  }));
  const seedPreview = useMemo(() => `hub-${new Date().toISOString().slice(0, 10)}`, []);
  const [editingWidgetId, setEditingWidgetId] = useState<string | null>(null);
  const fetchMusicRef = useRef<(() => Promise<void>) | null>(null);
  const requestMusicRefresh = useCallback(() => {
    void fetchMusicRef.current?.();
  }, []);

  const surface = useHubSurfaceEngine({
    layoutEditMode,
    gridSnapEnabled,
    gridStep: gridStepForDensity(prefs.desktop.gridDensity),
    prefs,
  });

  const {
    activeLayout,
    selectedWidgetIds,
    autosaveLayoutEnabled,
    isLayoutDirty,
    canUndoLayout,
    canRedoLayout,
    moveWidget,
    moveWidgetsByDelta,
    resizeWidget,
    focusWidget,
    saveLayoutCommitted,
    discardLayoutDraft,
    undoLayout,
    redoLayout,
    toggleAutosaveLayout,
    acknowledgeLayoutSaved,
    setWidgetSelection,
    toggleWidgetInSelection,
    clearWidgetSelection,
    nudgeSelectedWidgets,
    bringSelectedWidgetsToFront,
    revealAllHiddenWidgets: surfaceRevealAll,
    resetWidgetPosition: surfaceResetWidgetPosition,
    resetDesktopLayout: surfaceResetDesktopLayout,
  } = surface;

  useEffect(() => {
    if (me.status !== "user") {
      setPulseHistory({ voice: [], online: [] });
    }
  }, [me.status]);

  useEffect(() => {
    if (!guildWidget.live) return;
    setPulseHistory((prev) => ({
      ...prev,
      voice: pushHistory(prev.voice, guildWidget.live!.voice_users.length, 18),
    }));
  }, [guildWidget.live]);

  useEffect(() => {
    if (!guildWidget.summary) return;
    const online = guildWidget.summary.guild.approximate_presence_count;
    if (typeof online !== "number") return;
    setPulseHistory((prev) => ({
      ...prev,
      online: pushHistory(prev.online, online, 12),
    }));
  }, [guildWidget.summary]);

  useEffect(() => {
    if (me.status !== "user" || !HUB_GUILD_ID) {
      return;
    }
    const ac = new AbortController();

    const readError = async (res: Response): Promise<string> => {
      try {
        const j = (await res.json()) as { error?: string; code?: string };
        if (typeof j.error === "string") {
          return j.code ? `${j.error} (${j.code})` : j.error;
        }
      } catch {
        /* ignore */
      }
      return res.statusText || `HTTP ${res.status}`;
    };

    const fetchSummary = async () => {
      try {
        const res = await fetch(
          apiUrl(`/api/bot/guild/${encodeURIComponent(HUB_GUILD_ID)}/summary`),
          { credentials: "include", signal: ac.signal },
        );
        if (!res.ok) {
          const summaryError = await readError(res);
          setGuildWidget((prev) => ({
            ...prev,
            summary: null,
            summaryError,
          }));
          return;
        }
        const summary = (await res.json()) as GuildSummaryResponse;
        setGuildWidget((prev) => ({
          ...prev,
          summary,
          summaryError: null,
        }));
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          return;
        }
        setGuildWidget((prev) => ({
          ...prev,
          summary: null,
          summaryError: copy.dashboard.networkSummary,
        }));
      }
    };

    const fetchLive = async () => {
      try {
        const res = await fetch(
          apiUrl(`/api/bot/live/guild/${encodeURIComponent(HUB_GUILD_ID)}`),
          { credentials: "include", signal: ac.signal },
        );
        if (!res.ok) {
          const liveError = await readError(res);
          setGuildWidget((prev) => ({
            ...prev,
            live: null,
            liveError,
          }));
          return;
        }
        const live = (await res.json()) as GuildLiveResponse;
        setGuildWidget((prev) => ({ ...prev, live, liveError: null }));
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          return;
        }
        setGuildWidget((prev) => ({
          ...prev,
          live: null,
          liveError: copy.dashboard.networkLive,
        }));
      }
    };

    const fetchVoiceStates = async () => {
      try {
        const res = await fetch(
          apiUrl(`/api/bot/guild/${encodeURIComponent(HUB_GUILD_ID)}/voice-states`),
          { credentials: "include", signal: ac.signal },
        );
        if (!res.ok) return;
        const voiceStates = (await res.json()) as VoiceStatesResponse;
        setGuildWidget((prev) => ({ ...prev, voiceStates }));
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
      }
    };

    const fetchMusic = async () => {
      try {
        const res = await fetch(
          apiUrl(`/api/bot/guild/${encodeURIComponent(HUB_GUILD_ID)}/music`),
          { credentials: "include", signal: ac.signal },
        );
        if (!res.ok) return;
        const music = (await res.json()) as MusicState;
        setGuildWidget((prev) => ({ ...prev, music }));
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
      }
    };

    fetchMusicRef.current = fetchMusic;

    void Promise.all([fetchSummary(), fetchLive(), fetchVoiceStates(), fetchMusic()]);
    const summaryTimer = window.setInterval(() => void fetchSummary(), 15_000);
    const liveTimer = window.setInterval(() => void fetchLive(), 4_000);
    const voiceStatesTimer = window.setInterval(() => void fetchVoiceStates(), 5_000);
    let musicTimer = window.setInterval(() => void fetchMusic(), hubMusicPollIntervalMs());
    const restartMusicPoll = () => {
      window.clearInterval(musicTimer);
      musicTimer = window.setInterval(() => void fetchMusic(), hubMusicPollIntervalMs());
      if (!document.hidden) void fetchMusic();
    };
    document.addEventListener("visibilitychange", restartMusicPoll);
    return () => {
      fetchMusicRef.current = null;
      ac.abort();
      document.removeEventListener("visibilitychange", restartMusicPoll);
      window.clearInterval(summaryTimer);
      window.clearInterval(liveTimer);
      window.clearInterval(voiceStatesTimer);
      window.clearInterval(musicTimer);
    };
  }, [copy, me.status]);

  const profile = me.status === "user" ? me.profile : null;
  const displayName = profile ? profile.global_name ?? profile.username : null;
  const publicProfilePath = profile ? `/u/${encodeURIComponent(profile.id)}` : "/login";

  const widgets = useMemo<HubDesktopWidget[]>(() => {
    if (!profile || !displayName) {
      return [];
    }

    const welcomeWidget: HubDesktopWidget = {
      id: "welcome",
      label: d.widgetWelcome.label,
      description: d.widgetWelcome.description,
      tone: "social",
      icon: UserRound,
      content: (
        <div className="flex flex-col gap-4 text-sm text-muted-foreground">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">@{profile.username}</Badge>
            <Badge variant="outline">{colorPalette}</Badge>
            <Badge variant={audioEnabled ? "outline" : "destructive"}>
              {audioEnabled ? d.welcomeAudioOnline : d.welcomeAudioMuted}
            </Badge>
          </div>
          <div className="rounded-xl border border-border/60 bg-background/60 p-3">
            <p className="text-foreground">{d.welcomeBack(displayName)}</p>
            <p className="mt-1 text-muted-foreground">{d.welcomeBlurb}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link to={publicProfilePath}>{d.openProfile}</Link>
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={openCommandPalette}>
              {d.commandBar}
            </Button>
          </div>
        </div>
      ),
    };

    const serverPulseWidget: HubDesktopWidget = {
      id: "server-pulse",
      label: d.widgetServerPulse.label,
      description: d.widgetServerPulse.description,
      tone: "useful",
      icon: Gauge,
      content: HUB_GUILD_ID ? (
        <div className="flex flex-col gap-3 text-sm text-muted-foreground">
          {guildWidget.summaryError ? <p className="text-destructive">{guildWidget.summaryError}</p> : null}
          {guildWidget.liveError ? <p className="text-destructive">{guildWidget.liveError}</p> : null}
          {guildWidget.summary ? (
            <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-background/60 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium text-foreground">{guildWidget.summary.guild.name}</p>
                <Badge variant="outline">{d.channels(guildWidget.summary.channel_count)}</Badge>
              </div>
              <div className="rounded-lg border border-border/60 bg-background/70 p-2 text-xs text-muted-foreground">
                {d.membersOnline(
                  String(guildWidget.summary.guild.approximate_member_count ?? "—"),
                  String(guildWidget.summary.guild.approximate_presence_count ?? "—"),
                )}
              </div>
              {pulseHistory.online.length >= 2 ? (
                <div
                  className="rounded-lg border border-border/60 bg-background/70 p-2"
                  title={`Online pulse (recent): ${pulseHistory.online.at(-1) ?? 0}`}
                >
                  <HubPulseBars values={pulseHistory.online} barClassName="bg-accent/55" />
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border/60 bg-background/60 p-3">
              <p>{d.serverLoadingSummary}</p>
            </div>
          )}
          {guildWidget.live ? (
            <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-background/70 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{d.gateway}</p>
                <Badge variant={guildWidget.live.gateway_connected ? "outline" : "destructive"}>
                  {guildWidget.live.gateway_connected ? d.gatewayConnected : d.gatewayDisconnected}
                </Badge>
              </div>
              <p className="text-sm text-foreground">{d.voiceNow(guildWidget.live.voice_users.length)}</p>
              {pulseHistory.voice.length >= 2 ? (
                <div
                  className="rounded-lg border border-border/60 bg-background/70 p-2"
                  title={`Voice pulse (recent): ${pulseHistory.voice.at(-1) ?? 0}`}
                >
                  <HubPulseBars values={pulseHistory.voice} />
                </div>
              ) : null}
              <HubGatewayHeartbeat live={guildWidget.live} />
              {guildWidget.live.gateway_degraded_reason ? (
                <p className="text-xs text-warning">{guildWidget.live.gateway_degraded_reason}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">{d.guildIdHint}</div>
      ),
    };

    const moodClockWidget: HubDesktopWidget = {
      id: "mood-clock",
      label: d.widgetMoodClock.label,
      description: d.widgetMoodClock.description,
      tone: "social",
      icon: Clock4,
      content: <HubMoodClockWidget />,
    };

    const loreQuoteWidget: HubDesktopWidget = {
      id: "lore-quote",
      label: d.widgetLoreQuote.label,
      description: d.widgetLoreQuote.description,
      tone: "social",
      icon: Quote,
      content: <HubLoreQuoteWidget />,
    };

    const wheelWidget: HubDesktopWidget = {
      id: "wheel-launchpad",
      label: d.widgetWheel.label,
      description: d.widgetWheel.description,
      tone: "chaos",
      icon: Dices,
      content: (
        <div className="flex flex-col gap-4 text-sm text-muted-foreground">
          <p>{d.wheelBlurb}</p>
          <div className="rounded-xl border border-border/60 bg-background/60 p-3">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Seed</p>
            <p className="mt-2 font-mono text-sm text-foreground">{seedPreview}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link to="/tools/spin-the-wheel">{d.openWheel}</Link>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(seedPreview);
                toasts.push({
                  kind: "info",
                  title: copy.actions.toasts.seedCopied,
                  message: copy.actions.toasts.seedCopiedMessage,
                });
              }}
            >
              {d.copySeedStarter}
            </Button>
          </div>
        </div>
      ),
    };

    const presenceWidget: HubDesktopWidget = {
      id: "presence-radar",
      label: d.widgetPresence.label,
      description: d.widgetPresence.description,
      tone: "social",
      icon: Orbit,
      content: (
        <div className="flex flex-col gap-3 text-sm text-muted-foreground">
          <div className="rounded-xl border border-border/60 bg-background/60 p-3">
            <p className="text-foreground">{d.presenceLine1}</p>
            <p className="mt-2">
              {d.presenceLine2}
              <Link to={publicProfilePath} className="text-foreground underline-offset-4 hover:underline">
                {d.presenceLine2Link}
              </Link>
              .
            </p>
          </div>
          <div className="rounded-xl border border-border/60 bg-background/70 p-3">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{d.liveLineLabel}</p>
            <p className="mt-2 text-sm text-foreground">
              {pickHubChaosLine(chaosLines, chaosLines[0]!, new Date().getHours())}
            </p>
          </div>
        </div>
      ),
    };

    const ritualWidget: HubDesktopWidget = {
      id: "ritual-console",
      label: d.widgetRitual.label,
      description: d.widgetRitual.description,
      tone: "chaos",
      icon: Sparkles,
      content: (
        <div className="flex flex-col gap-4 text-sm text-muted-foreground">
          <p>{d.ritualBlurb}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                toggleAudio();
                toasts.push({
                  kind: "info",
                  title: audioEnabled ? copy.actions.toasts.audioMuted : copy.actions.toasts.audioArmed,
                  message: audioEnabled
                    ? copy.actions.toasts.audioMutedMessage
                    : copy.actions.toasts.audioArmedMessage,
                });
              }}
            >
              {audioEnabled ? d.muteAudio : d.enableAudio}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                play("chaos");
                toasts.push({
                  kind: "chaos",
                  title: d.ritualToastTitle,
                  message: d.ritualToastMessage,
                });
              }}
            >
              {d.fireCeremony}
            </Button>
          </div>
          <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-warning-foreground">
            {d.ritualPolicy}
          </div>
        </div>
      ),
    };

    const chaosMeterWidget: HubDesktopWidget = {
      id: "chaos-meter",
      label: d.widgetChaosMeter.label,
      description: d.widgetChaosMeter.description,
      tone: "chaos",
      icon: Flame,
      content: <HubChaosMeterWidget />,
    };

    const voiceOrbitWidget: HubDesktopWidget = {
      id: "voice-orbit",
      label: d.widgetVoiceOrbit.label,
      description: d.widgetVoiceOrbit.description,
      tone: "social",
      icon: MicVocal,
      content: <HubVoiceOrbitWidget guild={guildWidget.summary?.guild ?? null} live={guildWidget.live} voiceStates={guildWidget.voiceStates} />,
    };

    const radioWidget: HubDesktopWidget = {
      id: "neutralen-radio",
      label: d.widgetRadio.label,
      description: d.widgetRadio.description,
      tone: "social",
      icon: Radio,
      content: <HubNeutralenRadioWidget />,
    };

    const musicPlayerWidget: HubDesktopWidget = {
      id: "music-player",
      label: "Musikspelaren",
      description: "Styr uppspelning och kön direkt från dashboarden.",
      tone: "social",
      icon: Radio,
      content: (
        <HubMusicWidget
          music={guildWidget.music}
          guildId={HUB_GUILD_ID}
          voiceStates={guildWidget.voiceStates}
          userId={profile.id}
          onMusicRefreshRequest={requestMusicRefresh}
        />
      ),
    };

    const customModuleWidget: HubDesktopWidget = {
      id: "custom-modules",
      label: d.widgetCustomModules.label,
      description: d.widgetCustomModules.description,
      tone: "useful",
      icon: NotebookPen,
      content: <HubCustomModuleBuilder storageKey={`hub.custom.modules.${profile.id}.v1`} />,
    };

    return [
      welcomeWidget,
      serverPulseWidget,
      moodClockWidget,
      loreQuoteWidget,
      wheelWidget,
      voiceOrbitWidget,
      musicPlayerWidget,
      radioWidget,
      presenceWidget,
      ritualWidget,
      chaosMeterWidget,
      customModuleWidget,
    ];
  }, [
    audioEnabled,
    chaosLines,
    colorPalette,
    copy,
    d,
    displayName,
    guildWidget.live,
    guildWidget.liveError,
    guildWidget.music,
    guildWidget.summary,
    guildWidget.summaryError,
    guildWidget.voiceStates,
    pulseHistory,
    openCommandPalette,
    play,
    profile,
    publicProfilePath,
    requestMusicRefresh,
    seedPreview,
    toasts,
    toggleAudio,
  ]);

  const orderedWidgets = useMemo(
    () =>
      [...widgets].sort((left, right) => (activeLayout[left.id]?.z ?? 0) - (activeLayout[right.id]?.z ?? 0)),
    [activeLayout, widgets],
  );
  const hiddenWidgetIds = useMemo(
    () => orderedWidgets.filter((widget) => activeLayout[widget.id]?.hidden).map((widget) => widget.id),
    [activeLayout, orderedWidgets],
  );

  const revealWidget = useCallback(
    (id: string) => {
      surface.revealWidget(id);
      play("panel");
      toasts.push({
        kind: "success",
        title: d.toastWidgetOnline,
        message: orderedWidgets.find((widget) => widget.id === id)?.label ?? id,
      });
    },
    [d.toastWidgetOnline, orderedWidgets, play, surface, toasts],
  );

  const hideWidget = useCallback(
    (id: string) => {
      surface.hideWidget(id);
      toasts.push({
        kind: "info",
        title: d.toastWidgetHidden,
        message: orderedWidgets.find((widget) => widget.id === id)?.label ?? id,
      });
    },
    [d.toastWidgetHidden, orderedWidgets, surface, toasts],
  );

  const resetWidgetPosition = useCallback(
    (id: string) => {
      surfaceResetWidgetPosition(id);
      play("panel");
      toasts.push({
        kind: "info",
        title: copy.shellMenu.resetWidgetPosition,
        message: copy.desktopSurface.widgetPositionResetToast,
      });
    },
    [copy.desktopSurface.widgetPositionResetToast, copy.shellMenu.resetWidgetPosition, surfaceResetWidgetPosition, play, toasts],
  );

  const resetDesktopLayout = useCallback(() => {
    surfaceResetDesktopLayout();
    play("panel");
    toasts.push({
      kind: "info",
      title: d.toastDesktopReset,
      message: d.toastDesktopResetMessage,
    });
  }, [d.toastDesktopReset, d.toastDesktopResetMessage, surfaceResetDesktopLayout, play, toasts]);

  const openAddModuleFlow = useCallback(() => {
    const hasSleepingModules = hiddenWidgetIds.length > 0;
    window.setTimeout(() => {
      const spawn = document.getElementById("hub-spawn-modules");
      spawn?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (hasSleepingModules) {
        (spawn?.querySelector("button") as HTMLButtonElement | null)?.focus();
      }
    }, 0);
    play("panel");
    toasts.push({
      kind: "info",
      title: copy.editMode.addModuleToastTitle,
      message: copy.editMode.addModuleToastBody,
    });
  }, [
    copy.editMode.addModuleToastBody,
    copy.editMode.addModuleToastTitle,
    hiddenWidgetIds.length,
    play,
    toasts,
  ]);

  const revealAllHiddenWidgets = useCallback(() => {
    if (hiddenWidgetIds.length === 0) {
      return;
    }
    surfaceRevealAll(hiddenWidgetIds);
    play("panel");
    toasts.push({
      kind: "success",
      title: copy.editMode.restoreAllTitle,
      message: copy.editMode.restoreAllMessage,
    });
  }, [
    copy.editMode.restoreAllMessage,
    copy.editMode.restoreAllTitle,
    hiddenWidgetIds,
    surfaceRevealAll,
    play,
    toasts,
  ]);

  const wrappedSaveLayoutCommitted = useCallback(() => {
    saveLayoutCommitted();
    play("confirm");
    toasts.push({
      kind: "success",
      title: copy.editMode.layoutSavedTitle,
      message: copy.editMode.layoutSavedMessage,
    });
  }, [copy.editMode.layoutSavedMessage, copy.editMode.layoutSavedTitle, play, saveLayoutCommitted, toasts]);

  const wrappedDiscardLayoutDraft = useCallback(() => {
    discardLayoutDraft();
    toasts.push({
      kind: "info",
      title: copy.editMode.layoutDiscardedTitle,
      message: copy.editMode.layoutDiscardedMessage,
    });
  }, [copy.editMode.layoutDiscardedMessage, copy.editMode.layoutDiscardedTitle, discardLayoutDraft, toasts]);

  const triggerChaosPulse = useCallback(() => {
    const memeFreq = prefs.copyStyle.memeFrequency;
    const chaosAudio = memeFreq === "off" ? false : rollHubChaos(memeFreq === "low" ? "rare" : "rare");
    play(chaosAudio ? "chaos" : "confirm");
    toasts.push({
      kind: "chaos",
      title: d.toastDesktopPulse,
      message: memeFreq === "off" ? undefined : pickHubChaosLine(chaosLines, chaosLines[0]!),
    });
    if (memeFreq !== "off" && rollHubChaos("sometimes")) {
      const sleeping = hiddenWidgetIds[0];
      if (sleeping) {
        revealWidget(sleeping);
      }
    }
  }, [chaosLines, d.toastDesktopPulse, hiddenWidgetIds, play, prefs.copyStyle.memeFrequency, revealWidget, toasts]);

  const desktopShellWidgets = useMemo(
    () => widgets.map((widget) => ({ id: widget.id, label: widget.label, tone: widget.tone })),
    [widgets],
  );

  const toggleDesktopAudio = useCallback(() => {
    toggleAudio();
    if (!audioEnabled) {
      play("dock");
    }
  }, [audioEnabled, play, toggleAudio]);

  useEffect(() => {
    setDesktopShellState({
      widgets: desktopShellWidgets,
      hiddenWidgetIds,
      audioEnabled,
      revealWidget,
      hideWidget,
      resetLayout: resetDesktopLayout,
      triggerChaos: triggerChaosPulse,
      toggleAudio: toggleDesktopAudio,
      focusWidget,
      resetWidgetPosition,
      openAddModuleFlow,
      revealAllHiddenWidgets,
      saveLayoutCommitted: wrappedSaveLayoutCommitted,
      discardLayoutDraft: wrappedDiscardLayoutDraft,
      undoLayout,
      redoLayout,
      canUndoLayout,
      canRedoLayout,
      isLayoutDirty,
      autosaveLayoutEnabled,
      toggleAutosaveLayout,
      selectedWidgetIds,
      setWidgetSelection,
      toggleWidgetInSelection,
      clearWidgetSelection,
      nudgeSelectedWidgets,
      bringSelectedWidgetsToFront,
      moveWidget,
      moveWidgetsByDelta,
      resizeWidget,
      acknowledgeLayoutSaved,
    });

    return () => setDesktopShellState(null);
  }, [
    audioEnabled,
    autosaveLayoutEnabled,
    bringSelectedWidgetsToFront,
    canRedoLayout,
    canUndoLayout,
    clearWidgetSelection,
    desktopShellWidgets,
    wrappedDiscardLayoutDraft,
    focusWidget,
    hiddenWidgetIds,
    hideWidget,
    isLayoutDirty,
    moveWidget,
    moveWidgetsByDelta,
    nudgeSelectedWidgets,
    openAddModuleFlow,
    redoLayout,
    resetDesktopLayout,
    resetWidgetPosition,
    resizeWidget,
    revealAllHiddenWidgets,
    revealWidget,
    wrappedSaveLayoutCommitted,
    acknowledgeLayoutSaved,
    selectedWidgetIds,
    setDesktopShellState,
    setWidgetSelection,
    toggleAutosaveLayout,
    toggleDesktopAudio,
    toggleWidgetInSelection,
    triggerChaosPulse,
    undoLayout,
  ]);

  if (me.status === "loading") {
    return (
      <div className="mx-auto max-w-4xl px-5 py-10 text-muted-foreground">{copy.common.loadingProfile}</div>
    );
  }

  if (me.status === "guest") {
    return <Navigate to="/login" replace />;
  }

  if (me.status === "backend_error") {
    const bc = copy.backendCard;
    return (
      <div className="mx-auto max-w-lg px-5 py-10">
        <Card>
          <CardHeader>
            <CardTitle>{bc.title}</CardTitle>
            <CardDescription>
              <code className="text-foreground">discord-hub-api</code> — {bc.description}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
            <p>{bc.body}</p>
            <p>{bc.hintEnv}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="button" size="sm" onClick={() => void refreshMe()}>
                {bc.retry}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const editingWidget = editingWidgetId
    ? orderedWidgets.find((w) => w.id === editingWidgetId) ?? null
    : null;

  return (
    <>
      <HubDesktopSurface
        widgets={orderedWidgets}
        layouts={activeLayout}
        hiddenWidgetIds={hiddenWidgetIds}
        widgetVisualPrefsById={prefs.widgetVisualById}
        showWidgetBorder={prefs.desktop.showWidgetBorder}
        animationIntensity={prefs.motion.animationIntensity}
        onMoveWidget={moveWidget}
        onResizeWidget={resizeWidget}
        onFocusWidget={focusWidget}
        onOpenWidget={revealWidget}
        onHideWidget={hideWidget}
        layoutEditMode={layoutEditMode}
        gridStep={gridStepForDensity(prefs.desktop.gridDensity)}
        snapStrength={prefs.desktop.snapStrength}
        gridSnapEnabled={gridSnapEnabled}
        gridCompaction={prefs.desktop.gridCompaction}
        showGrid={gridVisible}
        onSelectWidget={toggleWidgetInSelection}
        onEditWidget={setEditingWidgetId}
        onResetWidgetPosition={resetWidgetPosition}
      />
      {editingWidget ? (
        <HubWidgetQuickEditDialog
          widgetId={editingWidget.id}
          widgetLabel={editingWidget.label}
          onClose={() => setEditingWidgetId(null)}
        />
      ) : null}
    </>
  );
}

type HubRadioTrack = {
  title: string;
  artist: string;
  mood: string;
};

const NEUTRALEN_RADIO_TRACKS: readonly HubRadioTrack[] = [
  { title: "Bara en snabb match", artist: "Kabelkören", mood: "copium" },
  { title: "Gateway Degraded (But Make It Cute)", artist: "Neutralen OS", mood: "pulse" },
  { title: "Seedloop 07", artist: "Wheel Whisper", mood: "chaos" },
  { title: "Dock Staring Contest", artist: "Taskbar Gremlin", mood: "glow" },
  { title: "Ritual Console Lullaby", artist: "Ambient Sysadmin", mood: "soft" },
  { title: "Presence Radar (Lo-Fi)", artist: "Orbit Kids", mood: "warm" },
];

function pickRadioTrack(seed: number): HubRadioTrack {
  const index = Math.abs(seed) % NEUTRALEN_RADIO_TRACKS.length;
  return NEUTRALEN_RADIO_TRACKS[index] ?? NEUTRALEN_RADIO_TRACKS[0]!;
}

function HubNeutralenRadioWidget() {
  const { copy } = useHubLocale();
  const d = copy.dashboard;
  const { play } = useHubAudio();
  const toasts = useHubToasts();
  const [shuffleSeed, setShuffleSeed] = useState(0);
  const [startedAtMs, setStartedAtMs] = useState(() => Date.now());
  const [nowMs, setNowMs] = useState(() => Date.now());

  const track = useMemo(() => {
    const daySeed = Number(new Date().toISOString().slice(8, 10));
    return pickRadioTrack(daySeed + shuffleSeed);
  }, [shuffleSeed]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const progress = useMemo(() => {
    const durationMs = 212_000;
    const elapsedMs = Math.max(0, nowMs - startedAtMs);
    return (elapsedMs % durationMs) / durationMs;
  }, [nowMs, startedAtMs]);

  return (
    <div className="flex flex-col gap-3 text-sm text-muted-foreground">
      <p>{d.radioBlurb}</p>

      <div className="relative overflow-hidden rounded-xl border border-border/60 bg-background/60 p-3">
        <div className="pointer-events-none absolute inset-0 hub-radio-static" aria-hidden />
        <div className="relative z-10">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{d.radioNowPlayingLabel}</p>
              <p className="mt-2 truncate text-base font-medium text-foreground">{track.title}</p>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {track.artist} · {track.mood}
              </p>
            </div>
            <Badge variant="outline" className="shrink-0">
              {d.radioBadge}
            </Badge>
          </div>

          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted/50">
            <div
              className="hub-radio-progress h-full rounded-full bg-primary/70 motion-reduce:transition-none"
              style={{ width: `${Math.max(6, Math.round(progress * 100))}%` }}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            play("confirm");
            const daySeed = Number(new Date().toISOString().slice(8, 10));
            const nextSeed = shuffleSeed + 1;
            const nextTrack = pickRadioTrack(daySeed + nextSeed);
            setShuffleSeed(nextSeed);
            setStartedAtMs(Date.now());
            toasts.push({
              kind: "info",
              title: d.radioToastTitle,
              message: d.radioToastMessage(nextTrack.title),
            });
          }}
        >
          {d.radioShuffle}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            play("panel");
            toasts.push({
              kind: "chaos",
              title: d.radioRequestToastTitle,
              message: d.radioRequestToastMessage,
            });
          }}
        >
          {d.radioRequest}
        </Button>
      </div>
    </div>
  );
}

function discordAvatarUrl(userId: string, avatarHash: string): string {
  return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png?size=64`;
}

function VoiceMemberAvatar({ member }: { member: VoiceStateMember }) {
  const initial = (member.global_name ?? member.username).charAt(0).toUpperCase();
  return (
    <div className="relative shrink-0" title={member.global_name ?? member.username}>
      {member.avatar ? (
        <img
          src={discordAvatarUrl(member.user_id, member.avatar)}
          alt={member.global_name ?? member.username}
          className="size-6 rounded-full object-cover"
        />
      ) : (
        <div className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
          {initial}
        </div>
      )}
      {member.is_muted && (
        <div className="absolute -bottom-0.5 -right-0.5 flex size-3 items-center justify-center rounded-full bg-background ring-1 ring-border">
          <MicOff className="size-2 text-destructive" />
        </div>
      )}
      {member.is_streaming && !member.is_muted && (
        <div className="absolute -bottom-0.5 -right-0.5 flex size-3 items-center justify-center rounded-full bg-background ring-1 ring-border">
          <MonitorPlay className="size-2 text-primary" />
        </div>
      )}
    </div>
  );
}

function HubVoiceOrbitWidget({
  guild,
  live,
  voiceStates,
}: {
  guild: GuildSummaryResponse["guild"] | null;
  live: GuildLiveResponse | null;
  voiceStates: VoiceStatesResponse | null;
}) {
  const { copy } = useHubLocale();
  const d = copy.dashboard;

  const totalUsers = voiceStates?.total_users ?? live?.voice_users.length ?? 0;
  const channelCount = voiceStates?.channels.length ?? 0;

  return (
    <div className={`flex flex-col text-sm text-muted-foreground ${HUB_WIDGET_TIERS.adaptiveGap}`}>
      {/* Always visible: gateway badge row */}
      <div className="flex items-center justify-between gap-2">
        <div className={`min-w-0 ${HUB_WIDGET_TIERS.hiddenAtMicro}`}>
          <p className="truncate text-sm font-medium text-foreground">{guild?.name ?? d.voiceOrbitUnknownGuild}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {voiceStates
              ? d.voiceOrbitSoulsLine(totalUsers, channelCount)
              : live
                ? d.voiceOrbitSoulsLine(totalUsers, 0)
                : d.voiceOrbitNoSignal}
          </p>
        </div>
        <Badge variant={live?.gateway_connected ? "outline" : "destructive"} className="shrink-0">
          {live?.gateway_connected ? d.voiceOrbitGatewayOk : d.voiceOrbitGatewayNope}
        </Badge>
      </div>

      {/* Base+: channel content */}
      <div className={HUB_WIDGET_TIERS.hiddenAtMicro}>
        {voiceStates && voiceStates.channels.length > 0 ? (
          <>
            {/* Wide+: full channel list */}
            <div className={`flex flex-col gap-1.5 ${HUB_WIDGET_TIERS.blurbVisible}`}>
              {voiceStates.channels.map((channel) => (
                <div key={channel.channel_id} className="rounded-lg border border-border/60 bg-background/60 px-2.5 py-2">
                  <p className="mb-1.5 truncate text-[11px] font-medium text-foreground/60">
                    🔊 {channel.channel_name ?? channel.channel_id}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {channel.members.map((member) => (
                      <VoiceMemberAvatar key={member.user_id} member={member} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {/* Base only: compact summary pill — hidden at Wide+ */}
            <div className="@[320px]:hidden rounded-lg border border-border/60 bg-background/60 px-2.5 py-2">
              <p className="text-center text-xs text-muted-foreground">
                {channelCount} ch · {totalUsers} {totalUsers === 1 ? "user" : "users"}
              </p>
            </div>
          </>
        ) : (
          <div className="rounded-lg border border-border/60 bg-background/60 px-2.5 py-2">
            <p className="text-center text-xs text-muted-foreground">{d.voiceOrbitNoSignal}</p>
          </div>
        )}
      </div>

      {/* Full+: degraded gateway reason */}
      {live?.gateway_degraded_reason ? (
        <p className={`text-xs text-warning ${HUB_WIDGET_TIERS.fullVisible}`}>{live.gateway_degraded_reason}</p>
      ) : null}
    </div>
  );
}

function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / 86_400_000);
}

function formatRelativeAge(locale: HubLocale, ageMs: number): string {
  const safeAge = Math.max(0, Math.round(ageMs));
  const seconds = Math.round(safeAge / 1000);
  const minutes = Math.round(safeAge / 60_000);
  const hours = Math.round(safeAge / 3_600_000);

  const rtf = new Intl.RelativeTimeFormat(toBcp47(locale), {
    numeric: "auto",
    style: "short",
  });

  if (safeAge < 60_000) {
    return rtf.format(-seconds, "second");
  }
  if (safeAge < 3_600_000) {
    return rtf.format(-minutes, "minute");
  }
  return rtf.format(-hours, "hour");
}

function SourceIcon({ source }: { source: MusicNowPlaying["source"] }) {
  const labels: Record<MusicNowPlaying["source"], string> = {
    youtube: "YT",
    soundcloud: "SC",
    spotify: "SP",
  };
  return (
    <span className="shrink-0 rounded px-1 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-muted text-muted-foreground">
      {labels[source]}
    </span>
  );
}

function MusicRequesterAvatar({ userId, voiceStates }: { userId: string; voiceStates: VoiceStatesResponse | null }) {
  const member = voiceStates?.channels.flatMap((ch) => ch.members).find((m) => m.user_id === userId);
  const defaultAvatar = `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(userId) % 6n)}.png`;
  const src = member?.avatar ? discordAvatarUrl(member.user_id, member.avatar) : defaultAvatar;
  const name = member ? (member.global_name ?? member.username) : userId;
  return <img src={src} alt={name} title={name} className="size-4 rounded-full object-cover shrink-0 opacity-80" />;
}

function HubMusicWidget({
  music,
  guildId,
  voiceStates,
  userId,
  onMusicRefreshRequest,
}: {
  music: MusicState | null;
  guildId: string;
  voiceStates: VoiceStatesResponse | null;
  userId: string;
  /** After hub → bot mutations, poll immediately so the widget matches Discord without waiting for the interval. */
  onMusicRefreshRequest?: () => void;
}) {
  const { copy } = useHubLocale();
  const d = copy.dashboard;
  const toasts = useHubToasts();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(t);
  }, []);

  const cmd = useCallback(
    async (action: string, body?: Record<string, unknown>) => {
      setLoading(true);
      let ok = false;
      try {
        const res = await fetch(apiUrl(`/api/bot/guild/${encodeURIComponent(guildId)}/music/${action}`), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body ?? {}),
        });
        ok = res.ok;
        if (action === "previous" && res.ok) {
          try {
            const j = (await res.json()) as { wentBack?: boolean };
            if (j.wentBack === false) {
              toasts.push({
                kind: "info",
                title: d.musicPreviousTitle,
                message: d.musicPreviousNone,
              });
            }
          } catch {
            /* ignore */
          }
        }
      } finally {
        setLoading(false);
        if (ok) onMusicRefreshRequest?.();
      }
    },
    [guildId, d.musicPreviousTitle, d.musicPreviousNone, toasts, onMusicRefreshRequest],
  );

  const resolveChannelId = (): string | null => {
    if (music?.now_playing?.channel_id) return music.now_playing.channel_id;
    for (const ch of voiceStates?.channels ?? []) {
      if (ch.members.some((m) => m.user_id === userId)) return ch.channel_id;
    }
    return null;
  };

  const handlePlay = async () => {
    if (!query.trim()) return;
    const channelId = resolveChannelId();
    if (!channelId) {
      toasts.push({
        kind: "error",
        title: d.musicPlayFailedTitle,
        message: d.musicNeedVoiceChannel,
      });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        apiUrl(`/api/bot/guild/${encodeURIComponent(guildId)}/music/play`),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: query.trim(), channelId }),
        },
      );
      let payload: { error?: string; code?: string } = {};
      try {
        payload = (await res.json()) as { error?: string; code?: string };
      } catch {
        /* ignore */
      }
      if (!res.ok) {
        let message = d.musicPlayFailedGeneric;
        if (payload.code === "spotify_playlist") {
          message = d.musicSpotifyPlaylistUnavailable;
        } else if (typeof payload.error === "string" && payload.error.trim()) {
          if (payload.error === "Could not resolve track") {
            message = d.musicPlayFailedGeneric;
          } else {
            message = payload.error;
          }
        }
        toasts.push({
          kind: "error",
          title: d.musicPlayFailedTitle,
          message,
        });
        return;
      }
      setQuery("");
      onMusicRefreshRequest?.();
    } finally {
      setLoading(false);
    }
  };

  const np = music?.now_playing ?? null;

  return (
    <div className="flex flex-col gap-3 text-sm">
      {/* Player card */}
      {np ? (
        <div>
          {/* Art + track info */}
          <div className="flex gap-4">
            <div className="shrink-0">
              {np.thumbnail ? (
                <img
                  src={np.thumbnail}
                  alt=""
                  className="size-20 rounded-xl object-cover shadow-md"
                />
              ) : (
                <div className="size-20 rounded-xl bg-muted flex items-center justify-center text-2xl">
                  🎵
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 flex flex-col justify-center gap-1">
              <p className="truncate font-semibold text-base text-foreground leading-tight">{np.title}</p>
              {np.artist && (
                <p className="truncate text-xs text-muted-foreground">{np.artist}</p>
              )}
              <div className="flex items-center gap-1.5 mt-0.5">
                <SourceIcon source={np.source} />
                {np.is_paused && (
                  <span className="rounded px-1 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-yellow-500/20 text-yellow-500">
                    Pausad
                  </span>
                )}
                <MusicRequesterAvatar userId={np.requested_by} voiceStates={voiceStates} />
              </div>
            </div>
          </div>

          {/* Progress */}
          <div className="mt-4">
            <MusicSeekProgressBar
              track={np}
              nowMs={nowMs}
              onSeek={(sec) => void cmd("seek", { seekSec: sec })}
            />
          </div>

          {/* Controls */}
          <div className="mt-3 flex items-center justify-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={loading}
              className="size-9 rounded-full p-0 text-base"
              onClick={() => void cmd("previous")}
              title={d.musicPreviousTitle}
            >
              ⏮
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={loading}
              className="size-9 rounded-full p-0 text-base"
              onClick={() => void cmd(np.is_paused ? "resume" : "pause")}
              title={np.is_paused ? "Återuppta" : "Pausa"}
            >
              {np.is_paused ? "▶️" : "⏸"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={loading}
              className="size-9 rounded-full p-0 text-base"
              onClick={() => void cmd("skip")}
              title="Skippa"
            >
              ⏭
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={loading}
              className="size-9 rounded-full p-0 text-base"
              onClick={() => void cmd("stop")}
              title="Stoppa"
            >
              ⏹
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <span className="text-3xl">🎵</span>
          <p className="text-xs text-muted-foreground">Inget spelas just nu</p>
        </div>
      )}

      {/* Add to queue */}
      <div className="flex gap-1.5">
        <input
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
          placeholder="YouTube, Spotify, SoundCloud, spellista eller sökterm…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void handlePlay(); }}
        />
        <Button size="sm" disabled={!query.trim() || loading} onClick={() => void handlePlay()}>
          ▶ Spela
        </Button>
      </div>

      {/* Queue */}
      {music && music.queue.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">Kö ({music.total_in_queue})</p>
          {music.queue.slice(0, 5).map((item, i) => (
            <div key={item.id} className="flex items-center gap-2 rounded-lg bg-muted/40 px-2 py-1.5">
              <span className="shrink-0 text-xs text-muted-foreground">{i + 1}.</span>
              <SourceIcon source={item.source} />
              <span className="truncate text-xs text-foreground">{item.title}</span>
              <MusicRequesterAvatar userId={item.requested_by} voiceStates={voiceStates} />
            </div>
          ))}
          {music.total_in_queue > 5 && (
            <p className="text-center text-xs text-muted-foreground">+{music.total_in_queue - 5} till</p>
          )}
        </div>
      )}
    </div>
  );
}

function HubGatewayHeartbeat({ live }: { live: GuildLiveResponse }) {
  const { locale, copy } = useHubLocale();
  const d = copy.dashboard;
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 2_000);
    return () => window.clearInterval(timer);
  }, []);

  const eventMs = live.last_event_at ? Date.parse(live.last_event_at) : Number.NaN;
  if (!Number.isFinite(eventMs)) {
    return <p className="text-xs text-muted-foreground">{d.gatewayLastEventUnknown}</p>;
  }

  const ageMs = Math.max(0, nowMs - eventMs);
  const stale = ageMs > 20_000;
  const dotColor = !live.gateway_connected
    ? "bg-destructive/80"
    : stale
      ? "bg-warning/75"
      : "bg-primary/75";

  return (
    <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-border/55 bg-background/60 px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span className={`hub-gateway-heartbeat-dot size-2 rounded-full ${dotColor}`} aria-hidden />
        <p className="text-xs text-muted-foreground">
          {d.gatewayLastEventLabel}{" "}
          <span className="text-foreground">{formatRelativeAge(locale, ageMs)}</span>
        </p>
      </div>
      {stale && live.gateway_connected ? (
        <Badge variant="outline" className="text-[0.65rem] uppercase tracking-[0.18em]">
          {d.gatewayStaleBadge}
        </Badge>
      ) : null}
    </div>
  );
}

function computeChaosSignal(now: Date): { value: number; tier: "calm" | "spicy" | "feral" | "meltdown" } {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const day = dayOfYear(now);
  const daily = (Math.sin((minutes / 1440) * Math.PI * 2) + 1) / 2;
  const wobble = (Math.sin(day * 12.9898 + minutes * 0.017) + 1) / 2;
  const value = Math.max(0, Math.min(100, Math.round((daily * 0.65 + wobble * 0.35) * 100)));

  const tier =
    value >= 86 ? "meltdown" : value >= 62 ? "feral" : value >= 36 ? "spicy" : "calm";

  return { value, tier };
}

function HubChaosMeterWidget() {
  const { copy } = useHubLocale();
  const d = copy.dashboard;
  const { play } = useHubAudio();
  const toasts = useHubToasts();
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const { value, tier } = useMemo(() => computeChaosSignal(new Date(nowMs)), [nowMs]);
  const tierLabel =
    tier === "meltdown"
      ? d.chaosMeterTierMeltdown
      : tier === "feral"
        ? d.chaosMeterTierFeral
        : tier === "spicy"
          ? d.chaosMeterTierSpicy
          : d.chaosMeterTierCalm;

  const barToneClass =
    tier === "meltdown"
      ? "bg-destructive/75"
      : tier === "feral"
        ? "bg-accent/80"
        : tier === "spicy"
          ? "bg-warning/75"
          : "bg-primary/70";

  return (
    <div className="flex flex-col gap-3 text-sm text-muted-foreground">
      <p>{d.chaosMeterBlurb}</p>

      <div className="rounded-xl border border-border/60 bg-background/60 p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{d.chaosMeterLevelLabel}</p>
          <Badge variant="outline">{tierLabel}</Badge>
        </div>

        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted/50">
          <div
            className={`h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none ${barToneClass}`}
            style={{ width: `${value}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{d.chaosMeterSignal(value)}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => {
            play("chaos");
            toasts.push({
              kind: "chaos",
              title: d.chaosMeterToastTitle,
              message: pickHubChaosLine(d.chaosLines, d.chaosLines[0]!, new Date().getHours()),
            });
          }}
        >
          {d.chaosMeterAction}
        </Button>
      </div>
    </div>
  );
}
