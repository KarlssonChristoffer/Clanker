# Clanker (discord-bot)

Discord-boten i Clanker-monorepot: musik, trackers för hubben, Jev (TypeSafe), WoW-verktyg, serveruppsättning,
citatbok, spelkvällar och veckorapport. TypeScript, discord.js 14, Node ≥ 22.12, ESM.

- Driftsättning och flytt till tincan: [`scripts/migrate-to-tincan.md`](../../scripts/migrate-to-tincan.md)
- Manuell testlista (kör i en egen testserver): [`TESTPLAN.md`](../../TESTPLAN.md)
- Alla miljövariabler med kommentarer: [`.env.example`](./.env.example)

## Kommandon

| Kommando | Vad det gör |
|---|---|
| `/ping` | Lever Clanker? Visar gateway-latens. |
| `/play`, `/skip`, `/previous`, `/pause`, `/resume`, `/stop`, `/queue` | Musik (YouTube via yt-dlp, SoundCloud, Spotify-låtar/album/spellistor → YouTube; fungerar utan Spotify-nycklar). |
| `/playlist skapa\|radera\|lista\|visa\|lagg-till\|ta-bort\|spela` | Sparade spellistor per server. |
| `/admin funktioner [funktion] [läge]` | Feature-flaggor per server, med meny för att slå av och på. Kräver Hantera server. |
| `/admin veckorapport-nu` | Posta veckorapporten direkt. |
| `/jev av\|på\|status` | Opt-out: dina meddelanden skickas aldrig till Jev. |
| `/jev reflexer läge:på\|av` | Emoji-reflexer i kanalen. Kräver Hantera kanaler och att funktionen **Jev-reflexer** är på. |
| `/vibe` | Jev läser av stämningen (50 senaste meddelandena, anonymiserade). |
| `/orakel <påstående>` | "Oraklet säger: 73 % ja". |
| `/tankeläsare` | Tänk på något, så gissar Clanker med ja/nej-frågor. |
| `/jevstats` | Anrop, tokens, uppskattad kostnad, latens, fel och breaker-status. |
| `/setup wow [torrkörning] [arkivera_övrigt]` | Bygger WoW-servern från mallen. Bara i `SETUP_ALLOWED_GUILD_IDS`. |
| `/setup ångra` | Ångrar senaste setup (även knapp i setup-svaret). |
| `/raid skapa <titel> <tid> [typ] [storlek]` | Anmälan med knappar, Discord-event och ping 30 min innan. |
| `/raid avbryt <id>` | Ställ in en raid. |
| `/wow koppla <namn> [realm] [klass] [roll] [spec] [ilvl]` | Koppla din karaktär. Retail hämtar data automatiskt, WoW Forever fylls i manuellt. |
| `/wow karaktär [användare]`, `/roster [sortering]` | Karaktärskort och allas mains. |
| `/citat [sök] [från]` | Slumpat eller sökt citat. Spara nya genom att reagera med 💬. |
| `/spelkväll <spel> <tid>` | Kommer/Kanske/Nej och ping 15 min innan. |
| `/påminn <tid> <text>` | Påminnelse, t.ex. `om 30 min` eller `fredag 19`. |

Tider tolkas alltid deterministiskt i Europe/Stockholm: `20:00`, `ikväll 21`, `imorgon 19:30`, `fredag 20`,
`3/10 20:00`, `3 okt 20`, `2026-10-03 20:00`, `om 2 h`. Förstår boten inte tiden svarar den med exempel i stället för att gissa.

Automatiskt, utan kommando:
- **Musikpanel.** Ett meddelande i #musik (från `/setup wow`) visar vad som spelas, vem som önskade det, vad som står
  på tur och knappar för Förra/Pausa/Nästa/Blanda/Stopp. Utan #musik hamnar panelen där `/play` senast kördes.
  Efter en omstart finns knappen **Fortsätt kön** om låtar låg kvar.
- **LFG i #lfg.** Nya inlägg tolkas (nyckelnivå och klockslag via regex, resten via Jev) och blir gruppkort. Full grupp ger en röstkanal.
- **💬-reaktion.** Meddelandet sparas i citatboken och boten bekräftar med 📖.
- **➕ Skapa grupp.** Man får en egen röstkanal som försvinner när den blir tom.
- **Reset-inlägg.** Varje vecka postas "Ny vecka" i #annonser (funktionen `reset_post`, av som standard).
- **Veckorapport.** Söndagar 19:00 postas veckorapporten i #annonser (funktionen `veckorapport`, av som standard).

