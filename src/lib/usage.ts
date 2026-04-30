// Daily AI spend tracking, enforced client-side as a soft cap.
//
// What this is: a self-imposed budget for AI rename calls. The app counts
// tokens reported by the LLM provider, multiplies by a static price table,
// and totals it for the local day. When the user hits their cap, the app
// refuses further calls until the cap is raised or the day's tally is reset.
//
// What this isn't: real billing. The actual charges happen at the user's
// Anthropic/OpenAI account; we don't talk to billing APIs and we don't
// touch the user's money. The cap is purely a self-control feature, useful
// the same way "$15/day Uber budget" is useful in your own head.
//
// Honesty notes:
//  - Anyone with localStorage access can clear this counter. That's fine,
//    nobody's adversarial against themselves.
//  - Prices are hardcoded from public docs; they go stale if providers
//    change pricing. The UI says so.

import type { AIProvider } from "./storage";

// USD per million tokens. Update when providers change pricing.
// Sources: anthropic.com/pricing, openai.com/api/pricing (as of 2026).
const PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-opus-4-7": { input: 15.0, output: 75.0 },
  // OpenAI
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1": { input: 2.0, output: 8.0 },
};

const FALLBACK_PRICE = { input: 1.0, output: 5.0 }; // conservative if model unknown

export type UsageRecord = {
  date: string; // YYYY-MM-DD in local time
  spentUsd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
};

const KEY = "drive-organizer:usage:v1";

export function todayDateKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function emptyUsage(): UsageRecord {
  return { date: todayDateKey(), spentUsd: 0, calls: 0, inputTokens: 0, outputTokens: 0 };
}

export function loadUsage(): UsageRecord {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyUsage();
    const parsed = JSON.parse(raw) as UsageRecord;
    if (parsed.date !== todayDateKey()) {
      // Date rolled over — start fresh
      const fresh = emptyUsage();
      saveUsage(fresh);
      return fresh;
    }
    return parsed;
  } catch {
    return emptyUsage();
  }
}

export function saveUsage(usage: UsageRecord): void {
  localStorage.setItem(KEY, JSON.stringify(usage));
}

export function resetUsage(): UsageRecord {
  const fresh = emptyUsage();
  saveUsage(fresh);
  return fresh;
}

export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICING[model] ?? FALLBACK_PRICE;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

// Rough pre-flight estimate for the cap check.
// Prompt overhead: ~600 tokens system + ~50 per file overhead.
// Output: ~30 tokens per file (suggested name + category + reason).
export function estimateCost(
  model: string,
  fileCount: number,
  avgFilenameLen: number = 30
): number {
  const inputTokens = 600 + fileCount * (50 + Math.ceil(avgFilenameLen / 4));
  const outputTokens = fileCount * 30;
  return calculateCost(model, inputTokens, outputTokens);
}

export function addUsage(
  current: UsageRecord,
  model: string,
  inputTokens: number,
  outputTokens: number
): UsageRecord {
  // Roll over if date changed mid-session
  const today = todayDateKey();
  const base = current.date === today ? current : emptyUsage();
  const cost = calculateCost(model, inputTokens, outputTokens);
  const next: UsageRecord = {
    date: today,
    spentUsd: base.spentUsd + cost,
    calls: base.calls + 1,
    inputTokens: base.inputTokens + inputTokens,
    outputTokens: base.outputTokens + outputTokens,
  };
  saveUsage(next);
  return next;
}

export function formatUsd(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  if (n < 10) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(2)}`;
}

export function pricingForModel(model: string): { input: number; output: number; known: boolean } {
  const known = model in PRICING;
  const price = known ? PRICING[model] : FALLBACK_PRICE;
  return { ...price, known };
}

// Provider-specific note kept for future expansion
export function pricingHint(provider: AIProvider): string {
  if (provider === "anthropic") {
    return "Live prices: anthropic.com/pricing";
  }
  return "Live prices: openai.com/api/pricing";
}
