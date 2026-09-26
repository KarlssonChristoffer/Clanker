/** App UI copy: Swedish / English. Tone is informal / playful per CLANKER_VISION. */

import type { HubNavBookmarkIconKey } from "@/lib/hub-nav-bookmark-icons";

export type HubLocale = "sv" | "en";

export const HUB_LOCALE_STORAGE_KEY = "discord-hub-locale";

export function toBcp47(locale: HubLocale): "sv-SE" | "en-GB" {
  return locale === "sv" ? "sv-SE" : "en-GB";
}

export type HubCopy = {
  common: {
    copied: string;
    dismissAria: string;
    loading: string;
    loadingProfile: string;
    backendProblem: string;
    tryAgain: string;
    command: string;
    commandShort: string;
    logIn: string;
    logOut: string;
  };
  layout: {
    title: string;
    navHome: string;
    navMyProfile: string;
    navLeague: string;
    toolsMenu: string;
    toolsMoreSoon: string;
    toolsMe: string;
    identityMenuTitle: string;
    identityRightClickHint: string;
    notLoggedIn: string;
    loadingAccount: string;
  };
  /** Shell chrome (Neutralen OS header, panel chrome, nav pills). */
  chrome: {
    brandTitle: string;
    brandTagline: string;
    bootToastTitle: string;
    bootToastMessage: string;
    toolDesktop: string;
    navDesktop: string;
    myProfile: string;
    myProfileOffline: string;
    settings: string;
    wheel: string;
    /** Primärnav → `/tools/music` (kö / “radion”). */
    navRadio: string;
    /** Primärnav → `/tools/league-stats`. */
    navLeagueStats: string;
    runningApp: string;
    identityNavHint: string;
    panelWheel: { label: string; detail: string };
    panelMusic: { label: string; detail: string };
    panelLeagueStats: { label: string; detail: string };
    panelSettings: { label: string; detail: string };
    panelProfile: { label: string; detail: string };
    panelDefault: { label: string; detail: string };
    layoutEditEnter: string;
    layoutEditExit: string;
    /** Dev-only: toggle browser vs shell right-click menu. */
    devNativeContextButtonShell: string;
    devNativeContextButtonBrowser: string;
    shellObjectNavGroup: string;
    shellObjectBrandBlock: string;
    shellObjectDockBar: string;
    shellObjectDesktopZone: string;
    shellObjectUtilityZone: string;
  };
  /** Edit / layout mode: bottom toolbar and toasts. */
  editMode: {
    toolbarAria: string;
    addModule: string;
    addModuleDetail: string;
    layoutOptions: string;
    layoutReset: string;
    layoutRestoreAll: string;
    gridSnapEnable: string;
    gridSnapDisable: string;
    gridShowEnable: string;
    gridShowDisable: string;
    saveLayout: string;
    saveLayoutDetail: string;
    done: string;
    doneDetail: string;
    cancel: string;
    cancelDetail: string;
    addModuleToastTitle: string;
    addModuleToastBody: string;
    layoutSavedTitle: string;
    layoutSavedMessage: string;
    restoreAllTitle: string;
    restoreAllMessage: string;
    desktopOnlyToast: string;
    discardLayout: string;
    discardLayoutDetail: string;
    undoLayout: string;
    redoLayout: string;
    autosaveEnable: string;
    autosaveDisable: string;
    unsavedBadge: string;
    shortcutsHelp: string;
    shortcutsHelpTitle: string;
    shortcutsLines: readonly string[];
    doneSaveExit: string;
    doneSaveExitDetail: string;
    cancelDiscardExit: string;
    cancelDiscardExitDetail: string;
    layoutDiscardedTitle: string;
    layoutDiscardedMessage: string;
    /** Layout edit: accessible label for reorderable top-bar nav tabs. */
    shellReorderDragHandleAria: (itemLabel: string) => string;
  };
  tools: {
    dashboard: { label: string; description: string };
    spinTheWheel: { label: string; description: string };
    music: { label: string; description: string };
    profileSettings: { label: string; description: string };
    me: { label: string; description: string };
  };
  commandPalette: {
    dialogTitle: string;
    dialogDescription: string;
    inputPlaceholder: string;
    recentHeading: string;
    recentBadge: string;
    emptyTitle: (query: string) => string;
    emptyHint: string;
    sectionNavigation: string;
    sectionSystem: string;
    sectionChaos: string;
    toneUseful: string;
    toneSocial: string;
    toneChaos: string;
  };
  actions: {
    toasts: {
      paletteSwitched: string;
      clipboardBlocked: string;
      clipboardBlockedMessage: string;
      sessionRefreshed: string;
      sessionRefreshedMessage: string;
      refreshFailed: string;
      refreshFailedMessage: string;
      audioArmed: string;
      audioMuted: string;
      audioArmedMessage: string;
      audioMutedMessage: string;
      seedCopied: string;
      seedCopiedMessage: string;
      goblinTitle: string;
      goblinMessage: string;
      hamsterTitle: string;
      hamsterMessage: string;
      copiedDiscordId: (id: string) => string;
      devNativeContextBrowserTitle: string;
      devNativeContextBrowserMessage: string;
      devNativeContextShellTitle: string;
      devNativeContextShellMessage: string;
    };
    navDashboard: { label: string; description: string; keywords: readonly string[] };
    navWheel: { label: string; description: string; keywords: readonly string[] };
    navRadio: { label: string; description: string; keywords: readonly string[] };
    navLeagueStats: { label: string; description: string; keywords: readonly string[] };
    navSettings: { label: string; description: string; keywords: readonly string[] };
    navProfile: { label: string; description: string; keywords: readonly string[] };
    systemCommand: { label: string; description: string; keywords: readonly string[] };
    systemRefresh: { label: string; description: string; keywords: readonly string[] };
    systemPalette: { label: string; description: string; keywords: readonly string[] };
    systemAudioMute: { label: string; description: string; keywords: readonly string[] };
    systemAudioEnable: { label: string; description: string; keywords: readonly string[] };
    systemCopySeed: { label: string; description: string; keywords: readonly string[] };
    systemLogout: { label: string; description: string; keywords: readonly string[] };
    systemCopyDiscord: { label: string; description: string; keywords: readonly string[] };
    systemCopyHandle: { label: string; description: string; keywords: readonly string[] };
    chaosGoblin: { label: string; description: string; keywords: readonly string[]; reveal: readonly string[] };
    chaosHamster: { label: string; description: string; keywords: readonly string[]; reveal: readonly string[] };
    devNativeBrowserMenu: { label: string; description: string; keywords: readonly string[] };
    devShellContextMenu: { label: string; description: string; keywords: readonly string[] };
  };
  shellMenu: {
    desktop: string;
    neutralenOs: string;
    openCommandBar: string;
    cyclePalette: string;
    cycleStylePack: string;
    muteAudio: string;
    enableAudio: string;
    spawnWidget: string;
    system: string;
    resetDesktop: string;
    refreshShell: string;
    chaosPulse: string;
    shell: string;
    openDashboard: string;
    openWheel: string;
    openRadio: string;
    openLeagueStats: string;
    openMyProfile: string;
    openSettings: string;
    identity: string;
    copyHandle: string;
    copyDiscordId: string;
    open: string;
    openProfile: string;
    logOut: string;
    hideWidget: string;
    openModule: string;
    openInNewTab: string;
    copyModulePath: string;
    pinDock: string;
    unpinDock: string;
    profile: string;
    copyProfileLink: string;
    returnToDesktop: string;
    link: string;
    openLink: string;
    openLinkNewTab: string;
    copyLinkAddress: string;
    enterLayoutEdit: string;
    exitLayoutEdit: string;
    shellObject: string;
    focusWidget: string;
    resetWidgetPosition: string;
    duplicatePlaceholder: string;
    detachPlaceholder: string;
    layoutEditing: string;
    shellUsageWhileEditing: string;
    addModule: string;
    restoreAllHidden: string;
    gridSnapOn: string;
    gridSnapOff: string;
    layoutSavedToast: string;
    desktopOnlyAction: string;
    saveLayoutCommitted: string;
    discardLayoutDraft: string;
    undoLayout: string;
    redoLayout: string;
    autosaveLayoutOn: string;
    autosaveLayoutOff: string;
  };
  /** Primärnav: användarbokmärken (layout-läge + högerklick). */
  navBookmarks: {
    addFromNavGroup: string;
    /** Context menu (layout-läge): sektion för Redigera / Ta bort — skiljer från tom nav-yta. */
    contextMenuManageSection: string;
    editBookmark: string;
    deleteBookmark: string;
    dialogAddTitle: string;
    dialogEditTitle: string;
    dialogDescription: string;
    labelField: string;
    pathField: string;
    pathHint: string;
    iconField: string;
    iconNames: Record<HubNavBookmarkIconKey, string>;
    save: string;
    cancel: string;
    deleteConfirm: string;
    toastAdded: string;
    toastUpdated: string;
    toastRemoved: string;
    validationBoth: string;
  };
  /** Primärnav: toppmeny-knappar (Skrivbord, Profil, Inställningar, Hjul). */
  primaryNav: {
    editLabel: string;
    dialogEditTitle: string;
    dialogDescription: string;
    labelField: string;
    pathField: string;
    pathHint: string;
    iconField: string;
    iconNames: Record<HubNavBookmarkIconKey, string>;
    save: string;
    cancel: string;
    validationBoth: string;
    validationInternal: string;
    toastUpdated: string;
  };
  toastChaosTitles: readonly string[];
  leagueFormat: {
    noRankedYet: string;
    notYetTimestamp: string;
  };
  dashboard: {
    chaosLines: readonly string[];
    networkSummary: string;
    networkLive: string;
    widgetWelcome: { label: string; description: string };
    widgetServerPulse: { label: string; description: string };
    widgetWiretap: { label: string; description: string };
    widgetWheel: { label: string; description: string };
    widgetPresence: { label: string; description: string };
    widgetRitual: { label: string; description: string };
    widgetChaosMeter: { label: string; description: string };
    widgetVoiceOrbit: { label: string; description: string };
    widgetRadio: { label: string; description: string };
    widgetMoodClock: { label: string; description: string };
    widgetLoreQuote: { label: string; description: string };
    widgetCustomModules: { label: string; description: string };
    loreQuoteBlurb: string;
    loreQuoteNowServingLabel: string;
    loreQuoteDailyBadge: string;
    loreQuoteBookBadge: string;
    loreQuoteCopy: string;
    loreQuoteShuffle: string;
    loreQuoteToastTitle: string;
    loreQuoteToastMessage: (speaker: string) => string;
    moodClockBlurb: string;
    moodClockApply: string;
    moodClockApplied: string;
    moodClockChime: string;
    moodClockToastAppliedTitle: string;
    moodClockToastChimeTitle: string;
    moodClockChimeMessage: (vibe: string) => string;
    moodClockProgressLabel: (pct: number) => string;
    moodClockVibeMorning: string;
    moodClockVibeDay: string;
    moodClockVibeEvening: string;
    moodClockVibeNight: string;
    welcomeAudioOnline: string;
    welcomeAudioMuted: string;
    welcomeBack: (name: string) => string;
    welcomeBlurb: string;
    openProfile: string;
    commandBar: string;
    serverLoadingSummary: string;
    membersOnline: (members: string, online: string) => string;
    channels: (n: number) => string;
    gateway: string;
    gatewayConnected: string;
    gatewayDisconnected: string;
    wiretapBlurb: string;
    wiretapBootLine: string;
    wiretapGatewayDegraded: string;
    wiretapGatewayStable: string;
    wiretapGatewayUnknown: string;
    wiretapGatewayDegradedShort: string;
    wiretapOnlineNow: (n: number) => string;
    wiretapLogLabel: string;
    wiretapLeak: string;
    wiretapClear: string;
    wiretapLeakToastTitle: string;
    wiretapLeakToastMessage: string;
    wiretapVoiceLabel: string;
    wiretapOnlineLabel: string;
    wiretapVoicePulse: string;
    wiretapOnlinePulse: string;
    gatewayLastEventLabel: string;
    gatewayLastEventUnknown: string;
    gatewayStaleBadge: string;
    voiceNow: (n: number) => string;
    guildIdHint: string;
    wheelBlurb: string;
    openWheel: string;
    copySeedStarter: string;
    presenceLine1: string;
    presenceLine2: string;
    presenceLine2Link: string;
    liveLineLabel: string;
    ritualBlurb: string;
    muteAudio: string;
    enableAudio: string;
    fireCeremony: string;
    ritualToastTitle: string;
    ritualToastMessage: string;
    ritualPolicy: string;
    voiceOrbitBlurb: string;
    voiceOrbitUnknownGuild: string;
    voiceOrbitSoulsLine: (souls: number, channels: number) => string;
    voiceOrbitNoSignal: string;
    voiceOrbitGatewayOk: string;
    voiceOrbitGatewayNope: string;
    voiceOrbitAction: string;
    voiceOrbitToastTitle: string;
    voiceOrbitToastMessage: string;
    radioBlurb: string;
    radioNowPlayingLabel: string;
    radioBadge: string;
    radioShuffle: string;
    radioRequest: string;
    radioToastTitle: string;
    radioToastMessage: (track: string) => string;
    radioRequestToastTitle: string;
    radioRequestToastMessage: string;
    chaosMeterBlurb: string;
    chaosMeterLevelLabel: string;
    chaosMeterTierCalm: string;
    chaosMeterTierSpicy: string;
    chaosMeterTierFeral: string;
    chaosMeterTierMeltdown: string;
    chaosMeterSignal: (value: number) => string;
    chaosMeterAction: string;
    chaosMeterToastTitle: string;
    toastWidgetOnline: string;
    toastWidgetHidden: string;
    toastDesktopReset: string;
    toastDesktopResetMessage: string;
    toastPaletteSwitched: string;
    toastDesktopPulse: string;
    backendTitle: string;
    backendDescription: string;
    backendHint1: string;
    backendHint2: string;
    musicNeedVoiceChannel: string;
    musicPlayFailedTitle: string;
    musicPlayFailedGeneric: string;
    musicSpotifyPlaylistUnavailable: string;
    /** Music player page: drag-and-drop links onto the page. */
    musicPlayerDropHint: string;
    musicPlayerDropActive: string;
    musicPlayerDropInvalid: string;
    musicPreviousTitle: string;
    musicPreviousNone: string;
    /** Music player: shuffle queue order. */
    musicShuffleQueue: string;
    /** Music queue: drag handle for reordering. */
    musicQueueDragHandleAria: string;
    musicQueueReorderFailed: string;
  };
  desktopSurface: {
    spawnApp: string;
    personalShell: string;
    rightClickHint: string;
    emptyBadge: string;
    emptyTitle: string;
    emptyBody: string;
    dragButton: string;
    dragTooltip: string;
    hideTooltip: string;
    hideAria: (label: string) => string;
    dragAria: (label: string) => string;
    layoutEditBanner: string;
    layoutEditHint: string;
    widgetPositionResetToast: string;
    editStickyHelp: string;
    resizeHandleAria: string;
    /** Shown on dashboard when layout mode is off: hold still, then drag to reposition widgets. */
    holdToDragOutsideLayoutHint: string;
    widgetContextMenuEdit: string;
    widgetContextMenuHide: string;
    widgetContextMenuResetPos: string;
    widgetQuickEditTitle: (label: string) => string;
  };
  profileSettings: {
    pageTitle: string;
    pageIntroBefore: string;
    publicProfileLinkLabel: string;
    pageIntroAfter: string;
    themeCardTitle: string;
    themeCardDesc: string;
    themeCardBody: string;
    languageCardTitle: string;
    languageCardDesc: string;
    languageSv: string;
    languageEn: string;
    profileCardTitle: string;
    profileCardDesc: string;
    showOnline: string;
    showRank: string;
    shareChampionPool: string;
    leagueCardTitle: string;
    leagueCardDesc: string;
    riotId: string;
    tagline: string;
    region: string;
    rankSource: string;
    rankSolo: string;
    rankFlex: string;
    autoSync: string;
    statusMessage: string;
    statusPlaceholder: string;
    connect: string;
    syncNow: string;
    disconnect: string;
    leagueFootnoteBefore: string;
    leagueFootnoteLinkLabel: string;
    leagueFootnoteAfter: string;
    defaultStatusMessage: string;
    errors: {
      leagueStatusRead: string;
      connectFailed: string;
      connectNetwork: string;
      syncFailed: string;
      syncNetwork: string;
      disconnectFailed: string;
      disconnectNetwork: string;
    };
    success: {
      connected: string;
      synced: string;
      disconnected: string;
    };
    backendTitle: string;
    backendDescription: string;
    backendBody: string;
  };
  publicProfile: {
    loadingTitle: string;
    loadingDesc: string;
    loadErrorNetwork: string;
    notFoundTitle: string;
    notFoundDesc: string;
    toHub: string;
    errorTitle: string;
    pageTitle: string;
    pageIntro: (name: string, leagueLine: string) => string;
    settingsButton: string;
    openHub: string;
    labelProfileStatus: string;
    labelLeagueConnection: string;
    labelLeagueStats: string;
    gamesRankLabel: string;
    gamesRegionLabel: string;
    cardStatusTitle: string;
    cardStatusDesc: string;
    cardGamesTitle: string;
    cardGamesDesc: string;
    cardMoreTitle: string;
    cardMoreDesc: string;
    profileStatusBase: string;
    profileStatusLeague: string;
    leagueLinkPublished: string;
    leagueLinkNot: string;
    statsSynced: string;
    statsWaiting: string;
    statsNone: string;
    steamNotLinked: string;
    noLeaguePublic: string;
    rankDash: string;
    regionDash: string;
    separator: string;
    syncedShort: (date: string) => string;
    leagueStatsTitle: string;
    leagueStatsDescFetched: (ts: string, account: string) => string;
    noLeagueData: string;
    notSyncedYet: string;
    statsUnavailable: string;
    accountLabel: string;
    regionLabel: string;
    rankedQueues: string;
    noRankedReturned: string;
    rankedEntryLine: (tier: string, rank: string, lp: number) => string;
    rankedEntryRecord: (wins: number, losses: number, hotStreakLabel: string) => string;
    recentMatches: string;
    noMatchHistory: string;
    win: string;
    loss: string;
    matchStatsLine: (kills: number, deaths: number, assists: number, cs: number, level: number) => string;
    /** Riot `gameMode` / `gameType`; empty string if both missing. */
    leagueMatchModeLine: (gameMode: string, gameType: string) => string;
    steamTitle: string;
    steamDesc: string;
    steamBody: string;
    leagueIntro: {
      none: string;
      notSynced: string;
      soon: string;
      synced: string;
    };
    rankFallback: string;
    noSyncYetShort: string;
    discordId: string;
    displayName: string;
    linkedSince: string;
    lastLeagueSync: string;
    statusLine: (label: string, value: string) => string;
    hotStreak: string;
  };
  /** `/tools/league-stats` — egen sida (inte samma som public profile). */
  leagueStatsPage: {
    loading: string;
    loadingMatches: string;
    syncRequiredTitle: string;
    syncRequiredBody: (accountList: string) => string;
    syncRequiredLinkLabel: string;
    syncRequiredAction: string;
    syncRequiredApiHint: string;
    noLinkedTitle: string;
    noLinkedBody: string;
    loadError: (message: string) => string;
    noMatchesTitle: string;
    noMatchesBody: string;
    title: string;
    subtitle: (totalGames: number, accountLine: string) => string;
    statGames: string;
    statGamesSub: (wins: number, losses: number) => string;
    statWinRate: string;
    statKda: string;
    statKdaSub: (k: number, d: number, a: number) => string;
    statCs: string;
    statCsSub: (avgDuration: string) => string;
    breakdownByQueue: string;
    thQueueMode: string;
    thMatches: string;
    thWl: string;
    thWinPct: string;
    championsTitle: string;
    thChampion: string;
    thChampMatches: string;
    thChampWinPct: string;
    thChampKda: string;
    thChampCsPerGame: string;
    matchHistoryTitle: string;
    winBadge: string;
    lossBadge: string;
    levelShort: (n: number) => string;
    goldK: (k: string) => string;
    csLabel: string;
    paginationPrev: string;
    paginationNext: string;
    paginationRange: (from: number, to: number, total: number) => string;
    paginationPage: (page: number, totalPages: number) => string;
    matchesLoadError: string;
    queueSoloDuo: string;
    queueFlex: string;
    queueAram: string;
    queueQuickplay: string;
    queueNormalDraft: string;
    queueCustom: string;
    queueUnknown: (queueId: number) => string;
  };
  login: {
    title: string;
    description: string;
    oauthFailed: string;
    apiUnreachable: string;
    continueDiscord: string;
    continueDisabled: string;
  };
  spinWheel: {
    loading: string;
    backendError: string;
    collabTitle: string;
    collabDesc: string;
    collabConnected: string;
    defaultCollabRoom: string;
    roomLabel: string;
    presenceCount: (n: number) => string;
    realtimeEnabled: string;
    copyRoom: string;
    participantsTitle: string;
    participantsDesc: string;
    participantsTextareaPlaceholder: string;
    noParticipants: string;
    participantCount: (n: number) => string;
    clear: string;
    participantMenuLabel: string;
    remove: string;
    copyName: string;
    uncurse: string;
    markCursed: string;
    accuseTitle: string;
    accuseMenuLabel: string;
    accuseMessage: (name: string) => string;
    curseLifted: string;
    markedCursed: string;
    teamsTitle: string;
    teamsDesc: string;
    teamCount: string;
    distribution: string;
    modeBalanced: string;
    modeEqual: string;
    equalTeamsWarning: (participants: number, teams: number) => string;
    seedLabel: string;
    seedPlaceholder: string;
    seedLastUsed: string;
    seedEmptyHint: string;
    copySeed: string;
    autoSave: string;
    spinAndTeams: string;
    spinOnly: string;
    makeTeams: string;
    reshuffle: string;
    groupsTitle: string;
    groupsDesc: string;
    newGroupDefault: string;
    groupNamePlaceholder: string;
    saveNew: string;
    update: string;
    refreshList: string;
    selectedGroup: string;
    clearSelection: string;
    loadingGroups: string;
    noGroups: string;
    participantsUpdated: string;
    removeGroup: string;
    addParticipantsHint: string;
    wheelEmptySliceLabel: string;
    wheelSpinAria: string;
    celebrateEyebrow: string;
    celebrateDesc: string;
    celebrateClose: string;
    celebrateRemove: string;
    teamsResultTitle: string;
    teamsResultDesc: string;
    equalTeamsBanner: string;
    noTeamsYet: string;
    teamLabel: (i: number) => string;
    sessionsTitle: string;
    sessionsDesc: string;
    refresh: string;
    loadingSessions: string;
    noSessions: string;
    sessionWinner: (name: string) => string;
    sessionTeamsOnly: string;
    sessionMetaParticipants: (count: number, teamCount: number, when: string) => string;
    sessionSeedPrefix: string;
    load: string;
    participantChipTitle: string;
    voiceChannelsTitle: string;
    voiceChannelsLoading: string;
    voiceChannelsError: string;
    voiceChannelsEmpty: string;
    voiceChannelsGuildHint: string;
    voiceChannelUnnamed: string;
    voiceChannelMore: (n: number) => string;
    toasts: {
      roomUpdate: string;
      roomUpdateMessage: (name: string) => string;
      loadGroupsFail: string;
      loadSessionsFail: string;
      backendUnreachable: string;
      backendUnreachableMessage: string;
      saveSessionFail: string;
      sessionSaved: string;
      sessionSavedWinner: (w: string) => string;
      sessionSavedTeams: string;
      saveGroupFail: string;
      groupSaved: string;
      updateGroupFail: string;
      groupUpdated: string;
      deleteGroupFail: string;
      groupDeleted: string;
      groupDeletedMessage: string;
      roomCopied: string;
      seedCopied: string;
      voiceFillTitle: string;
      voiceFillMessage: (channelLabel: string, count: number) => string;
      voiceMoveFail: string;
      voiceMoveUnknown: string;
      voiceMoveNoMember: (name: string) => string;
    };
  };
  backendCard: {
    title: string;
    description: string;
    body: string;
    hintEnv: string;
    retry: string;
  };
  hubPrefsPanel: {
    title: string;
    description: string;
    openButton: string;
    closeButton: string;
    resetAll: string;
    resetAllConfirm: string;
    savedToast: string;
    tabs: {
      widget: string;
      desktop: string;
      copy: string;
    };
    widget: {
      noWidgetSelected: string;
      selectWidgetHint: string;
      widgetLabel: string;
      sizePreset: string;
      sizeCompact: string;
      sizeCozy: string;
      sizeExpanded: string;
      toneOverride: string;
      toneInherit: string;
      toneUseful: string;
      toneSocial: string;
      toneChaos: string;
      glassOpacity: string;
      glassOpacityHint: string;
      blurStrength: string;
      blurNone: string;
      blurLight: string;
      blurMedium: string;
      blurStrong: string;
      showSubtitle: string;
      showSubtitleDesc: string;
      showToneBadge: string;
      showToneBadgeDesc: string;
      resetWidget: string;
    };
    desktop: {
      stylePack: string;
      stylePackDefault: string;
      stylePackMidnight: string;
      stylePackPaper: string;
      stylePackSignal: string;
      stylePackCampfire: string;
      gridDensity: string;
      gridCompact: string;
      gridCozy: string;
      gridExpanded: string;
      gridCompaction: string;
      gridCompactionNone: string;
      gridCompactionPack: string;
      snapStrength: string;
      snapRelaxed: string;
      snapStandard: string;
      snapFirm: string;
      showWidgetBorder: string;
      showWidgetBorderDesc: string;
      dockPosition: string;
      dockBottom: string;
      dockLeft: string;
      dockScale: string;
      dockSm: string;
      dockMd: string;
      dockLg: string;
      animationIntensity: string;
      animationIntensityHint: string;
    };
    inspectCursor: {
      sectionTitle: string;
      sectionHint: string;
      presetLabel: string;
      presetCrosshair: string;
      presetDot: string;
      presetRing: string;
      presetBracket: string;
      colorLabel: string;
      colorPrimary: string;
      colorAccent: string;
      colorForeground: string;
      colorCustom: string;
      customHexLabel: string;
      customHexHint: string;
      sizeLabel: string;
      sizeHint: string;
    };
    copy: {
      personality: string;
      personalityCalm: string;
      personalityNormal: string;
      personalityChaotic: string;
      personalityCalmDesc: string;
      personalityNormalDesc: string;
      personalityChaoticDesc: string;
      toastVerbosity: string;
      toastMinimal: string;
      toastNormal: string;
      toastVerbose: string;
      toastMinimalDesc: string;
      toastNormalDesc: string;
      toastVerboseDesc: string;
      memeFrequency: string;
      memeOff: string;
      memeLow: string;
      memeNormal: string;
      memeOffDesc: string;
      memeLowDesc: string;
      memeNormalDesc: string;
    };
  };
};

