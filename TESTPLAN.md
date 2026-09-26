# Testplan: Clanker-boten i Hermes

Manuell checklista. Ta ett steg i taget och bocka av. **Förväntat** beskriver vad som ska hända.
Automatiska tester körs med `npm test` (vitest). Den här listan täcker det som kräver riktiga Discord.

## 0. Förberedelser

- [ ] Developer Portal → Bot: *Server Members*, *Presence* och *Message Content* är påslagna.
- [ ] Boten är inbjuden till Hermes med behörighetslänken i [`bots/discord-bot/README.md`](bots/discord-bot/README.md).
- [ ] `.env` har `DISCORD_GUILD_ID=<Hermes>`, `SETUP_ALLOWED_GUILD_IDS=<Hermes>`, `WOW_FLAVOR=forever`,
      `BOT_HTTP_SECRET=<slumpad>`, `TYPESAFE_API_KEY=<nyckel>` (sektion 6 kräver den) och `LOG_LEVEL=debug` under testet.
- [ ] Boten startas (`npm run dev:discord-bot` på PC:n eller `discord-bot-host` på tincan). Bara **en** instans.

## 1. Start, hälsa och registrering

- [ ] Loggen visar `yt-dlp self-test ok`, migrationer 014–018 (`Applied` första gången), `slash commands registered`
      och `Discord client ready`. **Förväntat:** inga `error`-rader.
- [ ] `curl http://127.0.0.1:3012/health` → HTTP 200 och `{"discord":"ready","db":"ok","jev":"closed",…}`
      (`jev` visar `disabled` utan nyckel).
- [ ] Starta om boten. **Förväntat:** `slash commands unchanged; skipping registration`.
- [ ] `/ping` → ephemeral "Pong!" med gateway-latens.

## 2. Felhantering och nedstängning

- [ ] Stoppa Postgres en kort stund (`docker compose stop clanker-db`) och kör `/queue`.
      **Förväntat:** ett ephemeral svar med personlighet (t.ex. "💥 Något i maskinrummet small till…"). Loggen har en
      `interaction handler failed`-rad med `command`, `guildId`, `userId` och stacktrace. `/health` ger HTTP 503 med `"db":"fail"`.
- [ ] Starta Postgres igen. `/health` → 200.
- [ ] Spela musik (sektion 3) och stoppa sedan boten (`Ctrl+C` eller `docker compose stop discord-bot-host`).
      **Förväntat:** loggen visar `shutting down` → `shutdown complete`, boten lämnar röstkanalen och låten ligger kvar först i kön.

## 3. Musik och hubben

- [ ] Gå in i en röstkanal, kör `/play never gonna give you up`. **Förväntat:** ljud inom några sekunder.
- [ ] `/queue` visar låten. `/pause`, `/resume`, `/skip` och `/stop` fungerar.
- [ ] I hubben: musikkön visar samma sak, och *skip* från hubben fungerar (visar att `X-Clanker-Secret` stämmer).
- [ ] `curl -X POST http://127.0.0.1:3012/skip -d '{"guildId":"1"}'` utan header → **401**.

## 4. Feature-flaggor

- [ ] `/admin funktioner` → embed med alla funktioner och en meny. Välj *Musik* i menyn. **Förväntat:** embeden uppdateras, Musik ⛔.
- [ ] `/play test` → "🔌 **Musik** är avstängt här…". Slå på igen.
- [ ] En användare utan *Hantera server* ser inte `/admin` (eller får "🔒 …").

## 5. Schemaläggaren

- [ ] `/påminn tid:om 2 min text:testa schemaläggaren` → ephemeral bekräftelse med tid.
- [ ] Starta om boten inom de två minuterna. **Förväntat:** påminnelsen kommer ändå, i samma kanal, med ping.
- [ ] `/påminn tid:snart text:x` → svar med exempel på giltiga tider (ingen gissning).

## 6. Jev

