import { useState } from "react";
import { Eye, EyeOff, Key, Sparkles, AlertTriangle, ExternalLink } from "lucide-react";
import { type Settings, hasApiKey } from "@/lib/storage";

export default function SettingsView({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (next: Settings) => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const ready = hasApiKey(settings);

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
