# Discord hub — backend (`discord-hub-api`)

**Hono**-API för **discord-hub-web**: Discord OAuth2 (authorization code), httpOnly session-cookie (JWT), krypterad cookie för OAuth access/refresh, `GET /api/auth/me`, publik profil via `GET /api/public/profile/:userId`, **allowlistade** proxys mot [Discord REST v10](https://discord.com/developers/docs/reference#api-versioning), **bot-baserad guild-summary**, och valfri **Gateway (WebSocket)** för live voice-state.

## Krav

- Node.js som stödjer `fetch` (Node 18+).

## Miljövariabler

Kopiera [`.env.example`](./.env.example) till **repo-roten** `.env` och/eller `apps/discord-hub-api/.env` och fyll i värden. Vid start laddas först repots `.env`, sedan `apps/discord-hub-api/.env` (den senare **överstyr** vid krock). Du kan också sätta variabler direkt i shell.

| Variabel | Beskrivning |
|----------|-------------|
| `DISCORD_CLIENT_ID` | Application ID från Discord Developer Portal. |
| `DISCORD_CLIENT_SECRET` | OAuth2 client secret. |
| `DISCORD_REDIRECT_URI` | Måste vara **identisk** med en redirect du lagt under OAuth2 → Redirects (t.ex. `http://localhost:5173/api/auth/discord/callback`). Med Caddy/`http://dev.clanker.discord`: använd **samma host** här och i portalen (inte `localhost`). |
| `FRONTEND_URL` | Bas-URL till webben **utan** avslutande snedstreck (t.ex. `http://localhost:5173`). Efter lyckad inloggning redirectas användaren till `{FRONTEND_URL}/dashboard`. |
| `COOKIE_SECURE` | Valfritt. `1`/`true`: alltid `Secure` på cookies. `0`/`false`: aldrig `Secure`. Om osett: `Secure` endast när `NODE_ENV=production`. **HTTP + production** utan denna → inloggning misslyckas (state-cookie sparas inte); sätt `COOKIE_SECURE=0` i homelab utan TLS. |
| `DISCORD_OAUTH_DEBUG` | Valfritt. `1`/`true`: logga OAuth-callbackfel till stderr även i production (felsökning). I development loggas fel alltid. |
| `SESSION_SECRET` | Hemlig nyckel för JWT-signering (t.ex. `openssl rand -hex 32`). Används också för att härleda AES-nyckel till OAuth-cookien om `DISCORD_TOKEN_ENCRYPTION_KEY` saknas. |
| `DISCORD_OAUTH_SCOPES` | Valfritt. Blankstegsseparerade [OAuth2-scopes](https://docs.discord.com/developers/topics/oauth2#shared-resources-oauth2-scopes). Standard: `identify`. **Ändring kräver ny inloggning** för befintliga användare. |
| `DISCORD_OAUTH_PROMPT` | Valfritt: `consent` eller `none` (se Discord). |
| `DISCORD_PROXY_USER_PREFIXES` | Valfritt. Kommaseparerade URL-prefix (utan inledande `/`) som får anropas via användarproxyn. Standard: `users/@me,oauth2/@me`. |
| `DISCORD_BOT_TOKEN` | Valfritt. Bot-token från **Bot** i portalen. Aktiverar `/api/bot/discord/...`, `/api/bot/guild/:id/summary`, `/api/bot/live/*` och Gateway om guild-IDs är satta. **Committa aldrig.** |
| `RIOT_API_KEY` | Valfritt för övriga API:t, men krävs för `POST /api/integrations/league/sync`. Riot skickar nyckeln i headern `X-Riot-Token`. **App-gränser** (visas i portalen för din nyckel) gäller alla anrop — vanligt för personlig/dev-app: **20/s** och **100/2 min**; hubbens standarddelay (~**1200 ms**) följer 100/2 min-bucketen. **Metod-gränser** (t.ex. match-v5 **2000/10 s**) gäller bara när din app fått högre kvoter. Vid godkänd production-app: sänk `LEAGUE_MANUAL_RIOT_DELAY_MS` / `LEAGUE_CALL_DELAY_MS`. Se [Riot-regler för production key](./docs/riot-production-key-rules.md). |
| `DISCORD_PROXY_BOT_PREFIXES` | Valfritt. Allowlist för bot-REST-proxyn. Standard: `guilds/,channels/`. |
| `DISCORD_HUB_ALLOWED_GUILD_IDS` | Valfritt men **rekommenderas i prod**. Kommaseparerade snowflakes. Om satt får anroparen endast summary/live för dessa guilds. Tomt = ingen begränsning (endast för betrodd dev). |
| `DISCORD_HUB_ENFORCE_GUILD_MEMBERSHIP` | Valfritt. `1`/`true`: verifiera att inloggad användare (session `sub`) är medlem i guild via bot REST. |
| `DISCORD_TOKEN_ENCRYPTION_KEY` | Valfritt. Minst 32 UTF-8 byte; dedikerad nyckel för krypterad OAuth-cookie (`discord_oauth_tokens`). |
| `PORT` | Valfritt, standard `3001` (ska matcha Vite-proxyn i `discord-hub-web`). |
| `MUSIC_BOT_HTTP_URL` | **Krävs för musik** i hubben (t.ex. `http://127.0.0.1:3012`). Bas-URL till `discord-bot`:s HTTP-server (`MUSIC_BOT_HTTP_PORT`, standard **3012**). Utan denna returnerar musik-endpoints 503 („Music bot not configured”). Bot-processen måste köra parallellt med API:t. |
| `DATABASE_URL` | `postgresql://…` eller `postgres://…`. Krävs för Postgres-persistens. API:t verifierar anslutningen vid start. Se rot-`.env.example` och [docker.md](../../docs/docker.md#postgresql-på-workstation-lan). |

## Discord-applikation och bot (Fas 0 — drift)

1. [Discord Developer Portal](https://discord.com/developers/applications) → skapa **Application**.
2. **OAuth2** → **Redirects**: lägg hubbens callback-URL.
3. **Bot** → skapa bot, kopiera **token** till `DISCORD_BOT_TOKEN` (rotera om den läcker).
4. Bjud in boten: [Bot authorization](https://docs.discord.com/developers/topics/oauth2#bot-authorization-flow) — välj **minsta** permissions du behöver (undvik Administrator i onödan).
5. **Privileged Gateway Intents** (under Bot): slå endast på det ni behöver. **Presence** och **Message content** är privileged och kan kräva motivering hos Discord.
6. Live **voice** kräver ingen egen gateway i API:t: discord-bot skriver röststatus till `bot.guild_voice_states` och en heartbeat till `bot.runtime_status`.

OAuth-användare och bot-token är **olika** saker; hubben exponerar aldrig bot-token till webbläsaren.

### Inloggning misslyckas (`/login?error=oauth`)

Webbläsaren skickas hit om callbacken avvisar state, Discord skickar `error=`, eller token-/användarhämtning misslyckas. Kontrollera i ordning:

1. **Discord Developer Portal → OAuth2 → Redirects** — exakt samma sträng som `DISCORD_REDIRECT_URI` (ingen avvikande snedstreck, `http` vs `https`, eller host).
2. **`FRONTEND_URL`** — samma host som du faktiskt öppnar hubben i (t.ex. `http://dev.clanker.discord`, inte `localhost`, om du surfar via Caddy).
3. **`NODE_ENV=production` över HTTP** — sätt `COOKIE_SECURE=0` så state-cookien kan sparas (annars ignoreras den av webbläsaren).
4. Terminalen där **discord-hub-api** kör: vid utveckling (eller med `DISCORD_OAUTH_DEBUG=1`) skrivs en kort orsak till stderr.

### Säkerhet och loggning

- Logga **inte** råa Discord-svar som kan innehålla känsliga fält; logga aldrig `DISCORD_BOT_TOKEN` eller användares access tokens.
- Ogiltig bot-token ger **401** från Discord på REST; Gateway stänger med kod **4004** och försöker inte i oändlighet.

## Säkerhet: proxys

Öppen proxy mot hela `discord.com` skulle vara farlig (CSRF, missbruk). Därför:

- Endast sökvägar som börjar med dina **konfigurerade prefix** mot `https://discord.com/api/v10/...` tillåts i proxys.
- Sökvägar med `..`, omvänt snedstreck eller otillåtna tecken avvisas.
- Användarproxyn skickar användarens **Bearer-token**; bot-proxyn skickar **aldrig** bot-token till klienten.

Token-URL:er följer [Discord OAuth2](https://docs.discord.com/developers/topics/oauth2): `POST` med `application/x-www-form-urlencoded` till `https://discord.com/api/oauth2/token`.

## Utveckling

Från repots rot (med variabler satta i miljön):

```bash
npm run dev:discord-api
```

Sedan starta `discord-hub-web` (`npm run dev`). Webbläsaren anropar `/api/...` via Vite-proxyn mot `127.0.0.1:3001`.

## Endpoints

| Metod | Sökväg | Beskrivning |
|-------|--------|-------------|
| GET | `/api/auth/discord` | Startar OAuth (redirect till `https://discord.com/oauth2/authorize`). |
| GET | `/api/auth/discord/callback` | Discord callback; sätter `discord_session` + krypterad `discord_oauth_tokens`; redirect till `{FRONTEND_URL}/dashboard`. |
| GET | `/api/auth/me` | Profilfält + `discord`-metadata från [`GET /oauth2/@me`](https://docs.discord.com/developers/topics/oauth2#get-current-authorization-information) när token finns. |
| POST | `/api/auth/logout` | Rensar session- och OAuth-token-cookies. |
| GET | `/api/me/hub-settings` | Inloggad: privat hubb-JSON (prefs + dashboard-layout m.m.) från Postgres. Utan `DATABASE_URL`: `{ available: false, settings: null, updatedAt: null }`. |
| PUT | `/api/me/hub-settings` | Inloggad: sparar hela dokumentet (kräver `version: 1` i body). **400** vid ogiltig payload, **413** om body > ~400 kB, **503** utan DB. |
| GET | `/api/public/profile/:userId` | Publik profil-DTO för en Discord-användare. Returnerar Discord-identitet, publika integrationer och stats-platshållare. **404** om profilen saknas eller inte är publicerad. |
| `*` | `/api/discord/*` | Inloggad användare: proxy till Discord REST v10 med Bearer; refresh enligt [refresh grant](https://docs.discord.com/developers/topics/oauth2#authorization-code-grant-refresh-token-exchange-example). |
| `*` | `/api/bot/discord/*` | Inloggad användare + `DISCORD_BOT_TOKEN`: proxy med `Authorization: Bot …`. **503** om bot-token saknas. |
| GET | `/api/bot/guild/:id/summary` | Inloggad + bot: sammansatt **REST-snapshot** (guild med `with_counts`, kanaler). **503** utan bot. **403** om allowlist/medlemskapsregler säger nej. **502/504** vid Discord-fel/timeout (en retry vid 429/503). |
| GET | `/api/bot/live/health` | Inloggad: Gateway-status (`connected`, heartbeat-ack, reconnect-försök, intents, `degraded`). |
| GET | `/api/bot/live/guild/:id` | Inloggad: live **voice**-snapshot från `bot.guild_voice_states` + botens heartbeat (`bot.runtime_status`). `gateway_connected` = boten har skickat heartbeat de senaste 90 s. |
| GET | `/api/integrations/league/status` | Inloggad: sparad Riot-koppling och senaste hämtade League-snapshot i minnet. |
| POST | `/api/integrations/league/connect` | Inloggad: sparar `riotId`, `tagLine`, `region`, `rankPreference` och övriga League-inställningar. |
| POST | `/api/integrations/league/sync` | Inloggad + `RIOT_API_KEY`: hämtar PUUID via Riot Account v1, rank via League v4 och senaste matcher via Match v5. Returnerar snapshot med rank och matchlista. |
| POST | `/api/integrations/league/disconnect` | Inloggad: tar bort sparad League-koppling och rensar senaste snapshoten. |
| GET | `/api/stats/league?puuid=` | Inloggad: aggregerad League-statistik + kö/champion-uppdelning från `stats.league_matches` (ingen rå matchlista). |
| GET | `/api/stats/league/matches?puuid=&offset=&limit=` | Inloggad: paginerad matchhistorik (nyast först). `limit` 1–100, standard 25. **403** om `puuid` inte tillhör användarens kopplade konton. |

### JSON-exempel: `GET /api/bot/guild/:id/summary`

```json
{
  "guild": {
    "id": "…",
    "name": "Min server",
    "icon": "hash eller null",
    "approximate_member_count": 42,
    "approximate_presence_count": 12
  },
  "channels": [
    { "id": "…", "type": 0, "name": "general", "parent_id": null }
  ],
  "channel_count": 15
}
```

Discord-svar via generisk bot-proxy returneras med samma statuskropp; relevanta `X-RateLimit-*` / `Retry-After` vidarebefordras.

### JSON-exempel: `GET /api/public/profile/:userId`

```json
{
  "user": {
    "id": "123456789012345678",
    "username": "clanker",
    "global_name": "Christoffer",
    "avatar": "abc123hash",
    "banner": null,
    "accent_color": 5793266
  },
  "integrations": {
    "league": {
      "riotId": "Clanker",
      "tagLine": "EUW",
      "region": "EUW",
      "linkedAt": "2026-03-25T09:15:00.000Z",
      "lastSyncRequestedAt": "2026-03-25T10:22:00.000Z"
    },
    "steam": null
  },
  "stats": {
    "league": {
      "available": false,
      "source": "not_synced",
      "lastSyncRequestedAt": "2026-03-25T10:22:00.000Z"
    }
  }
}
```

När en synkad Riot-snapshot finns i minnet för användaren är `stats.league` i stället `available: true`, `source: "riot_sync"` och innehåller bland annat `fetchedAt`, `preferredRank`, `leagueEntries`, `recentMatches` och `account` (utan `puuid`). Utan kopplat League-konto är `source: "not_configured"`.

### Persistens och migrationer

Profilidentitet/visibilitet, League-koppling och senaste Riot-snapshot lagras i **PostgreSQL** när `DATABASE_URL` är satt.

Migrationer ligger under `apps/discord-hub-api/migrations/`. **discord-hub-api** kör saknade migrationer automatiskt vid uppstart (redan körda hoppas över). Manuellt:

```bash
npm run migrate -w discord-hub-api
```

Efter en lyckad migrering:

- `profiles` innehåller Discord-identitet + visibility.
- `league_connections` innehåller Riot ID, region m.m.
- `league_snapshots` innehåller senaste snapshot som JSONB.

API-hanterare uppdaterar tabellerna automatiskt: inloggning uppdaterar profilen; connect/sync/disconnect hanterar League-data. Publik profil (`GET /api/public/profile/:userId`) byggs från databasen.

## Riot / League policy

Om den här integrationen ska använda en Riot **production key**, läs och följ [Riot-regler för production key](./docs/riot-production-key-rules.md) innan projektet registreras eller görs publikt.

**Två nivåer av limits:** (1) **Din applikations** kvoter i portalen — t.ex. **20 förfrågningar/s** och **100 per 2 minuter**; det är oftast det som begränsar långa synker. (2) **Per metod** när Riot gett appen högre tak — t.ex. LoL **match-v5** `matches/{id}` och match-ID-lista upp till **2000 / 10 s**. Hubben använder som standard ~**1200 ms** mellan Riot-anrop så 100/2 min hålls; har du högre app-kvot, sänk `LEAGUE_MANUAL_RIOT_DELAY_MS` och `LEAGUE_CALL_DELAY_MS` i `.env`.

## Gateway — fel och återanslutning

- Vid nätverksfel: exponentiell **backoff** (upp till ~60 s) och ny WebSocket.
- **INVALID_SESSION** (`d: false`): session nollställs, anslutning stängs och öppnas om; ny **IDENTIFY**.
- **INVALID_SESSION** (`d: true`): **RESUME** efter kort slumpfördröjning.
- **Gateway close 4004**: ogiltig bot-token — klienten **stoppas** (loggar orsak utan token).

## Produktion

```bash
npm run build -w discord-hub-api
npm run start -w discord-hub-api
```

Sätt `NODE_ENV=production` så cookies får flaggan `Secure`. Terminera TLS på reverse proxy (Caddy/nginx) och prox:a `/api` till denna tjänst.

När `DATABASE_URL` är satt verifieras Postgres vid uppstart (`pg`). Själva **persistensen** av profiler/League (migrationer, queries) kommer i senare steg. Om Postgres körs på **en annan maskin** (t.ex. Windows-workstation medan API kör på Pi), peka `DATABASE_URL` mot den värdens LAN-IP och använd samma användare/lösenord/databas som i Compose — se [PostgreSQL på workstation (LAN)](../../docs/docker.md#postgresql-på-workstation-lan).
