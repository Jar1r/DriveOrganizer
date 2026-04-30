import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  AlertTriangle,
  FolderOpen,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  Check,
  ChevronRight,
} from "lucide-react";
import {
  isSupported,
  pickDirectory,
  scanDirectory,
  ensureSubdirectory,
  moveFile,
  formatBytes,
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
import { cn } from "@/lib/cn";

type Phase = "idle" | "scanning" | "ready" | "applying" | "done";

type Plan = Map<string, { category: Category; files: ScannedFile[] }>;

export default function Organizer() {
  const [supported] = useState(isSupported);
  const [root, setRoot] = useState<FileSystemDirectoryHandle | null>(null);
  const [files, setFiles] = useState<ScannedFile[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [recursive, setRecursive] = useState(false);
  const [categories, setCategories] = useState<Category[]>(() => loadCategories());
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const plan = useMemo<Plan>(() => {
    const map: Plan = new Map();
    for (const file of files) {
      if (excluded.has(file.relativePath)) continue;
      const cat = categorize(file.name, categories);
      const entry = map.get(cat.key) ?? { category: cat, files: [] };
      entry.files.push(file);
      map.set(cat.key, entry);
    }
    return map;
  }, [files, categories, excluded]);

  const stats = useMemo(() => {
    let total = 0;
    let bytes = 0;
    for (const { files } of plan.values()) {
      total += files.length;
      for (const f of files) bytes += f.size;
    }
    return { total, bytes, groups: plan.size };
  }, [plan]);

  const handlePick = useCallback(async () => {
    setError(null);
    try {
      const dir = await pickDirectory();
      if (!dir) return;
      setRoot(dir);
      setPhase("scanning");
      const scanned = await scanDirectory(dir, { recursive });
      setFiles(scanned);
      setPhase("ready");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to read folder";
      setError(message);
      setPhase("idle");
    }
  }, [recursive]);

  const handleApply = useCallback(async () => {
    if (!root) return;
    setError(null);
    setPhase("applying");
    const groups = Array.from(plan.values()).filter(
      (g) => g.category.key !== OTHER_CATEGORY.key
    );
    const total = groups.reduce((sum, g) => sum + g.files.length, 0);
    setProgress({ done: 0, total });
    try {
      let done = 0;
      for (const group of groups) {
        const dest = await ensureSubdirectory(root, group.category.folder);
        for (const file of group.files) {
          try {
            await moveFile(file, dest);
          } catch (err) {
            console.warn("Failed to move", file.name, err);
          }
          done += 1;
          setProgress({ done, total });
        }
      }
      setPhase("done");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to apply";
      setError(message);
      setPhase("ready");
    }
  }, [root, plan]);

  const handleReset = useCallback(() => {
    setRoot(null);
    setFiles([]);
    setExcluded(new Set());
    setPhase("idle");
    setProgress({ done: 0, total: 0 });
    setError(null);
  }, []);

  const handleResetRules = useCallback(() => {
    setCategories(resetCategories());
  }, []);

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

  if (!supported) {
    return <UnsupportedScreen />;
  }

  return (
    <div className="min-h-screen bg-[#0b1220] text-gray-100">
      <header className="border-b border-white/[0.06] sticky top-0 z-30 bg-[#0b1220]/85 backdrop-blur-md">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between gap-4">
          <Link
            to="/"
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-100 transition-colors duration-150 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <img src="/logo.svg" alt="" className="w-6 h-6" />
            <span className="font-medium tracking-tight text-gray-100">DriveOrganizer</span>
          </Link>
          {root && (
            <button
              onClick={handleReset}
              className="text-xs text-gray-400 hover:text-gray-100 px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/[0.04] transition-colors duration-150 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5 inline mr-1.5" />
              Pick another folder
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {error && (
          <div className="mb-6 flex items-start gap-3 p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-sm text-rose-200">
            <AlertTriangle className="w-4 h-4 flex-none mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {phase === "idle" && (
          <IdleScreen onPick={handlePick} recursive={recursive} setRecursive={setRecursive} />
        )}

        {phase === "scanning" && (
          <div className="flex flex-col items-center justify-center py-32 gap-4">
            <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
            <p className="text-sm text-gray-400">Reading folder&hellip;</p>
          </div>
        )}

        {(phase === "ready" || phase === "applying" || phase === "done") && (
          <PlanView
            phase={phase}
            plan={plan}
            stats={stats}
            categories={categories}
            excluded={excluded}
            progress={progress}
            onApply={handleApply}
            onToggleFile={toggleFile}
            onUpdateFolder={updateFolder}
            onResetRules={handleResetRules}
          />
        )}
      </main>
    </div>
  );
}

function IdleScreen({
  onPick,
  recursive,
  setRecursive,
}: {
  onPick: () => void;
  recursive: boolean;
  setRecursive: (v: boolean) => void;
}) {
  return (
    <div className="text-center py-20">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-sky-500/10 border border-sky-500/20 mb-6">
        <FolderOpen className="w-7 h-7 text-sky-400" />
      </div>
      <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">Pick a folder to clean up</h1>
      <p className="mt-3 text-sm text-gray-400 max-w-md mx-auto">
        DriveOrganizer reads the folder you choose. Files never leave your machine.
      </p>
      <button
        onClick={onPick}
        className="mt-8 inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-[#0b1220] font-semibold text-sm shadow-lg shadow-sky-500/20 transition-all duration-200 cursor-pointer"
      >
        <FolderOpen className="w-4 h-4" />
        Pick folder
      </button>
      <label className="mt-6 inline-flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
        <input
          type="checkbox"
          className="accent-sky-500"
          checked={recursive}
          onChange={(e) => setRecursive(e.target.checked)}
        />
        Include nested subfolders (slower on huge folders)
      </label>
    </div>
  );
}

function PlanView({
  phase,
  plan,
  stats,
  categories,
  excluded,
  progress,
  onApply,
  onToggleFile,
  onUpdateFolder,
  onResetRules,
}: {
  phase: Phase;
  plan: Plan;
  stats: { total: number; bytes: number; groups: number };
  categories: Category[];
  excluded: Set<string>;
  progress: { done: number; total: number };
  onApply: () => void;
  onToggleFile: (path: string) => void;
  onUpdateFolder: (key: string, folder: string) => void;
  onResetRules: () => void;
}) {
  const groups = Array.from(plan.values()).sort((a, b) => b.files.length - a.files.length);
  const isApplying = phase === "applying";
  const isDone = phase === "done";

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
            {isDone ? "All sorted." : "Preview the plan"}
          </h1>
          <p className="mt-2 text-sm text-gray-400">
            {isDone
              ? "Your folder is clean. Pick another to continue."
              : `${stats.total} files · ${stats.groups} categories · ${formatBytes(stats.bytes)}`}
          </p>
        </div>
        {!isDone && (
          <div className="flex items-center gap-3">
            <button
              onClick={onResetRules}
              className="text-xs text-gray-400 hover:text-gray-100 px-3 py-2 rounded-lg border border-white/10 hover:bg-white/[0.04] transition-colors duration-150 cursor-pointer"
            >
              Reset rules
            </button>
            <button
              onClick={onApply}
              disabled={isApplying || stats.total === 0}
              className={cn(
                "inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all duration-200 cursor-pointer",
                "bg-sky-500 hover:bg-sky-400 text-[#0b1220] shadow-lg shadow-sky-500/20",
                "disabled:opacity-60 disabled:cursor-not-allowed"
              )}
            >
              {isApplying ? (
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
      </div>

      {isApplying && (
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
            Moved {progress.done} files into {stats.groups} folders.
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
            onToggleFile={onToggleFile}
            onUpdateFolder={
              category.key === OTHER_CATEGORY.key ? undefined : (folder) => onUpdateFolder(category.key, folder)
            }
            customCategories={categories}
          />
        ))}
        {groups.length === 0 && (
          <div className="text-center py-16 text-sm text-gray-500">
            <Sparkles className="w-5 h-5 mx-auto mb-2 text-gray-600" />
            This folder is already empty (or all files were excluded).
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
  onToggleFile,
  onUpdateFolder,
}: {
  category: Category;
  files: ScannedFile[];
  excluded: Set<string>;
  disabled: boolean;
  onToggleFile: (path: string) => void;
  onUpdateFolder?: (folder: string) => void;
  customCategories: Category[];
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
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
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
            <span className="text-xs text-gray-500">
              {category.label}
            </span>
          </div>
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
            return (
              <li
                key={file.relativePath}
                className={cn(
                  "flex items-center gap-3 px-4 py-2 text-sm transition-colors duration-150",
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
                <span className={cn("flex-1 truncate text-gray-200", isExcluded && "line-through")}>
                  {file.relativePath}
                </span>
                <span className="text-xs text-gray-500 font-mono">{formatBytes(file.size)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function UnsupportedScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0b1220] p-6">
      <div className="max-w-md text-center space-y-5">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <AlertTriangle className="w-6 h-6 text-amber-400" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Browser not supported</h1>
        <p className="text-sm text-gray-400 leading-relaxed">
          DriveOrganizer needs the File System Access API to read your folders. That works in
          Chrome, Edge, Brave, Arc, and Opera. Safari and Firefox don&rsquo;t support it yet.
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-white/10 hover:bg-white/[0.04] text-sm transition-colors duration-150 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to landing
        </Link>
      </div>
    </div>
  );
}
