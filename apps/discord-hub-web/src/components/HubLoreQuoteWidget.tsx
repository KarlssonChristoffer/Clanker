import { useEffect, useMemo, useState } from "react";
import { Badge } from "@clanker/ui/components/badge";
import { Button } from "@clanker/ui/components/button";
import { cn } from "@clanker/ui/lib/utils";
import { useHubAudio } from "@/components/HubAudioProvider";
import { useHubToasts } from "@/components/HubToastProvider";
import { useHubLocale } from "@/components/locale-provider";
import type { HubLocale } from "@/i18n/hub-copy";
import { apiUrl } from "@/config";

const HUB_GUILD_ID = import.meta.env.VITE_DISCORD_HUB_GUILD_ID?.trim() ?? "";

type LoreQuote = {
  speaker: string;
  quote: string;
};

const LORE_QUOTES: Record<HubLocale, readonly LoreQuote[]> = {
  sv: [
    { speaker: "Neutralen OS", quote: "Inga garantier. Bara vibbar." },
    { speaker: "Någon i voice", quote: "Säg bara att du är här så löser sig resten." },
    { speaker: "Dashboarden", quote: "Det är inte en bugg. Det är en feature med aura." },
    { speaker: "Okänd sysadmin", quote: "Om det funkar: rör det inte. Om det inte funkar: byt palett." },
    { speaker: "Skalet", quote: "80% personlighet. 20% disciplin. 0% ånger." },
  ],
  en: [
    { speaker: "Neutralen OS", quote: "No promises. Only vibes." },
    { speaker: "Someone in voice", quote: "Just say you’re here and the rest solves itself." },
    { speaker: "The dashboard", quote: "Not a bug. A feature with aura." },
    { speaker: "Unknown sysadmin", quote: "If it works: don’t touch it. If it doesn’t: change palette." },
    { speaker: "The shell", quote: "80% personality. 20% discipline. 0% remorse." },
  ],
};

function localDateKey(now: Date) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function hashSeed(input: string) {
  let seed = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    seed ^= input.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
}

type QuoteBookResponse = { available?: boolean; quotes?: { content: string; author_name: string }[] };

/** Quotes saved with 💬 in Discord (bot.quotes via hub-api); null until loaded or when unavailable. */
function useQuoteBook(): LoreQuote[] | null {
  const [quotes, setQuotes] = useState<LoreQuote[] | null>(null);
  useEffect(() => {
    if (!HUB_GUILD_ID) return;
    const ac = new AbortController();
    fetch(apiUrl(`/api/bot/guild/${encodeURIComponent(HUB_GUILD_ID)}/quotes?limit=50`), {
      credentials: "include",
      signal: ac.signal,
    })
      .then((res) => (res.ok ? (res.json() as Promise<QuoteBookResponse>) : null))
      .then((json) => {
        if (json?.available && json.quotes?.length) {
          setQuotes(json.quotes.map((q) => ({ speaker: q.author_name, quote: q.content })));
        }
      })
      .catch(() => undefined);
    return () => ac.abort();
  }, []);
  return quotes;
}

function pickLoreQuote(quotes: readonly LoreQuote[], seed: number) {
  if (quotes.length === 0) {
    return { speaker: "Neutralen OS", quote: "…" };
  }
  return quotes[seed % quotes.length] ?? quotes[0]!;
}

export default function HubLoreQuoteWidget() {
  const { copy, locale } = useHubLocale();
  const d = copy.dashboard;
  const { play } = useHubAudio();
  const toasts = useHubToasts();
  const [shuffleSeed, setShuffleSeed] = useState(0);

  const dailySeed = useMemo(() => hashSeed(`${locale}:${localDateKey(new Date())}`), [locale]);
  const bookQuotes = useQuoteBook();
  const quotes = bookQuotes ?? LORE_QUOTES[locale];
  const quote = useMemo(() => pickLoreQuote(quotes, dailySeed + shuffleSeed), [dailySeed, quotes, shuffleSeed]);

  const quotedLine = `“${quote.quote}” — ${quote.speaker}`;

  const copyToClipboard = () => {
    void navigator.clipboard.writeText(quotedLine).then(
      () => {
        play("confirm");
        toasts.push({
          kind: "success",
          title: d.loreQuoteToastTitle,
          message: d.loreQuoteToastMessage(quote.speaker),
        });
      },
      () => {
        toasts.push({
          kind: "error",
          title: copy.actions.toasts.clipboardBlocked,
          message: copy.actions.toasts.clipboardBlockedMessage,
        });
      },
    );
  };

  return (
    <div className="flex flex-col gap-3 text-sm text-muted-foreground">
      <p className="hub-blurb">{d.loreQuoteBlurb}</p>

      <div className="relative overflow-hidden rounded-xl border border-border/60 bg-background/60 p-3">
        <div
          className={cn(
            "pointer-events-none absolute inset-0 opacity-70",
            "bg-[radial-gradient(circle_at_top_left,color-mix(in_oklab,var(--primary)_10%,transparent),transparent_55%),radial-gradient(circle_at_bottom_right,color-mix(in_oklab,var(--accent)_10%,transparent),transparent_55%)]",
          )}
          aria-hidden
        />
        <div className="relative">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{d.loreQuoteNowServingLabel}</p>
            <Badge variant="outline">{bookQuotes ? d.loreQuoteBookBadge : d.loreQuoteDailyBadge}</Badge>
          </div>

          <p className="mt-2 text-sm font-medium text-foreground">{quote.speaker}</p>

          <blockquote className="mt-2 rounded-lg border border-border/60 bg-background/70 p-3 text-foreground">
            <p className="text-sm leading-relaxed">“{quote.quote}”</p>
          </blockquote>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={copyToClipboard}>
          {d.loreQuoteCopy}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            play("panel");
            setShuffleSeed((prev) => prev + 1);
          }}
        >
          {d.loreQuoteShuffle}
        </Button>
      </div>
    </div>
  );
}

