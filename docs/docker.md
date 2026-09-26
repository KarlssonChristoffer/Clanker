# Docker & Compose i Clanker

Kort referens för **vanliga kommandon** och hur de används i detta repo. Alla exempel förutsätter att du står i **repots rot** (mappen där `docker-compose.yml` och `README.md` ligger), t.ex. `~/apps/Clanker`.

## Varför alltid roten?

Compose-filen använder volymsökvägar som `./etc-pihole` och `./etc-dnsmasq.d` samt `build.context: .` för webbapparna. Körs du från fel katalog hittar inte Docker filerna eller monorepot (`packages/ui` m.m.).

```bash
cd ~/apps/Clanker   # anpassa sökväg efter din maskin
```

## Ett kommando från SSH (`clanker.run`)

Skriptet [`scripts/clanker-run`](../scripts/clanker-run) byter alltid till **repots rot** och kör `docker compose --profile caddy up -d --build` — **Caddy startas alltid** (samma som `clanker up`). Övriga profiler styrs av **`COMPOSE_PROFILES` i `.env`** (t.ex. `discord`, `devtools`, `db`). Utan `COMPOSE_PROFILES` får du alltså i praktiken bara Caddy. Pi-hole har profilen `pihole` (på Pi:n: `COMPOSE_PROFILES=pihole`). Du behöver inte längre lägga `caddy` i `COMPOSE_PROFILES` för `clanker-run` / `clanker up`; variabeln gäller webb/db m.m. (se `.env.example`).

**Vite i bakgrunden (valfritt):** sätter du **`CLANKER_VITE_DEV=1`** i `.env` och har kört **`npm install`** i roten startar skriptet efter lyckad Compose-körning även **`npm run dev:all`** (discord-hub + dev-tools) i bakgrunden med `setsid`, så Caddy kan nå `dev.clanker.*` utan separat terminal. PID sparas i **`.clanker/vite-dev.pid`** (gitignorerad), logg i **`.clanker/vite-dev.log`**. Utan `npm` eller `node_modules/` skrivs en varning och Compose påverkas inte. Om en Vite-process redan körs enligt PID-filen startas ingen ny.

**Kör från repo:**

```bash
./scripts/clanker-run
```

**Flaggor** vidarebefordras till `docker compose up`, t.ex.:

```bash
./scripts/clanker-run --no-build
```

**Globalt kommando** (anpassa sökvägen till din clone):

```bash
sudo ln -sf "$HOME/apps/Clanker/scripts/clanker-run" /usr/local/bin/clanker.run
clanker.run
```

## Stäng ned (`clanker.kill`)

Skriptet [`scripts/clanker-kill`](../scripts/clanker-kill) stoppar först **Vite** om **`.clanker/vite-dev.pid`** finns (samma som `clanker-run` skapade med `CLANKER_VITE_DEV=1` — hela processgruppen avslutas), därefter som standard **`docker compose down`** från **repots rot** (samma `.env` / `COMPOSE_PROFILES` som vid start).

**Pi-hole och DNS:** `clanker-pihole` har Compose-profilen `pihole` (sedan flytten av Discord-stacken till tincan kör Pi:n bara Pi-hole, med `COMPOSE_PROFILES=pihole` i `.env`). **`docker compose down` på Pi:n stoppar Pi-hole.** Klienter som i routern/DHCP **bara** har Pis IP som DNS-server får då inga DNS-svar (internet “fungerar inte”) tills Pi-hole startar igen — t.ex. med `./scripts/clanker-run` eller `docker compose up -d`. Lägg gärna in **sekundär DNS** (t.ex. `1.1.1.1`) i routern så uppslag fungerar om Pi är nere; se [pihole/README_PIHOLE.md](../pihole/README_PIHOLE.md) (avsnitt om DHCP och sekundär DNS).

**Lämn Pi-hole igång:** sätt **`CLANKER_KILL_KEEP_PIHOLE=1`** i `.env`. Då kör skriptet `docker compose stop` på `discord-hub-web`, `dev-tools-web`, `clanker-caddy` och `clanker-db` i stället för `down`. Containrar blir kvar i *exited*-läge (till skillnad från `down`). **Extra argument** (t.ex. `--volumes`) **används inte** i det läget — använd full `down` utan variabeln om du behöver dem.