- [ ] `/jevstats` → status 🟢, modell `jev-1.13.0`, räknare.
- [ ] `/orakel påstående:Pizza med ananas är gott` → "Oraklet säger: NN % ja" + stapel + replik.
- [ ] Skriv ett tiotal meddelanden i en kanal, kör `/vibe`. **Förväntat:** embed med sex staplar (▰▱), rubrik och säkerhet.
- [ ] `/tankeläsare`, tänk på "katt". **Förväntat:** frågor med Ja/Nej/Kanske/Vet inte och topp 5-staplar som ändras
      efter varje svar. Boten gissar när den är över 70 % säker eller efter 15 frågor. Någon annan som trycker får "🙅 Det här är inte ditt spel".
      (Direkt efter första start kan den svara att den "värmer upp". Matrisen räknas fram i bakgrunden, se loggen.)
- [ ] `/admin funktioner` → slå på *Jev-reflexer*. `/jev reflexer läge:på` i en textkanal.
      Skriv "HAHAHA det där var det roligaste jag hört 😂". **Förväntat:** Clanker reagerar (t.ex. 😂), högst en gång per minut och kanal.
- [ ] `/jev av`, skriv ett nytt roligt meddelande. **Förväntat:** ingen reaktion, och `/vibe` räknar inte med dig. `/jev på` återställer.
- [ ] Ta bort `TYPESAFE_API_KEY` och starta om. **Förväntat:** `/vibe` → "😴 Jev sover…", `/health` → `"jev":"disabled"`, inga fel i loggen.

## 7. /setup wow

- [ ] `/setup wow torrkörning:true` → embed med **Skapas / Flyttas / Arkiveras / Återanvänds / Onboarding**.
      Inget har ändrats i servern.
- [ ] `/setup wow`. **Förväntat:** kategorierna ℹ️ Info, ⚔️ WoW, 🎉 Socialt och 🔊 Röst skapas med kanalerna. #lfg är ett forum
      med taggarna Dungeon/Raid/PvP/Leveling/Övrigt. Rollerna är de 9 klasserna i klassfärg, @Tank/@Healer/@DPS (pingbara),
      @Raider/@Dungeons/@Casual. Övriga kanaler har flyttats till 📦 Arkiv och är skrivskyddade (inga raderade).
      #välkommen och #annonser är skrivskyddade för @everyone. Svaret har knappen **Ångra senaste setup**.
- [ ] Kör `/setup wow` igen. **Förväntat:** bara "Återanvänds" + rollväljare/onboarding, inga nya kanaler eller roller.
- [ ] Byt namn på #raid-anmälan och kör torrkörning. **Förväntat:** kanalen återanvänds (hittas via bindning).
- [ ] I #välkommen: välj klass, roll och intresse i menyerna. **Förväntat:** rollerna delas ut, ephemeral bekräftelse; avmarkering tar bort dem.
- [ ] Är Hermes en Community-server: Server Settings → Onboarding visar samma frågor.
- [ ] Tryck **Ångra senaste setup**. **Förväntat:** skapade kanaler utan innehåll och roller utan medlemmar tas bort, flyttade
      kanaler flyttas tillbaka och skrivskyddet återställs. Det som behölls listas.
- [ ] Kör `/setup wow` i en server som *inte* står i `SETUP_ALLOWED_GUILD_IDS`. **Förväntat:** "🚧 … jag rör ingenting."

## 8. Raid

- [ ] `/raid skapa titel:Molten Core tid:om 35 min`. **Förväntat:** en embed i #raid-anmälan med tid (Discord-timestamp),
      "🛡️ 0/4 tanks · 💚 0/10 heals · ⚔️ 0/26 DPS" (40 platser på Forever) och sex knappar. Ett Discord-event skapas
      (röstkanalen Raid). Svaret nämner pingen.
- [ ] Tryck Tank, sedan DPS. **Förväntat:** du flyttas mellan listorna och siffrorna uppdateras live.
- [ ] Efter cirka 5 minuter (30 min före start) **förväntas** "⏰ **Molten Core** börjar om 30 minuter!" med ping till alla anmälda utom bänken.
- [ ] Vid starttid: knapparna inaktiveras och foten visar "Anmälan stängd".
- [ ] `/raid avbryt id:<nr>` → embeden visar "(inställd)" och Discord-eventet tas bort.
- [ ] `/raid skapa titel:x tid:blabla` → felmeddelande med tidsexempel.

