import { useState } from "react";
import {
  Eye,
  EyeOff,
  Key,
  Sparkles,
  AlertTriangle,
  ExternalLink,
  RotateCcw,
  Wallet,
} from "lucide-react";
import { type Settings, hasApiKey } from "@/lib/storage";
import {
  formatUsd,
  resetUsage,
  type UsageRecord,
} from "@/lib/usage";

const CAP_PRESETS = [0.1, 0.5, 2, 10];

export default function SettingsView({
  settings,
  onChange,
  usage,
  onUsageReset,
}: {
  settings: Settings;
  onChange: (next: Settings) => void;
  usage: UsageRecord;
  onUsageReset: (next: UsageRecord) => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const [capDraft, setCapDraft] = useState(settings.dailyCapUsd.toString());
  const ready = hasApiKey(settings);
  const remaining = Math.max(0, settings.dailyCapUsd - usage.spentUsd);
  const usagePct = settings.dailyCapUsd > 0 ? Math.min(100, (usage.spentUsd / settings.dailyCapUsd) * 100) : 0;
  const overLimit = settings.dailyCapEnabled && remaining <= 0;

  const commitCap = (value: number) => {
    if (Number.isFinite(value) && value > 0 && value <= 1000) {
      onChange({ ...settings, dailyCapUsd: value });
      setCapDraft(value.toString());
    } else {
      setCapDraft(settings.dailyCapUsd.toString());
    }
  };

  return (
    <div className="max-w-xl space-y-8">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-fuchsia-400" />
          AI rename
        </h2>
        <p className="mt-2 text-sm text-gray-400 leading-relaxed">
          Bring your own key. Calls go directly from your browser to the provider you pick &mdash;
          we have no backend and your key never leaves your machine except to that provider.
          Typical cost: $0.001 per file with a small model.
        </p>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-5">
        <div>
          <label className="text-xs font-medium text-gray-400 mb-2 block">Provider</label>
          <div className="grid grid-cols-2 gap-2">
            <ProviderButton
              active={settings.aiProvider === "anthropic"}
              onClick={() => onChange({ ...settings, aiProvider: "anthropic" })}
              label="Anthropic"
              hint="Claude"
            />
            <ProviderButton
              active={settings.aiProvider === "openai"}
              onClick={() => onChange({ ...settings, aiProvider: "openai" })}
              label="OpenAI"
              hint="GPT-4o-mini"
            />
          </div>
        </div>

        {settings.aiProvider === "anthropic" ? (
          <>
            <ApiKeyField
              label="Anthropic API key"
              value={settings.anthropicKey}
              showKey={showKey}
              setShowKey={setShowKey}
              onChange={(v) => onChange({ ...settings, anthropicKey: v })}
              placeholder="sk-ant-…"
              docsHref="https://console.anthropic.com/settings/keys"
              docsLabel="Get an Anthropic key"
            />
            <ModelField
              label="Model"
              value={settings.anthropicModel}
              onChange={(v) => onChange({ ...settings, anthropicModel: v })}
              suggestions={[
                "claude-haiku-4-5-20251001",
                "claude-sonnet-4-6",
                "claude-opus-4-7",
              ]}
            />
          </>
        ) : (
          <>
            <ApiKeyField
              label="OpenAI API key"
              value={settings.openaiKey}
              showKey={showKey}
              setShowKey={setShowKey}
              onChange={(v) => onChange({ ...settings, openaiKey: v })}
              placeholder="sk-…"
              docsHref="https://platform.openai.com/api-keys"
              docsLabel="Get an OpenAI key"
            />
            <ModelField
              label="Model"
              value={settings.openaiModel}
              onChange={(v) => onChange({ ...settings, openaiModel: v })}
              suggestions={["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"]}
            />
          </>
        )}

        <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 text-xs text-amber-200/90">
          <AlertTriangle className="w-3.5 h-3.5 flex-none mt-0.5" />
          <span>
            The key is stored in <code className="text-amber-200">localStorage</code> on this
            device. Anyone with access to this browser profile can read it. For high-security
            machines, paste it only when you need it and clear after.
          </span>
        </div>

        <div
          className={`flex items-center gap-2 text-xs ${
            ready ? "text-emerald-300" : "text-gray-500"
          }`}
        >
          <Key className="w-3.5 h-3.5" />
          {ready ? "Ready to use AI rename." : "Add a key above to enable AI rename."}
        </div>
      </div>

      {/* Daily spend cap */}
      <div>
        <h2 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Wallet className="w-5 h-5 text-amber-400" />
          Daily spend cap
        </h2>
        <p className="mt-2 text-sm text-gray-400 leading-relaxed">
          Soft limit on AI rename spend per day. When you hit it, AI rename refuses
          new calls until you reset the day&rsquo;s tally or raise the cap. The cap is enforced
          locally &mdash; the actual money still lives at your provider account.
        </p>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-5">
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-sm font-medium text-gray-200">Enable daily cap</span>
          <span className="relative inline-flex">
            <input
              type="checkbox"
              checked={settings.dailyCapEnabled}
              onChange={(e) => onChange({ ...settings, dailyCapEnabled: e.target.checked })}
              className="sr-only peer"
            />
            <span className="w-10 h-6 bg-white/[0.08] rounded-full peer-checked:bg-amber-500/60 transition-colors duration-200" />
            <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform duration-200 peer-checked:translate-x-4" />
          </span>
        </label>

        {settings.dailyCapEnabled && (
          <>
            <div>
              <label className="text-xs font-medium text-gray-400 mb-2 block">
                Cap amount (USD)
              </label>
              <div className="flex items-center gap-2">
                <span className="text-gray-400 text-sm">$</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  max="1000"
                  value={capDraft}
                  onChange={(e) => setCapDraft(e.target.value)}
                  onBlur={() => commitCap(parseFloat(capDraft))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  className="w-32 px-3 py-2 bg-[#0e1729] border border-white/10 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-amber-500/40 transition-colors duration-150 font-mono"
                />
                <span className="text-xs text-gray-500">per day</span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-gray-500 mr-1">Quick set:</span>
                {CAP_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    onClick={() => commitCap(preset)}
                    className={`text-xs px-2.5 py-1 rounded-md border transition-colors duration-150 cursor-pointer ${
                      settings.dailyCapUsd === preset
                        ? "bg-amber-500/15 border-amber-500/40 text-amber-100"
                        : "bg-white/[0.02] border-white/10 text-gray-300 hover:bg-white/[0.04]"
                    }`}
                  >
                    {formatUsd(preset)}
                  </button>
                ))}
              </div>
            </div>

            {/* Today's usage */}
            <div className="rounded-lg border border-white/[0.06] bg-[#0e1729]/60 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400 uppercase tracking-wider">
                  Today &middot; {usage.date}
                </span>
                <span className={`text-xs font-mono ${overLimit ? "text-amber-300" : "text-gray-300"}`}>
                  {formatUsd(usage.spentUsd)} / {formatUsd(settings.dailyCapUsd)}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-white/[0.04] overflow-hidden">
                <div
                  className={`h-full transition-[width] duration-300 ${
                    overLimit ? "bg-amber-400" : "bg-emerald-400"
                  }`}
                  style={{ width: `${usagePct}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>
                  {usage.calls} AI call{usage.calls === 1 ? "" : "s"} ·{" "}
                  {(usage.inputTokens + usage.outputTokens).toLocaleString()} tokens
                </span>
                <span className={overLimit ? "text-amber-300 font-medium" : "text-gray-400"}>
                  {overLimit ? "Cap reached" : `${formatUsd(remaining)} left`}
                </span>
              </div>
              <button
                onClick={() => onUsageReset(resetUsage())}
                disabled={usage.spentUsd === 0}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-100 border border-amber-500/30 text-sm font-medium transition-colors duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {overLimit ? "Reset cap to keep using" : "Reset today's tally"}
              </button>
            </div>
          </>
        )}

        <div className="text-[11px] text-gray-500 leading-relaxed">
          Cap counts <em>this device only</em>. If you use AI rename on multiple devices with the
          same key, they each track independently. Prices come from a static table; if your
          provider raises rates the actual spend may differ slightly.
        </div>
      </div>

      {/* What gets sent */}
      <div className="text-xs text-gray-500 space-y-2">
        <div className="font-medium text-gray-400 uppercase tracking-wider text-[10px]">
          What gets sent
        </div>
        <p className="leading-relaxed">
          For each file: the filename, size, and modification date. For small text/code files
          (&lt; 64 KB) we also include the first 240 characters as context. Binary files (images,
          videos, etc.) get filename-only. We never send file <em>contents</em> for binary files,
          and we never persist anything server-side.
        </p>
      </div>
    </div>
  );
}

function ProviderButton({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-3 rounded-xl border text-sm font-medium tracking-tight transition-all duration-200 cursor-pointer text-left ${
        active
          ? "bg-fuchsia-500/15 border-fuchsia-500/40 text-fuchsia-100"
          : "bg-white/[0.02] border-white/10 text-gray-300 hover:bg-white/[0.04]"
      }`}
    >
      <div>{label}</div>
      <div className={`text-xs mt-0.5 ${active ? "text-fuchsia-300/80" : "text-gray-500"}`}>{hint}</div>
    </button>
  );
}

function ApiKeyField({
  label,
  value,
  showKey,
  setShowKey,
  onChange,
  placeholder,
  docsHref,
  docsLabel,
}: {
  label: string;
  value: string;
  showKey: boolean;
  setShowKey: (v: boolean) => void;
  onChange: (v: string) => void;
  placeholder: string;
  docsHref: string;
  docsLabel: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-medium text-gray-400">{label}</label>
        <a
          href={docsHref}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-sky-400 hover:text-sky-300 inline-flex items-center gap-1"
        >
          {docsLabel}
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
      <div className="relative">
        <input
          type={showKey ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2.5 pr-10 bg-[#0e1729] border border-white/10 rounded-lg text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-fuchsia-500/40 transition-colors duration-150 font-mono"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          onClick={() => setShowKey(!showKey)}
          className="absolute top-1/2 right-2 -translate-y-1/2 p-1.5 text-gray-500 hover:text-gray-300 transition-colors duration-150 cursor-pointer"
          aria-label={showKey ? "Hide key" : "Show key"}
          type="button"
        >
          {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

function ModelField({
  label,
  value,
  onChange,
  suggestions,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
}) {
  return (
    <div>
      <label className="text-xs font-medium text-gray-400 mb-2 block">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        list="model-suggestions"
        className="w-full px-3 py-2.5 bg-[#0e1729] border border-white/10 rounded-lg text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-fuchsia-500/40 transition-colors duration-150 font-mono"
      />
      <datalist id="model-suggestions">
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <div className="mt-1.5 text-[11px] text-gray-500">
        Suggested: {suggestions.join(" · ")}
      </div>
    </div>
  );
}