Efteråt skrivs **compose-status** och **TCP-portar** (`ss -tlnp`). **Tolkning:** **22** (SSH), **111** (rpcbind), **631** (CUPS), **5900** (VNC) m.m. är vanliga värdtjänster; **127.0.0.1** med `node` kan vara IDE (t.ex. Cursor), inte Clanker. Efter **full** `down` ska Clanker-relaterat ofta vara borta: 80, 4173, 4174, 5173, 5174, 8080, och Pi-hole kan använda **TCP 53** (DNS över TCP syns här; **UDP 53** syns inte i `ss -tlnp`). Med **`CLANKER_KILL_KEEP_PIHOLE=1`** är **53** och **8080** i stället **förväntade** så länge Pi-hole kör. Om **5173/5174** står kvar kan det vara Vite utanför `clanker-run` eller en process som sluppit processgruppen.

**Kör från repo:**

```bash
./scripts/clanker-kill
```

**Flaggor** vidarebefordras till `docker compose down` (när `CLANKER_KILL_KEEP_PIHOLE` inte är satt), t.ex. ta bort volymer:

```bash
./scripts/clanker-kill --volumes
```

**Globalt kommando:**

```bash
sudo ln -sf "$HOME/apps/Clanker/scripts/clanker-kill" /usr/local/bin/clanker.kill
clanker.kill
```

## Kommandot `clanker` (dispatcher)

[`scripts/clanker`](../scripts/clanker) är en **tunn ingång** från repots rot: samma idé som `clanker.run` / `clanker.kill`, men med **delkommandon** så du slipper komma ihåg långa `docker compose --profile …`-rader. Detaljerad backlog: [homelab-todo-clanker-cli.md](homelab-todo-clanker-cli.md).

**Rekommenderat:** använd `clanker up`, `clanker stop`, `clanker run` och `clanker kill` i vardagen. **`clanker up`** och **`clanker run`** lägger alltid till Compose-profilen **`caddy`** (reverse proxy). **`clanker compose …`** är rå `docker compose` och lägger **inte** till caddy automatiskt.