## 9. LFG i #lfg (forum)

- [ ] Nytt inlägg: "Deadmines ikväll kl 20:30, jag tankar, behöver healer och dps".
      **Förväntat:** ett gruppkort "🧭 Dungeon · söker 💚 1 Healer, ⚔️ 3 DPS" med knappar, "ikväll 20:30" och taggen *Dungeon*.
      (Siffrorna kommer från Jevs tolkning av vilka roller som redan finns. Säger inlägget att det finns en DPS blir det 2.)
- [ ] Fyra personer trycker Healer, DPS, DPS och DPS. **Förväntat:** kortet blir grönt, en röstkanal "🧭 Dungeon" skapas och alla pingas.
      När alla lämnat röstkanalen raderas den.
- [ ] Oklart inlägg: "någon som vill hitta på något?" **Förväntat:** "🤔 …, menade du **Dungeon**?" med knappar. Bara
      författaren kan svara, och *Inte LFG* får boten att backa.
- [ ] Utan Jev: bara inlägg med nyckelnivå hanteras (retail), övriga ignoreras tyst.

## 10. WoW-karaktärer (Forever = manuellt)

- [ ] `/wow koppla namn:Kalle` + välj ruleset i `realm` (autocomplete) + `klass:Mage`, `roll:dps`, `ilvl:62`.
      **Förväntat:** karaktärskort i klassfärg, "Manuellt inlagd".
- [ ] `/wow koppla namn:Kalle realm:Normal` utan klass → besked att klass krävs (inget API för Forever än).
- [ ] `/wow karaktär` och `/wow karaktär användare:@någon`.
- [ ] `/roster` → mains grupperade per roll, sorterade på item level.
- [ ] Anmäl dig till en raid: klassen syns bredvid namnet.

## 11. Röst: ➕ Skapa grupp

- [ ] Gå in i "➕ Skapa grupp". **Förväntat:** du flyttas till "🎮 <namn>s grupp" i samma kategori.
- [ ] Lämna. **Förväntat:** kanalen raderas direkt.
- [ ] Stäng av `join_to_create` i `/admin funktioner` → inget händer när man går in.

## 12. Citatboken

- [ ] Reagera med 💬 på någons meddelande. **Förväntat:** boten reagerar 📖. Ett andra 💬 på samma meddelande ger inget nytt citat.
- [ ] `/citat` → citatet med datum och länk. `/citat sök:<ord>` och `/citat från:@person` fungerar.
- [ ] Hubben: lore-widgeten visar citat "ur citatboken" (inbyggda citat om boken är tom).

## 13. Spelkväll

- [ ] `/spelkväll spel:Lethal Company tid:om 20 min` → embed med Kommer/Kanske/Nej.
- [ ] Svara Kommer. Efter cirka 5 minuter (15 min före) **förväntas** en ping till Kommer och Kanske.

## 14. Veckorapport och reset

- [ ] `/admin veckorapport-nu` → rapport i #annonser: röst-timmar, mest aktiva, veckans låt, veckans citat (vald av Jev)
      och en rubrik.
- [ ] Reset-inlägg: slå på *Reset-inlägg* och tvinga fram jobbet:
      `UPDATE bot.scheduled_jobs SET run_at = now() WHERE kind = 'wow-reset' AND status = 'pending';`
      **Förväntat:** inom 30 s kommer "🗓️ Ny vecka!" i #annonser, och ett nytt jobb ligger kvar för nästa vecka.

## 15. Hubben: livevy utan egen gateway

- [ ] Dashboardens röst-widget visar vilka som är i röst och badgen "ansluten".
- [ ] Stoppa boten. **Förväntat:** inom cirka 90 s visar badgen frånkopplad med en förklaring. hub-api loggar inga gateway-fel
      (hub-api har ingen egen gateway längre).
