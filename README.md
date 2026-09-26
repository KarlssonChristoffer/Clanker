# Clanker

Homeserver-repo fÃ¶r Raspberry Pi (Clanker) â€” skript, anteckningar och tjÃ¤nster som Pi-hole.

- **Remote:** [github.com/9914kach/Clanker](https://github.com/9914kach/Clanker)

## Struktur (vÃ¤xer efter behov)

| SÃ¶kvÃ¤g | InnehÃ¥ll |
| ------ | -------- |
| `apps/discord-hub-web/` | Frontend fÃ¶r **discord-hubben** (Vite + React + TS, Tailwind + shadcn + Motion) â€” se `apps/discord-hub-web/README.md` |
| `apps/discord-hub-api/` | Backend fÃ¶r samma hub â€” se `apps/discord-hub-api/README.md` |
| `bots/discord-bot/` | **Clanker-boten** (Discord: musik, Jev, WoW, setup, citat) — se `bots/discord-bot/README.md`. Drift på tincan: `scripts/migrate-to-tincan.md`, testlista: `TESTPLAN.md` |
| `docs/discord-hub.md` | Samlad **discord-hub**-översikt (arkitektur, dev, portar, env) |
| `apps/dev-tools-web/` | **Lokala dev-verktyg** (dokumentationsviewer m.m., separat frÃ¥n discord-hub; samma UI-grund som discord-hub) â€” **start:** se [apps/dev-tools-web/README.md](apps/dev-tools-web/README.md) (`npm run dev:tools`, eller `npm run dev:all` tillsammans med discord-hub; Docker-profil `devtools`) |
| `packages/ui/` | Delat **`@clanker/ui`** â€” shadcn/ui-primitives som bÃ¥da webapparna importerar |
| `.agents/skills/shadcn/` | **AI-skill** fÃ¶r shadcn/ui (mÃ¶nster, CLI, theming) â€” installerad enligt [Skills (shadcn/ui)](https://ui.shadcn.com/docs/skills); uppdatera med `npx skills add shadcn/ui -y`. Roten har `skills-lock.json` som lÃ¥ser kÃ¤llan. |
| `experiments/` | Isolerade fÃ¶rsÃ¶k och engÃ¥ngsskript |
| `pihole/` | Dokumentation och skript fÃ¶r Pi-hole (sjÃ¤lva Compose-filen ligger i repots rot) |
| `docs/homelab-todo.md` | Backlog / TODO fÃ¶r homelab (VM, domÃ¤n, osv.) |
| `docs/homelab-network-rundown.md` | Sammanfattning av nuvarande nÃ¤tverk: Pi-hole, DNS/DHCP, portar, Caddy och trafikflÃ¶den |
| `docs/docker.md` | **Docker Compose** â€” vanliga kommandon, profiler och exempel fÃ¶r Clanker |
| `infra/caddy/` | Valfri **Caddy**-reverse proxy (HTTP, profil `caddy`) â€” detaljer i [docs/docker.md](docs/docker.md#caddy-reverse-proxy) |

En framtida **server-/homelab-dashboard** kan fÃ¥ egna mappar, t.ex. `apps/clanker-hub-web` / `apps/clanker-hub-api`, och en egen Compose-profil â€” sÃ¥ den inte blandas ihop med discord-hubben.

## Docker Compose: var du kÃ¶r ifrÃ¥n

**Alla `docker compose`-kommandon kÃ¶rs frÃ¥n repots rot** (mappen dÃ¤r denna `README.md` och `docker-compose.yml` ligger). DÃ¥ pekar volymsÃ¶kvÃ¤gar som `./etc-pihole` och `./etc-dnsmasq.d` rÃ¤tt. FÃ¶r ett kommando som alltid anvÃ¤nder rÃ¤tt katalog: **`scripts/clanker`** (dispatcher: `help`, `run`, `kill`, `up`, `stop`, `down`, `compose`, `ps`, `doctor`, **`dev`**) â€” valfritt symlink `clanker` i `PATH`; valfritt **tab completion** via `scripts/clanker-completion.bash` (se [docs/docker.md](docs/docker.md)). **`clanker dev discord`** / **`clanker dev devtools`** kÃ¶r fÃ¶rst **`clanker up`** fÃ¶r samma profil, sedan Vite fÃ¶r **en** app i fÃ¶rgrund (`--vite-only` bara Vite; tunna skript `scripts/clanker-dev-discord` / `clanker-dev-tools`); **`clanker run`** + **`CLANKER_VITE_DEV=1`** kÃ¶r i stÃ¤llet bÃ¥da via `dev:all` i bakgrunden. Du kan ocksÃ¥ kÃ¶ra `npm run dev` / `dev:tools` i roten utan `clanker`. Ã„ven `scripts/clanker-run` (`clanker.run`) och `scripts/clanker-kill` (`clanker.kill`) â€” **`clanker up`** och **`clanker-run`** lÃ¤gger alltid till Compose-profilen **caddy**; Ã¶vriga profiler via `COMPOSE_PROFILES` i `.env`. **`clanker compose`** vidarebefordrar rÃ¥ Compose utan att lÃ¤gga till caddy. **`clanker up` startar inte Vite**. **`clanker-kill`** kÃ¶r som standard **`docker compose down`** och stoppar dÃ¤rmed **Pi-hole**; utan sekundÃ¤r DNS i routern slutar DNS fÃ¶r klienter som bara pekar pÃ¥ Pi. Vill du bara stÃ¤nga webb/caddy/db men behÃ¥lla DNS, sÃ¤tt **`CLANKER_KILL_KEEP_PIHOLE=1`** i `.env` (se [docs/docker.md](docs/docker.md)). Undermappar som `pihole/` innehÃ¥ller guider och hjÃ¤lpskript â€” inte en egen compose-fil. FÃ¤rdiga exempel och kommandoÃ¶versikt: [docs/docker.md](docs/docker.md).

NÃ¤r du lÃ¤gger till fler tjÃ¤nster kan varje app fÃ¥ en egen undermapp (`pihole/`, `din-webbapp/`, â€¦) med dokumentation, medan antingen (a) en gemensam `docker-compose.yml` i roten vÃ¤xer, eller (b) varje tjÃ¤nst har `docker-compose.yml` i sin mapp och du kÃ¶r `docker compose -f <mapp>/docker-compose.yml` frÃ¥n rot med korrekta volymsÃ¶kvÃ¤gar â€” spika ett mÃ¶nster per tjÃ¤nst och skriv det i respektive README.

## Ny Pi eller ren installation (kort checklista)

1. Installera Docker (och Compose-plugin) pÃ¥ Pi.
2. `git clone` detta repo till t.ex. `~/apps/Clanker` och `cd` dit.
3. Kopiera `.env.example` till `.env` och justera vÃ¤rden (inga hemligheter i git).
4. `docker compose pull` och `docker compose up -d`.
5. Ã…terstÃ¤ll **persistent data** om du har backup (t.ex. `etc-pihole/`) â€” compose skapar containrar, inte nÃ¶dvÃ¤ndigtvis all historik.

## Krav

Beror pÃ¥ respektive del; dokumentera modell av Pi, OS-version och ev. Python/venv i varje undermapp nÃ¤r det spelar roll.