const SV: HubCopy = {
  common: {
    copied: "Kopierat",
    dismissAria: "Stäng",
    loading: "Laddar…",
    loadingProfile: "Laddar profil…",
    backendProblem: "Backend strular",
    tryAgain: "Försök igen",
    command: "Kommandon",
    commandShort: "Cmd",
    logIn: "Logga in",
    logOut: "Logga ut",
  },
  layout: {
    title: "Discord hub",
    navHome: "Hem",
    navMyProfile: "Min profil",
    navLeague: "League",
    toolsMenu: "Verktyg",
    toolsMoreSoon: "Fler moduler snart. Förmodligen.",
    toolsMe: "Jag",
    identityMenuTitle: "Identitet",
    identityRightClickHint: "Högerklicka för fler val.",
    notLoggedIn: "Inte inloggad",
    loadingAccount: "Laddar konto…",
  },
  chrome: {
    brandTitle: "Neutralen OS",
    brandTagline: "community shell",
    bootToastTitle: "Boot klar",
    bootToastMessage: "Skalet är uppe. Vänligen behandla vibbarna varsamt.",
    toolDesktop: "Skrivbord",
    navDesktop: "Skrivbord",
    myProfile: "Min profil",
    myProfileOffline: "Min profil (offline)",
    settings: "Inställningar",
    wheel: "Hjul",
    navRadio: "Radio",
    navLeagueStats: "League-statistik",
    runningApp: "Körande app",
    identityNavHint: "Högerklicka för identitetsåtgärder.",
    panelWheel: {
      label: "Hjulmodul",
      detail: "Delat kaos, slump och ödesrouting.",
    },
    panelMusic: {
      label: "Musik / kö",
      detail: "Discord-botens kö och uppspelning.",
    },
    panelLeagueStats: {
      label: "League-statistik",
      detail: "Egna matcher, köer och champions.",
    },
    panelSettings: {
      label: "Profilinställningar",
      detail: "Identitet, integrationer och ansvarsfull konfig (typ).",
    },
    panelProfile: {
      label: "Publik profil",
      detail: "Användarpanel i Neutralen OS-skalet.",
    },
    panelDefault: {
      label: "Arbetsyta",
      detail: "En app-ruta som bor i skalet.",
    },
    layoutEditEnter: "Layout",
    layoutEditExit: "Klar",
    devNativeContextButtonShell: "Dev: högerklick använder skalmenyn. Klicka för webbläsarens meny.",
    devNativeContextButtonBrowser: "Dev: högerklick använder webbläsarens meny. Klicka för skalmenyn.",
    shellObjectNavGroup: "Primär navigation",
    shellObjectBrandBlock: "Systemmärke och ticker",
    shellObjectDockBar: "Docka",
    shellObjectDesktopZone: "Skrivbordsyta",
    shellObjectUtilityZone: "Modulspawn",
  },
  editMode: {
    toolbarAria: "Layout-verktygsrad",
    addModule: "Lägg till modul",
    addModuleDetail: "Hoppa till sovande moduler och spawna en",
    layoutOptions: "Layout",
    layoutReset: "Återställ skrivbordslayout",
    layoutRestoreAll: "Visa alla sovande moduler",
    gridSnapEnable: "Rutnätsfäste på",
    gridSnapDisable: "Rutnätsfäste av",
    gridShowEnable: "Visa rutnät",
    gridShowDisable: "Dölj rutnät",
    saveLayout: "Spara layout",
    saveLayoutDetail: "Bekräfta att layouten är sparad lokalt",
    done: "Klar",
    doneDetail: "Lämna layout-läge",
    cancel: "Avbryt",
    cancelDetail: "Lämna layout-läge utan extra steg",
    addModuleToastTitle: "Modulspawn",
    addModuleToastBody: "Välj en sovande modul nedan eller använd verktygsraden.",
    layoutSavedTitle: "Layout sparad",
    layoutSavedMessage: "Din skrivbordslayout finns kvar i den här webbläsaren.",
    restoreAllTitle: "Moduler väckta",
    restoreAllMessage: "Alla sovande moduler är tillbaka på skrivbordet.",
    desktopOnlyToast: "Byt till skrivbordet för den här åtgärden.",
    discardLayout: "Ångra session",
    discardLayoutDetail: "Återställ utkastet till hur det var när du öppnade layout-läge",
    undoLayout: "Ångra",
    redoLayout: "Gör om",
    autosaveEnable: "Autospara på",
    autosaveDisable: "Autospara av",
    unsavedBadge: "Osparade ändringar",
    shortcutsHelp: "Kortkommandon",
    shortcutsHelpTitle: "Layout — kortkommandon",
    shortcutsLines: [
      "Esc — rensa markering",
      "Pilar — flytta markerade moduler (rutnät om magnet är på)",
      "Ctrl/⌘+Z — ångra · Ctrl/⌘+Shift+Z eller Ctrl/⌘+Y — gör om",
      "] — lägg markerade överst",
      "Shift eller Ctrl/⌘+klick — flerval",
      "Topbar: dra flikar för ordning (sparas lokalt).",
    ],
    doneSaveExit: "Klar",
    doneSaveExitDetail: "Spara layout och lämna layout-läge",
    cancelDiscardExit: "Avbryt",
    cancelDiscardExitDetail: "Kasta ändringar och lämna layout-läge",
    layoutDiscardedTitle: "Layout återställd",
    layoutDiscardedMessage: "Utkastet matchar startläget för sessionen.",
    shellReorderDragHandleAria: (itemLabel) => `Flytta ${itemLabel}`,
  },
  tools: {
    dashboard: {
      label: "Hem",
      description: "Status, moduler och vad skiten håller på med.",
    },
    spinTheWheel: {
      label: "Hjul",
      description: "Ödessnurra + laglottning. Skyll på hjulet, inte på mig.",
    },
    music: {
      label: "Musik",
      description: "Köhanterare för Discord-musikbotten.",
    },
    profileSettings: {
      label: "Inställningar",
      description: "Finjustera din vibe och integrationer.",
    },
    me: {
      label: "Jag",
      description: "Din publika profil. Titta inte för hårt.",
    },
  },
  commandPalette: {
    dialogTitle: "Clanker-kommandon",
    dialogDescription: "Sök moduler, systemgrejer och dåliga beslut.",
    inputPlaceholder: "Sök kommandon, routes, inställningar eller förbjudna ord…",
    recentHeading: "Senaste",
    recentBadge: "senast",
    emptyTitle: (q) => `Inget kommando matchade “${q}”.`,
    emptyHint: "Testa dashboard, ljud, inställningar, seed eller något konstigt ritualord.",
    sectionNavigation: "Navigation",
    sectionSystem: "System",
    sectionChaos: "Kaos",
    toneUseful: "nyttig",
    toneSocial: "social",
    toneChaos: "kaos",
  },
  actions: {
    toasts: {
      paletteSwitched: "Palett bytt",
      clipboardBlocked: "Clipboard sa nej",
      clipboardBlockedMessage: "Webbläsaren vägrade skriva till urklipp. Typiskt.",
      sessionRefreshed: "Session uppdaterad",
      sessionRefreshedMessage: "Vi pingade backend om identitet och skal-tillstånd.",
      refreshFailed: "Uppdateringen dog",
      refreshFailedMessage: "Hub-API:t svarade inte i tid. Fan också.",
      audioArmed: "Ljud på",
      audioMuted: "Ljud av",
      audioArmedMessage: "Små klick och fanfarer är tillbaka.",
      audioMutedMessage: "Nu tystnar skiten. Systemet surar i tystnad.",
      seedCopied: "Seed kopierad",
      seedCopiedMessage: "Färskplockad för framtida bråk.",
      goblinTitle: "Goblin-protokoll aktiverat",
      goblinMessage: "Systemet godkänner exakt noll av det här.",
      hamsterTitle: "Hamstern lugnad",
      hamsterMessage: "Latens förbättrad andligt, om inte tekniskt.",
      copiedDiscordId: (id) => `Discord-ID: ${id}`,
      devNativeContextBrowserTitle: "Webbläsarens högerklick",
      devNativeContextBrowserMessage: "Inspect och sidans egen meny fungerar igen.",
      devNativeContextShellTitle: "Skal-högerklick",
      devNativeContextShellMessage: "Hubbens kontextmeny är tillbaka.",
    },
    navDashboard: {
      label: "Öppna dashboard",
      description: "Hoppa till Neutralen OS-ytan.",
      keywords: ["hem", "dashboard", "desktop", "hub", "start"],
    },
    navWheel: {
      label: "Öppna hjulet",
      description: "Starta ödessnurran och laglottningen.",
      keywords: ["snurra", "hjul", "lag", "slump", "wheel", "spin"],
    },
    navRadio: {
      label: "Öppna radion",
      description: "Musik-kön och Discord-botten.",
      keywords: ["radio", "musik", "music", "kö", "queue", "spela"],
    },
    navLeagueStats: {
      label: "Öppna League-statistik",
      description: "Matcher, köer och champions för dina kopplade konton.",
      keywords: ["league", "lol", "riot", "stats", "matcher"],
    },
    navSettings: {
      label: "Öppna inställningar",
      description: "Profilvibe och integrationer.",
      keywords: ["inställningar", "profil", "integrationer", "settings"],
    },
    navProfile: {
      label: "Öppna min profil",
      description: "Direkt till din publika profilkort.",
      keywords: ["jag", "profil", "identitet", "me"],
    },
    systemCommand: {
      label: "Öppna kommandorad",
      description: "Kommandolager var du än är.",
      keywords: ["kommando", "palette", "sök", "launcher", "command"],
    },
    systemRefresh: {
      label: "Uppdatera session",
      description: "Läs om identitet och skal-status från backend.",
      keywords: ["uppdatera", "reload", "session", "identitet", "profil"],
    },
    systemPalette: {
      label: "Byt färgpalett",
      description: "Ny palett, ny stämning.",
      keywords: ["tema", "palett", "färg", "läge"],
    },
    systemAudioMute: {
      label: "Stäng av Clanker-ljud",
      description: "Tysta små fanfarer och knappklick.",
      keywords: ["ljud", "mute", "volym", "audio"],
    },
    systemAudioEnable: {
      label: "Slå på Clanker-ljud",
      description: "Låt systemet klicka tillbaka.",
      keywords: ["ljud", "mute", "volym", "audio"],
    },
    systemCopySeed: {
      label: "Kopiera hjul-seed",
      description: "Lägg en färsk seed på urklipp för framtida gräl.",
      keywords: ["kopiera", "clipboard", "seed", "hjul", "slump"],
    },
    systemLogout: {
      label: "Logga ut",
      description: "Lämna hubben och tillbaka till login.",
      keywords: ["logga ut", "auth", "leave"],
    },
    systemCopyDiscord: {
      label: "Kopiera Discord-ID",
      description: "Kopiera ditt numeriska Discord-ID.",
      keywords: ["kopiera", "discord", "id", "identitet"],
    },
    systemCopyHandle: {
      label: "Kopiera handle",
      description: "Kopiera ditt @handle för snabb delning.",
      keywords: ["kopiera", "handle", "användarnamn", "discord"],
    },
    chaosGoblin: {
      label: "Tillkalla goblin-protokoll",
      description: "Skicka ett onödigt men känslomässigt korrekt systemmeddelande.",
      keywords: ["goblin", "kaos", "meme", "easter"],
      reveal: ["goblin", "protokoll", "meme"],
    },
    chaosHamster: {
      label: "Mata serverhamstern",
      description: "Andlig underhållning för rackmonterad gnagare.",
      keywords: ["hamster", "server", "ritual", "snacks"],
      reveal: ["hamster", "snacks", "ritual"],
    },
    devNativeBrowserMenu: {
      label: "Webbläsarens högerklick (dev)",
      description: "Släpp igenom Inspect och sidans meny i stället för skalmenyn.",
      keywords: ["inspect", "devtools", "högerklick", "webbläsare", "native", "context", "dev"],
    },
    devShellContextMenu: {
      label: "Skal-högerklick (standard)",
      description: "Återgå till hubbens egna högerklicksmeny.",
      keywords: ["shell", "skal", "högerklick", "context", "neutralen"],
    },
  },
  shellMenu: {
    desktop: "Skrivbord",
    neutralenOs: "Neutralen OS",
    openCommandBar: "Öppna kommandorad",
    cyclePalette: "Byt palett",
    cycleStylePack: "Byt stilpaket",
    muteAudio: "Stäng av ljudeffekter",
    enableAudio: "Slå på ljudeffekter",
    spawnWidget: "Visa widget",
    system: "System",
    resetDesktop: "Återställ skrivbordslayout",
    refreshShell: "Uppdatera skal",
    chaosPulse: "Kaospuls",
    shell: "Skal",
    openDashboard: "Öppna dashboard",
    openWheel: "Öppna hjulet",
    openRadio: "Öppna radion",
    openLeagueStats: "Öppna League-statistik",
    openMyProfile: "Öppna min profil",
    openSettings: "Öppna inställningar",
    identity: "Identitet",
    copyHandle: "Kopiera handle",
    copyDiscordId: "Kopiera Discord-ID",
    open: "Öppna",
    openProfile: "Öppna profil",
    logOut: "Logga ut",
    hideWidget: "Dölj widget",
    openModule: "Öppna modul",
    openInNewTab: "Öppna i ny flik",
    copyModulePath: "Kopiera modulsökväg",
    pinDock: "Fäst i dockan",
    unpinDock: "Lossa från dockan",
    profile: "Profil",
    copyProfileLink: "Kopiera profillänk",
    returnToDesktop: "Tillbaka till skrivbordet",
    link: "Länk",
    openLink: "Öppna länk",
    openLinkNewTab: "Öppna länk i ny flik",
    copyLinkAddress: "Kopiera länkadress",
    enterLayoutEdit: "Byt till layout-läge",
    exitLayoutEdit: "Lämna layout-läge",
    shellObject: "Skalobjekt",
    focusWidget: "Lägg överst",
    resetWidgetPosition: "Återställ position",
    duplicatePlaceholder: "Duplicera (snart)",
    detachPlaceholder: "Lossa panel (snart)",
    layoutEditing: "Layout-redigering",
    shellUsageWhileEditing: "Skal (under användning)",
    addModule: "Lägg till modul",
    restoreAllHidden: "Visa alla sovande moduler",
    gridSnapOn: "Rutnätsfäste på",
    gridSnapOff: "Rutnätsfäste av",
    layoutSavedToast: "Layout sparad lokalt",
    desktopOnlyAction: "Endast på skrivbordet",
    saveLayoutCommitted: "Spara layout",
    discardLayoutDraft: "Ångra session",
    undoLayout: "Ångra",
    redoLayout: "Gör om",
    autosaveLayoutOn: "Autospara layout på",
    autosaveLayoutOff: "Autospara layout av",
  },
  navBookmarks: {
    addFromNavGroup: "Lägg till bokmärke…",
    contextMenuManageSection: "Bokmärke",
    editBookmark: "Redigera bokmärke…",
    deleteBookmark: "Ta bort bokmärke",
    dialogAddTitle: "Nytt bokmärke",
    dialogEditTitle: "Redigera bokmärke",
    dialogDescription:
      "Visningsnamn, ikon och mål. Intern hub-sökväg som börjar med / (t.ex. /dashboard, /profile/settings) eller en fullständig https-URL för sidor utanför hubben.",
    labelField: "Visningsnamn",
    pathField: "Mål (sökväg eller URL)",
    pathHint: "Intern: /profile/settings · Extern: https://…",
    iconField: "Ikon",
    iconNames: {
      Bookmark: "Bokmärke",
      Home: "Hem",
      Settings: "Inställningar",
      Workflow: "Flöde",
      Star: "Stjärna",
      LayoutDashboard: "Panel",
      User: "Profil",
      Search: "Sök",
      Link2: "Länk",
      Bell: "Klocka",
      Heart: "Hjärta",
      Zap: "Energi",
      Music: "Musik",
      Radio: "Radio",
      Trophy: "Pokal",
    },
    save: "Spara",
    cancel: "Avbryt",
    deleteConfirm: "Ta bort",
    toastAdded: "Bokmärke tillagt",
    toastUpdated: "Bokmärke uppdaterat",
    toastRemoved: "Bokmärke borttaget",
    validationBoth: "Fyll i både namn och mål.",
  },
  primaryNav: {
    editLabel: "Redigera...",
    dialogEditTitle: "Redigera menyknapp",
    dialogDescription: "Ändra namn, ikon och intern länk för toppmenyn.",
    labelField: "Visningsnamn",
    pathField: "Intern sökväg",
    pathHint: "t.ex. /dashboard",
    iconField: "Ikon",
    iconNames: {
      Bookmark: "Bokmärke",
      Home: "Hem",
      Settings: "Inställningar",
      Workflow: "Flöde",
      Star: "Stjärna",
      LayoutDashboard: "Panel",
      User: "Profil",
      Search: "Sök",
      Link2: "Länk",
      Bell: "Klocka",
      Heart: "Hjärta",
      Zap: "Energi",
      Music: "Musik",
      Radio: "Radio",
      Trophy: "Pokal",
    },
    save: "Spara",
    cancel: "Avbryt",
    validationBoth: "Fyll i både namn och sökväg.",
    validationInternal: "Sökvägen måste vara intern (börja med /).",
    toastUpdated: "Menyknapp uppdaterad",
  },
  toastChaosTitles: [
    "Systemet viskar:",
    "Neutralen OS säger:",
    "Inte en bugg. En feature.",
    "Mystiskt men giltigt:",
  ],
  leagueFormat: {
    noRankedYet: "Ingen ranked-data ännu",
    notYetTimestamp: "Inte ännu",
  },
  dashboard: {
    chaosLines: [
      "Neutralen OS blinkade till och tyckte det räckte med drama för stunden.",
      "En osynlig sysadmin flyttar runt vibbarna bakom din rygg.",
      "Dashboarden hävdar att allt här räknas som infrastruktur.",
      "Någon viskade onekligen “bara en snabb match” i kablarna igen.",
    ],
    networkSummary: "Nätverket strular — kunde inte hämta guild-summary.",
    networkLive: "Nätverket strular — kunde inte hämta live-data.",
    widgetWelcome: {
      label: "Identitet",
      description: "Din profil, palett och startläge.",
    },
    widgetServerPulse: {
      label: "Serverpuls",
      description: "Guild-sammanfattning, voice och gateway-hälsa.",
    },
    widgetWiretap: {
      label: "Discord-wiretap",
      description: "En liten portal: radar, logg och signalspår.",
    },
    widgetWheel: {
      label: "Hjul-start",
      description: "Snabbväg till slump, delat kaos och seeds.",
    },
    widgetPresence: {
      label: "Närvaro",
      description: "Ett litet socialt lager så skalet känns befolkat.",
    },
    widgetRitual: {
      label: "Ritualkonsol",
      description: "Låg risk: palett, kommandorad och små systemscener.",
    },
    widgetChaosMeter: {
      label: "Kaosmätare",
      description: "Ambient signal om hur mycket systemet vill bråka.",
    },
    widgetVoiceOrbit: {
      label: "Voice-orbit",
      description: "Social puls: prickar som låtsas vara närvaro.",
    },
    widgetRadio: {
      label: "Neutralen FM",
      description: "Fejkad radio för att ge skalet lite liv.",
    },
    widgetMoodClock: {
      label: "Stämningsklocka",
      description: "Tid, vibe och små OS-knep.",
    },
    widgetLoreQuote: {
      label: "Lore-citat",
      description: "Dagens citat. Inte alltid sant, alltid relevant.",
    },
    widgetCustomModules: {
      label: "Modulverkstad",
      description: "Bygg egna moduler och skruva på storlek + innehåll.",
    },
    loreQuoteBlurb: "En liten lore-krok. Bra för att känna att platsen minns saker.",
    loreQuoteNowServingLabel: "Dagens utdrag",
    loreQuoteDailyBadge: "daily",
    loreQuoteBookBadge: "ur citatboken",
    loreQuoteCopy: "Kopiera",
    loreQuoteShuffle: "Nytt utdrag",
    loreQuoteToastTitle: "Citat kopierat",
    loreQuoteToastMessage: (speaker) => `Signerad: ${speaker}. Nu är den på urklipp.`,
    moodClockBlurb: "En klocka som inte bara visar tid — den föreslår vilket humör skrivbordet borde ha.",
    moodClockApply: "Synka vibe",
    moodClockApplied: "Redan synkat",
    moodClockChime: "Plinga",
    moodClockToastAppliedTitle: "Vibe synkad",
    moodClockToastChimeTitle: "Systemet plingade",
    moodClockChimeMessage: (vibe) => `Vibe: ${vibe}. Skrivbordet nickade.`,
    moodClockProgressLabel: (pct) => `Dagens progress: ${pct}%`,
    moodClockVibeMorning: "Morgon-boot",
    moodClockVibeDay: "Dagsljus-signal",
    moodClockVibeEvening: "Kvälls-lounge",
    moodClockVibeNight: "Natt-ritual",
    welcomeAudioOnline: "ljud på",
    welcomeAudioMuted: "tyst",
    welcomeBack: (name) => `Välkommen tillbaka, ${name}.`,
    welcomeBlurb: "Nu är skalet mer skrivbord och mindre “respektabel app”.",
    openProfile: "Öppna profil",
    commandBar: "Kommandorad",
    serverLoadingSummary: "Laddar guild-summary…",
    membersOnline: (m, o) => `Medlemmar ca ${m} · online ca ${o}`,
    channels: (n) => `Kanaler ${n}`,
    gateway: "Gateway",
    gatewayConnected: "ansluten",
    gatewayDisconnected: "frånkopplad",
    wiretapBlurb: "En liten portal mot Discord. Den sniffar signaler och hittar på resten.",
    wiretapBootLine: "Wiretap online. Lyssnar på kablarna…",
    wiretapGatewayDegraded: "Gateway degraderad (systemet hostar).",
    wiretapGatewayStable: "Gateway stabil igen.",
    wiretapGatewayUnknown: "okänd",
    wiretapGatewayDegradedShort: "degraderad",
    wiretapOnlineNow: (n) => `Online just nu: ${n}`,
    wiretapLogLabel: "Logg",
    wiretapLeak: "Läcka rykte",
    wiretapClear: "Rensa logg",
    wiretapLeakToastTitle: "Wiretap läckte något",
    wiretapLeakToastMessage: "Det var säkert ingenting. Eller allt.",
    wiretapVoiceLabel: "voice",
    wiretapOnlineLabel: "online",
    wiretapVoicePulse: "Voice-puls",
    wiretapOnlinePulse: "Online-puls",
    gatewayLastEventLabel: "Senast blink:",
    gatewayLastEventUnknown: "Senast blink: okänt (systemet sov).",
    gatewayStaleBadge: "seg",
    voiceNow: (n) => `I voice just nu: ${n}`,
    guildIdHint:
      "Sätt VITE_DISCORD_HUB_GUILD_ID för att visa guild-puls här.",
    wheelBlurb:
      "Hjul-modulen är fortfarande bästa stället att låta slumpen ta juridiskt ansvar.",
    openWheel: "Öppna hjul",
    copySeedStarter: "Kopiera seed",
    presenceLine1: "Discord-inloggning är aktiv och din profil är inkopplad.",
    presenceLine2: "League, teman och identitet går via ",
    presenceLine2Link: "din profil",
    liveLineLabel: "Live-rad",
    ritualBlurb:
      "För premium-skrivbordskänsla: byt palett, öppna kommandoraden och låt systemet göra en scen.",
    muteAudio: "Stäng av ljud",
    enableAudio: "Slå på ljud",
    fireCeremony: "Kör ceremoni",
    ritualToastTitle: "Ceremoni accepterad",
    ritualToastMessage: "Dashboarden låtsas att det här var nödvändigt.",
    ritualPolicy:
      "Sällan-händelse-policy: subtil charm alltid, konstigheter ibland, nonsens sparsamt.",
    voiceOrbitBlurb: "Skrivbordet vill kännas multiplayer, så vi låtsas att voice är en liten stjärnhimmel.",
    voiceOrbitUnknownGuild: "Okänd guild",
    voiceOrbitSoulsLine: (souls, channels) => `Souls i voice: ${souls} · kanaler: ${channels}`,
    voiceOrbitNoSignal: "Inga signaler än. Skalet lyssnar ändå.",
    voiceOrbitGatewayOk: "puls",
    voiceOrbitGatewayNope: "tyst",
    voiceOrbitAction: "Pinga voice",
    voiceOrbitToastTitle: "Signal skickad",
    voiceOrbitToastMessage: "Om någon är där ute så blinkar det nog till.",
    radioBlurb: "En liten radio som inte gör något viktigt. Perfekt.",
    radioNowPlayingLabel: "Nu spelas",
    radioBadge: "live-ish",
    radioShuffle: "Shuffle",
    radioRequest: "Begär låt",
    radioToastTitle: "Stationen bytte spår",
    radioToastMessage: (track) => `Nu: ${track}`,
    radioRequestToastTitle: "Begäran registrerad",
    radioRequestToastMessage: "Vi skickade den till kabelgudarna. Ingen svarstid utlovas.",
    chaosMeterBlurb: "Ett litet instrument som läser av dagens kaosflöde. Ingen vet hur. Alla accepterar det.",
    chaosMeterLevelLabel: "Kaosnivå",
    chaosMeterTierCalm: "lugn",
    chaosMeterTierSpicy: "spicy",
    chaosMeterTierFeral: "vild",
    chaosMeterTierMeltdown: "meltdown",
    chaosMeterSignal: (value) => `Signal: ${value}/100`,
    chaosMeterAction: "Peta på OS:et",
    chaosMeterToastTitle: "Signal uppsnappad",
    toastWidgetOnline: "Widget online",
    toastWidgetHidden: "Widget dold",
    toastDesktopReset: "Skrivbord återställt",
    toastDesktopResetMessage: "Standardlayout tillbaka.",
    toastPaletteSwitched: "Palett bytt",
    toastDesktopPulse: "Skrivbordspuls",
    backendTitle: "Backend nås inte",
    backendDescription: "discord-hub-api körs inte eller har kraschat.",
    backendHint1: "Starta API:t och ladda om.",
    backendHint2:
      "Lägg värden från apps/discord-hub-api/.env.example i repots .env och kör om npm run dev:discord-stack.",
    musicNeedVoiceChannel: "Gå med i en röstkanal på Discord för att spela musik.",
    musicPlayFailedTitle: "Kunde inte köa",
    musicPlayFailedGeneric: "Länken gick inte att spela upp. Prova en annan källa eller sökterm.",
    musicSpotifyPlaylistUnavailable:
      "Den här Spotify-spellistan gick inte att läsa eller fick inga spår som botten kan spela. Personliga listor (t.ex. Discover Weekly) fungerar ofta inte med app-läge — använd en publik spellista. Tips: sätt SPOTIFY_DEFAULT_MARKET=SE i bot-miljön om spår saknar region.",
    musicPlayerDropHint:
      "Dra en länk från Spotify, YouTube eller SoundCloud hit och släpp för att köa (samma som att klistra in i fältet).",
    musicPlayerDropActive: "Släpp för att lägga till i kön",
    musicPlayerDropInvalid:
      "Hittade ingen spelbar länk. Droppa en Spotify-, YouTube- eller SoundCloud-URL (eller dra från Spotify till sidan).",
    musicPreviousTitle: "Föregående låt",
    musicPreviousNone: "Ingen tidigare låt finns i den här sessionen.",
    musicShuffleQueue: "Blanda kön",
    musicQueueDragHandleAria: "Dra för att ändra ordning i kön",
    musicQueueReorderFailed: "Kunde inte spara köordningen. Försök igen.",
  },
  desktopSurface: {
    spawnApp: "Visa app",
    personalShell: "Personligt skal",
    rightClickHint: "Högerklicka för skalåtgärder",
    emptyBadge: "Skrivbordet sover",
    emptyTitle: "Allt är gömt just nu",
    emptyBody:
      "Visa en modul, högerklicka ytan och bygg ditt eget skal från scratch.",
    dragButton: "Dra",
    dragTooltip: "Tryck och dra var som helst på modulen för att flytta den",
    hideTooltip: "Dölj widget",
    hideAria: (label) => `Dölj ${label}`,
    dragAria: (label) => `Dra ${label}`,
    layoutEditBanner: "Layout-läge",
    layoutEditHint:
      "Använd nedre verktygsraden. Nyp tag i modulen (tryck och dra var som helst på kortet). Högerklick prioriterar layout.",
    widgetPositionResetToast: "Modulens plats är tillbaka till standard.",
    editStickyHelp: "Nyp och dra modul · ändra storlek · högerklick · spara",
    resizeHandleAria: "Ändra storlek",
    holdToDragOutsideLayoutHint:
      "Håll pekaren stilla en kort stund på en modul — då greppar du den och kan dra utan layoutläge (handen byter till grepp).",
    widgetContextMenuEdit: "Redigera",
    widgetContextMenuHide: "Dölj",
    widgetContextMenuResetPos: "Återställ position",
    widgetQuickEditTitle: (label) => `Redigera ${label}`,
  },
  profileSettings: {
    pageTitle: "Profilinställningar",
    pageIntroBefore: "Koppla League, synka och styr vad som visas på din",
    publicProfileLinkLabel: "publika profil",
    pageIntroAfter: ". Rank och matcher visas på profilen efter lyckad synk.",
    themeCardTitle: "Tema och färger",
    themeCardDesc:
      "Diagramfärger och primärknapp följer temat i sidhuvudet.",
    themeCardBody:
      "Byt ljust/mörkt och accent där — det påverkar hela hubben, inklusive din publika profil.",
    languageCardTitle: "Språk",
    languageCardDesc: "Styr språk för hela hubben (menyer, fel, toasts).",
    languageSv: "Svenska",
    languageEn: "English",
    profileCardTitle: "Profil",
    profileCardDesc: "Grundinställningar för profilsidan.",
    showOnline: "Visa online-status",
    showRank: "Visa rank på profil",
    shareChampionPool: "Dela champion pool",
    leagueCardTitle: "Synka League of Legends",
    leagueCardDesc: "Koppla konto och hämta rank samt senaste matcher via Riot API.",
    riotId: "Riot ID",
    tagline: "Tagline",
    region: "Region",
    rankSource: "Rank-källa",
    rankSolo: "Solo Queue",
    rankFlex: "Flex Queue",
    autoSync: "Auto-synk när datahämtning aktiveras",
    statusMessage: "Statusmeddelande",
    statusPlaceholder: "Redo för ranked-grind.",
    connect: "Koppla konto",
    syncNow: "Synka nu",
    disconnect: "Koppla bort",
    leagueFootnoteBefore:
      "Snapshot ligger i minnet på servern tills omstart — detaljerad rank och matchhistorik visas på",
    leagueFootnoteLinkLabel: "din publika profil",
    leagueFootnoteAfter: "efter synk.",
    defaultStatusMessage: "Redo för ranked-grind.",
    errors: {
      leagueStatusRead: "Kunde inte läsa League-status just nu.",
      connectFailed: "Kunde inte koppla League-kontot.",
      connectNetwork: "Nätverksfel vid koppling av League-konto.",
      syncFailed: "Kunde inte köra synk.",
      syncNetwork: "Nätverksfel vid synk.",
      disconnectFailed: "Kunde inte koppla bort League-kontot.",
      disconnectNetwork: "Nätverksfel vid bortkoppling.",
    },
    success: {
      connected: "League-konto kopplat.",
      synced: "League-data synkad.",
      disconnected: "League-konto bortkopplat.",
    },
    backendTitle: "Backend nås inte",
    backendDescription: "discord-hub-api körs inte eller har avslutats.",
    backendBody: "Starta API:t och ladda om sidan.",
  },
  publicProfile: {
    loadingTitle: "Laddar offentlig profil…",
    loadingDesc: "Hämtar Discord-identitet och kopplade profiler.",
    loadErrorNetwork: "Kunde inte ladda den offentliga profilen just nu.",
    notFoundTitle: "Profilen hittades inte",
    notFoundDesc:
      "Användaren finns inte i den publika cachen ännu, eller så är profilen inte publicerad.",
    toHub: "Till hubben",
    errorTitle: "Kunde inte ladda profilen",
    pageTitle: "Publik profil",
    pageIntro: (name, leagueLine) => `Profil för ${name}. ${leagueLine}`,
    settingsButton: "Profilinställningar",
    openHub: "Öppna hubben",
    labelProfileStatus: "Profilstatus",
    labelLeagueConnection: "League-koppling",
    labelLeagueStats: "League-stats",
    gamesRankLabel: "Rank",
    gamesRegionLabel: "Region",
    cardStatusTitle: "Status",
    cardStatusDesc: "Offentlig vy av kontot.",
    cardGamesTitle: "Spel",
    cardGamesDesc: "League of Legends (publik data).",
    cardMoreTitle: "Mer profildata",
    cardMoreDesc: "Identitet och tidsstämplar.",
    profileStatusBase: "Grundprofil",
    profileStatusLeague: "På gång",
    leagueLinkPublished: "Publicerad",
    leagueLinkNot: "Ej kopplad",
    statsSynced: "Synkade",
    statsWaiting: "Väntar på synk",
    statsNone: "Inte inkopplade ännu",
    steamNotLinked: "Inte kopplat",
    noLeaguePublic: "Ingen League-koppling publicerad.",
    rankDash: "Rank: —",
    regionDash: "Region: —",
    separator: "·",
    syncedShort: (d) => `Synkad ${d}`,
    leagueStatsTitle: "League — stats",
    leagueStatsDescFetched: (ts, account) =>
      `Data hämtad ${ts} · konto ${account}`,
    noLeagueData:
      "Ingen League-data att visa. När användaren kopplar kontot syns det här.",
    notSyncedYet:
      "Ingen synkad snapshot ännu. Efter nästa synk visas ranked-köer och senaste matcher här.",
    statsUnavailable: "Stats inte tillgängliga just nu.",
    accountLabel: "Konto",
    regionLabel: "Region",
    rankedQueues: "Ranked-köer",
    noRankedReturned: "Ingen ranked-data returnerades för spelaren.",
    rankedEntryLine: (tier, rank, lp) => `${tier} ${rank} · ${lp} LP`,
    rankedEntryRecord: (wins, losses, hotStreakLabel) => `${wins}V / ${losses}F${hotStreakLabel}`,
    recentMatches: "Senaste matcher",
    noMatchHistory: "Ingen matchhistorik i denna snapshot.",
    win: "Vinst",
    loss: "Förlust",
    matchStatsLine: (kills, deaths, assists, cs, level) =>
      `${kills}/${deaths}/${assists} KDA · ${cs} CS · nivå ${level}`,
    leagueMatchModeLine: (gameMode, gameType) => {
      const gm = gameMode.trim();
      const gt = gameType.trim();
      if (!gm && !gt) return "";
      if (!gt) return gm;
      if (!gm) return gt;
      return `${gm} · ${gt}`;
    },
    steamTitle: "Steam",
    steamDesc: "Reserverat för nästa integration.",
    steamBody:
      "Steam visas här när koppling och backend finns — samma kortstil som på hubben.",
    leagueIntro: {
      none: "Inget League-konto publicerat ännu.",
      notSynced:
        "League kopplat — ägaren kan synka under profilinställningar för att visa rank och matcher här.",
      soon: "League kopplat — stats kommer snart.",
      synced: "League-stats från senaste synk.",
    },
    rankFallback: "Ingen rank ännu — rent noob-läge.",
    noSyncYetShort: "Ingen sync ännu",
    discordId: "Discord-ID",
    displayName: "Visningsnamn",
    linkedSince: "Kopplad sedan",
    lastLeagueSync: "Senaste League-sync (koppling)",
    statusLine: (label, value) => `${label}: ${value}`,
    hotStreak: " · hot streak",
  },
  leagueStatsPage: {
    loading: "Laddar statistik…",
    loadingMatches: "Laddar matcher…",
    syncRequiredTitle: "Synk krävs",
    syncRequiredBody: (accountList) =>
      `${accountList} är kopplat men ingen synk har körts.`,
    syncRequiredLinkLabel: "Profil → Inställningar",
    syncRequiredAction: "och klicka Synkronisera på kontot.",
    syncRequiredApiHint: "Kräver att RIOT_API_KEY är satt i API:ts .env.",
    noLinkedTitle: "Ingen League-data tillgänglig",
    noLinkedBody: "Koppla ditt Riot-konto under Profil → Inställningar och kör en synk.",
    loadError: (message) => `Kunde inte ladda statistik: ${message}`,
    noMatchesTitle: "Inga matcher inspelade ännu",
    noMatchesBody: "Kör en synk för det valda kontot för att börja samla data.",
    title: "League of Legends — statistik",
    subtitle: (totalGames, accountLine) =>
      `Baserat på ${totalGames} inspelade matcher${accountLine}`,
    statGames: "Matcher",
    statGamesSub: (wins, losses) => `${wins}V / ${losses}F`,
    statWinRate: "Win rate",
    statKda: "KDA (snitt)",
    statKdaSub: (k, d, a) => `${k} / ${d} / ${a}`,
    statCs: "CS / match",
    statCsSub: (avgDuration) => `Snitt ${avgDuration} / match`,
    breakdownByQueue: "Per spelläge",
    thQueueMode: "Läge",
    thMatches: "Matcher",
    thWl: "V/F",
    thWinPct: "Win %",
    championsTitle: "Mest spelade champions",
    thChampion: "Champion",
    thChampMatches: "Matcher",
    thChampWinPct: "Win %",
    thChampKda: "KDA",
    thChampCsPerGame: "CS/match",
    matchHistoryTitle: "Matchhistorik",
    winBadge: "VINST",
    lossBadge: "FÖRLUST",
    levelShort: (n) => `Niv ${n}`,
    goldK: (k) => `${k}k guld`,
    csLabel: "CS",
    paginationPrev: "Föregående",
    paginationNext: "Nästa",
    paginationRange: (from, to, total) => `Visar ${from}–${to} av ${total}`,
    paginationPage: (page, totalPages) => `Sida ${page} av ${totalPages}`,
    matchesLoadError: "Kunde inte ladda matchhistorik.",
    queueSoloDuo: "Solo/Duo",
    queueFlex: "Flex",
    queueAram: "ARAM",
    queueQuickplay: "Snabbspel",
    queueNormalDraft: "Normal draft",
    queueCustom: "Custom",
    queueUnknown: (queueId) => `Kö ${queueId}`,
  },
  login: {
    title: "Logga in",
    description: "Synka med Discord för att använda hubben.",
    oauthFailed: "Inloggningen dog. Försök igen.",
    apiUnreachable:
      "Backend svarar inte (vanligt mål: port 3001). Vanlig orsak: discord-hub-api körs inte eller kraschade — kolla [api]-terminalen och .env enligt apps/discord-hub-api/.env.example. Om du satt PORT i apps/discord-hub-api/.env: starta om Vite så proxyn följer (eller sätt DISCORD_HUB_API_DEV_PORT i rot-.env).",
    continueDiscord: "Fortsätt med Discord",
    continueDisabled: "Fortsätt med Discord",
  },
  spinWheel: {
    loading: "Laddar…",
    backendError: "Backend strular. Försök igen senare.",
    collabTitle: "Delat hjul (beta)",
    collabDesc:
      "Realtime-rum med Yjs/y-websocket. Utkastet synkas live och spins/lag skickas till alla i rummet.",
    collabConnected: "ansluten",
    defaultCollabRoom: "neutralen-wheel",
    roomLabel: "Rum",
    presenceCount: (n) => `${n} närvarande i rummet`,
    realtimeEnabled: "Realtime på",
    copyRoom: "Kopiera rum",
    participantsTitle: "Deltagare",
    participantsDesc: "En rad per namn. Komma funkar också.",
    participantsTextareaPlaceholder: "Alice\nBob\nCharlie",
    noParticipants: "Inga deltagare än",
    participantCount: (n) => `${n} deltagare`,
    clear: "Rensa",
    participantMenuLabel: "Deltagare",
    remove: "Ta bort",
    copyName: "Kopiera namn",
    uncurse: "Ta bort curse",
    markCursed: "Markera som cursed",
    accuseTitle: "Anmälan inskickad",
    accuseMenuLabel: "Anklaga (ceremoniellt)",
    accuseMessage: (name) => `${name} är nu under utredning (ceremoniellt).`,
    curseLifted: "Curse borttagen",
    markedCursed: "Markerad som cursed",
    teamsTitle: "Lag & seed",
    teamsDesc: "Styr hur lagen skapas (och om det ska vara deterministiskt).",
    teamCount: "Antal lag",
    distribution: "Fördelning",
    modeBalanced: "Balanserade lag (rekommenderas)",
    modeEqual: "Exakt jämna lag",
    equalTeamsWarning: (p, t) =>
      `Kan inte skapa exakt jämna lag: ${p} deltagare går inte jämnt upp i ${t} lag.`,
    seedLabel: "Seed (valfritt)",
    seedPlaceholder: "t.ex. scrim-2026-03-25",
    seedLastUsed: "Senast använd seed:",
    seedEmptyHint: "Lämna tomt för slumpmässigt seed.",
    copySeed: "Kopiera",
    autoSave: "Auto-spara sessioner",
    spinAndTeams: "Snurra & skapa lag",
    spinOnly: "Snurra",
    makeTeams: "Skapa lag",
    reshuffle: "Blanda om lag",
    groupsTitle: "Sparade grupper",
    groupsDesc: "Spara deltagarlistor du återanvänder.",
    newGroupDefault: "Ny grupp",
    groupNamePlaceholder: "Gruppnamn",
    saveNew: "Spara ny",
    update: "Uppdatera",
    refreshList: "Uppdatera lista",
    selectedGroup: "Vald grupp:",
    clearSelection: "Avmarkera",
    loadingGroups: "Laddar grupper…",
    noGroups: "Inga sparade grupper än.",
    participantsUpdated: "deltagare · uppdaterad",
    removeGroup: "Ta bort",
    addParticipantsHint: "Lägg till deltagare för att se hjulet.",
    wheelEmptySliceLabel: "Tomt",
    wheelSpinAria: "Snurra hjulet",
    celebrateEyebrow: "Vinnare",
    celebrateDesc: "Hjulet stannade på detta namn.",
    celebrateClose: "Stäng",
    celebrateRemove: "Ta bort",
    teamsResultTitle: "Lag",
    teamsResultDesc: "Resultatet från senaste lagbygget.",
    equalTeamsBanner:
      "Exakt jämna lag kräver att deltagarantalet är delbart med antal lag.",
    noTeamsYet: 'Inga lag ännu. Klicka på "Skapa lag".',
    teamLabel: (i) => `Lag ${i + 1}`,
    sessionsTitle: "Senaste sessioner",
    sessionsDesc: "Team/vinnar-historik sparad i backend.",
    refresh: "Uppdatera",
    loadingSessions: "Laddar sessioner…",
    noSessions: "Inga sessioner ännu.",
    sessionWinner: (name) => `Vinnare: ${name}`,
    sessionTeamsOnly: "Lag skapade",
    sessionMetaParticipants: (count, teamCount, when) =>
      `${count} deltagare · ${teamCount} lag · ${when}`,
    sessionSeedPrefix: "· seed",
    load: "Ladda",
    participantChipTitle: "Klicka för att ta bort. Högerklick för mer brott.",
    voiceChannelsTitle: "Röstkanaler (live)",
    voiceChannelsLoading: "Hämtar röstläge…",
    voiceChannelsError: "Kunde inte hämta röstkanaler.",
    voiceChannelsEmpty: "Ingen är i röst just nu.",
    voiceChannelsGuildHint:
      "Sätt VITE_DISCORD_HUB_GUILD_ID i discord-hub-web/.env för att se live-röst här (samma som dashboard).",
    voiceChannelUnnamed: "Röstkanal",
    voiceChannelMore: (n) => `+${n} till`,
    toasts: {
      roomUpdate: "Rumsuppdatering",
      roomUpdateMessage: (name) => `${name} uppdaterade det delade hjulet.`,
      loadGroupsFail: "Kunde inte ladda grupper",
      loadSessionsFail: "Kunde inte ladda sessioner",
      backendUnreachable: "Backend svarar inte",
      backendUnreachableMessage: "Hub-API:t svarade inte. Nu jävlar.",
      saveSessionFail: "Kunde inte spara session",
      sessionSaved: "Session sparad",
      sessionSavedWinner: (w) => `Vinnare: ${w}`,
      sessionSavedTeams: "Lagen noterade.",
      saveGroupFail: "Kunde inte spara grupp",
      groupSaved: "Grupp sparad",
      updateGroupFail: "Kunde inte uppdatera grupp",
      groupUpdated: "Grupp uppdaterad",
      deleteGroupFail: "Kunde inte ta bort grupp",
      groupDeleted: "Grupp borta",
      groupDeletedMessage: "Borta. reducerad till atomer.",
      roomCopied: "Rum kopierat",
      seedCopied: "Seed kopierad",
      voiceFillTitle: "Deltagare från röst",
      voiceFillMessage: (channelLabel, count) =>
        `${count} ${count === 1 ? "person" : "personer"} från ${channelLabel}`,
      voiceMoveFail: "Kunde inte flytta i Discord",
      voiceMoveUnknown: "Okänt fel — kolla att botten har Behörighet att flytta medlemmar.",
      voiceMoveNoMember: (name) =>
        `Hittade ingen i röst som matchar “${name}”. Uppdatera listan från röstkanal eller använd samma namn som i Discord.`,
    },
  },
  backendCard: {
    title: "Backend nås inte",
    description: "discord-hub-api körs inte eller har kraschat.",
    body: "Starta API:t och ladda om.",
    hintEnv:
      "Lägg värden från apps/discord-hub-api/.env.example i repots .env och kör om npm run dev:discord-stack.",
    retry: "Försök igen",
  },
  hubPrefsPanel: {
    title: "Shell-inställningar",
    description: "Anpassa widgets, skrivbord och ton.",
    openButton: "Anpassa",
    closeButton: "Stäng",
    resetAll: "Återställ allt",
    resetAllConfirm: "Alla inställningar återställda.",
    savedToast: "Inställningar sparade",
    tabs: {
      widget: "Widget",
      desktop: "Skrivbord",
      copy: "Ton & copy",
    },
    widget: {
      noWidgetSelected: "Ingen widget vald",
      selectWidgetHint: "Välj en widget nedan för att anpassa den.",
      widgetLabel: "Widget",
      sizePreset: "Storlek",
      sizeCompact: "Kompakt",
      sizeCozy: "Normal",
      sizeExpanded: "Utbyggd",
      toneOverride: "Ton",
      toneInherit: "Ärvd",
      toneUseful: "Useful",
      toneSocial: "Social",
      toneChaos: "Chaos",
      glassOpacity: "Opacitet",
      glassOpacityHint: "Kortets fyllnadsnivå (0 = genomskinlig, 100 = solid).",
      blurStrength: "Blur",
      blurNone: "Ingen",
      blurLight: "Lätt",
      blurMedium: "Medel",
      blurStrong: "Stark",
      showSubtitle: "Visa undertitel",
      showSubtitleDesc: "Visa widgetens beskrivningsrad.",
      showToneBadge: "Visa ton-badge",
      showToneBadgeDesc: "Visa tone-märket i kortets header.",
      resetWidget: "Återställ widget",
    },
    desktop: {
      stylePack: "Stilpaket",
      stylePackDefault: "Standard",
      stylePackMidnight: "Midnight",
      stylePackPaper: "Paper",
      stylePackSignal: "Signal",
      stylePackCampfire: "Lägereld",
      gridDensity: "Rutnätsdensitet",
      gridCompact: "Kompakt",
      gridCozy: "Normal",
      gridExpanded: "Luftigt",
      gridCompaction: "Packning",
      gridCompactionNone: "Ingen packning",
      gridCompactionPack: "Auto-packa",
      snapStrength: "Snap-styrka",
      snapRelaxed: "Avslappnad",
      snapStandard: "Standard",
      snapFirm: "Strikt",
      showWidgetBorder: "Widget-kant",
      showWidgetBorderDesc: "Ram runt modulkort på skrivbordet och i mobil-listan.",
      dockPosition: "Dock-position",
      dockBottom: "Nederkant",
      dockLeft: "Vänster",
      dockScale: "Dock-storlek",
      dockSm: "Liten",
      dockMd: "Medel",
      dockLg: "Stor",
      animationIntensity: "Animationsintensitet",
      animationIntensityHint: "0 = minimal rörelse, 100 = fulla transitioner.",
    },
    inspectCursor: {
      sectionTitle: "Skal-pekare (dev)",
      sectionHint:
        "När skal-högerklick är aktivt visas denna pekare i stället för standardmusen. Webbläsarens högerklick och Inspect använder vanlig pekare.",
      presetLabel: "Stil",
      presetCrosshair: "Hårkors",
      presetDot: "Punkt",
      presetRing: "Ring",
      presetBracket: "Hörn",
      colorLabel: "Färg",
      colorPrimary: "Primary",
      colorAccent: "Accent",
      colorForeground: "Text",
      colorCustom: "Egen hex",
      customHexLabel: "Hex-färg",
      customHexHint: "#RGB eller #RRGGBB, t.ex. #38bdf8.",
      sizeLabel: "Storlek",
      sizeHint: "Relativ skala för pekaren (50–200 %).",
    },
    copy: {
      personality: "Personlighet",
      personalityCalm: "Lugn",
      personalityNormal: "Normal",
      personalityChaotic: "Kaotisk",
      personalityCalmDesc: "Kortfattad och saklig – inga galenskaper.",
      personalityNormalDesc: "Balanserat – lekfullt men inte överdrivet.",
      personalityChaoticDesc: "Fullt kaos-läge. Du vet vad du gör.",
      toastVerbosity: "Toast-verbositet",
      toastMinimal: "Minimal",
      toastNormal: "Normal",
      toastVerbose: "Utförlig",
      toastMinimalDesc: "Kort TTL, ingen meddelandetext.",
      toastNormalDesc: "Standard timing och innehåll.",
      toastVerboseDesc: "Längre TTL, mer text.",
      memeFrequency: "Meme-frekvens",
      memeOff: "Av",
      memeLow: "Låg",
      memeNormal: "Normal",
      memeOffDesc: "Inga memes eller easter eggs. Tryggt.",
      memeLowDesc: "Sällsynta easter eggs – lätt kryddat.",
      memeNormalDesc: "Normalt chaos-läge. Förväntad nivå av vansinne.",
    },
  },
};

