import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  FolderSearch,
  Loader2,
  Play,
  Sparkles,
  Trash2,
  Edit3,
} from "lucide-react";
import { ensureWritePermission, formatBytes } from "@/lib/fs";
import {
  findGenericFolders,
  deleteFolder,
  renameFolder,
  type GenericFolder,
} from "@/lib/folders";
import {
  renameFoldersWithAI,
  type AIFolderRenameSuggestion,
} from "@/lib/ai";
import { hasApiKey, getActiveModel, type Settings } from "@/lib/storage";
import { addUsage, estimateCost, formatUsd, type UsageRecord } from "@/lib/usage";
import { cn } from "@/lib/cn";

type Phase = "idle" | "scanning" | "ready" | "ai" | "applying" | "done";

type Plan = {
  folder: GenericFolder;
  action: "delete" | "rename" | "skip";
  newName: string; // user-editable
  aiSuggestion?: AIFolderRenameSuggestion;
};

export default function FoldersView({
  root,
  settings,
  usage,
  onUsageChange,
  onOpenSettings,
}: {
  root: FileSystemDirectoryHandle;
  settings: Settings;
  usage: UsageRecord;
  onUsageChange: (next: UsageRecord) => void;
  onOpenSettings: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [folders, setFolders] = useState<GenericFolder[]>([]);
  const [plans, setPlans] = useState<Map<string, Plan>>(new Map());
  const [scanProgress, setScanProgress] = useState(0);
  const [aiProgress, setAiProgress] = useState({ done: 0, total: 0 });
  const [applyProgress, setApplyProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{
    deleted: number;
    renamed: number;
    failed: { name: string; reason: string }[];
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const planArray = useMemo(() => Array.from(plans.values()), [plans]);
  const counts = useMemo(() => {
    let toDelete = 0;
    let toRename = 0;
    for (const p of planArray) {
      if (p.action === "delete") toDelete++;
      else if (p.action === "rename") toRename++;
    }
    return { toDelete, toRename, total: planArray.length };
  }, [planArray]);

  const handleScan = useCallback(async () => {
    setError(null);
    setResults(null);
    setFolders([]);
    setPlans(new Map());
    setPhase("scanning");
    abortRef.current = new AbortController();
    try {
      const found = await findGenericFolders(
        root,
        undefined,
        abortRef.current.signal,
        (n) => setScanProgress(n)
      );
      setFolders(found);

      // Default plan: empty → delete, non-empty → rename (current name as draft)
      const init = new Map<string, Plan>();
      for (const f of found) {
        const id = `${f.parentPath}/${f.name}`;
        init.set(id, {
          folder: f,
          action: f.isEmpty ? "delete" : "rename",
          newName: f.name,
        });
      }
      setPlans(init);
      setPhase("ready");
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        setPhase("idle");
      } else {
        setError(e instanceof Error ? e.message : "Scan failed");
        setPhase("idle");
      }
    }
  }, [root]);

  const handleCancel = useCallback(() => abortRef.current?.abort(), []);

  const updatePlan = useCallback((id: string, patch: Partial<Plan>) => {
    setPlans((prev) => {
      const next = new Map(prev);
      const cur = next.get(id);
      if (cur) next.set(id, { ...cur, ...patch });
      return next;
    });
  }, []);

  const handleSuggestAI = useCallback(async () => {
    if (!hasApiKey(settings)) {
      setError("Add an API key in Settings to use AI rename.");
      return;
    }
    const renameTargets = planArray.filter((p) => p.action === "rename");
    if (renameTargets.length === 0) {
      setError("No folders set to 'rename'. Toggle the action on the folders you want named.");
      return;
    }
    const model = getActiveModel(settings);
    const estimate = estimateCost(model, renameTargets.length, 100);
    if (settings.dailyCapEnabled) {
      const remaining = Math.max(0, settings.dailyCapUsd - usage.spentUsd);
      if (estimate > remaining) {
        setError(
          `This would cost about ${formatUsd(estimate)} but you only have ${formatUsd(remaining)} left in today's cap.`
        );
        return;
      }
    }

    setError(null);
    setPhase("ai");
    setAiProgress({ done: 0, total: renameTargets.length });

    const BATCH = 10;
    let runningUsage = usage;
    try {
      for (let i = 0; i < renameTargets.length; i += BATCH) {
        if (settings.dailyCapEnabled) {
          const remaining = Math.max(0, settings.dailyCapUsd - runningUsage.spentUsd);
          const nextEstimate = estimateCost(model, Math.min(BATCH, renameTargets.length - i), 100);
          if (nextEstimate > remaining) {
            setError(`Stopped at ${i} of ${renameTargets.length} folders — daily cap reached.`);
            break;
          }
        }

        const slice = renameTargets.slice(i, i + BATCH);
        const response = await renameFoldersWithAI({
          settings,
          folders: slice.map((p) => ({
            currentName: p.folder.name,
            parentPath: p.folder.parentPath,
            fileCount: p.folder.fileCount,
            subdirCount: p.folder.subdirCount,
            sampleEntries: p.folder.sampleEntries,
          })),
        });

        runningUsage = addUsage(
          runningUsage,
          model,
          response.usage.inputTokens,
          response.usage.outputTokens
        );
        onUsageChange(runningUsage);

        for (const sug of response.suggestions) {
          const target = slice.find((p) => p.folder.name === sug.currentName);
          if (target) {
            const id = `${target.folder.parentPath}/${target.folder.name}`;
            updatePlan(id, { aiSuggestion: sug, newName: sug.suggestedName });
          }
        }
        setAiProgress({ done: Math.min(i + BATCH, renameTargets.length), total: renameTargets.length });
      }
      setPhase("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI rename failed");
      setPhase("ready");
    }
  }, [planArray, settings, usage, onUsageChange, updatePlan]);

  const handleApply = useCallback(async () => {
    setError(null);
    const granted = await ensureWritePermission(root);
    if (!granted) {
      setError("Write permission denied. Pick the folder again.");
      return;
    }
    const work = planArray.filter((p) => p.action !== "skip");
    if (work.length === 0) {
      setError("Nothing selected.");
      return;
    }

    setPhase("applying");
    setApplyProgress({ done: 0, total: work.length });
    let deleted = 0;
    let renamed = 0;
    const failed: { name: string; reason: string }[] = [];

    for (const plan of work) {
      try {
        if (plan.action === "delete") {
          await deleteFolder(plan.folder.parent, plan.folder.name);
          deleted++;
        } else if (plan.action === "rename") {
          if (plan.newName.trim() === "" || plan.newName === plan.folder.name) {
            // No-op rename — skip silently
          } else {
            const result = await renameFolder(
              plan.folder.parent,
              plan.folder.name,
              plan.newName.trim()
            );
            if (result.ok) renamed++;
            else failed.push({ name: plan.folder.name, reason: result.error });
          }
        }
      } catch (err) {
        failed.push({
          name: plan.folder.name,
          reason: err instanceof Error ? err.message : "unknown",
        });
      }
      setApplyProgress((p) => ({ done: p.done + 1, total: p.total }));
    }

    setResults({ deleted, renamed, failed });
    setPhase("done");
  }, [root, planArray]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  if (phase === "idle") {
    return (
      <div className="text-center py-16">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 mb-6">
          <FolderSearch className="w-7 h-7 text-emerald-400" />
        </div>
        <h2 className="text-3xl font-semibold tracking-tight">Find generic folders</h2>
        <p className="mt-3 text-sm text-gray-400 max-w-md mx-auto">
          Scans for folders named "New folder", "untitled folder", "Untitled (3)" and friends.
          Empty ones get queued for deletion. Non-empty ones can be AI-renamed based on what&rsquo;s inside.
        </p>
        {error && (
          <div className="mt-4 inline-flex items-start gap-2 p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-xs text-rose-200">
            <AlertTriangle className="w-3.5 h-3.5 flex-none mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        <button
          onClick={handleScan}
          className="mt-8 inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#0b1220] font-semibold text-sm shadow-lg shadow-emerald-500/20 transition-all duration-200 cursor-pointer"
        >
          <Play className="w-4 h-4" />
          Scan for generic folders
        </button>
      </div>
    );
  }

  if (phase === "scanning") {
    return (
      <div className="py-16 max-w-md mx-auto text-center space-y-6">
        <Loader2 className="w-8 h-8 text-emerald-400 animate-spin mx-auto" />
        <div className="text-sm text-gray-300">
          Walking the tree…
          <div className="mt-1 text-xs text-gray-500 font-mono">{scanProgress} folders scanned</div>
        </div>
        <button
          onClick={handleCancel}
          className="text-xs text-gray-400 hover:text-gray-100 px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/[0.04] transition-colors duration-150 cursor-pointer"
        >
          Cancel
        </button>
      </div>
    );
  }

  if (phase === "done" && results) {
    return (
      <div className="py-16 text-center space-y-5 max-w-md mx-auto">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
          <Check className="w-7 h-7 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Done.</h2>
          <p className="mt-2 text-sm text-gray-400">
            Renamed {results.renamed} &middot; Deleted {results.deleted}
            {results.failed.length > 0 && ` · Failed ${results.failed.length}`}
          </p>
        </div>
        {results.failed.length > 0 && (
          <details className="text-left mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <summary className="text-xs text-amber-200 cursor-pointer">
              {results.failed.length} folder{results.failed.length === 1 ? "" : "s"} failed
            </summary>
            <ul className="mt-2 space-y-1">
              {results.failed.map((f, i) => (
                <li key={i} className="text-xs text-amber-300/80 font-mono">
                  {f.name} &mdash; {f.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
        <button
          onClick={handleScan}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-white/10 hover:bg-white/[0.04] text-gray-100 text-sm transition-colors duration-200 cursor-pointer"
        >
          Scan again
        </button>
      </div>
    );
  }

  // ready / ai / applying — show the plan list
  if (folders.length === 0) {
    return (
      <div className="py-16 text-center space-y-4">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <Check className="w-6 h-6 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">No generic folders found.</h2>
          <p className="mt-2 text-sm text-gray-400">
            Either everything has a real name, or this folder is too tidy. Nice work.
          </p>
        </div>
        <button
          onClick={handleScan}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-white/10 hover:bg-white/[0.04] text-gray-100 text-sm transition-colors duration-200 cursor-pointer"
        >
          Scan again
        </button>
      </div>
    );
  }

  const renameTargets = planArray.filter((p) => p.action === "rename");
  const aiCount = renameTargets.filter((p) => p.aiSuggestion).length;
  const isApplying = phase === "applying";
  const isAI = phase === "ai";

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-sm text-rose-200">
          <AlertTriangle className="w-4 h-4 flex-none mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
            Found {folders.length} generic folder{folders.length === 1 ? "" : "s"}
          </h2>
          <p className="mt-2 text-sm text-gray-400">
            <span className="text-emerald-300">{counts.toRename} to rename</span> ·{" "}
            <span className="text-rose-300">{counts.toDelete} to delete</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {aiCount === renameTargets.length && renameTargets.length > 0 ? (
            <span className="text-xs text-fuchsia-300 inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/5">
              <Sparkles className="w-3.5 h-3.5" />
              AI named all
            </span>
          ) : (
            <AISuggestButton
              hasKey={hasApiKey(settings)}
              isAI={isAI}
              progress={aiProgress}
              folderCount={renameTargets.length}
              model={getActiveModel(settings)}
              usage={usage}
              capEnabled={settings.dailyCapEnabled}
              capUsd={settings.dailyCapUsd}
              onClick={handleSuggestAI}
              onOpenSettings={onOpenSettings}
            />
          )}
          <button
            onClick={handleApply}
            disabled={isApplying || isAI || (counts.toDelete + counts.toRename === 0)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#0b1220] font-semibold text-sm shadow-lg shadow-emerald-500/20 transition-colors duration-200 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isApplying ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {applyProgress.done}/{applyProgress.total}
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Apply
              </>
            )}
          </button>
        </div>
      </div>

      {isAI && (
        <div className="h-1 w-full rounded-full bg-white/[0.04] overflow-hidden">
          <div
            className="h-full bg-fuchsia-400 transition-[width] duration-200"
            style={{
              width: `${aiProgress.total === 0 ? 0 : (aiProgress.done / aiProgress.total) * 100}%`,
            }}
          />
        </div>
      )}
      {isApplying && (
        <div className="h-1 w-full rounded-full bg-white/[0.04] overflow-hidden">
          <div
            className="h-full bg-emerald-400 transition-[width] duration-200"
            style={{
              width: `${applyProgress.total === 0 ? 0 : (applyProgress.done / applyProgress.total) * 100}%`,
            }}
          />
        </div>
      )}

      <div className="grid gap-3">
        {planArray.map((plan) => {
          const id = `${plan.folder.parentPath}/${plan.folder.name}`;
          return (
            <FolderRow
              key={id}
              plan={plan}
              disabled={isApplying || isAI}
              onChangeAction={(action) => updatePlan(id, { action })}
              onChangeName={(newName) => updatePlan(id, { newName })}
            />
          );
        })}
      </div>
    </div>
  );
}

function FolderRow({
  plan,
  disabled,
  onChangeAction,
  onChangeName,
}: {
  plan: Plan;
  disabled: boolean;
  onChangeAction: (action: Plan["action"]) => void;
  onChangeName: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { folder, action, newName, aiSuggestion } = plan;
  const isEmpty = folder.isEmpty;
  const path = folder.parentPath ? `${folder.parentPath}/${folder.name}` : folder.name;

  return (
    <div
      className={cn(
        "rounded-xl border overflow-hidden transition-colors duration-200",
        action === "delete"
          ? "border-rose-500/20 bg-rose-500/[0.03]"
          : action === "skip"
          ? "border-white/[0.04] bg-white/[0.01] opacity-60"
          : "border-white/[0.06] bg-white/[0.02]"
      )}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <button
          onClick={() => setOpen((v) => !v)}
          className="mt-0.5 text-gray-500 hover:text-gray-200 transition-colors duration-150 cursor-pointer"
          disabled={folder.sampleEntries.length === 0}
        >
          <ChevronRight
            className={cn("w-4 h-4 transition-transform duration-200", open && "rotate-90")}
          />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium tracking-tight truncate">{path}</span>
            {isEmpty && (
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/30">
                empty
              </span>
            )}
            {!isEmpty && (
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                {folder.fileCount + folder.subdirCount} items
              </span>
            )}
            {aiSuggestion && (
              <span
                className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/30 inline-flex items-center gap-1"
                title={aiSuggestion.reason}
              >
                <Sparkles className="w-3 h-3" />
                AI
              </span>
            )}
          </div>
          {!isEmpty && (
            <div className="mt-2 flex items-center gap-2">
              <Edit3 className="w-3.5 h-3.5 text-gray-500" />
              <input
                type="text"
                value={newName}
                onChange={(e) => onChangeName(e.target.value)}
                disabled={disabled || action !== "rename"}
                placeholder={folder.name}
                className="flex-1 px-2.5 py-1.5 bg-[#0e1729] border border-white/10 rounded-md text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"
              />
            </div>
          )}
          <div className="mt-2 text-xs text-gray-500">
            {folder.fileCount} files · {folder.subdirCount} subfolders ·{" "}
            {formatBytes(folder.totalBytes)}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <ActionButton
            label="Rename"
            active={action === "rename"}
            disabled={disabled || isEmpty}
            onClick={() => onChangeAction("rename")}
            color="emerald"
          />
          <ActionButton
            label="Delete"
            active={action === "delete"}
            disabled={disabled}
            onClick={() => onChangeAction("delete")}
            color="rose"
          />
          <ActionButton
            label="Skip"
            active={action === "skip"}
            disabled={disabled}
            onClick={() => onChangeAction("skip")}
            color="gray"
          />
        </div>
      </div>
      {open && folder.sampleEntries.length > 0 && (
        <div className="border-t border-white/[0.04] px-4 py-3 bg-black/20">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">
            Contents preview
          </div>
          <ul className="text-xs text-gray-400 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 font-mono">
            {folder.sampleEntries.slice(0, 30).map((e, i) => (
              <li key={i} className="truncate">
                {e.kind === "directory" ? "📁 " : ""}
                {e.name}
              </li>
            ))}
            {folder.fileCount + folder.subdirCount > 30 && (
              <li className="text-gray-600 italic">+ more…</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function ActionButton({
  label,
  active,
  disabled,
  onClick,
  color,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  color: "emerald" | "rose" | "gray";
}) {
  const styles = {
    emerald: active
      ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-200"
      : "bg-white/[0.02] border-white/10 text-gray-400 hover:bg-white/[0.04]",
    rose: active
      ? "bg-rose-500/15 border-rose-500/40 text-rose-200"
      : "bg-white/[0.02] border-white/10 text-gray-400 hover:bg-white/[0.04]",
    gray: active
      ? "bg-white/[0.08] border-white/20 text-gray-200"
      : "bg-white/[0.02] border-white/10 text-gray-500 hover:bg-white/[0.04]",
  };
  const Icon = label === "Delete" ? Trash2 : label === "Rename" ? Edit3 : null;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md border transition-colors duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
        styles[color]
      )}
    >
      {Icon && <Icon className="w-3 h-3" />}
      {label}
    </button>
  );
}

function AISuggestButton({
  hasKey,
  isAI,
  progress,
  folderCount,
  model,
  usage,
  capEnabled,
  capUsd,
  onClick,
  onOpenSettings,
}: {
  hasKey: boolean;
  isAI: boolean;
  progress: { done: number; total: number };
  folderCount: number;
  model: string;
  usage: UsageRecord;
  capEnabled: boolean;
  capUsd: number;
  onClick: () => void;
  onOpenSettings: () => void;
}) {
  const remaining = capEnabled ? Math.max(0, capUsd - usage.spentUsd) : Infinity;
  // Folders use slightly bigger context per item (file lists)
  const estimated = estimateCost(model, folderCount || 1, 100);
  const wouldExceed = capEnabled && estimated > remaining;

  if (!hasKey) {
    return (
      <button
        onClick={onOpenSettings}
        className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 px-3 py-2 rounded-lg border border-white/10 hover:bg-white/[0.04] transition-colors duration-150 cursor-pointer"
      >
        <Sparkles className="w-3.5 h-3.5" />
        AI rename · add key
      </button>
    );
  }
  if (wouldExceed) {
    return (
      <button
        onClick={onOpenSettings}
        className="inline-flex flex-col items-start gap-0 text-left text-xs text-amber-200 hover:text-amber-100 px-3 py-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/15 transition-colors duration-150 cursor-pointer"
      >
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" />
          Would exceed cap
        </span>
        <span className="text-[10px] text-amber-300/70 font-mono">
          need ~{formatUsd(estimated)} · have {formatUsd(remaining)}
        </span>
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      disabled={isAI || folderCount === 0}
      className="inline-flex flex-col items-start gap-0 text-left text-xs text-fuchsia-200 hover:text-fuchsia-100 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg border border-fuchsia-500/30 hover:bg-fuchsia-500/10 transition-colors duration-150 cursor-pointer"
    >
      {isAI ? (
        <span className="inline-flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {progress.done}/{progress.total}
        </span>
      ) : (
        <>
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            AI suggest names
          </span>
          <span className="text-[10px] text-fuchsia-300/60 font-mono">
            ~{formatUsd(estimated)}
            {capEnabled && ` · ${formatUsd(remaining)} left today`}
          </span>
        </>
      )}
    </button>
  );
}
