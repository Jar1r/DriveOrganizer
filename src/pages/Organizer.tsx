import { useCallback, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Cloud,
  Cog,
  Files,
  FolderOpen,
  Info,
  RotateCcw,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import { isSupported, pickDirectory } from "@/lib/fs";
import { loadSettings, saveSettings, type Settings } from "@/lib/storage";
import { UndoManager } from "@/lib/undo";
import { cn } from "@/lib/cn";
import SortView from "@/components/SortView";
import DuplicatesView from "@/components/DuplicatesView";
import SettingsView from "@/components/SettingsView";

type Tab = "sort" | "dupes" | "settings";

export default function Organizer() {
  const [supported] = useState(isSupported);
  const [root, setRoot] = useState<FileSystemDirectoryHandle | null>(null);
  const [rootName, setRootName] = useState("");
  const [oneDriveLikely, setOneDriveLikely] = useState(false);
  const [recursive, setRecursive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("sort");
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const undoManagerRef = useRef<UndoManager>(new UndoManager());

  const updateSettings = useCallback((next: Settings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

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
    <div className="min-h-screen bg-[#0b1220] text-gray-100">
      <header className="border-b border-white/[0.06] sticky top-0 z-30 bg-[#0b1220]/85 backdrop-blur-md">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between gap-4">
          <Link
            to="/"
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-100 transition-colors duration-150 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <img src="/logo.svg" alt="" className="w-6 h-6" />
            <span className="font-medium tracking-tight text-gray-100 hidden sm:inline">
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

        {root && tab === "settings" && (
          <SettingsView settings={settings} onChange={updateSettings} />
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
        "inline-flex items-center gap-1.5 px-4 py-3 text-sm font-medium tracking-tight border-b-2 transition-colors duration-150 cursor-pointer",
        active
          ? "border-sky-400 text-gray-100"
          : "border-transparent text-gray-500 hover:text-gray-200"
      )}
    >
      {children}
    </button>
  );
}

function PickFolderScreen({ onPick }: { onPick: () => void }) {
  return (
    <div className="text-center py-16">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-sky-500/10 border border-sky-500/20 mb-6">
        <FolderOpen className="w-7 h-7 text-sky-400" />
      </div>
      <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">Pick a folder</h1>
      <p className="mt-3 text-sm text-gray-400 max-w-md mx-auto">
        DriveOrganizer reads what you pick and never uploads anything. Works on any drive &mdash;
        C:, D:, USB, network share.
      </p>
      <button
        onClick={onPick}
        className="mt-8 inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-[#0b1220] font-semibold text-sm shadow-lg shadow-sky-500/20 transition-all duration-200 cursor-pointer"
      >
        <FolderOpen className="w-4 h-4" />
        Pick folder
      </button>

      <div className="mt-12 max-w-xl mx-auto text-left">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-xs text-gray-400 space-y-3">
          <div className="flex items-start gap-2">
            <Info className="w-3.5 h-3.5 mt-0.5 flex-none text-sky-400" />
            <div>
              <span className="text-gray-200 font-medium">Windows tip:</span> pick Documents,
              Desktop, Downloads, or any folder you created. Windows blocks browser access to
              system folders (Program Files, Windows, AppData) by design.
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Cloud className="w-3.5 h-3.5 mt-0.5 flex-none text-sky-400" />
            <div>
              <span className="text-gray-200 font-medium">OneDrive tip:</span> online-only files
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

