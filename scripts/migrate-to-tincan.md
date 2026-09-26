# Runbook: flytta Discord-stacken från Raspberry Pi:n till `tincan`

Efter flytten kör **tincan** Postgres (`clanker-db`), `discord-hub-api`, `discord-hub-web`, boten
(`discord-bot-host`) och Caddy. **Pi-hole stannar på Pi:n** och pekar bara om hostnamnen.

Platshållare nedan: `<PI_IP>`, `<TINCAN_IP>`, `<user>`. Den gamla databasen kör antingen på Pi:n
eller på din workstation. Kör steg 2 där `clanker-db` kör **i dag** (kolla med `docker ps`). tincan: 192.168.0.174, Pi:n: 192.168.0.2.

> **Regel nummer ett:** två bot-instanser med samma token får aldrig vara igång samtidigt, varken
> på Pi:n, på tincan eller i `npm run dev` på din PC. Då slåss de om gateway-sessionen och röst- och
> musikflödet blir instabilt.

Planerad nertid: cirka 15–30 min, alltså tiden mellan steg 1 och steg 4.

---

## 0. Förberedelser på tincan (ingen nertid) — **redan gjort 2026-09-26**

tincan (192.168.0.174, Ubuntu 26.04, x86_64) följer mönstret `/srv/stacks/<namn>` med en gemensam Caddy i
`/srv/stacks/proxy` på Docker-nätverket `edge`. Clanker har anpassats till det:

| Vad | Var | Status |
|---|---|---|
| Repot (`feat/bot-overhaul`) | `/srv/stacks/clanker` | klonat |
| `.env` (chmod 600) | `/srv/stacks/clanker/.env` | skapad: icke-hemliga värden ifyllda, Postgres-lösenord, `SESSION_SECRET` och `BOT_HTTP_SECRET` genererade. **Tomt att fylla i:** `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_SECRET`, `SETUP_ALLOWED_GUILD_IDS`, valfria API-nycklar |
| `docker-compose.override.yml` (gitignorerad) | `/srv/stacks/clanker` | lägger `discord-hub-web` och `discord-hub-api` på nätverket `edge` |
| Caddy-site | `/srv/stacks/proxy/conf.d/clanker.caddy` | **`https://clanker.tincan.internal`** (tincans lokala CA): `/api` → hub-api, `/collab/*` → wheel-collab (wss), resten → webben. Pi-hole löser redan `*.tincan.internal` till tincan, så **ingen DNS-ändring behövs och Pi-hole rörs inte** |
| ufw | `3012/tcp ALLOW från 172.16.0.0/12` | Docker-nät → botens HTTP. Inte öppet mot LAN |
| Imager | `docker compose build` | byggda |

Clankers egen `clanker-caddy` används **inte** på tincan (port 80/443 ägs av `/srv/stacks/proxy`), därför
`COMPOSE_PROFILES=db,discord,discord-host`. Webbens port 4173 och wheel-collab 3002 är bundna till 127.0.0.1
(Caddy når dem via `edge`).

**Driftsatt 2026-09-26** med en **ny, tom** databas (ingen data flyttades från Pi:n):
`FRONTEND_URL=https://clanker.tincan.internal`, `DISCORD_REDIRECT_URI=https://clanker.tincan.internal/api/auth/discord/callback`,
`COOKIE_SECURE=1`, `VITE_WHEEL_COLLAB_URL=wss://clanker.tincan.internal/collab`. Boten ("Clanker", app `1486101477994004631`)
är bara med i Hermes (`1537349490736898100`), därför är `DISCORD_GUILD_ID` och `VITE_DISCORD_HUB_GUILD_ID` satta till Hermes.
neutralen-bot på Pi:n är avstängd (`systemctl disable --now neutralen-bot`).

> **Samma Discord-app som neutralen-bot.** Clanker och neutralen-bot använder båda applikation `1486101477994004631`.
> Bara **en** av dem får köra med token åt gången. neutralen-bot-imagen (`neutralen-bot:overhaul`) finns byggd
> men startas inte.

Bygga om efter en `git pull`:

```bash
cd /srv/stacks/clanker && git pull && docker compose build
```

---

## 1. Stoppa boten på Pi:n

På Pi:n (i repot):

```bash
docker compose --profile discord-host stop discord-bot-host
docker update --restart=no discord-bot-host      # annars startar den igen om Pi:n bootar om
docker compose --profile discord-bridge stop discord-bot 2>/dev/null || true
docker ps --format '{{.Names}}\t{{.Status}}'      # ingen discord-bot* får synas
```

Stoppa även det som skriver till databasen, så att dumpen blir konsistent:

- `discord-hub-api` (kör den med npm: stäng processen eller kör `scripts/clanker-kill`; kör den i Docker: `docker compose --profile discord stop discord-hub-api`).
- Eventuell `npm run dev:discord-bot` på din PC.

