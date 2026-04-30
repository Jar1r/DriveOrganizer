// User settings persisted to localStorage.
// API keys live in localStorage — fine for a local-first PWA. The user is the
// only one with access to their browser's localStorage, and we never send the
// key anywhere except the LLM provider they configured.

export type AIProvider = "anthropic" | "openai";

export type Settings = {
  aiProvider: AIProvider;
  anthropicKey: string;
  openaiKey: string;
  anthropicModel: string;
  openaiModel: string;
  aiRenameEnabled: boolean;
  // Daily soft-cap on AI spend (USD). When enabled, the app refuses AI calls
  // that would push today's tally above this number. The user can reset the
  // tally or raise the cap whenever they want.
  dailyCapEnabled: boolean;
  dailyCapUsd: number;
};

const KEY = "drive-organizer:settings:v1";

export const DEFAULT_SETTINGS: Settings = {
  aiProvider: "anthropic",
  anthropicKey: "",
  openaiKey: "",
  anthropicModel: "claude-haiku-4-5-20251001",
  openaiModel: "gpt-4o-mini",
  aiRenameEnabled: false,
  dailyCapEnabled: true,
  dailyCapUsd: 0.5,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(settings));
}

export function hasApiKey(settings: Settings): boolean {
  if (settings.aiProvider === "anthropic") return settings.anthropicKey.trim().length > 0;
  return settings.openaiKey.trim().length > 0;
}

export function getActiveKey(settings: Settings): string {
  return settings.aiProvider === "anthropic" ? settings.anthropicKey.trim() : settings.openaiKey.trim();
}

export function getActiveModel(settings: Settings): string {
  return settings.aiProvider === "anthropic" ? settings.anthropicModel : settings.openaiModel;
}