## Discord-inställningar

**Privilegierade intents** (Developer Portal → Bot): Server Members, Presence, Message Content.
Boten använder även GuildMessageReactions och GuildScheduledEvents (inte privilegierade).

**Behörigheter** (inbjudningslänk, `permissions=17893155753072`): View Channels, Send Messages, Send Messages in Threads,
Embed Links, Read Message History, Add Reactions, Manage Channels, Manage Roles, Manage Server (onboarding),
Manage Threads (forumtaggar), Create Events, Manage Events, Move Members, Connect, Speak och Use Voice Activity.

```
https://discord.com/oauth2/authorize?client_id=<DISCORD_APPLICATION_ID>&scope=bot%20applications.commands&permissions=17893155753072
```

> Sedan 2026-02-23 räcker inte Manage Events för att *skapa* evenemang. Det kräver **Create Events**.
> Från 2026-11-16 ser botar inte kanaler de saknar View-rätt i. `/setup` ger därför boten en egen View-overwrite i
> skrivskyddade kanaler.

Botens roll måste ligga **över** klass- och intresseroller för att rollväljaren ska kunna dela ut dem. Roller som
`/setup` skapar hamnar automatiskt under botens roll.

## Arkitektur

```
src/index.ts            bootstrap: config → DB + migrationer → moduler → schemaläggare → slash-sync → login
src/modules.ts          alla feature-moduler (ordningen = ordningen för meddelandehanterare)
src/core/               config, logger (pino), lifecycle (signaler, graceful shutdown), felhantering,
                        commands/components (register + customId-routing), scheduler, feature-flaggor,
                        heartbeat, message-pipeline, health, time (svensk tidstolkning)
src/commands/           ett kommando per fil: { data, execute, autocomplete? }
src/jev/                Jev-klient (retry, breaker, semafor, statistik), opt-out, reflexer, tankeläsaren
src/wow/                speldata per variant, datakällor (Raider.IO/Blizzard/manuell), raid, LFG, reset
src/setup/              blueprint → ren planerare → exekvering med ändringslogg (ångra)
src/social/             citatbok, spelkvällar/påminnelser, veckorapport
src/voice/              tillfälliga röstkanaler (join-to-create, LFG)
music-*.ts, *-tracker.ts befintlig musik och trackers för hubben
```

- **En gateway-ägare.** Bara boten har Discord-gateway. Hubben läser `bot.guild_voice_states` och heartbeat i `bot.runtime_status`.
- **Schemaläggaren.** `bot.scheduled_jobs` pollas var 30:e sekund med `FOR UPDATE SKIP LOCKED`, retry med backoff, dedupe-nycklar och återkommande jobb. Jobb överlever omstarter.
- **Feature-flaggor.** Flaggor per server i `bot.guild_features` och per kanal i `bot.channel_features`. Hanteras via `/admin funktioner`.
- **HTTP (port 3012).** `GET /health` är öppen. Musikrutterna kräver `X-Clanker-Secret` (= `BOT_HTTP_SECRET`).
- **Migrationer.** De ligger i `apps/discord-hub-api/migrations` (014–018 hör till boten). Både boten och hub-api kör dem vid start under ett advisory lock.

## Köra

```bash
npm install                      # från monorepots rot
npm run dev:discord-bot          # dev (tsx watch, färgade loggar)
npm test -w discord-bot          # vitest (PGlite = riktig Postgres i WASM, ingen Docker)
npm run typecheck                # hela monorepot
```

Docker (Linux, röst kräver host-nät): `docker compose --profile db --profile discord-host up -d --build discord-bot-host`.
Imagen har yt-dlp (python3 + node som JS-runtime för YouTube), loggar `yt-dlp self-test ok` vid start och uppdaterar yt-dlp i
bakgrunden (`YTDLP_AUTO_UPDATE=1`).

## Hermes (testservern)

1. Bjud in boten till Hermes med länken ovan.
2. I `.env`: `DISCORD_GUILD_ID=<Hermes-id>` (kommaseparerat om även prod-servern ska ha kommandon),
   `SETUP_ALLOWED_GUILD_IDS=<Hermes-id>`, `WOW_FLAVOR=forever`, `TYPESAFE_API_KEY=…`, `BOT_HTTP_SECRET=…`.
3. Starta boten. Slash-kommandon registreras guild-scopat i Hermes direkt (bara när definitionerna ändrats).
4. Gå igenom [`TESTPLAN.md`](../../TESTPLAN.md) uppifrån och ned.