Kontrollera i Discord att boten visas som **offline**.

---

## 2. `pg_dump` → överföring → `pg_restore`

### 2a. Dumpa (där `clanker-db` kör i dag)

```bash
cd ~/Clanker   # eller var repot ligger
docker exec clanker-db pg_dump -U clanker -d clanker_discord -Fc > clanker_discord.dump
docker exec clanker-db pg_dump -U clanker -d clanker_devtools -Fc > clanker_devtools.dump   # om den finns
docker exec -i clanker-db pg_restore -l < clanker_discord.dump | head   # ska lista tabeller, inte ge fel

# Radräkning att jämföra med efteråt:
docker exec clanker-db psql -U clanker -d clanker_discord -Atc "
  SELECT 'schema_migrations', count(*) FROM public.schema_migrations UNION ALL
  SELECT 'profiles', count(*) FROM profile.profiles UNION ALL
  SELECT 'message_log', count(*) FROM stats.message_log UNION ALL
  SELECT 'voice_sessions', count(*) FROM stats.voice_sessions UNION ALL
  SELECT 'playlists', count(*) FROM bot.playlists UNION ALL
  SELECT 'league_matches', count(*) FROM stats.league_matches;" | tee counts-before.txt
```

Byt `clanker`/`clanker_discord` om du har andra `POSTGRES_USER`/`POSTGRES_DB` i `.env`.

### 2b. Överför

```bash
scp clanker_discord.dump clanker_devtools.dump counts-before.txt <user>@<TINCAN_IP>:/srv/stacks/clanker/
```

### 2c. Återställ på tincan

```bash
cd /srv/stacks/clanker
docker compose --profile db up -d clanker-db
until docker exec clanker-db pg_isready -q; do sleep 1; done

docker exec -i clanker-db pg_restore -U clanker -d clanker_discord --clean --if-exists --no-owner --role=clanker < clanker_discord.dump
docker exec -i clanker-db pg_restore -U clanker -d clanker_devtools --clean --if-exists --no-owner --role=clanker < clanker_devtools.dump   # om den finns
```

`--clean --if-exists` på en nyss skapad, tom databas kan skriva ut några `does not exist`-rader. Det är ofarligt.
Kör samma radräkningsfråga som i 2a och jämför med `counts-before.txt`. Siffrorna ska vara identiska.

> Samma Postgres-major (16) på båda sidor, så dumpen går att läsa direkt.

---

## 3. Kopiera `.env` manuellt

```bash
scp <user>@<PI_IP>:~/Clanker/.env /srv/stacks/clanker/.env
scp <user>@<PI_IP>:~/Clanker/bots/discord-bot/.env /srv/stacks/clanker/bots/discord-bot/.env   # om den finns (används bara av npm-körning)
chmod 600 /srv/stacks/clanker/.env
```

Justera sedan `/srv/stacks/clanker/.env` på tincan:

| Variabel | Värde på tincan | Varför |
|---|---|---|
| `COMPOSE_PROFILES` | `db,discord,discord-host` | redan satt. Ingen `caddy`: tincans egen proxy serverar hubben |
| `BOT_HTTP_SECRET` | redan genererad | krävs av botens musik-HTTP (hub-api skickar samma värde) |
| `FRONTEND_URL` | `http://clanker.discord` | prod-hubben via Caddy |
| `DISCORD_REDIRECT_URI` | `http://clanker.discord/api/auth/discord/callback` | lägg **också** in den i Discord Developer Portal → OAuth2 → Redirects |
| `COOKIE_SECURE` | `0` | hubben körs över http |
| `DISCORD_BOT_HOST_DATABASE_URL` | (ta bort eller lämna tom) | standard `127.0.0.1:5432` stämmer när Postgres kör på samma värd |
| `MUSIC_BOT_HTTP_URL` | (ta bort) | compose sätter `http://host.docker.internal:3012` åt API-containern |
| `LOG_LEVEL` | `info` | |

Övriga nya variabler (Jev, WoW, setup) beskrivs i `.env.example` och `docs/discord-hub.md`.

På **Pi:n** ändras `.env` till att bara starta Pi-hole:

```bash
# Pi:n: ~/Clanker/.env
COMPOSE_PROFILES=pihole
```

---

## 4. Starta stacken på tincan

```bash
cd /srv/stacks/clanker
docker compose up -d          # profilerna kommer från COMPOSE_PROFILES i .env
docker compose ps
```

Det startar `clanker-db`, `discord-hub-api`, `discord-hub-web` och `discord-bot-host`. Hubben nås via tincans proxy
(`/srv/stacks/proxy/conf.d/clanker.caddy`).
API:t och boten kör båda migrationerna vid start. De tar ett advisory lock, så ordningen spelar ingen roll.

---

