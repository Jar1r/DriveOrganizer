import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Files,
  Loader2,
  Play,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  ensureWritePermission,
  formatBytes,
  scanDirectory,
  type ScannedFile,
} from "@/lib/fs";
import { deleteExtras, findDuplicates, pickKeeper, type DupeGroup, type DupeReport } from "@/lib/dupes";
import { cn } from "@/lib/cn";

type Phase = "idle" | "scanning" | "hashing" | "ready" | "deleting" | "done";

export default function DuplicatesView({
  root,
  recursive,
  setRecursive,
}: {
  root: FileSystemDirectoryHandle;
  recursive: boolean;
  setRecursive: (v: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ phase: "fast" as "fast" | "full", done: 0, total: 0 });
  const [report, setReport] = useState<DupeReport | null>(null);
  const [keepers, setKeepers] = useState<Map<string, ScannedFile>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [reclaimed, setReclaimed] = useState(0);
  const [deletedCount, setDeletedCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const handleScan = useCallback(async () => {
    setError(null);
    setReport(null);
    setReclaimed(0);
    setDeletedCount(0);
    setKeepers(new Map());
    setPhase("scanning");
    abortRef.current = new AbortController();
    try {
      const files = await scanDirectory(root, { recursive });
      setPhase("hashing");
      const result = await findDuplicates(
        files,
        (phase, done, total) => setProgress({ phase, done, total }),
        abortRef.current.signal
      );
      setReport(result);
      // Initialize keepers as the picked keeper per group
      const initialKeepers = new Map<string, ScannedFile>();
      for (const group of result.groups) {
        initialKeepers.set(group.hash, pickKeeper(group));
      }
      setKeepers(initialKeepers);
      setPhase("ready");
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        setPhase("idle");
      } else {
        setError(e instanceof Error ? e.message : "Scan failed");
        setPhase("idle");
      }
    }
  }, [root, recursive]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const setKeeper = useCallback((groupHash: string, file: ScannedFile) => {
    setKeepers((prev) => {
      const next = new Map(prev);
      next.set(groupHash, file);
      return next;
    });
  }, []);

  const handleDelete = useCallback(async () => {
    if (!report) return;
    setError(null);
    const granted = await ensureWritePermission(root);
    if (!granted) {
      setError("Write permission denied. Pick the folder again to re-grant access.");
      return;
    }
    setPhase("deleting");
    let totalDeleted = 0;
    let totalBytes = 0;
    const failed: string[] = [];
    for (const group of report.groups) {
      const keeper = keepers.get(group.hash);
      if (!keeper) continue;
      const result = await deleteExtras(group, keeper);
      totalDeleted += result.deleted;
      totalBytes += result.deleted * group.bytesPerFile;
      for (const f of result.failed) {
        failed.push(`${f.file.relativePath} — ${f.reason}`);
      }
    }
    setDeletedCount(totalDeleted);
    setReclaimed(totalBytes);
    setPhase("done");
    if (failed.length > 0) {
      setError(`${failed.length} file${failed.length === 1 ? "" : "s"} couldn't be deleted.`);
    }
  }, [report, keepers, root]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  if (phase === "idle") {
    return (
      <div className="text-center py-16">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-fuchsia-500/10 border border-fuchsia-500/20 mb-6">
          <Files className="w-7 h-7 text-fuchsia-400" />
        </div>
        <h2 className="text-3xl font-semibold tracking-tight">Find duplicate files</h2>
        <p className="mt-3 text-sm text-gray-400 max-w-md mx-auto">
          We&rsquo;ll hash every file and report exact duplicates. Two-stage hashing keeps it fast
          even on huge folders. Then pick which copy to keep and reclaim the space.
        </p>
        {error && (
          <div className="mt-4 inline-flex items-start gap-2 p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-xs text-rose-200">
            <AlertTriangle className="w-3.5 h-3.5 flex-none mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        <button
          onClick={handleScan}
          className="mt-8 inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-fuchsia-500 hover:bg-fuchsia-400 text-[#0b1220] font-semibold text-sm shadow-lg shadow-fuchsia-500/20 transition-all duration-200 cursor-pointer"
        >
          <Play className="w-4 h-4" />
          Scan for duplicates
        </button>
        <label className="mt-6 inline-flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
          <input
            type="checkbox"
            className="accent-fuchsia-500"
            checked={recursive}
            onChange={(e) => setRecursive(e.target.checked)}
          />
          Include nested subfolders
        </label>
      </div>
    );
  }

  if (phase === "scanning" || phase === "hashing") {
    const pct = progress.total === 0 ? 0 : (progress.done / progress.total) * 100;
    return (
      <div className="py-16 max-w-md mx-auto text-center space-y-6">
        <Loader2 className="w-8 h-8 text-fuchsia-400 animate-spin mx-auto" />
        <div>
          <div className="text-sm text-gray-300">
            {phase === "scanning"
              ? "Reading folder…"
              : progress.phase === "fast"
              ? "Fast-hashing files…"
              : "Verifying duplicates…"}
          </div>
          <div className="mt-2 text-xs text-gray-500">
            {progress.done} / {progress.total}
          </div>
        </div>
        <div className="h-1 w-full rounded-full bg-white/[0.04] overflow-hidden">
          <div
            className="h-full bg-fuchsia-400 transition-[width] duration-200"
            style={{ width: `${pct}%` }}
          />
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

  if (phase === "ready" || phase === "deleting" || phase === "done") {
    return (
      <DupeReportView
        report={report!}
        keepers={keepers}
        setKeeper={setKeeper}
        onDelete={handleDelete}
        onRescan={handleScan}
        phase={phase}
        deletedCount={deletedCount}
        reclaimed={reclaimed}
        error={error}
      />
    );
  }

  return null;
}

function DupeReportView({
  report,
  keepers,
  setKeeper,
  onDelete,
  onRescan,
  phase,
  deletedCount,
  reclaimed,
  error,
}: {
  report: DupeReport;
  keepers: Map<string, DupeGroup["files"][number]>;
  setKeeper: (hash: string, file: DupeGroup["files"][number]) => void;
  onDelete: () => void;
  onRescan: () => void;
  phase: "ready" | "deleting" | "done";
  deletedCount: number;
  reclaimed: number;
  error: string | null;
}) {
  const totalReclaimable = useMemo(() => {
    return report.groups.reduce((sum, g) => {
      const keeper = keepers.get(g.hash);
      if (!keeper) return sum;
      return sum + (g.files.length - 1) * g.bytesPerFile;
    }, 0);
  }, [report.groups, keepers]);

  if (phase === "done") {
    return (
      <div className="py-16 text-center space-y-5 max-w-md mx-auto">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
          <Sparkles className="w-7 h-7 text-emerald-400" />
        </div>
        <h2 className="text-2xl font-semibold tracking-tight">Reclaimed {formatBytes(reclaimed)}</h2>
        <p className="text-sm text-gray-400">
          Deleted {deletedCount} duplicate file{deletedCount === 1 ? "" : "s"}.
        </p>
        {error && (
          <div className="inline-flex items-start gap-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-xs text-amber-200">
            <AlertTriangle className="w-3.5 h-3.5 flex-none mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        <button
          onClick={onRescan}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-white/10 hover:bg-white/[0.04] text-gray-100 text-sm transition-colors duration-200 cursor-pointer"
        >
          Scan again
        </button>
      </div>
    );
  }

  if (report.groups.length === 0) {
    return (
      <div className="py-16 text-center space-y-4">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <Check className="w-6 h-6 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">No duplicates found.</h2>
          <p className="mt-2 text-sm text-gray-400">
            Scanned {report.filesScanned} file{report.filesScanned === 1 ? "" : "s"}.
          </p>
        </div>
        <button
          onClick={onRescan}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-white/10 hover:bg-white/[0.04] text-gray-100 text-sm transition-colors duration-200 cursor-pointer"
        >
          Scan again
        </button>
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
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
            Found {report.groups.length} duplicate group
            {report.groups.length === 1 ? "" : "s"}
          </h2>
          <p className="mt-2 text-sm text-gray-400">
            Reclaim up to{" "}
            <span className="text-fuchsia-300 font-medium">{formatBytes(totalReclaimable)}</span>{" "}
            by deleting{" "}
            {report.groups.reduce((sum, g) => sum + (g.files.length - 1), 0)} extras.
          </p>
        </div>
        <button
          onClick={onDelete}
          disabled={phase === "deleting" || totalReclaimable === 0}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-semibold text-sm shadow-lg shadow-rose-500/20 transition-colors duration-200 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {phase === "deleting" ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Deleting…
            </>
          ) : (
            <>
              <Trash2 className="w-4 h-4" />
              Delete extras &middot; reclaim {formatBytes(totalReclaimable)}
            </>
          )}
        </button>
      </div>

      <div className="grid gap-3">
        {report.groups.map((group) => (
          <DupeGroupCard
            key={group.hash}
            group={group}
            keeper={keepers.get(group.hash)!}
            onPickKeeper={(file) => setKeeper(group.hash, file)}
          />
        ))}
      </div>
    </div>
  );
}

function DupeGroupCard({
  group,
  keeper,
  onPickKeeper,
}: {
  group: DupeGroup;
  keeper: ScannedFile;
  onPickKeeper: (file: ScannedFile) => void;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.04]">
        <Files className="w-4 h-4 text-fuchsia-400" />
        <span className="text-sm font-medium tracking-tight">
          {group.files.length} copies &middot; {formatBytes(group.bytesPerFile)} each
        </span>
        <span className="text-xs text-fuchsia-300/80 font-mono ml-auto">
          reclaim {formatBytes(group.reclaimableBytes)}
        </span>
      </div>
      <ul className="divide-y divide-white/[0.04]">
        {group.files.map((file) => {
          const isKeeper = file === keeper;
          return (
            <li
              key={file.relativePath}
              className={cn(
                "flex items-center gap-3 px-4 py-2 text-sm transition-colors duration-150",
                isKeeper ? "bg-emerald-500/5" : "hover:bg-white/[0.015]"
              )}
            >
              <input
                type="radio"
                name={`keep-${group.hash}`}
                className="accent-emerald-500 cursor-pointer"
                checked={isKeeper}
                onChange={() => onPickKeeper(file)}
                title="Keep this copy"
              />
              <span
                className={cn(
                  "flex-1 min-w-0 truncate",
                  isKeeper ? "text-emerald-200" : "text-gray-300 line-through decoration-rose-400/40"
                )}
              >
                {file.relativePath}
              </span>
              {isKeeper && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
                  keep
                </span>
              )}
              <span className="text-xs text-gray-500 font-mono whitespace-nowrap">
                {new Date(file.lastModified).toLocaleDateString()}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
