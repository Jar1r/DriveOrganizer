import { useCallback, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Cloud,
  Cog,
  Files,
  FolderOpen,
  FolderSearch,
  Info,
  RotateCcw,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import { isSupported, pickDirectory } from "@/lib/fs";
import { loadSettings, saveSettings, type Settings } from "@/lib/storage";
import { loadUsage, type UsageRecord } from "@/lib/usage";
import { UndoManager } from "@/lib/undo";
import { cn } from "@/lib/cn";
import SortView from "@/components/SortView";
import DuplicatesView from "@/components/DuplicatesView";
import FoldersView from "@/components/FoldersView";
import SettingsView from "@/components/SettingsView";

type Tab = "sort" | "dupes" | "folders" | "settings";

export default function Organizer() {
  const [supported] = useState(isSupported);
  const [root, setRoot] = useState<FileSystemDirectoryHandle | null>(null);
  const [rootName, setRootName] = useState("");
  const [oneDriveLikely, setOneDriveLikely] = useState(false);
  const [recursive, setRecursive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("sort");
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [usage, setUsage] = useState<UsageRecord>(() => loadUsage());
  const undoManagerRef = useRef<UndoManager>(new UndoManager());

  const updateSettings = useCallback((next: Settings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const handleOpenSettings = useCallback(() => setTab("settings"), []);

  const handlePick = useCallback(async () => {
    setError(null);
    try {
      const dir = await pickDirectory();
      if (!dir) return;
      setRoot(dir);
      setRootName(dir.name);
      setOneDriveLikely(/onedrive/i.test(dir.name));
      setTab("sort");
      undoManagerRef.current.clear();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to read folder");
    }
  }, []);

  const handleReset = useCallback(() => {
    setRoot(null);
    setRootName("");
    setOneDriveLikely(false);
    undoManagerRef.current.clear();
  }, []);

  if (!supported) return <UnsupportedScreen />;

  return (
    <div className="min-h-screen text-gray-100">
      <header className="border-b border-cyan-500/[0.18] sticky top-0 z-30 bg-[#070a1c]/80 backdrop-blur-md">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between gap-4">
          <Link
            to="/"
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-100 transition-colors duration-150 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <img src="/logo.svg" alt="" className="w-6 h-6 animate-neon-pulse" />
            <span className="cyber-bracket text-gray-100 hidden sm:inline">
              DriveOrganizer
            </span>
          </Link>
          <div className="flex items-center gap-3 min-w-0">
            {rootName && (
              <span className="hidden md:inline-flex items-center gap-1.5 text-xs text-gray-500 max-w-xs truncate">
                <FolderOpen className="w-3.5 h-3.5" />
                <span className="truncate">{rootName}</span>
              </span>
            )}
            {root && (
              <button
                onClick={handleReset}
                className="flex-none text-xs text-gray-400 hover:text-gray-100 px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/[0.04] transition-colors duration-150 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5 inline mr-1.5" />
                Pick another
              </button>
            )}
          </div>
        </div>
        {root && (
          <div className="mx-auto max-w-6xl px-6 flex items-center gap-1 -mb-px">
            <TabButton active={tab === "sort"} onClick={() => setTab("sort")}>
              <Sparkles className="w-3.5 h-3.5" />
              Sort
            </TabButton>
            <TabButton active={tab === "dupes"} onClick={() => setTab("dupes")}>
              <Files className="w-3.5 h-3.5" />
              Duplicates
            </TabButton>
            <TabButton active={tab === "folders"} onClick={() => setTab("folders")}>
              <FolderSearch className="w-3.5 h-3.5" />
              Folders
            </TabButton>
            <TabButton active={tab === "settings"} onClick={() => setTab("settings")}>
              <Cog className="w-3.5 h-3.5" />
              Settings
            </TabButton>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {error && (
          <div className="mb-6 flex items-start gap-3 p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-sm text-rose-200">
            <AlertTriangle className="w-4 h-4 flex-none mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {!root && <PickFolderScreen onPick={handlePick} />}

        {root && tab === "sort" && (
          <SortView
            key={`sort-${rootName}`}
            root={root}
            rootName={rootName}
            oneDriveLikely={oneDriveLikely}
            recursive={recursive}
            setRecursive={setRecursive}
            settings={settings}
            undoManager={undoManagerRef.current}
            usage={usage}
            onUsageChange={setUsage}
            onOpenSettings={handleOpenSettings}
          />
        )}

        {root && tab === "dupes" && (
          <DuplicatesView
            key={`dupes-${rootName}`}
            root={root}
            recursive={recursive}
            setRecursive={setRecursive}
          />
        )}

        {root && tab === "folders" && (
          <FoldersView
            key={`folders-${rootName}`}
            root={root}
            rootName={rootName}
            settings={settings}
            usage={usage}
            onUsageChange={setUsage}
            onOpenSettings={handleOpenSettings}
            undoManager={undoManagerRef.current}
          />
        )}

        {root && tab === "settings" && (
          <SettingsView
            settings={settings}
            onChange={updateSettings}
            usage={usage}
            onUsageReset={setUsage}
          />
        )}
      </main>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-4 py-3 text-xs cyber-bracket border-b-2 transition-all duration-200 cursor-pointer",
        active
          ? "border-cyan-400 text-cyan-200 [text-shadow:0_0_8px_rgba(34,211,238,0.45)]"
          : "border-transparent text-gray-500 hover:text-gray-200 hover:border-cyan-500/30"
      )}
    >
      {children}
    </button>
  );
}

function PickFolderScreen({ onPick }: { onPick: () => void }) {
  return (
    <div className="text-center py-16">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-400/40 mb-6 shadow-glow-cyan-sm">
        <FolderOpen className="w-7 h-7 text-cyan-300" />
      </div>
      <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
        <span className="neon-cyan">Pick a folder</span>
      </h1>
      <p className="mt-3 text-sm text-gray-400 max-w-md mx-auto">
        DriveOrganizer reads what you pick and never uploads anything. Works on any drive &mdash;
        C:, D:, USB, network share.
      </p>
      <button
        onClick={onPick}
        className="neon-cyan-btn mt-8 inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-[#070a1c] font-semibold text-sm transition-all duration-200 cursor-pointer"
      >
        <FolderOpen className="w-4 h-4" />
        Pick folder
      </button>

      <div className="mt-12 max-w-xl mx-auto text-left">
        <div className="rounded-xl border border-cyan-500/[0.15] bg-cyan-500/[0.02] p-4 text-xs text-gray-400 space-y-3">
          <div className="flex items-start gap-2">
            <Info className="w-3.5 h-3.5 mt-0.5 flex-none text-cyan-400" />
            <div>
              <span className="text-cyan-200 font-medium cyber-bracket">[ win ]</span> pick Documents,
              Desktop, Downloads, or any folder you created. Windows blocks browser access to
              system folders (Program Files, Windows, AppData) by design.
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Cloud className="w-3.5 h-3.5 mt-0.5 flex-none text-fuchsia-400" />
            <div>
              <span className="text-fuchsia-200 font-medium cyber-bracket">[ onedrive ]</span> online-only files
              download on read. Big folders may take a moment.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function UnsupportedScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
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