const EN: HubCopy = {
  common: {
    copied: "Copied",
    dismissAria: "Dismiss",
    loading: "Loading…",
    loadingProfile: "Loading profile…",
    backendProblem: "Backend’s having a moment",
    tryAgain: "Try again",
    command: "Command",
    commandShort: "Cmd",
    logIn: "Log in",
    logOut: "Log out",
  },
  layout: {
    title: "Discord hub",
    navHome: "Home",
    navMyProfile: "My profile",
    navLeague: "League",
    toolsMenu: "Tools",
    toolsMoreSoon: "More modules soon. Probably.",
    toolsMe: "Me",
    identityMenuTitle: "Identity",
    identityRightClickHint: "Right-click for more options.",
    notLoggedIn: "Not logged in",
    loadingAccount: "Loading account…",
  },
  chrome: {
    brandTitle: "Neutralen OS",
    brandTagline: "community shell",
    bootToastTitle: "Boot complete",
    bootToastMessage: "Shell online. Please handle the vibes gently.",
    toolDesktop: "Desktop",
    navDesktop: "Desktop",
    myProfile: "My profile",
    myProfileOffline: "My profile offline",
    settings: "Settings",
    wheel: "Wheel",
    navRadio: "Radio",
    navLeagueStats: "League stats",
    runningApp: "Running app",
    identityNavHint: "Right-click for identity actions.",
    panelWheel: {
      label: "Wheel module",
      detail: "Shared chaos tools and random fate routing.",
    },
    panelMusic: {
      label: "Music queue",
      detail: "Discord bot queue and playback.",
    },
    panelLeagueStats: {
      label: "League stats",
      detail: "Your matches, queues, and champions.",
    },
    panelSettings: {
      label: "Profile settings",
      detail: "Identity, integrations, and whatever counts as responsible configuration here.",
    },
    panelProfile: {
      label: "Public profile",
      detail: "A user-facing panel running inside the Neutralen OS shell.",
    },
    panelDefault: {
      label: "Workspace panel",
      detail: "A routed app window living inside the shell.",
    },
    layoutEditEnter: "Layout",
    layoutEditExit: "Done",
    devNativeContextButtonShell: "Dev: right-click uses the shell menu. Click for the browser menu.",
    devNativeContextButtonBrowser: "Dev: right-click uses the browser menu. Click for the shell menu.",
    shellObjectNavGroup: "Primary navigation",
    shellObjectBrandBlock: "System brand & ticker",
    shellObjectDockBar: "Dock",
    shellObjectDesktopZone: "Desktop surface",
    shellObjectUtilityZone: "Module spawn zone",
  },
  editMode: {
    toolbarAria: "Layout edit toolbar",
    addModule: "Add module",
    addModuleDetail: "Jump to sleeping modules and spawn one",
    layoutOptions: "Layout",
    layoutReset: "Reset desktop layout",
    layoutRestoreAll: "Wake all sleeping modules",
    gridSnapEnable: "Grid snap on",
    gridSnapDisable: "Grid snap off",
    gridShowEnable: "Show grid",
    gridShowDisable: "Hide grid",
    saveLayout: "Save layout",
    saveLayoutDetail: "Confirm layout is stored locally",
    done: "Done",
    doneDetail: "Exit layout edit mode",
    cancel: "Cancel",
    cancelDetail: "Exit layout edit mode",
    addModuleToastTitle: "Module spawn",
    addModuleToastBody: "Pick a sleeping module below or use the toolbar.",
    layoutSavedTitle: "Layout saved",
    layoutSavedMessage: "Your desktop layout stays in this browser.",
    restoreAllTitle: "Modules restored",
    restoreAllMessage: "Every sleeping module is back on the desktop.",
    desktopOnlyToast: "Switch to the desktop for this action.",
    discardLayout: "Discard session",
    discardLayoutDetail: "Revert the draft to how it was when you opened layout mode",
    undoLayout: "Undo",
    redoLayout: "Redo",
    autosaveEnable: "Autosave on",
    autosaveDisable: "Autosave off",
    unsavedBadge: "Unsaved changes",
    shortcutsHelp: "Shortcuts",
    shortcutsHelpTitle: "Layout shortcuts",
    shortcutsLines: [
      "Esc — clear selection",
      "Arrow keys — nudge selected modules (grid step when snap is on)",
      "Ctrl/⌘+Z — undo · Ctrl/⌘+Shift+Z or Ctrl/⌘+Y — redo",
      "] — bring selected to front",
      "Shift or Ctrl/⌘+click — multi-select",
      "Top bar: drag tabs to reorder (saved locally).",
    ],
    doneSaveExit: "Done",
    doneSaveExitDetail: "Save layout and exit layout mode",
    cancelDiscardExit: "Cancel",
    cancelDiscardExitDetail: "Discard changes and exit layout mode",
    layoutDiscardedTitle: "Layout reverted",
    layoutDiscardedMessage: "Draft matches the start of this edit session.",
    shellReorderDragHandleAria: (itemLabel) => `Move ${itemLabel}`,
  },
  tools: {
    dashboard: {
      label: "Home",
      description: "Status lights, modules, and whatever the system is up to.",
    },
    spinTheWheel: {
      label: "Wheel",
      description: "Fate spinner + team randomizer. Blame the wheel, not me.",
    },
    music: {
      label: "Music",
      description: "Queue manager for the Discord music bot.",
    },
    profileSettings: {
      label: "Settings",
      description: "Tweak your vibe and integrations.",
    },
    me: {
      label: "Me",
      description: "Your public profile. Do not perceive too hard.",
    },
  },
  commandPalette: {
    dialogTitle: "Clanker command palette",
    dialogDescription: "Search modules, system actions, and the occasional bad decision.",
    inputPlaceholder: "Search actions, routes, settings, or the occasional forbidden word…",
    recentHeading: "Recent commands",
    recentBadge: "recent",
    emptyTitle: (q) => `No command matched “${q}”.`,
    emptyHint: "Try dashboard, audio, settings, seed, or one of the stranger ritual words.",
    sectionNavigation: "Navigation",
    sectionSystem: "System",
    sectionChaos: "Chaos",
    toneUseful: "useful",
    toneSocial: "social",
    toneChaos: "chaos",
  },
  actions: {
    toasts: {
      paletteSwitched: "Palette switched",
      clipboardBlocked: "Clipboard blocked",
      clipboardBlockedMessage: "The browser refused to write that value. Rude.",
      sessionRefreshed: "Session refreshed",
      sessionRefreshedMessage: "Identity and shell state asked the backend to wake up.",
      refreshFailed: "Refresh failed",
      refreshFailedMessage: "The hub API didn’t answer in time. Bollocks.",
      audioArmed: "Audio armed",
      audioMuted: "Audio muted",
      audioArmedMessage: "Tiny noises are back online.",
      audioMutedMessage: "The system will sulk in silence.",
      seedCopied: "Seed copied",
      seedCopiedMessage: "Freshly harvested for future disputes.",
      goblinTitle: "Goblin protocol armed",
      goblinMessage: "The system approves exactly none of this.",
      hamsterTitle: "Hamster appeased",
      hamsterMessage: "Latency improved spiritually, if not technically.",
      copiedDiscordId: (id) => `Discord ID: ${id}`,
      devNativeContextBrowserTitle: "Browser right-click",
      devNativeContextBrowserMessage: "Inspect and the page menu work again.",
      devNativeContextShellTitle: "Shell right-click",
      devNativeContextShellMessage: "The hub context menu is back.",
    },
    navDashboard: {
      label: "Open dashboard",
      description: "Jump to the main Neutralen OS surface.",
      keywords: ["home", "dashboard", "desktop", "hub"],
    },
    navWheel: {
      label: "Open wheel",
      description: "Launch the fate spinner and team randomizer.",
      keywords: ["spin", "wheel", "teams", "random"],
    },
    navRadio: {
      label: "Open radio",
      description: "Music queue and Discord bot controls.",
      keywords: ["radio", "music", "queue", "player"],
    },
    navLeagueStats: {
      label: "Open League stats",
      description: "Matches, queues, and champions for your linked accounts.",
      keywords: ["league", "lol", "riot", "stats", "matches"],
    },
    navSettings: {
      label: "Open settings",
      description: "Tweak your profile vibe and integrations.",
      keywords: ["settings", "profile", "integrations"],
    },
    navProfile: {
      label: "Open my profile",
      description: "Jump straight to your public profile card.",
      keywords: ["me", "profile", "identity"],
    },
    systemCommand: {
      label: "Open command bar",
      description: "Open the shell command layer from anywhere.",
      keywords: ["command", "palette", "search", "launcher"],
    },
    systemRefresh: {
      label: "Refresh session state",
      description: "Re-read identity and shell status from the backend.",
      keywords: ["refresh", "reload", "session", "identity", "profile"],
    },
    systemPalette: {
      label: "Cycle color palette",
      description: "Switch the current UI palette to a different mood.",
      keywords: ["theme", "palette", "color", "mode"],
    },
    systemAudioMute: {
      label: "Mute Clanker sounds",
      description: "Silence tiny fanfares and button noises.",
      keywords: ["audio", "sound", "mute", "volume"],
    },
    systemAudioEnable: {
      label: "Enable Clanker sounds",
      description: "Let the system click back at you.",
      keywords: ["audio", "sound", "mute", "volume"],
    },
    systemCopySeed: {
      label: "Copy wheel seed starter",
      description: "Put a fresh seed name on the clipboard for future disputes.",
      keywords: ["copy", "clipboard", "seed", "wheel", "random"],
    },
    systemLogout: {
      label: "Log out",
      description: "Exit the hub shell and drop back to the login gate.",
      keywords: ["logout", "sign out", "auth", "leave"],
    },
    systemCopyDiscord: {
      label: "Copy Discord ID",
      description: "Copy your numeric Discord identifier to the clipboard.",
      keywords: ["copy", "clipboard", "discord", "id", "identity"],
    },
    systemCopyHandle: {
      label: "Copy handle",
      description: "Copy your @handle for quick sharing.",
      keywords: ["copy", "clipboard", "handle", "username", "discord"],
    },
    chaosGoblin: {
      label: "Summon goblin protocol",
      description: "Fire an unnecessary but emotionally correct system message.",
      keywords: ["goblin", "chaos", "easter egg", "meme"],
      reveal: ["goblin", "protocol", "meme"],
    },
    chaosHamster: {
      label: "Appease the server hamster",
      description: "Offer spiritual maintenance to the tiny creature in the rack.",
      keywords: ["hamster", "server", "ritual", "snack"],
      reveal: ["hamster", "snack", "ritual"],
    },
    devNativeBrowserMenu: {
      label: "Browser right-click (dev)",
      description: "Let Inspect and the page menu through instead of the shell menu.",
      keywords: ["inspect", "devtools", "right-click", "browser", "native", "context", "dev"],
    },
    devShellContextMenu: {
      label: "Shell right-click (default)",
      description: "Return to the hub’s own context menu.",
      keywords: ["shell", "right-click", "context", "neutralen"],
    },
  },
  shellMenu: {
    desktop: "Desktop",
    neutralenOs: "Neutralen OS",
    openCommandBar: "Open command bar",
    cyclePalette: "Cycle palette",
    cycleStylePack: "Cycle style pack",
    muteAudio: "Mute audio feedback",
    enableAudio: "Enable audio feedback",
    spawnWidget: "Spawn widget",
    system: "System",
    resetDesktop: "Reset desktop layout",
    refreshShell: "Refresh shell state",
    chaosPulse: "Chaos pulse",
    shell: "Shell",
    openDashboard: "Open dashboard",
    openWheel: "Open wheel",
    openRadio: "Open radio",
    openLeagueStats: "Open League stats",
    openMyProfile: "Open my profile",
    openSettings: "Open settings",
    identity: "Identity",
    copyHandle: "Copy handle",
    copyDiscordId: "Copy Discord ID",
    open: "Open",
    openProfile: "Open profile",
    logOut: "Log out",
    hideWidget: "Hide widget",
    openModule: "Open module",
    openInNewTab: "Open in new tab",
    copyModulePath: "Copy module path",
    pinDock: "Pin to dock",
    unpinDock: "Unpin from dock",
    profile: "Profile",
    copyProfileLink: "Copy profile link",
    returnToDesktop: "Return to desktop",
    link: "Link",
    openLink: "Open link",
    openLinkNewTab: "Open link in new tab",
    copyLinkAddress: "Copy link address",
    enterLayoutEdit: "Enter layout edit mode",
    exitLayoutEdit: "Exit layout edit mode",
    shellObject: "Shell object",
    focusWidget: "Bring to front",
    resetWidgetPosition: "Reset position",
    duplicatePlaceholder: "Duplicate (coming soon)",
    detachPlaceholder: "Detach panel (coming soon)",
    layoutEditing: "Layout editing",
    shellUsageWhileEditing: "Shell usage",
    addModule: "Add module",
    restoreAllHidden: "Wake all sleeping modules",
    gridSnapOn: "Grid snap on",
    gridSnapOff: "Grid snap off",
    layoutSavedToast: "Layout saved locally",
    desktopOnlyAction: "Desktop only",
    saveLayoutCommitted: "Save layout",
    discardLayoutDraft: "Discard session",
    undoLayout: "Undo",
    redoLayout: "Redo",
    autosaveLayoutOn: "Layout autosave on",
    autosaveLayoutOff: "Layout autosave off",
  },
  navBookmarks: {
    addFromNavGroup: "Add bookmark…",
    contextMenuManageSection: "Bookmark",
    editBookmark: "Edit bookmark…",
    deleteBookmark: "Remove bookmark",
    dialogAddTitle: "New bookmark",
    dialogEditTitle: "Edit bookmark",
    dialogDescription:
      "Display name, icon, and target. Use an internal hub path starting with / (e.g. /dashboard, /profile/settings) or a full https URL for external pages.",
    labelField: "Display name",
    pathField: "Target (path or URL)",
    pathHint: "Internal: /profile/settings · External: https://…",
    iconField: "Icon",
    iconNames: {
      Bookmark: "Bookmark",
      Home: "Home",
      Settings: "Settings",
      Workflow: "Workflow",
      Star: "Star",
      LayoutDashboard: "Dashboard",
      User: "User",
      Search: "Search",
      Link2: "Link",
      Bell: "Bell",
      Heart: "Heart",
      Zap: "Zap",
      Music: "Music",
      Radio: "Radio",
      Trophy: "Trophy",
    },
    save: "Save",
    cancel: "Cancel",
    deleteConfirm: "Remove",
    toastAdded: "Bookmark added",
    toastUpdated: "Bookmark updated",
    toastRemoved: "Bookmark removed",
    validationBoth: "Enter both a name and a destination.",
  },
  primaryNav: {
    editLabel: "Edit...",
    dialogEditTitle: "Edit menu button",
    dialogDescription: "Change label, icon, and internal link for the top menu button.",
    labelField: "Label",
    pathField: "Internal path",
    pathHint: "e.g. /dashboard",
    iconField: "Icon",
    iconNames: {
      Bookmark: "Bookmark",
      Home: "Home",
      Settings: "Settings",
      Workflow: "Workflow",
      Star: "Star",
      LayoutDashboard: "Dashboard",
      User: "User",
      Search: "Search",
      Link2: "Link",
      Bell: "Bell",
      Heart: "Heart",
      Zap: "Zap",
      Music: "Music",
      Radio: "Radio",
      Trophy: "Trophy",
    },
    save: "Save",
    cancel: "Cancel",
    validationBoth: "Enter both a label and a destination.",
    validationInternal: "Path must be internal (start with /).",
    toastUpdated: "Menu button updated",
  },
  toastChaosTitles: [
    "System whispers:",
    "Neutralen OS says:",
    "Not a bug. A feature.",
    "Mysterious but valid:",
  ],
  leagueFormat: {
    noRankedYet: "No ranked data yet",
    notYetTimestamp: "Not yet",
  },
  dashboard: {
    chaosLines: [
      "Neutralen OS blinked once and decided that was enough drama for now.",
      "A tiny invisible sysadmin keeps rearranging the vibes behind your back.",
      "The dashboard insists this all counts as infrastructure.",
      "Someone definitely whispered 'one quick game' into the wiring again.",
    ],
    networkSummary: "Network hiccup — couldn’t fetch guild summary.",
    networkLive: "Network hiccup — couldn’t fetch live data.",
    widgetWelcome: {
      label: "Identity core",
      description: "Your profile, current palette, and launch posture.",
    },
    widgetServerPulse: {
      label: "Server pulse",
      description: "Guild summary, voice presence and gateway health.",
    },
    widgetWiretap: {
      label: "Discord wiretap",
      description: "A tiny portal: radar, logs, and signal traces.",
    },
    widgetWheel: {
      label: "Wheel launchpad",
      description: "Fast path to random teams, shared chaos and repeatable seeds.",
    },
    widgetPresence: {
      label: "Presence radar",
      description: "A small social layer so the shell feels inhabited.",
    },
    widgetRitual: {
      label: "Ritual console",
      description: "Low-stakes toggles, palette vibes and little system rituals.",
    },
    widgetChaosMeter: {
      label: "Chaos meter",
      description: "Ambient readout of how much trouble the shell wants today.",
    },
    widgetVoiceOrbit: {
      label: "Voice orbit",
      description: "Social pulse: dots pretending to be presence.",
    },
    widgetRadio: {
      label: "Neutralen FM",
      description: "Fake radio to keep the shell feeling alive.",
    },
    widgetMoodClock: {
      label: "Mood clock",
      description: "Time, vibe, and tiny OS tricks.",
    },
    widgetLoreQuote: {
      label: "Lore quote",
      description: "Quote of the day. Not always true, always relevant.",
    },
    widgetCustomModules: {
      label: "Module forge",
      description: "Build custom modules and tweak size + content.",
    },
    loreQuoteBlurb: "A small lore hook. Helps the place feel like it remembers.",
    loreQuoteNowServingLabel: "Now serving",
    loreQuoteDailyBadge: "daily",
    loreQuoteBookBadge: "from the quote book",
    loreQuoteCopy: "Copy",
    loreQuoteShuffle: "New excerpt",
    loreQuoteToastTitle: "Quote copied",
    loreQuoteToastMessage: (speaker) => `Signed: ${speaker}. It’s on your clipboard.`,
    moodClockBlurb: "A clock that does more than tell time — it suggests what mood the desktop should wear.",
    moodClockApply: "Sync vibe",
    moodClockApplied: "Already synced",
    moodClockChime: "Chime",
    moodClockToastAppliedTitle: "Vibe synced",
    moodClockToastChimeTitle: "System chimed",
    moodClockChimeMessage: (vibe) => `Vibe: ${vibe}. The desktop nodded.`,
    moodClockProgressLabel: (pct) => `Day progress: ${pct}%`,
    moodClockVibeMorning: "Morning boot",
    moodClockVibeDay: "Daylight signal",
    moodClockVibeEvening: "Evening lounge",
    moodClockVibeNight: "Night ritual",
    welcomeAudioOnline: "audio online",
    welcomeAudioMuted: "muted",
    welcomeBack: (name) => `Welcome back, ${name}.`,
    welcomeBlurb: "This shell is now a little more like a desktop and a little less like a respectable app.",
    openProfile: "Open profile",
    commandBar: "Command bar",
    serverLoadingSummary: "Loading guild summary…",
    membersOnline: (m, o) => `Members ~${m} · online ~${o}`,
    channels: (n) => `Channels ${n}`,
    gateway: "Gateway",
    gatewayConnected: "connected",
    gatewayDisconnected: "disconnected",
    wiretapBlurb: "A tiny portal into Discord. It sniffs packets and invents vibes.",
    wiretapBootLine: "Wiretap online. Listening to the wiring…",
    wiretapGatewayDegraded: "Gateway degraded (the system is coughing).",
    wiretapGatewayStable: "Gateway stable again.",
    wiretapGatewayUnknown: "unknown",
    wiretapGatewayDegradedShort: "degraded",
    wiretapOnlineNow: (n) => `Online right now: ${n}`,
    wiretapLogLabel: "Log",
    wiretapLeak: "Leak rumor",
    wiretapClear: "Clear log",
    wiretapLeakToastTitle: "Wiretap leaked something",
    wiretapLeakToastMessage: "Probably fine. Or everything.",
    wiretapVoiceLabel: "voice",
    wiretapOnlineLabel: "online",
    wiretapVoicePulse: "Voice pulse",
    wiretapOnlinePulse: "Online pulse",
    gatewayLastEventLabel: "Last blink:",
    gatewayLastEventUnknown: "Last blink: unknown (system is sulking).",
    gatewayStaleBadge: "stale",
    voiceNow: (n) => `In voice right now: ${n}`,
    guildIdHint: "Set VITE_DISCORD_HUB_GUILD_ID to show guild pulse here.",
    wheelBlurb: "The wheel is still the best place to let randomness carry legal liability.",
    openWheel: "Open wheel",
    copySeedStarter: "Copy seed starter",
    presenceLine1: "Discord login is active and your profile shell is wired in.",
    presenceLine2: "League, themes and identity settings all route through ",
    presenceLine2Link: "your profile",
    liveLineLabel: "Live line",
    ritualBlurb:
      "For the premium desktop feeling: change palette, ping the command bar, and let the system make a scene.",
    muteAudio: "Mute audio",
    enableAudio: "Enable audio",
    fireCeremony: "Fire ceremony",
    ritualToastTitle: "Ceremony accepted",
    ritualToastMessage: "The dashboard pretends this was necessary.",
    ritualPolicy: "Rare event policy: subtle charm always on, weirdness sometimes, nonsense sparingly.",
    voiceOrbitBlurb: "The desktop wants to feel multiplayer, so we pretend voice is a tiny starfield.",
    voiceOrbitUnknownGuild: "Unknown guild",
    voiceOrbitSoulsLine: (souls, channels) => `Souls in voice: ${souls} · channels: ${channels}`,
    voiceOrbitNoSignal: "No signal yet. The shell keeps listening anyway.",
    voiceOrbitGatewayOk: "pulse",
    voiceOrbitGatewayNope: "silent",
    voiceOrbitAction: "Ping voice",
    voiceOrbitToastTitle: "Signal sent",
    voiceOrbitToastMessage: "If someone is out there, it probably blinked.",
    radioBlurb: "A tiny radio that does nothing important. Perfect.",
    radioNowPlayingLabel: "Now playing",
    radioBadge: "live-ish",
    radioShuffle: "Shuffle",
    radioRequest: "Request track",
    radioToastTitle: "Station switched tracks",
    radioToastMessage: (track) => `Now: ${track}`,
    radioRequestToastTitle: "Request logged",
    radioRequestToastMessage: "Forwarded to the cable gods. No ETA promised.",
    chaosMeterBlurb: "A tiny instrument that reads today's chaos flow. No one knows how. Everyone accepts it.",
    chaosMeterLevelLabel: "Chaos level",
    chaosMeterTierCalm: "calm",
    chaosMeterTierSpicy: "spicy",
    chaosMeterTierFeral: "feral",
    chaosMeterTierMeltdown: "meltdown",
    chaosMeterSignal: (value) => `Signal: ${value}/100`,
    chaosMeterAction: "Poke the OS",
    chaosMeterToastTitle: "Signal acquired",
    toastWidgetOnline: "Widget online",
    toastWidgetHidden: "Widget hidden",
    toastDesktopReset: "Desktop reset",
    toastDesktopResetMessage: "Default layout restored.",
    toastPaletteSwitched: "Palette switched",
    toastDesktopPulse: "Desktop pulse",
    backendTitle: "Can’t reach backend",
    backendDescription: "discord-hub-api isn’t running or it crashed.",
    backendHint1: "Start the API and reload.",
    backendHint2:
      "Add values from apps/discord-hub-api/.env.example to the repo .env and restart npm run dev:discord-stack.",
    musicNeedVoiceChannel: "Join a Discord voice channel to play music.",
    musicPlayFailedTitle: "Could not queue",
    musicPlayFailedGeneric: "That link or search could not be played. Try another source.",
    musicSpotifyPlaylistUnavailable:
      "This Spotify playlist could not be read or yielded no tracks the bot can play. Personalized lists (e.g. Discover Weekly) often fail with app-only access — use a public playlist. Tip: set SPOTIFY_DEFAULT_MARKET=US (or your country) on the bot if tracks are region-blocked.",
    musicPlayerDropHint:
      "Drag a link from Spotify, YouTube, or SoundCloud here and release to queue it (same as pasting into the field).",
    musicPlayerDropActive: "Release to add to queue",
    musicPlayerDropInvalid:
      "No playable link found. Drop a Spotify, YouTube, or SoundCloud URL (or drag from Spotify onto the page).",
    musicPreviousTitle: "Previous track",
    musicPreviousNone: "No previous track in this session.",
    musicShuffleQueue: "Shuffle queue",
    musicQueueDragHandleAria: "Drag to reorder queue",
    musicQueueReorderFailed: "Couldn’t save queue order. Try again.",
  },
  desktopSurface: {
    spawnApp: "Spawn app",
    personalShell: "Personal shell",
    rightClickHint: "Right-click anything for shell actions",
    emptyBadge: "Desktop sleeping",
    emptyTitle: "Everything is hidden right now",
    emptyBody: "Spawn a module, right-click the surface, and build your own shell from scratch.",
    dragButton: "Drag",
    dragTooltip: "Press and drag anywhere on the module to move it",
    hideTooltip: "Hide widget",
    hideAria: (label) => `Hide ${label}`,
    dragAria: (label) => `Drag ${label}`,
    layoutEditBanner: "Layout edit mode",
    layoutEditHint:
      "Use the bottom toolbar. Pinch-grab a module (press and drag anywhere on the card). Right-click prioritizes layout actions.",
    widgetPositionResetToast: "Module position reset to default.",
    editStickyHelp: "Pinch-drag module · resize · right-click · save",
    resizeHandleAria: "Resize",
    holdToDragOutsideLayoutHint:
      "Hold still briefly on a module — then you’ve grabbed it and can drag without layout mode (cursor switches to a closed hand).",
    widgetContextMenuEdit: "Edit",
    widgetContextMenuHide: "Hide",
    widgetContextMenuResetPos: "Reset position",
    widgetQuickEditTitle: (label) => `Edit ${label}`,
  },
  profileSettings: {
    pageTitle: "Profile settings",
    pageIntroBefore: "Connect League, run sync, and control what shows on your",
    publicProfileLinkLabel: "public profile",
    pageIntroAfter: ". Rank and matches appear on the profile after a successful sync.",
    themeCardTitle: "Theme & colors",
    themeCardDesc: "Chart colors and primary button follow the theme menu in the header.",
    themeCardBody:
      "Switch light/dark and accent there — it affects the whole hub, including your public profile.",
    languageCardTitle: "Language",
    languageCardDesc: "Controls language for the whole hub (menus, errors, toasts).",
    languageSv: "Svenska",
    languageEn: "English",
    profileCardTitle: "Profile",
    profileCardDesc: "Basics for your profile page.",
    showOnline: "Show online status",
    showRank: "Show rank on profile",
    shareChampionPool: "Share champion pool",
    leagueCardTitle: "Sync League of Legends",
    leagueCardDesc: "Link account and fetch rank plus recent matches via Riot API.",
    riotId: "Riot ID",
    tagline: "Tagline",
    region: "Region",
    rankSource: "Rank source",
    rankSolo: "Solo queue",
    rankFlex: "Flex queue",
    autoSync: "Auto-sync when data fetch is enabled",
    statusMessage: "Status message",
    statusPlaceholder: "Ready for ranked grind.",
    connect: "Connect account",
    syncNow: "Sync now",
    disconnect: "Disconnect",
    leagueFootnoteBefore:
      "Snapshot lives in server memory until restart — detailed rank and match history show on your",
    leagueFootnoteLinkLabel: "public profile",
    leagueFootnoteAfter: "after sync.",
    defaultStatusMessage: "Ready for ranked grind.",
    errors: {
      leagueStatusRead: "Couldn’t read League status right now.",
      connectFailed: "Couldn’t link the League account.",
      connectNetwork: "Network error while linking League.",
      syncFailed: "Couldn’t run sync.",
      syncNetwork: "Network error during sync.",
      disconnectFailed: "Couldn’t unlink the League account.",
      disconnectNetwork: "Network error while unlinking.",
    },
    success: {
      connected: "League account linked.",
      synced: "League data synced.",
      disconnected: "League account unlinked.",
    },
    backendTitle: "Can’t reach backend",
    backendDescription: "discord-hub-api isn’t running or has stopped.",
    backendBody: "Start the API and reload the page.",
  },
  publicProfile: {
    loadingTitle: "Loading public profile…",
    loadingDesc: "Fetching Discord identity and linked profiles.",
    loadErrorNetwork: "Couldn’t load the public profile right now.",
    notFoundTitle: "Profile not found",
    notFoundDesc:
      "That user isn’t in the public profile cache yet, or the profile isn’t published.",
    toHub: "To hub",
    errorTitle: "Couldn’t load profile",
    pageTitle: "Public profile",
    pageIntro: (name, leagueLine) => `Profile for ${name}. ${leagueLine}`,
    settingsButton: "Profile settings",
    openHub: "Open hub",
    labelProfileStatus: "Profile status",
    labelLeagueConnection: "League link",
    labelLeagueStats: "League stats",
    gamesRankLabel: "Rank",
    gamesRegionLabel: "Region",
    cardStatusTitle: "Status",
    cardStatusDesc: "Public view of the account.",
    cardGamesTitle: "Games",
    cardGamesDesc: "League of Legends (public data).",
    cardMoreTitle: "More profile data",
    cardMoreDesc: "Identity and timestamps.",
    profileStatusBase: "Base profile",
    profileStatusLeague: "In motion",
    leagueLinkPublished: "Published",
    leagueLinkNot: "Not linked",
    statsSynced: "Synced",
    statsWaiting: "Waiting for sync",
    statsNone: "Not wired up yet",
    steamNotLinked: "Not linked",
    noLeaguePublic: "No League link published.",
    rankDash: "Rank: —",
    regionDash: "Region: —",
    separator: "·",
    syncedShort: (d) => `Synced ${d}`,
    leagueStatsTitle: "League — stats",
    leagueStatsDescFetched: (ts, account) => `Data fetched ${ts} · account ${account}`,
    noLeagueData: "No League data to show. When they link an account, it’ll appear here.",
    notSyncedYet: "No synced snapshot yet. After the next sync, ranked queues and recent matches show up here.",
    statsUnavailable: "Stats aren’t available right now.",
    accountLabel: "Account",
    regionLabel: "Region",
    rankedQueues: "Ranked queues",
    noRankedReturned: "No ranked data returned for this player.",
    rankedEntryLine: (tier, rank, lp) => `${tier} ${rank} · ${lp} LP`,
    rankedEntryRecord: (wins, losses, hotStreakLabel) => `${wins}W / ${losses}L${hotStreakLabel}`,
    recentMatches: "Recent matches",
    noMatchHistory: "No match history in this snapshot.",
    win: "Win",
    loss: "Loss",
    matchStatsLine: (kills, deaths, assists, cs, level) =>
      `${kills}/${deaths}/${assists} KDA · ${cs} CS · lvl ${level}`,
    leagueMatchModeLine: (gameMode, gameType) => {
      const gm = gameMode.trim();
      const gt = gameType.trim();
      if (!gm && !gt) return "";
      if (!gt) return gm;
      if (!gm) return gt;
      return `${gm} · ${gt}`;
    },
    steamTitle: "Steam",
    steamDesc: "Reserved for the next integration.",
    steamBody: "Steam will show here once linking and backend exist — same card style as the hub.",
    leagueIntro: {
      none: "No League account published yet.",
      notSynced: "League linked — owner can sync in profile settings to show rank and matches here.",
      soon: "League linked — stats coming soon.",
      synced: "League stats from the latest sync.",
    },
    rankFallback: "No rank yet — full noob mode.",
    noSyncYetShort: "No sync yet",
    discordId: "Discord ID",
    displayName: "Display name",
    linkedSince: "Linked since",
    lastLeagueSync: "Last League sync (link)",
    statusLine: (label, value) => `${label}: ${value}`,
    hotStreak: " · hot streak",
  },
  leagueStatsPage: {
    loading: "Loading stats…",
    loadingMatches: "Loading matches…",
    syncRequiredTitle: "Sync required",
    syncRequiredBody: (accountList) =>
      `${accountList} is linked but no sync has run yet.`,
    syncRequiredLinkLabel: "Profile → Settings",
    syncRequiredAction: "and click Sync on the account.",
    syncRequiredApiHint: "Requires RIOT_API_KEY in the API .env.",
    noLinkedTitle: "No League data available",
    noLinkedBody: "Link your Riot account under Profile → Settings and run a sync.",
    loadError: (message) => `Couldn’t load stats: ${message}`,
    noMatchesTitle: "No matches recorded yet",
    noMatchesBody: "Run a sync for the selected account to start collecting data.",
    title: "League of Legends — stats",
    subtitle: (totalGames, accountLine) =>
      `Based on ${totalGames} recorded matches${accountLine}`,
    statGames: "Games",
    statGamesSub: (wins, losses) => `${wins}W / ${losses}L`,
    statWinRate: "Win rate",
    statKda: "KDA (avg)",
    statKdaSub: (k, d, a) => `${k} / ${d} / ${a}`,
    statCs: "CS / game",
    statCsSub: (avgDuration) => `Avg ${avgDuration} / game`,
    breakdownByQueue: "By queue",
    thQueueMode: "Mode",
    thMatches: "Games",
    thWl: "W/L",
    thWinPct: "Win %",
    championsTitle: "Most-played champions",
    thChampion: "Champion",
    thChampMatches: "Games",
    thChampWinPct: "Win %",
    thChampKda: "KDA",
    thChampCsPerGame: "CS/game",
    matchHistoryTitle: "Match history",
    winBadge: "WIN",
    lossBadge: "LOSS",
    levelShort: (n) => `Lvl ${n}`,
    goldK: (k) => `${k}k gold`,
    csLabel: "CS",
    paginationPrev: "Previous",
    paginationNext: "Next",
    paginationRange: (from, to, total) => `Showing ${from}–${to} of ${total}`,
    paginationPage: (page, totalPages) => `Page ${page} of ${totalPages}`,
    matchesLoadError: "Couldn’t load match history.",
    queueSoloDuo: "Solo/Duo",
    queueFlex: "Flex",
    queueAram: "ARAM",
    queueQuickplay: "Quickplay",
    queueNormalDraft: "Normal draft",
    queueCustom: "Custom",
    queueUnknown: (queueId) => `Queue ${queueId}`,
  },
  login: {
    title: "Log in",
    description: "Sync with Discord to use the hub.",
    oauthFailed: "Login failed. Try again.",
    apiUnreachable:
      "Backend isn’t answering (usual target: port 3001). Common cause: discord-hub-api isn’t running or crashed — check the [api] terminal and .env per apps/discord-hub-api/.env.example. If you set PORT in apps/discord-hub-api/.env, restart Vite so the proxy matches (or set DISCORD_HUB_API_DEV_PORT in the repo root .env).",
    continueDiscord: "Continue with Discord",
    continueDisabled: "Continue with Discord",
  },
  spinWheel: {
    loading: "Loading…",
    backendError: "Backend trouble. Try again later.",
    collabTitle: "Shared wheel beta",
    collabDesc:
      "Realtime room with Yjs/y-websocket. Draft syncs live and spins/team results broadcast to everyone in the room.",
    collabConnected: "connected",
    defaultCollabRoom: "neutralen-wheel",
    roomLabel: "Room",
    presenceCount: (n) => `${n} present in room`,
    realtimeEnabled: "Realtime enabled",
    copyRoom: "Copy room",
    participantsTitle: "Participants",
    participantsDesc: "One name per line. Commas work too.",
    participantsTextareaPlaceholder: "Alice\nBob\nCharlie",
    noParticipants: "No participants yet",
    participantCount: (n) => `${n} participants`,
    clear: "Clear",
    participantMenuLabel: "Participant",
    remove: "Remove",
    copyName: "Copy name",
    uncurse: "Uncurse",
    markCursed: "Mark as cursed",
    accuseTitle: "Accusation filed",
    accuseMenuLabel: "Accuse (ceremonial)",
    accuseMessage: (name) => `${name} is now under investigation (ceremonial).`,
    curseLifted: "Curse lifted",
    markedCursed: "Marked as cursed",
    teamsTitle: "Teams & seed",
    teamsDesc: "Control how teams are built (and whether it’s deterministic).",
    teamCount: "Team count",
    distribution: "Distribution",
    modeBalanced: "Balanced teams (recommended)",
    modeEqual: "Exactly even teams",
    equalTeamsWarning: (p, t) =>
      `Can’t make exactly even teams: ${p} participants don’t divide cleanly by ${t} teams.`,
    seedLabel: "Seed (optional)",
    seedPlaceholder: "e.g. scrim-2026-03-25",
    seedLastUsed: "Last seed used:",
    seedEmptyHint: "Leave empty for a random seed.",
    copySeed: "Copy",
    autoSave: "Auto-save sessions",
    spinAndTeams: "Spin & build teams",
    spinOnly: "Spin",
    makeTeams: "Build teams",
    reshuffle: "Reshuffle teams",
    groupsTitle: "Saved groups",
    groupsDesc: "Save participant lists you reuse.",
    newGroupDefault: "New group",
    groupNamePlaceholder: "Group name",
    saveNew: "Save new",
    update: "Update",
    refreshList: "Refresh list",
    selectedGroup: "Selected group:",
    clearSelection: "Clear selection",
    loadingGroups: "Loading groups…",
    noGroups: "No saved groups yet.",
    participantsUpdated: "participants · updated",
    removeGroup: "Remove",
    addParticipantsHint: "Add participants to see the wheel.",
    wheelEmptySliceLabel: "Empty",
    wheelSpinAria: "Spin the wheel",
    celebrateEyebrow: "Winner",
    celebrateDesc: "The wheel landed on this name.",
    celebrateClose: "Close",
    celebrateRemove: "Remove",
    teamsResultTitle: "Teams",
    teamsResultDesc: "Result from the latest team build.",
    equalTeamsBanner: "Exactly even teams need participant count divisible by team count.",
    noTeamsYet: 'No teams yet. Hit “Build teams”.',
    teamLabel: (i) => `Team ${i + 1}`,
    sessionsTitle: "Recent sessions",
    sessionsDesc: "Team/winner history stored in the backend.",
    refresh: "Refresh",
    loadingSessions: "Loading sessions…",
    noSessions: "No sessions yet.",
    sessionWinner: (name) => `Winner: ${name}`,
    sessionTeamsOnly: "Teams built",
    sessionMetaParticipants: (count, teamCount, when) =>
      `${count} participants · ${teamCount} teams · ${when}`,
    sessionSeedPrefix: "· seed",
    load: "Load",
    participantChipTitle: "Click to remove. Right-click for more crimes.",
    voiceChannelsTitle: "Voice channels (live)",
    voiceChannelsLoading: "Fetching voice state…",
    voiceChannelsError: "Couldn’t load voice channels.",
    voiceChannelsEmpty: "Nobody is in voice right now.",
    voiceChannelsGuildHint:
      "Set VITE_DISCORD_HUB_GUILD_ID in discord-hub-web/.env to show live voice here (same as dashboard).",
    voiceChannelUnnamed: "Voice channel",
    voiceChannelMore: (n) => `+${n} more`,
    toasts: {
      roomUpdate: "Room update",
      roomUpdateMessage: (name) => `${name} updated the shared wheel.`,
      loadGroupsFail: "Couldn’t load groups",
      loadSessionsFail: "Couldn’t load sessions",
      backendUnreachable: "Backend unreachable",
      backendUnreachableMessage: "The hub API didn’t answer. Whole thing’s on fire.",
      saveSessionFail: "Couldn’t save session",
      sessionSaved: "Session saved",
      sessionSavedWinner: (w) => `Winner: ${w}`,
      sessionSavedTeams: "Teams recorded.",
      saveGroupFail: "Couldn’t save group",
      groupSaved: "Group saved",
      updateGroupFail: "Couldn’t update group",
      groupUpdated: "Group updated",
      deleteGroupFail: "Couldn’t delete group",
      groupDeleted: "Group deleted",
      groupDeletedMessage: "Gone. Reduced to atoms.",
      roomCopied: "Room copied",
      seedCopied: "Seed copied",
      voiceFillTitle: "Participants from voice",
      voiceFillMessage: (channelLabel, count) =>
        `${count} ${count === 1 ? "person" : "people"} from ${channelLabel}`,
      voiceMoveFail: "Couldn’t move in Discord",
      voiceMoveUnknown: "Unknown error — check the bot has Move Members permission.",
      voiceMoveNoMember: (name) =>
        `No voice member matched “${name}”. Refresh the list from a voice channel or use the same name as in Discord.`,
    },
  },
  backendCard: {
    title: "Can’t reach backend",
    description: "discord-hub-api isn’t running or it crashed.",
    body: "Start the API and reload.",
    hintEnv:
      "Add values from apps/discord-hub-api/.env.example to the repo .env and restart npm run dev:discord-stack.",
    retry: "Try again",
  },
  hubPrefsPanel: {
    title: "Shell preferences",
    description: "Customise widgets, desktop, and tone.",
    openButton: "Customise",
    closeButton: "Close",
    resetAll: "Reset all",
    resetAllConfirm: "All preferences reset.",
    savedToast: "Preferences saved",
    tabs: {
      widget: "Widget",
      desktop: "Desktop",
      copy: "Tone & copy",
    },
    widget: {
      noWidgetSelected: "No widget selected",
      selectWidgetHint: "Pick a widget below to customise it.",
      widgetLabel: "Widget",
      sizePreset: "Size",
      sizeCompact: "Compact",
      sizeCozy: "Cozy",
      sizeExpanded: "Expanded",
      toneOverride: "Tone",
      toneInherit: "Inherit",
      toneUseful: "Useful",
      toneSocial: "Social",
      toneChaos: "Chaos",
      glassOpacity: "Opacity",
      glassOpacityHint: "Card fill level (0 = transparent, 100 = solid).",
      blurStrength: "Blur",
      blurNone: "None",
      blurLight: "Light",
      blurMedium: "Medium",
      blurStrong: "Strong",
      showSubtitle: "Show subtitle",
      showSubtitleDesc: "Show the widget description line.",
      showToneBadge: "Show tone badge",
      showToneBadgeDesc: "Show the tone badge in the card header.",
      resetWidget: "Reset widget",
    },
    desktop: {
      stylePack: "Style pack",
      stylePackDefault: "Default",
      stylePackMidnight: "Midnight",
      stylePackPaper: "Paper",
      stylePackSignal: "Signal",
      stylePackCampfire: "Campfire",
      gridDensity: "Grid density",
      gridCompact: "Compact",
      gridCozy: "Cozy",
      gridExpanded: "Airy",
      gridCompaction: "Compaction",
      gridCompactionNone: "No packing",
      gridCompactionPack: "Auto-pack",
      snapStrength: "Snap strength",
      snapRelaxed: "Relaxed",
      snapStandard: "Standard",
      snapFirm: "Firm",
      showWidgetBorder: "Widget border",
      showWidgetBorderDesc: "Outline around module cards on the desktop and in the stacked mobile list.",
      dockPosition: "Dock position",
      dockBottom: "Bottom",
      dockLeft: "Left",
      dockScale: "Dock size",
      dockSm: "Small",
      dockMd: "Medium",
      dockLg: "Large",
      animationIntensity: "Animation intensity",
      animationIntensityHint: "0 = minimal motion, 100 = full transitions.",
    },
    inspectCursor: {
      sectionTitle: "Shell pointer (dev)",
      sectionHint:
        "When shell right-click is active, this pointer replaces the default cursor. Browser right-click and Inspect use the normal pointer.",
      presetLabel: "Style",
      presetCrosshair: "Crosshair",
      presetDot: "Dot",
      presetRing: "Ring",
      presetBracket: "Corners",
      colorLabel: "Colour",
      colorPrimary: "Primary",
      colorAccent: "Accent",
      colorForeground: "Foreground",
      colorCustom: "Custom hex",
      customHexLabel: "Hex colour",
      customHexHint: "#RGB or #RRGGBB, e.g. #38bdf8.",
      sizeLabel: "Size",
      sizeHint: "Relative scale for the pointer (50–200%).",
    },
    copy: {
      personality: "Personality",
      personalityCalm: "Calm",
      personalityNormal: "Normal",
      personalityChaotic: "Chaotic",
      personalityCalmDesc: "Brief and factual — no nonsense.",
      personalityNormalDesc: "Balanced — playful but not over the top.",
      personalityChaoticDesc: "Full chaos mode. You know what you’re doing.",
      toastVerbosity: "Toast verbosity",
      toastMinimal: "Minimal",
      toastNormal: "Normal",
      toastVerbose: "Verbose",
      toastMinimalDesc: "Short TTL, no message body.",
      toastNormalDesc: "Standard timing and content.",
      toastVerboseDesc: "Longer TTL, more text.",
      memeFrequency: "Meme frequency",
      memeOff: "Off",
      memeLow: "Low",
      memeNormal: "Normal",
      memeOffDesc: "No memes or easter eggs. Safe.",
      memeLowDesc: "Rare easter eggs — lightly seasoned.",
      memeNormalDesc: "Normal chaos mode. Expected level of madness.",
    },
  },
};

export const hubCopy: Record<HubLocale, HubCopy> = {
  sv: SV,
  en: EN,
};