| Kommando | Betydelse |
|----------|-----------|
| `clanker run` | = `./scripts/clanker-run` (**alltid** `--profile caddy` + `COMPOSE_PROFILES` / övriga tjänster + ev. Vite). **`clanker up` startar inte Vite** — bara `run` (eller manuell `npm run dev:all`). |
| `clanker kill` | = `./scripts/clanker-kill` (Vite stoppas först, sedan `docker compose down` m.m.; se [Stäng ned](#stäng-ned-clankerkill) om Pi-hole) |
| `clanker up` | `docker compose up -d --build` med **caddy alltid** + angivna profiler (eller bara caddy + `COMPOSE_PROFILES` om du inte listar namn) |
| `clanker up devtools` | Startar **devtools + caddy** (du behöver inte skriva `caddy`; kan lista flera: `discord devtools`) |
| `clanker up … --no-build` | Samma som ovan men utan `--build`; du kan också skicka `--build` explicit utan att det dubblas |
| `clanker stop devtools` | Stoppar **en** profils container (mappning se `clanker help`) |
| `clanker down` | `docker compose down` med **varning** om Pi-hole; till skillnad från `kill` körs inte Vite-nedstängning först och **`CLANKER_KILL_KEEP_PIHOLE` påverkar inte** `down` |
| `clanker compose …` | Rå `docker compose` från rot — **ingen** automatisk caddy |
| `clanker ps` | `docker compose ps` |
| `clanker doctor` | Snabb koll: finns `.env`, `docker compose ps`, samt `node_modules` om `CLANKER_VITE_DEV=1` i `.env` |
| `clanker dev discord` / `devtools` | Kör först **`clanker up <profil>`** (webbcontainer **+ caddy** alltid), sedan Vite i förgrund. **`--vite-only`** hoppar över Docker. |
| `scripts/clanker-dev-discord`, `scripts/clanker-dev-tools` | Tunna wrappers (= `clanker dev discord` / `devtools`); valfri symlink i PATH, t.ex. `clanker.discord.dev`. |

**Linux kort:** lägg en symlink i en katalog som finns i `PATH` (t.ex. `ln -sf "$HOME/apps/Clanker/scripts/clanker" /usr/local/bin/clanker`) så räcker det att skriva `clanker` var du än står. Filen måste vara körbar (`chmod +x`).

**Tab completion (bash):** ladda [`scripts/clanker-completion.bash`](../scripts/clanker-completion.bash) i `~/.bashrc`, t.ex. `source "$HOME/apps/Clanker/scripts/clanker-completion.bash"` (justera sökväg). Under **zsh:** `autoload -U bashcompinit && bashcompinit` och samma `source`.

```bash
./scripts/clanker help
```

---

## Starta alla tjänster (Docker)

**Snabbstart (utan Postgres)** — Pi-hole + båda webbapparna (vanligast om du inte kör API/DB än):

```bash
cd ~/apps/Clanker
docker compose --profile discord --profile devtools up -d --build
```

**Med Postgres** (när du behöver databasen, t.ex. till kommande API):

```bash
docker compose --profile discord --profile devtools --profile db up -d --build
```

Har du aldrig kört en databas förut? Följ [PostgreSQL: kom igång (första gången, Docker)](#postgresql-kom-igång-första-gången-docker) — du installerar inget på operativsystemet, bara startar en container.

**Med Caddy** (HTTP på port 80 — prod-webb, Pi-hole-admin, samt `dev.clanker.*` mot Vite på värden om det körs):

```bash
docker compose --profile discord --profile devtools --profile caddy up -d --build
```

- `--build` bygger om webb-images efter kodändringar; utelämna den om du bara vill starta snabbt.
- Vill du **bara** Pi-hole: `docker compose up -d` (inga profiler).

**Miljö:** ha `.env` från `.env.example` om du behöver egna portar eller Pi-hole-inställningar.

**Valfritt — kortare kommando:** i `.env` kan du sätta `COMPOSE_PROFILES=discord,devtools` (lägg till `,db` för Postgres). Med **`clanker up`** eller **`./scripts/clanker-run`** får du **caddy utöver det** automatiskt. Om du kör **rå** `docker compose up -d` utan Clanker-skript behöver du själv lägga **`caddy`** i `COMPOSE_PROFILES` eller `--profile caddy` om du vill ha reverse proxyn. Sedan:

```bash
docker compose up -d --build
```

(Pi-hole startar bara med profilen `pihole`.)

---

## Fuskblad: vad är vad (portar)

| Vad | Typ | Var du når det | Standard om inget annat står i `.env` |
|-----|-----|----------------|----------------------------------------|
| **Discord hub** (webb, nginx-build) | Docker | `http://<din-pi>:4173` | Värdport **4173** → nginx port 80 i containern (`DISCORD_HUB_WEB_PORT`) |
| **Dev tools** (webb, nginx-build) | Docker | `http://<din-pi>:4174` | Värdport **4174** (`DEV_TOOLS_WEB_PORT`) |
| **Caddy** (valfritt, reverse proxy) | Docker | `http://clanker.discord`, `http://clanker.tools`, `http://clanker.pihole`, `http://dev.clanker.discord`, … (standardnamn; se [Caddy](#caddy-reverse-proxy)) | Värdport **80** eller `CADDY_HTTP_PORT`; profil **`caddy`**. Proxar även Pi-hole-admin och Vite på värden via `host.docker.internal`. |
| **PostgreSQL** | Docker | **127.0.0.1** på värden som standard (ej LAN) | **127.0.0.1:5432** (`POSTGRES_PORT`, `POSTGRES_BIND_ADDRESS`). På **workstation** som DB-värd: se [PostgreSQL på workstation (LAN)](#postgresql-på-workstation-lan). |
| **Pi-hole** (DNS + admin m.m.) | Docker, `host`-nät | Direkt på värden: `WEB_PORT` / `FTLCONF_webserver_port` (t.ex. **8080** i `.env.example`). DNS: port **53**. Via Caddy: `http://clanker.pihole` på värdens port **80** (samma ingång som övriga Caddy-namn). | Pi-hole delar Pi:ns nätverksstack. |

Om klienterna i LAN **bara** använder Pis IP som DNS och Pi-hole-containern **inte** kör, försvinner namnuppslag (det kan kännas som att hela nätverket är nere även om t.ex. `ping 1.1.1.1` fungerar). Sätt gärna **sekundär DNS** i routern/DHCP eller läs mer under felsökning i [`pihole/README_PIHOLE.md`](../pihole/README_PIHOLE.md).

**Utveckling utan Docker** (npm från repots rot — *inte* samma portar som tabellen ovan):

| App | Kommando | Dev-server (typiskt) |
|-----|----------|----------------------|
| Båda (rekommenderat med Caddy `dev.clanker.*`) | `npm run dev:all` | Vite **5173** + **5174** parallellt |
| Discord hub | `npm run dev` | Vite, oftast **5173** |
| Dev tools | `npm run dev:tools` | Vite, oftast **5174** |

Alltså: **4173/4174** = färdigbyggd statisk sajt i container; **5173/5174** = lokal Vite med hot reload.

---

## Tjänster och profiler

I `docker-compose.yml` finns fem tjänster. **Profiler** styr vilka som startar när du kör `up` — undviker att t.ex. databas eller extra webbar startar av misstag.

| Tjänst | Container-namn | Profil | Standard / notis |
|--------|------------------|--------|------------------|
| `discord-hub-web` | `discord-hub-web` | `discord` | Port **4173→80** i containern (`DISCORD_HUB_WEB_PORT` i `.env`) |
| `dev-tools-web` | `dev-tools-web` | `devtools` | Port **4174→80** (`DEV_TOOLS_WEB_PORT`) |
| `clanker-caddy` | `clanker-caddy` | `caddy` | HTTP på värd: `CADDY_HTTP_PORT` (standard **80**). Prod, Pi-hole-admin, dev-Vite — se [Caddy](#caddy-reverse-proxy); `extra_hosts: host.docker.internal:host-gateway`. |
| `clanker-db` | `clanker-db` | `db` | Postgres 16, volym `clanker-pgdata`; **en** server/port, **två** databaser vid ny volym: `POSTGRES_DB` (standard **`clanker_discord`**) + `POSTGRES_EXTRA_DB` (standard `clanker_devtools`). Init: [infra/postgres/docker-entrypoint-initdb.d/](../infra/postgres/docker-entrypoint-initdb.d/). |
| `clanker-pihole` | `clanker-pihole` | `pihole` | `network_mode: host` — delar Pi:ns nätverksstack |

- **Ingen profil** = tjänsten ingår i “default”-uppsättningen när du kör `docker compose up` utan `--profile`.
- **Med profil** = tjänsten startar bara om du anger motsvarande `--profile` (eller sätter miljövariabeln `COMPOSE_PROFILES`).

Pi-hole kräver profilen `pihole` (startar alltså inte av misstag på tincan). Webbapparna kräver explicit `discord` / `devtools`. **Caddy** kräver profilen `caddy`. Namnen `clanker.discord` / `clanker.tools` ger **502** om motsvarande webbcontainer inte kör; `clanker.pihole` funkar om Pi-hole lyssnar på värdens `WEB_PORT` och `CLANKER_PIHOLE_UPSTREAM` stämmer. `dev.clanker.*` ger **502** om Vite inte kör på **samma värd som Docker**.

## PostgreSQL: kom igång (första gången, Docker)

Du behöver **inte** ladda ner eller “installera PostgreSQL” som ett Windows/Linux-program om du redan har Docker. Compose hämtar en färdig **image** (`postgres:16-alpine`) första gången du startar tjänsten.

### 1. Gå till repot

```bash
cd ~/apps/Clanker
```

(Använd sökvägen där du klonat **Clanker**.)

### 2. Skapa `.env` med ett riktigt lösenord

Om du inte redan har `.env` i repots rot:

```bash
cp .env.example .env
```

Redigera `.env` och **aktivera** (ta bort `#` framför) samt **byt** lösenordet:

```env
POSTGRES_USER=clanker
POSTGRES_PASSWORD=byt_mig_starkt_lösenord
POSTGRES_DB=clanker_discord
POSTGRES_PORT=5432
```

- **Användarnamn** (`POSTGRES_USER`) kan vara `clanker`; **discord-databasen** heter standard **`clanker_discord`** (`POSTGRES_DB`). Det viktiga är att `POSTGRES_PASSWORD` är unikt och svårgissat.
- **Lämna** `POSTGRES_BIND_ADDRESS` odefinierad tills du behöver att **en annan dator** (t.ex. Pi) ska ansluta — då läser du [PostgreSQL på workstation (LAN)](#postgresql-på-workstation-lan).
- **Två appar, en Postgres:** du behöver **inte** två portar. En Postgres-instans lyssnar på **5432**; du använder **olika databasnamn** i URL:en (sista path-segmentet). Vid **första** init av volymen skapas automatiskt en extra databas enligt `POSTGRES_EXTRA_DB` (standard **`clanker_devtools`**) bredvid `POSTGRES_DB` (standard **`clanker_discord`** för discord-hub). Exempel-URL:er finns i `.env.example`.
- **Befintlig volym** från innan init-scriptet fanns: init körs **inte** om igen. Skapa den andra databasen manuellt en gång:  
  `docker exec -it clanker-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c 'CREATE DATABASE clanker_devtools;'`  
  (byt namn om du använder annat än standard.)
- **Äldre standard `POSTGRES_DB=clanker`:** volymer som redan initierats har kvar det databasnamnet. Antingen pekar du `DATABASE_URL` mot `…/clanker`, eller du byter namn / skapar `clanker_discord` manuellt och migrerar data — **nya** installationer får standard **`clanker_discord`** från Compose.

### 3. Starta bara databasen (minsta möjliga)

Du behöver inte starta webb eller Pi-hole för att testa Postgres:

```bash
docker compose --profile db up -d
```

Första körningen kan ta en stund medan Docker **pull**ar `postgres:16-alpine`.

### 4. Kontrollera att den kör

```bash
docker ps --filter name=clanker-db
```

Du ska se containern **clanker-db** som **Up**. Anslutning från **samma maskin** sker mot **127.0.0.1** och port **5432** (om du inte ändrat `POSTGRES_PORT`).

### 5. (Valfritt) Öppna en SQL-prompt i containern

```bash
docker exec -it clanker-db psql -U clanker -d clanker_discord
```

I `psql`-prompten: skriv `\q` och Enter för att avsluta.

### 6. Anslutningssträngar (discord-hub vs devtools)

**Samma värd och port** — bara **sista delen** av URL:en (databasnamnet) skiljer:

```text
postgresql://clanker:DITT_LÖSENORD@127.0.0.1:5432/clanker_discord
postgresql://clanker:DITT_LÖSENORD@127.0.0.1:5432/clanker_devtools
```

- **discord-hub-api:** `DATABASE_URL` mot `POSTGRES_DB` (standard **`clanker_discord`** om du inte ändrat).
- **devtools-backend** (när den finns): egen variabel, t.ex. `DATABASE_URL` i den tjänsten, mot **`clanker_devtools`** (eller vad du satt som `POSTGRES_EXTRA_DB`).

Kör API **i Compose** mot samma nät: byt värd till **`clanker-db`** i stället för `127.0.0.1` (se `.env.example`).

### Stoppa och starta om

```bash
docker compose --profile db stop
docker compose --profile db start
```

Ta bort containern men **behåll data** i volymen:

```bash
docker compose --profile db down
```

**Radera all databasdata** (⚠️ oåterkalleligt) kräver att du också tar bort volymen `clanker-pgdata` — se avsnitt om volymer längre ner i denna fil om du behöver det.

## PostgreSQL på workstation (LAN)

När **Pi** kör webb/API men Postgres ska ligga på **stationär workstation** (mer RAM, snabbare disk) kör du `clanker-db` **bara** på desktop med samma repo och `docker-compose.yml`.

1. På **workstation**: samma `.env`-värden för `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` som API:t ska använda.
2. Sätt **`POSTGRES_BIND_ADDRESS=0.0.0.0`** om klienter på LAN (t.ex. Pi) ska ansluta direkt. Standard **`127.0.0.1`** är säkrast om allt som pratar med DB kör på samma maskin.
3. Starta eller uppdatera databasen så portmappningen mot värden stämmer: `docker compose --profile db up -d`. Efter du **ändrat** `POSTGRES_BIND_ADDRESS` måste detta köras igen (så Docker sätter om `0.0.0.0:5432` eller `127.0.0.1:5432` på värden).
4. **Brandvägg** på workstation: begränsa **5432/tcp** till Pis IP (eller betrott subnet), inte mot hela internet. Använd **starkt** `POSTGRES_PASSWORD`. På **Windows** (PowerShell som administratör), byt ut IP:

   ```powershell
   New-NetFirewallRule -DisplayName "Postgres Clanker (Pi only)" -Direction Inbound -LocalPort 5432 -Protocol TCP -Action Allow -RemoteAddress 192.168.x.x
   ```

5. På **Pi** (eller var respektive klient körs): connection string mot workstationens **LAN-IP** och port **5432**, databasnamn = `POSTGRES_DB` (standard `clanker_discord`). **discord-hub-api:** `DATABASE_URL`. **Discord-bot** med Compose-profil **`discord-host`** (`network_mode: host`): sätt **`DISCORD_BOT_HOST_DATABASE_URL`** i rotens `.env` till den URL:en — standard **`127.0.0.1`** i Compose gäller bara när Postgres körs på **samma** maskin som boten. Kör du boten med **npm** på Pi: `DATABASE_URL` i `bots/discord-bot/.env` mot samma URL. Specialtecken i lösenord måste **URL-kodas** i connection string (t.ex. `!` → `%21`).
6. Två databaser på samma server: **samma** host/port men olika path (`…/clanker_discord` och `…/clanker_devtools` eller dina `POSTGRES_DB` / `POSTGRES_EXTRA_DB`). Starta **inte** profilen **`db`** på Pi — då får du en **tom lokal** Postgres i stället för workstationens data.

**Utan att exponera Postgres mot LAN:** kör Postgres på workstation med standard **127.0.0.1** och öppna en **SSH-tunnel** från Pi (`ssh -L 5432:127.0.0.1:5432 användare@workstation`). Sätt då `DATABASE_URL` mot **`127.0.0.1:5432`** på Pi-sidan.

## Miljövariabler (`.env`)

Kopiera `.env.example` → `.env` och justera. För Docker är bland annat detta relevant:

- `DISCORD_HUB_WEB_PORT`, `DEV_TOOLS_WEB_PORT` — vilken port på **värden** som mappas till nginx i containern.
- Caddy (profil `caddy`): `CADDY_HTTP_PORT`, prod- och dev-värdnamn/upstreams, `CLANKER_PIHOLE_HOST`, `CLANKER_PIHOLE_UPSTREAM` (ska matcha Pi-holes `WEB_PORT`) — se [Caddy](#caddy-reverse-proxy).
- Postgres: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_EXTRA_DB` (andra databasen vid **ny** volym; standard `clanker_devtools`), `POSTGRES_PORT`, `POSTGRES_BIND_ADDRESS` (när du använder profilen `db`).
- Pi-hole läser `env_file: .env` — se Pi-hole-dokumentation och repots egna guider under `pihole/`.

## Caddy (reverse proxy)

Valfri tjänst **`clanker-caddy`** (`caddy:2-alpine`) läser [infra/caddy/Caddyfile](../infra/caddy/Caddyfile) och routar HTTP utifrån **Host**-header. Containern har `extra_hosts: host.docker.internal:host-gateway` så proxyn kan nå **värdmaskinen** (Pi-holes webb-UI och Vite).

### Standardvärdnamn (överskrivs i `.env`)

| Värdnamn | Mål |
|----------|-----|
| `clanker.discord` | Prod discord-hub → `discord-hub-web:80` |
| `clanker.tools` | Prod dev-tools-web → `dev-tools-web:80` |
| `clanker.pihole` | Pi-hole admin → `CLANKER_PIHOLE_UPSTREAM` (standard `http://host.docker.internal:8080`) |
| `dev.clanker.discord` | Vite discord-hub på värden (port **5173**) |
| `dev.clanker.tools` | Vite dev-tools-web på värden (port **5174**) |

Om du ändrar Pi-holes **`WEB_PORT`** / **`FTLCONF_webserver_port`** i `.env`, sätt **`CLANKER_PIHOLE_UPSTREAM`** till samma port (t.ex. `http://host.docker.internal:9090`).

### DNS eller hosts

Alla namn du använder måste peka på **den adress där Caddy lyssnar** (Pi:ns IP i LAN, eller `127.0.0.1` om du SSH-/port-forwardar värdens port 80 till din laptop).

Exempel (en rad):

```text
127.0.0.1  clanker.discord  clanker.tools  clanker.pihole  dev.clanker.discord  dev.clanker.tools
```

### Start

`docker compose --profile discord --profile devtools --profile caddy up -d --build`, eller lägg `caddy` i `COMPOSE_PROFILES`. Du kan även starta bara `clanker-caddy` om du bara vill proxyn (t.ex. `clanker.pihole`) — prod-namn ger då **502** tills webbcontainrarna körs.

### Övrigt

- **4173 och 4174** — oförändrat direkt till nginx i containrarna.
- **Endast HTTP:** [Caddyfile](../infra/caddy/Caddyfile) använder `http://` så Caddy inte aktiverar HTTPS mot **443** (inte mappad i Compose). HTTPS kan läggas framför eller i Caddy senare.
- **Begränsning:** `dev.clanker.*` förutsätter att **Vite kör på samma värd som Docker** (`npm run dev:all` eller båda `npm run dev` och `npm run dev:tools` på Pi:en). Kör du Vite bara på en annan maskin utan motsvarande nätverksväg når inte Caddy på Pi den processen.
- **Grå sida på `dev.clanker.*`:** du laddar HTML på port **80**, men Vite försöker annars koppla HMR-WebSocket mot **5173/5174** (som inte går via Caddy). Lägg **`VITE_HMR_CLIENT_PORT=80`** i **repots rot-**`.env` och **starta om** Vite. (`vite.config` använder `loadEnv` mot roten så värdet plockas upp — `process.env` i config-filen läser inte `.env` automatiskt.) Lämna variabeln borttagen om du bara använder `http://localhost:5173` / `:5174`.

## Kolla status

Här ser du om Clanker-tjänsterna (eller andra containrar) **kör**, vilka **portar** som exponeras, och om **Docker** svarar.

### Bara detta repo (Compose-projektet)

Stå i **repots rot** så Compose känner igen `docker-compose.yml` och rätt projektnamn.

```bash
cd ~/apps/Clanker
docker compose ps
```

- **Kolumnen `STATE` / `STATUS`** visar om containern kör (t.ex. `running`) eller är stoppad (`exited`).
- **Portar** visas som `0.0.0.0:4173->80/tcp` (värdport → containerport) för webbapparna.

Visa även **stoppade** containrar som tillhör projektet:

```bash
docker compose ps -a
```

### Allt som kör på maskinen (`docker ps`)

Oberoende av katalog — listar **alla** containrar Docker känner till:

```bash
docker ps              # bara körande
docker ps -a           # körande + stoppade
```

Filtrera på namn (matchar delsträng i namnet):

```bash
docker ps -a --filter "name=discord-hub-web"
docker ps -a --filter "name=clanker"
```

Containrar i detta repo har ofta namnen `discord-hub-web`, `dev-tools-web`, `clanker-db`, `clanker-pihole` (samma som i Compose).

### Lever Docker-daemonen?

```bash
docker info
```

Om kommandot svarar med info (version, images, …) kör daemonen. Vid fel: t.ex. `sudo systemctl status docker` på Raspberry Pi / Linux med systemd.

### CPU/minne i realtid

```bash
docker stats
```

Visar resursanvändning per **körande** container; avsluta med `Ctrl+C`.

### Processer inuti projektets containrar

```bash
cd ~/apps/Clanker
docker compose top
```

## Grundläggande Compose-kommandon

### `docker compose up`

Skapar och startar containrar enligt `docker-compose.yml`.

| Flagga / form | Betydelse |
|---------------|-----------|
| `-d` | *Detached* — körs i bakgrunden (daemon). |
| `--build` | Bygger om images innan start (bra efter kodändringar i Dockerfile). |
| `--profile <namn>` | Aktiverar en profil; kan upprepas för flera. |

**Exempel — bara discord-hub:**

```bash
docker compose --profile discord up -d --build
```

**Exempel — båda webbapparna:**

```bash
docker compose --profile discord --profile devtools up -d --build
```

**Exempel — båda webbapparna + Caddy** (port 80: prod, Pi-hole-admin, `dev.clanker.*` — se [Caddy](#caddy-reverse-proxy)):

```bash
docker compose --profile discord --profile devtools --profile caddy up -d --build
```

**Exempel — webb + Postgres (t.ex. när API:t ska använda DB):**

```bash
docker compose --profile discord --profile devtools --profile db up -d --build
```

**Exempel — bara Pi-hole (om inget annat ska med):**

```bash
docker compose --profile pihole up -d clanker-pihole
```

*(Om du redan har andra tjänster igång påverkas de inte om du bara anger en tjänst — Compose startar/uppdaterar det du ber om.)*

**Raspberry Pi — bara Pi-hole + discord-bot på disk:** vanlig `.gitignore` under `apps/*` **tar inte bort** redan **sparade** filer vid `git pull`; den styr bara ospårade filer. För att **inte** checka ut webbappar/API/packages på Pi:n, använd **sparse checkout**:

- Befintlig clone: [`scripts/git-sparse-checkout-pi-bot-pihole.sh`](../scripts/git-sparse-checkout-pi-bot-pihole.sh) (kör med `-y` efter att du sparat ocommittat arbete). Då finns i arbetskatalogen bara `docker-compose.yml`, `.env.example`, `bots/discord-bot/` och själva skriptet.
- Discord-bot: `cd bots/discord-bot && npm install && npm run build && npm run start` (monoreporotens `npm install` behövs inte; workspaces under `apps/` finns inte i sparse-trädet).
- Ny sparse clone (exempel): `git clone --filter=blob:none --sparse <url> Clanker && cd Clanker && git sparse-checkout set docker-compose.yml .env.example .gitignore bots/discord-bot/ scripts/git-sparse-checkout-pi-bot-pihole.sh`

Ångra: `git sparse-checkout disable` (återställer full arbetskatalog från nästa `git checkout` / `git pull`).

### `docker compose down`

Stoppar och **tar bort** containrar som skapats av detta projekt. **Volymen** `clanker-pgdata` tas inte bort i standardfallet (databasdata finns kvar).

```bash
docker compose down
```

Vill du även ta bort volymer kopplade till projektet (⚠️ kan radera databasdata):

```bash
docker compose down -v
```

Använd `-v` bara när du medvetet vill nollställa.

### `docker compose ps`

Samma som i avsnittet [Kolla status](#kolla-status) ovan — kör från repots rot.

```bash
docker compose ps
docker compose ps -a
```

### `docker compose logs`

Följer eller visar loggar.

```bash
docker compose logs -f                    # alla tjänster, följer
docker compose logs -f discord-hub-web     # en tjänst
docker compose logs --tail=100 dev-tools-web
docker compose logs -f clanker-caddy       # reverse proxy (när profilen caddy är aktiv)
```

### `docker compose pull`

Hämtar nyare **images** där `image: ...` används (t.ex. `postgres:16-alpine`, `pihole/pihole`). Påverkar inte lokalt **byggda** webbimages (`build:`).

```bash
docker compose pull
docker compose pull clanker-db clanker-pihole
```

### `docker compose build`

Bygger images utan att starta containrar.

```bash
docker compose build
docker compose build discord-hub-web dev-tools-web
```

### `docker compose restart`

Startar om redan skapade containrar (snabbt om du bara vill ladda om processen).

```bash
docker compose restart discord-hub-web
```

### `docker compose stop` / `start`

`stop` stoppar utan att ta bort containrar; `start` startar dem igen.

```bash
docker compose stop dev-tools-web
docker compose start dev-tools-web
```

## Bygga en webb-image manuellt (utan Compose)

Ibland vill du bara verifiera att en Dockerfile bygger:

```bash
docker build -f apps/discord-hub-web/Dockerfile . -t clanker-discord-hub:local
docker build -f apps/dev-tools-web/Dockerfile . -t clanker-dev-tools:local
```

Context är alltid **`.`** (roten) så monorepot och `package-lock.json` följer med.

## `docker compose` vs `docker-compose`

- **Rekommenderat:** `docker compose` (plugin till Docker CLI, V2).
- Äldre fristående binären: `docker-compose` (med bindestreck). Samma idé, annat kommando.

Om `docker compose` saknas: installera Docker Compose-plugin enligt din distros/Docker-dokumentation.

## Felsökning

### `failed to resolve registry-1.docker.io` / `127.0.0.1:53: connection refused`

Gäller **både** `docker pull`, **`docker compose up --build`** och när BuildKit hämtar basimages (`node:…`, `nginx:…`, `postgres:…`). Ofta pekar värdens DNS mot **127.0.0.1:53** (Pi-hole). Om inget svarar där faller uppslagningen av `registry-1.docker.io`.

**Varför hjälper ibland inte `daemon.json` → `"dns"`?**  
Den inställningen styr främst **DNS för körande containrar**. Vid **`docker build`** (BuildKit) används ofta **värdens** resolver (`/etc/resolv.conf`) för att nå Docker Hub — då spelar det ingen roll att du satte `1.1.1.1` i `daemon.json`; felet kan vara kvar på `127.0.0.1:53`.

Kolla vad värdens använder:

```bash
cat /etc/resolv.conf
```

**Åtgärder (välj det som passar din Pi):**

1. **Starta Pi-hole först** så att `127.0.0.1:53` faktiskt svarar, sedan `docker compose … up -d --build` igen.
2. **Byt tillfälligt värd-DNS** bort från en död `127.0.0.1` — exakt metod beror på om du kör **dhcpcd**, **NetworkManager** eller **systemd-resolved** (Bookworm kan använda `127.0.0.53` mot resolved). Målet är att `resolv.conf` pekar på t.ex. `1.1.1.1` eller routern **medan** du bygger images.
3. **`daemon.json` + `"dns"`** kan ändå hjälpa för **körda** containrar; behåll gärna inställningen om du slog ihop med befintlig JSON. Starta om Docker efter ändring: `sudo systemctl restart docker`.
4. **Diagnostik:** prova äldre byggmotor (använder ibland annan DNS-väg):  
   `DOCKER_BUILDKIT=0 docker compose --profile discord --profile devtools build`  
   (sedan `up -d` utan `--build` om images redan finns.)
5. **Postgres:** utelämna `--profile db` tills DNS är löst om du bara behöver webb/Pi-hole.

## Vanliga frågor

**Hur startar jag allt, och var finns det dokumenterat?**  
Använd avsnittet [Starta alla tjänster (Docker)](#starta-alla-tjänster-docker) (snabbstart **utan** Postgres först) och [Fuskblad](#fuskblad-vad-är-vad-portar) i denna fil (`docs/docker.md`).

**Varför startar inte discord när jag kör `docker compose up -d`?**  
Troligen saknas profilen `discord`. Kör med `--profile discord` (eller sätt `COMPOSE_PROFILES=discord` i `.env` / shell).

**Kan jag köra båda webbapparna samtidigt?**  
Ja: `docker compose --profile discord --profile devtools up -d`. De lyssnar på olika värdportar (standard 4173 och 4174).

**Var hamnar databasfilerna?**  
I Docker-volymen `clanker-pgdata` (namn brukar prefixas med projektnamn — kolla med `docker volume ls`).

**Pi-hole och portar**  
Med `network_mode: host` exponeras Pi-hole enligt Pi-holes egen konfiguration på värden — inte via `ports:` i Compose på samma sätt som webbcontainrarna.

## Se även

- Rot-`README.md` — översikt och checklista för ny installation.
- `apps/discord-hub-web/README.md`, `apps/dev-tools-web/README.md` — apptspecifika portar och utveckling.
- `pihole/` — guider kring Pi-hole i detta repo.