## 5. Peka om hostnamnen i Pi-hole (behövs inte på tincan: hubben ligger på `clanker.tincan.internal`)

Alla namn som i dag pekar på Pi:ns IP ska peka på **tincan**:
`clanker.discord`, `dev.clanker.discord`, `clanker.tools`, `dev.clanker.tools` och `clanker.pihole`.
`clanker.pihole` går också till tincans Caddy, som proxar vidare till Pi:ns Pi-hole-admin.

**Pi-hole v6** (det ni kör: `etc-pihole/pihole.toml`) lagrar lokala poster i `dns.hosts`, inte i `custom.list`:

- Webbgränssnitt: *Settings → Local DNS Records*. Ändra IP för varje namn till `<TINCAN_IP>`.
- Eller CLI på Pi:n:

  ```bash
  docker exec clanker-pihole pihole-FTL --config dns.hosts \
    '["<TINCAN_IP> clanker.discord","<TINCAN_IP> dev.clanker.discord","<TINCAN_IP> clanker.tools","<TINCAN_IP> dev.clanker.tools","<TINCAN_IP> clanker.pihole"]'
  docker exec clanker-pihole pihole-FTL --config dns.hosts   # kontrollera
  ```

  Obs: kommandot **ersätter** hela listan. Lägg med eventuella andra poster du redan har.

**Pi-hole v5** (äldre): redigera `etc-pihole/custom.list` (rader `IP namn`) och kör `docker exec clanker-pihole pihole restartdns`.

Töm klienternas DNS-cache: Windows `ipconfig /flushdns`, Linux `resolvectl flush-caches`.

---

## 6. Verifiering

På tincan:

```bash
docker compose ps                                 # alla "running", discord-bot-host "healthy"
curl -s http://127.0.0.1:3012/health              # {"discord":"ready","db":"ok",...} och HTTP 200
docker logs discord-bot-host 2>&1 | grep -E "yt-dlp self-test|Ready as|Slash commands|migrations" | head
docker logs discord-hub-api 2>&1 | tail -20
nslookup clanker.discord <PI_IP>                  # svarar med <TINCAN_IP>
```

Från din PC:

- [ ] `http://clanker.discord` laddar hubben, och inloggning med Discord fungerar (redirect enligt steg 3).
- [ ] Dashboardens röst-widget visar vilka som sitter i röst (läser `bot.guild_voice_states`).
- [ ] `/ping` i Discord svarar.
- [ ] `/play <låt>` i en röstkanal spelar ljud. Det verifierar både host-nät/UDP och yt-dlp.
- [ ] Musikkön i hubben visar samma låt, och *skip* från hubben fungerar (verifierar `BOT_HTTP_SECRET` hela vägen).
- [ ] `http://clanker.pihole` når Pi-hole-admin.
- [ ] `sudo systemctl list-timers clanker-db-backup.timer` visar nästa körning (se nedan).

---

## Nattlig backup (tincan)

```bash
sudo mkdir -p /var/backups/clanker && sudo chown "$USER" /var/backups/clanker
/srv/stacks/clanker/scripts/db-backup.sh                 # testkör en gång
ls -lh /var/backups/clanker/daily

sudo cp /srv/stacks/clanker/infra/systemd/clanker-db-backup.{service,timer} /etc/systemd/system/
sudo systemctl edit clanker-db-backup.service     # vid behov: User=<user> (måste vara i docker-gruppen)
sudo systemctl daemon-reload
sudo systemctl enable --now clanker-db-backup.timer
systemctl list-timers clanker-db-backup.timer
```

Rotation: 7 dagliga och 4 veckovisa (söndagar). Alternativ utan systemd finns i `infra/systemd/crontab.example`.
Kopiera gärna `/var/backups/clanker` vidare till en annan maskin, till exempel med Syncthing eller rsync.
En backup på samma disk skyddar inte mot diskhaveri.

Återställning av en fil:

```bash
docker exec -i clanker-db pg_restore -U clanker -d clanker_discord --clean --if-exists --no-owner < /var/backups/clanker/daily/clanker_discord_YYYY-MM-DD_HHMM.dump
```

---

## Rollback (om något inte fungerar)

1. tincan: `docker compose stop discord-bot-host discord-hub-api`.
2. Pi-hole: peka tillbaka namnen till `<PI_IP>`.
3. Pi:n: `docker update --restart=unless-stopped discord-bot-host && docker compose --profile discord-host up -d discord-bot-host`, och starta hub-api som förut.
4. Data som skrivits på tincan efter steg 4 finns bara där. Vill du ha med den tillbaka, dumpa från tincan och återställ på Pi:n (steg 2 åt andra hållet).

## Städning (efter en vecka utan problem)

På Pi:n: `docker compose --profile discord-host rm -f discord-bot-host`. Behåll volymen `clanker-pgdata` på den
gamla värden tills du har minst en veckobackup från tincan.
