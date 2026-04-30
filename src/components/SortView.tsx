import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Cloud,
  Info,
  Loader2,
  Play,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import {
  ensureSubdirectory,
  ensureWritePermission,
  formatBytes,
  moveFile,
  moveFileAs,
  scanDirectory,
  type MoveError,
  type ScannedFile,
} from "@/lib/fs";
import {
  loadCategories,
  saveCategories,
  resetCategories,
  categorize,
  OTHER_CATEGORY,
  type Category,
} from "@/lib/rules";
import { hasApiKey, getActiveModel, type Settings } from "@/lib/storage";
import { makeRecord, type UndoManager } from "@/lib/undo";
import { maybeReadExcerpt, renameWithAI, type AIRenameSuggestion } from "@/lib/ai";
import {
  loadUsage,
  addUsage,
  estimateCost,
  formatUsd,
  type UsageRecord,
} from "@/lib/usage";
import { cn } from "@/lib/cn";

type Phase = "scanning" | "ready" | "ai-suggesting" | "applying" | "done";

type Plan = Map<string, { category: Category; files: ScannedFile[] }>;

export default function SortView({
  root,
  rootName,
  oneDriveLikely,
  recursive,
  setRecursive,
  settings,
  undoManager,
  usage,
  onUsageChange,
  onOpenSettings,
  onUndoComplete,
}: {
  root: FileSystemDirectoryHandle;
  rootName: string;
  oneDriveLikely: boolean;
  recursive: boolean;
  setRecursive: (v: boolean) => void;
  settings: Settings;
  undoManager: UndoManager;
  usage: UsageRecord;
  onUsageChange: (next: UsageRecord) => void;
  onOpenSettings: () => void;
  onUndoComplete?: () => void;
}) {
  const [files, setFiles] = useState<ScannedFile[]>([]);
  const [phase, setPhase] = useState<Phase>("scanning");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>(() => loadCategories());
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [failures, setFailures] = useState<MoveError[]>([]);
  const [aiSuggestions, setAiSuggestions] = useState<Map<string, AIRenameSuggestion>>(new Map());
  const [aiOverrides, setAiOverrides] = useState<Map<string, AIRenameSuggestion>>(new Map());
  const [undoVersion, setUndoVersion] = useState(0);
  const aiAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return undoManager.subscribe(() => setUndoVersion((v) => v + 1));
  }, [undoManager]);

  // Initial scan
  useEffect(() => {
    let cancelled = false;
    setPhase("scanning");
    setError(null);
    setFiles([]);
    scanDirectory(root, { recursive })
      .then((scanned) => {
        if (!cancelled) {
          setFiles(scanned);
          setPhase("ready");
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to read folder");
          setPhase("ready");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [root, recursive]);

  const plan = useMemo<Plan>(() => {
    const map: Plan = new Map();
    for (const file of files) {
      if (excluded.has(file.relativePath)) continue;
      const override = aiOverrides.get(file.relativePath);
      const cat = override
        ? categories.find((c) => c.key === override.category) ?? categorize(file.name, categories)
        : categorize(file.name, categories);
      const entry = map.get(cat.key) ?? { category: cat, files: [] };
      entry.files.push(file);
      map.set(cat.key, entry);
    }
    return map;
  }, [files, categories, excluded, aiOverrides]);

  const stats = useMemo(() => {
    let total = 0;
    let bytes = 0;
    for (const { files } of plan.values()) {
      total += files.length;
      for (const f of files) bytes += f.size;
    }
    return { total, bytes, groups: plan.size };
  }, [plan]);

  const toggleFile = useCallback((path: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const updateFolder = useCallback(
    (key: string, folder: string) => {
      const next = categories.map((c) => (c.key === key ? { ...c, folder } : c));
      setCategories(next);
      saveCategories(next);
    },
    [categories]
  );

  const handleResetRules = useCallback(() => {
    setCategories(resetCategories());
  }, []);

  const handleSuggestAI = useCallback(async () => {
    if (!hasApiKey(settings)) {
      setError("Add an API key in Settings to use AI rename.");
      return;
    }

    // Enforce daily cap before spending a single token
    const model = getActiveModel(settings);
    const estimated = estimateCost(model, files.length);
    if (settings.dailyCapEnabled) {
      const remaining = Math.max(0, settings.dailyCapUsd - usage.spentUsd);
      if (estimated > remaining) {
        setError(
          `This would cost about ${formatUsd(estimated)} but you only have ${formatUsd(
            remaining
          )} left in today's cap. Reset the cap in Settings, raise it, or pick a smaller folder.`
        );
        return;
      }
    }

    setError(null);
    setPhase("ai-suggesting");
    setProgress({ done: 0, total: files.length });

    aiAbortRef.current = new AbortController();
    const signal = aiAbortRef.current.signal;

    // Cap to first N files per call to keep latency low
    const BATCH = 30;
    const all = new Map<string, AIRenameSuggestion>();
    let runningUsage = usage;
    let abortedByUser = false;

    try {
      for (let i = 0; i < files.length; i += BATCH) {
        if (signal.aborted) {
          abortedByUser = true;
          break;
        }
        // Re-check the cap before EACH batch — actual usage may differ from estimate
        if (settings.dailyCapEnabled) {
          const remaining = Math.max(0, settings.dailyCapUsd - runningUsage.spentUsd);
          const nextEstimate = estimateCost(model, Math.min(BATCH, files.length - i));
          if (nextEstimate > remaining) {
            setError(
              `Stopped at ${i} of ${files.length} files — daily cap reached. Reset or raise it in Settings to continue.`
            );
            break;
          }
        }

        const slice = files.slice(i, i + BATCH);
        const requests = await Promise.all(
          slice.map(async (f) => {
            const blob = await f.handle.getFile().catch(() => null);
            const excerpt = blob ? await maybeReadExcerpt(blob, f.name) : undefined;
            return {
              filename: f.name,
              size: f.size,
              lastModified: f.lastModified,
              textExcerpt: excerpt,
            };
          })
        );
        const response = await renameWithAI({
          settings,
          categories,
          files: requests,
          signal,
        });

        // Tally actual spend reported by the provider
        runningUsage = addUsage(
          runningUsage,
          model,
          response.usage.inputTokens,
          response.usage.outputTokens
        );
        onUsageChange(runningUsage);

        // Index suggestions by filename
        for (const sug of response.suggestions) {
          const match = slice.find((f) => f.name === sug.filename);
          if (match) all.set(match.relativePath, sug);
        }
        setProgress({ done: Math.min(i + BATCH, files.length), total: files.length });
      }
      setAiSuggestions(all);
      setAiOverrides(all);
      setPhase("ready");
      if (abortedByUser && all.size > 0) {
        setError(`Stopped at ${all.size} of ${files.length} files. Suggestions for the completed batches are kept.`);
      }
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        // User-initiated cancel; keep whatever suggestions arrived
        setAiSuggestions(all);
        setAiOverrides(all);
      } else {
        setError(e instanceof Error ? e.message : "AI rename failed");
      }
      setPhase("ready");
    } finally {
      aiAbortRef.current = null;
    }
  }, [files, settings, categories, usage, onUsageChange]);

  const handleCancelAI = useCallback(() => {
    aiAbortRef.current?.abort();
  }, []);

  const handleClearAI = useCallback(() => {
    setAiSuggestions(new Map());
    setAiOverrides(new Map());
  }, []);

  const toggleAIOverride = useCallback(
    (path: string) => {
      setAiOverrides((prev) => {
        const next = new Map(prev);
        if (next.has(path)) next.delete(path);
        else {
          const sug = aiSuggestions.get(path);
          if (sug) next.set(path, sug);
        }
        return next;
      });
    },
    [aiSuggestions]
  );

  const handleApply = useCallback(async () => {
    setError(null);
    setFailures([]);
    const granted = await ensureWritePermission(root);
    if (!granted) {
      setError("Write permission denied. Pick the folder again to re-grant access.");
      return;
    }
    setPhase("applying");

    const groups = Array.from(plan.values()).filter((g) => g.category.key !== OTHER_CATEGORY.key);
    const total = groups.reduce((sum, g) => sum + g.files.length, 0);
    setProgress({ done: 0, total });

    const recorder = undoManager.begin(rootName);
    const collectedFailures: MoveError[] = [];
    let done = 0;

    for (const group of groups) {
      let dest: FileSystemDirectoryHandle;
      try {
        dest = await ensureSubdirectory(root, group.category.folder);
      } catch (err) {
        for (const file of group.files) {
          collectedFailures.push({
            file,
            code: "permission-denied",
            message: `Couldn't create folder "${group.category.folder}": ${
              err instanceof Error ? err.message : "unknown"
            }`,
          });
          done++;
          setProgress({ done, total });
        }
        continue;
      }
      for (const file of group.files) {
        const override = aiOverrides.get(file.relativePath);
        const result = override
          ? await moveFileAs(file, dest, override.suggestedName)
          : await moveFile(file, dest);
        if (result.ok) {
          recorder.record(makeRecord(file, dest, result.destName));
        } else {
          collectedFailures.push(result.error);
        }
        done++;
        setProgress({ done, total });
      }
    }
    recorder.commit();
    setFailures(collectedFailures);
    setPhase("done");
  }, [plan, root, rootName, undoManager, aiOverrides]);

  const handleUndo = useCallback(async () => {
    const op = undoManager.latestSort();
    if (!op) return;
    setError(null);
    setPhase("applying");
    setProgress({ done: 0, total: op.moves.length });
    const result = await undoManager.undo(op);
    setPhase("ready");
    setProgress({ done: 0, total: 0 });
    if (result.failed.length > 0) {
      setError(
        `Reversed ${result.reversed} of ${op.moves.length} files. ${result.failed.length} couldn't be restored.`
      );
    }
    onUndoComplete?.();
    // Rescan to reflect current state
    scanDirectory(root, { recursive }).then(setFiles).catch(() => {});
  }, [root, recursive, undoManager, onUndoComplete]);

  const groups = Array.from(plan.values()).sort((a, b) => b.files.length - a.files.length);
  const isApplying = phase === "applying" || phase === "ai-suggesting";
  const isDone = phase === "done";
  const isScanning = phase === "scanning";
  const latestOp = undoManager.latestSort();
  void undoVersion; // tracked to re-render on undo state change

  if (isScanning) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
        <p className="text-sm text-gray-400">Reading folder&hellip;</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-sm text-rose-200">
          <AlertTriangle className="w-4 h-4 flex-none mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {oneDriveLikely && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-sky-500/30 bg-sky-500/10 text-sm text-sky-200">
          <Cloud className="w-4 h-4 flex-none mt-0.5" />
          <div>
            <div className="font-medium">OneDrive folder detected.</div>
            <div className="mt-1 text-sky-300/80">
              Online-only files need to download before they can be moved. Right-click any
              that fail in File Explorer → "Always keep on this device".
            </div>
          </div>
        </div>
      )}

      {failures.length > 0 && <FailureSummary failures={failures} />}

      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
            {isDone ? "All sorted." : "Preview the plan"}
          </h2>
          <p className="mt-2 text-sm text-gray-400">
            {isDone
              ? "Folder is clean. Undo if you don't like the result."
              : `${stats.total} files · ${stats.groups} categories · ${formatBytes(stats.bytes)}`}
          </p>
        </div>
        {!isDone && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none px-2 py-2">
              <input
                type="checkbox"
                className="accent-sky-500"
                checked={recursive}
                onChange={(e) => setRecursive(e.target.checked)}
              />
              Recursive
            </label>
            <button
              onClick={handleResetRules}
              className="text-xs text-gray-400 hover:text-gray-100 px-3 py-2 rounded-lg border border-white/10 hover:bg-white/[0.04] transition-colors duration-150 cursor-pointer"
            >
              Reset rules
            </button>
            {phase === "ai-suggesting" ? (
              <div className="inline-flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/10 text-xs text-fuchsia-200">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  AI {progress.done}/{progress.total}
                </span>
                <button
                  onClick={handleCancelAI}
                  className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-100 px-2.5 py-2 rounded-lg border border-white/10 hover:bg-white/[0.04] transition-colors duration-150 cursor-pointer"
                  title="Stop the AI batch and keep what's already finished"
                >
                  <X className="w-3.5 h-3.5" />
                  Cancel
                </button>
              </div>
            ) : aiSuggestions.size > 0 ? (
              <button
                onClick={handleClearAI}
                className="text-xs text-fuchsia-300 hover:text-fuchsia-200 px-3 py-2 rounded-lg border border-fuchsia-500/30 hover:bg-fuchsia-500/10 transition-colors duration-150 cursor-pointer"
              >
                Clear AI
              </button>
            ) : (
              <AIButton
                hasKey={hasApiKey(settings)}
                phase={phase}
                progress={progress}
                fileCount={files.length}
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
              disabled={isApplying || stats.total === 0}
              className={cn(
                "inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all duration-200 cursor-pointer",
                "neon-cyan-btn bg-cyan-400 hover:bg-cyan-300 text-[#070a1c]",
                "disabled:opacity-60 disabled:cursor-not-allowed"
              )}
            >
              {phase === "applying" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {progress.done}/{progress.total}
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Apply &middot; {stats.total} files
                </>
              )}
            </button>
          </div>
        )}
        {isDone && latestOp && (
          <button
            onClick={handleUndo}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border border-amber-500/30 transition-colors duration-200 cursor-pointer"
          >
            <Undo2 className="w-4 h-4" />
            Undo last sort &middot; {latestOp.moves.length} files
          </button>
        )}
      </div>

      {phase === "applying" && (
        <div className="h-1 w-full rounded-full bg-white/[0.04] overflow-hidden">
          <div
            className="h-full bg-sky-400 transition-[width] duration-200"
            style={{
              width: `${progress.total === 0 ? 0 : (progress.done / progress.total) * 100}%`,
            }}
          />
        </div>
      )}

      {isDone && (
        <div className="flex items-center gap-3 p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-sm text-emerald-200">
          <Check className="w-4 h-4 flex-none" />
          <span>
            Moved {Math.max(0, progress.done - failures.length)} of {progress.done} files into{" "}
            {stats.groups} folder{stats.groups === 1 ? "" : "s"}.
            {failures.length > 0 && ` ${failures.length} skipped.`}
          </span>
        </div>
      )}

      <div className="grid gap-3">
        {groups.map(({ category, files }) => (
          <CategoryGroup
            key={category.key}
            category={category}
            files={files}
            excluded={excluded}
            disabled={isApplying || isDone}
            aiSuggestions={aiSuggestions}
            aiOverrides={aiOverrides}
            onToggleFile={toggleFile}
            onToggleAI={toggleAIOverride}
            onUpdateFolder={
              category.key === OTHER_CATEGORY.key
                ? undefined
                : (folder) => updateFolder(category.key, folder)
            }
          />
        ))}
        {groups.length === 0 && (
          <div className="text-center py-16 text-sm text-gray-500">
            <Info className="w-5 h-5 mx-auto mb-2 text-gray-600" />
            This folder is empty.
          </div>
        )}
      </div>
    </div>
  );
}

function CategoryGroup({
  category,
  files,
  excluded,
  disabled,
  aiSuggestions,
  aiOverrides,
  onToggleFile,
  onToggleAI,
  onUpdateFolder,
}: {
  category: Category;
  files: ScannedFile[];
  excluded: Set<string>;
  disabled: boolean;
  aiSuggestions: Map<string, AIRenameSuggestion>;
  aiOverrides: Map<string, AIRenameSuggestion>;
  onToggleFile: (path: string) => void;
  onToggleAI: (path: string) => void;
  onUpdateFolder?: (folder: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [folderDraft, setFolderDraft] = useState(category.folder);
  const totalSize = files.reduce((s, f) => s + f.size, 0);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors duration-150 cursor-pointer text-left"
      >
        <ChevronRight
          className={cn(
            "w-4 h-4 text-gray-500 transition-transform duration-200",
            open && "rotate-90"
          )}
        />
        <span
          className="w-2.5 h-2.5 rounded-sm flex-none"
          style={{ backgroundColor: category.color }}
        />
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {editing && onUpdateFolder ? (
            <input
              value={folderDraft}
              onChange={(e) => setFolderDraft(e.target.value)}
              onBlur={() => {
                if (folderDraft.trim()) onUpdateFolder(folderDraft.trim());
                setEditing(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  setFolderDraft(category.folder);
                  setEditing(false);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              autoFocus
              className="bg-white/[0.04] border border-white/10 rounded px-2 py-0.5 text-sm font-medium tracking-tight focus:outline-none focus:border-sky-500/50"
            />
          ) : (
            <span
              onClick={
                onUpdateFolder
                  ? (e) => {
                      e.stopPropagation();
                      setFolderDraft(category.folder);
                      setEditing(true);
                    }
                  : undefined
              }
              className={cn(
                "text-sm font-medium tracking-tight",
                onUpdateFolder && "hover:text-sky-300 cursor-text"
              )}
              title={onUpdateFolder ? "Click to rename folder" : undefined}
            >
              {category.folder}
            </span>
          )}
          <span className="text-xs text-gray-500">{category.label}</span>
        </div>
        <span className="text-xs text-gray-500 font-mono">{formatBytes(totalSize)}</span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-gray-300">
          {files.length}
        </span>
      </button>
      {open && (
        <ul className="border-t border-white/[0.04] divide-y divide-white/[0.03]">
          {files.map((file) => {
            const isExcluded = excluded.has(file.relativePath);
            const sug = aiSuggestions.get(file.relativePath);
            const aiOn = aiOverrides.has(file.relativePath);
            return (
              <li
                key={file.relativePath}
                className={cn(
                  "flex flex-wrap items-center gap-3 px-4 py-2 text-sm transition-colors duration-150",
                  isExcluded ? "opacity-40" : "hover:bg-white/[0.015]"
                )}
              >
                <input
                  type="checkbox"
                  className="accent-sky-500 cursor-pointer"
                  disabled={disabled}
                  checked={!isExcluded}
                  onChange={() => onToggleFile(file.relativePath)}
                />
                <span
                  className={cn(
                    "flex-1 min-w-0 truncate text-gray-200",
                    isExcluded && "line-through"
                  )}
                >
                  {file.relativePath}
                </span>
                {sug && (
                  <button
                    onClick={() => onToggleAI(file.relativePath)}
                    disabled={disabled}
                    className={cn(
                      "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs border transition-colors duration-150 cursor-pointer disabled:cursor-not-allowed",
                      aiOn
                        ? "bg-fuchsia-500/15 border-fuchsia-500/40 text-fuchsia-200"
                        : "bg-white/[0.02] border-white/10 text-gray-400"
                    )}
                    title={`${sug.suggestedName} — ${sug.reason}`}
                  >
                    <Sparkles className="w-3 h-3" />
                    {aiOn ? sug.suggestedName : "use AI"}
                  </button>
                )}
                <span className="text-xs text-gray-500 font-mono">{formatBytes(file.size)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function FailureSummary({ failures }: { failures: MoveError[] }) {
  const [open, setOpen] = useState(false);
  const grouped = useMemo(() => {
    const map = new Map<MoveError["code"], MoveError[]>();
    for (const f of failures) {
      const list = map.get(f.code) ?? [];
      list.push(f);
      map.set(f.code, list);
    }
    return Array.from(map.entries());
  }, [failures]);

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left text-amber-200 hover:bg-amber-500/5 transition-colors duration-150 cursor-pointer text-sm"
      >
        <AlertTriangle className="w-4 h-4 flex-none" />
        <span className="flex-1">
          {failures.length} file{failures.length === 1 ? "" : "s"} couldn&rsquo;t be moved.
        </span>
        <ChevronRight
          className={cn("w-4 h-4 text-amber-300 transition-transform duration-200", open && "rotate-90")}
        />
      </button>
      {open && (
        <div className="border-t border-amber-500/20 divide-y divide-amber-500/10">
          {grouped.map(([code, items]) => (
            <div key={code} className="px-4 py-3">
              <div className="text-xs font-medium text-amber-200 mb-1.5">
                {labelForCode(code)} &middot; {items.length}
              </div>
              <div className="text-xs text-amber-300/80 mb-2">{items[0].message}</div>
              <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                {items.slice(0, 50).map((f, i) => (
                  <li key={i} className="text-xs text-amber-300/60 font-mono truncate">
                    {f.file.relativePath}
                  </li>
                ))}
                {items.length > 50 && (
                  <li className="text-xs text-amber-300/40">+ {items.length - 50} more&hellip;</li>
                )}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AIButton({
  hasKey,
  phase,
  progress,
  fileCount,
  model,
  usage,
  capEnabled,
  capUsd,
  onClick,
  onOpenSettings,
}: {
  hasKey: boolean;
  phase: Phase;
  progress: { done: number; total: number };
  fileCount: number;
  model: string;
  usage: UsageRecord;
  capEnabled: boolean;
  capUsd: number;
  onClick: () => void;
  onOpenSettings: () => void;
}) {
  const remaining = capEnabled ? Math.max(0, capUsd - usage.spentUsd) : Infinity;
  const estimated = estimateCost(model, fileCount || 1);
  const wouldExceed = capEnabled && estimated > remaining;
  const overLimit = capEnabled && remaining <= 0;

  if (!hasKey) {
    return (
      <button
        onClick={onOpenSettings}
        className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 px-3 py-2 rounded-lg border border-white/10 hover:bg-white/[0.04] transition-colors duration-150 cursor-pointer"
        title="Add an API key in Settings to enable AI rename"
      >
        <Sparkles className="w-3.5 h-3.5" />
        AI rename &middot; add key
      </button>
    );
  }

  if (overLimit || wouldExceed) {
    return (
      <button
        onClick={onOpenSettings}
        className="inline-flex flex-col items-start gap-0 text-left text-xs text-amber-200 hover:text-amber-100 px-3 py-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/15 transition-colors duration-150 cursor-pointer"
        title="Daily cap reached — open Settings to reset or raise"
      >
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" />
          {overLimit ? "Cap reached" : "Would exceed cap"}
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
      disabled={phase === "ai-suggesting" || fileCount === 0}
      className="inline-flex flex-col items-start gap-0 text-left text-xs text-fuchsia-200 hover:text-fuchsia-100 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg border border-fuchsia-500/30 hover:bg-fuchsia-500/10 transition-colors duration-150 cursor-pointer"
      title={`AI rename + categorize (~${formatUsd(estimated)} for ${fileCount} files)`}
    >
      {phase === "ai-suggesting" ? (
        <span className="inline-flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {progress.done}/{progress.total}
        </span>
      ) : (
        <>
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            AI rename
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

function labelForCode(code: MoveError["code"]): string {
  switch (code) {
    case "permission-denied":
      return "Permission denied";
    case "file-locked":
      return "File in use by another app";
    case "onedrive-offline":
      return "OneDrive online-only files";
    case "destination-exists":
      return "Destination conflict";
    case "source-missing":
      return "File no longer exists";
    case "quota-exceeded":
      return "Disk space exhausted";
    case "name-too-long":
      return "Path too long for Windows";
    default:
      return "Other errors";
  }
}
