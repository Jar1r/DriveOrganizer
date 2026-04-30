import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Apple,
  ArrowRight,
  Check,
  Download,
  FolderTree,
  Image as ImageIcon,
  FileText,
  Music,
  Film,
  Archive,
  Wand2,
  Lock,
  Zap,
  Monitor,
  X,
  Sparkles,
  Files,
  Undo2,
  Gauge,
} from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function detectPlatform(): "mac" | "windows" | "other" {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent || "";
  if (/Mac|iPhone|iPad|iPod/i.test(ua)) return "mac";
  if (/Win/i.test(ua)) return "windows";
  return "other";
}

function detectBrowser(): "chrome" | "edge" | "safari" | "firefox" | "other" {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent || "";
  if (/Edg\//i.test(ua)) return "edge";
  if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) return "chrome";
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return "safari";
  if (/Firefox\//i.test(ua)) return "firefox";
  return "other";
}

const FEATURES = [
  {
    icon: Sparkles,
    title: "AI rename + categorize",
    body: "Drop ugly filenames like IMG_8472.HEIC. AI reads context, renames them to something you'd recognize, and files them by meaning — not just extension.",
    accent: "from-fuchsia-500/20 to-pink-500/0",
    span: "md:col-span-2 md:row-span-2",
  },
  {
    icon: Files,
    title: "Find duplicate files",
    body: "Two-stage hashing finds exact dupes fast. See reclaimable space. One click to delete extras.",
    accent: "from-cyan-500/20 to-cyan-500/0",
    span: "",
  },
  {
    icon: Undo2,
    title: "One-click undo",
    body: "Don't like the result? Reverse the entire sort instantly. Your files come back exactly where they were.",
    accent: "from-amber-500/20 to-amber-500/0",
    span: "",
  },
  {
    icon: Lock,
    title: "Stays on your machine",
    body: "Files never leave your computer. No upload, no account, no telemetry.",
    accent: "from-emerald-500/20 to-emerald-500/0",
    span: "",
  },
  {
    icon: Gauge,
    title: "Built for huge folders",
    body: "Streams multi-GB files. Hashes 10K-file folders without melting your RAM.",
    accent: "from-sky-500/20 to-sky-500/0",
    span: "",
  },
];

export default function Landing() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [platform] = useState(detectPlatform);
  const [browser] = useState(detectBrowser);

  useEffect(() => {
    const onBefore = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", onBefore);
    window.addEventListener("appinstalled", onInstalled);
    if (window.matchMedia?.("(display-mode: standalone)").matches) {
      setInstalled(true);
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onBefore);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const handleInstall = useCallback(async () => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === "accepted") setInstalled(true);
        setDeferredPrompt(null);
      } catch {
        setShowHelp(true);
      }
      return;
    }
    setShowHelp(true);
  }, [deferredPrompt]);

  const primaryLabel =
    platform === "mac" ? "Install on Mac" : platform === "windows" ? "Install on Windows" : "Install DriveOrganizer";
  const secondaryLabel = platform === "mac" ? "Install on Windows" : "Install on Mac";
  const PrimaryIcon = platform === "windows" ? Monitor : Apple;
  const SecondaryIcon = platform === "windows" ? Apple : Monitor;

  return (
    <div className="min-h-screen bg-[#0b1220] text-gray-100 antialiased">
      <BackgroundFX />

      {/* Nav */}
      <header className="relative z-20">
        <div className="mx-auto max-w-6xl px-6 py-5 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 group cursor-pointer">
            <img src="/logo.svg" alt="DriveOrganizer" className="w-8 h-8 transition-transform duration-200 group-hover:scale-105" />
            <span className="font-semibold tracking-tight text-[15px]">DriveOrganizer</span>
          </Link>
          <nav className="flex items-center gap-1">
            <a
              href="#features"
              className="hidden sm:inline-flex text-sm text-gray-400 hover:text-gray-100 px-3 py-2 rounded-lg transition-colors duration-150"
            >
              Features
            </a>
            <a
              href="#how"
              className="hidden sm:inline-flex text-sm text-gray-400 hover:text-gray-100 px-3 py-2 rounded-lg transition-colors duration-150"
            >
              How it works
            </a>
            <Link
              to="/app"
              className="text-sm text-gray-100 hover:text-white px-4 py-2 rounded-lg bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] transition-colors duration-150 cursor-pointer"
            >
              Open app
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10">
        <div className="mx-auto max-w-6xl px-6 pt-12 pb-16 md:pt-20 md:pb-28">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/10 bg-white/[0.03] backdrop-blur-sm text-xs text-gray-400 mb-6 animate-fade-in">
              <Zap className="w-3.5 h-3.5 text-sky-400" />
              <span>Free during beta &middot; Mac &amp; Windows</span>
            </div>
            <h1 className="text-5xl md:text-7xl font-semibold tracking-tight leading-[1.04] animate-slide-up">
              Reclaim
              <br />
              <span className="bg-gradient-to-r from-fuchsia-300 via-sky-300 to-cyan-300 bg-clip-text text-transparent">
                your disk.
              </span>
            </h1>
            <p className="mt-6 text-base md:text-lg text-gray-400 max-w-2xl leading-relaxed">
              Pick a folder. AI renames the messy files, sorts them by meaning, and finds the
              duplicates eating your storage. Don&rsquo;t like the result? One-click undo puts
              everything back exactly where it was.
            </p>

            <div id="install" className="mt-10 flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleInstall}
                disabled={installed}
                className="group inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-sky-500 hover:bg-sky-400 active:bg-sky-600 text-[#0b1220] font-semibold text-sm shadow-lg shadow-sky-500/20 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
              >
                {installed ? (
                  <>
                    <Check className="w-4 h-4" />
                    Installed
                  </>
                ) : (
                  <>
                    <PrimaryIcon className="w-4 h-4" />
                    {primaryLabel}
                    <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                  </>
                )}
              </button>
              <button
                onClick={handleInstall}
                disabled={installed}
                className="inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-gray-100 font-medium text-sm transition-all duration-200 disabled:opacity-60 cursor-pointer"
              >
                <SecondaryIcon className="w-4 h-4" />
                {secondaryLabel}
              </button>
              <Link
                to="/app"
                className="inline-flex items-center justify-center gap-1.5 px-4 py-3.5 text-sm text-gray-400 hover:text-gray-100 transition-colors duration-150"
              >
                Try in browser
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
            <p className="mt-4 text-xs text-gray-500">
              Installs as a desktop app via your browser. No App Store. No installer file.
            </p>
          </div>

          {/* Visual demo card */}
          <div className="mt-16 md:mt-24 relative">
            <DemoCard />
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <section className="relative z-10 border-y border-white/[0.06] bg-white/[0.015]">
        <div className="mx-auto max-w-6xl px-6 py-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-xs text-gray-500">
          <span className="inline-flex items-center gap-2">
            <Lock className="w-3.5 h-3.5" /> 100% local. Files never leave your machine.
          </span>
          <span className="inline-flex items-center gap-2">
            <Zap className="w-3.5 h-3.5" /> Sorts thousands of files per second
          </span>
          <span className="inline-flex items-center gap-2">
            <Apple className="w-3.5 h-3.5" /> macOS &amp;
            <Monitor className="w-3.5 h-3.5" /> Windows
          </span>
        </div>
      </section>

      {/* Features bento */}
      <section id="features" className="relative z-10">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
          <div className="max-w-2xl">
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
              Smarter than a folder rule.
              <br />
              <span className="text-gray-400">Safer than a rm -rf.</span>
            </h2>
          </div>
          <div className="mt-12 grid grid-cols-1 md:grid-cols-3 md:auto-rows-[200px] gap-4">
            {FEATURES.map((f, i) => {
              const Icon = f.icon;
              return (
                <div
                  key={i}
                  className={`group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-sm p-6 transition-all duration-300 hover:border-white/15 hover:bg-white/[0.035] ${f.span}`}
                >
                  <div
                    className={`absolute inset-0 bg-gradient-to-br ${f.accent} opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none`}
                  />
                  <div className="relative flex flex-col h-full">
                    <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.06] mb-4">
                      <Icon className="w-5 h-5 text-sky-400" />
                    </div>
                    <h3 className="text-lg font-medium tracking-tight text-gray-100">{f.title}</h3>
                    <p className="mt-2 text-sm text-gray-400 leading-relaxed">{f.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="relative z-10 border-t border-white/[0.06]">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            {[
              {
                n: "01",
                title: "Pick + AI scan",
                body: "Choose any folder. AI reads filenames + small text excerpts, suggests clean names and the right category for each file.",
              },
              {
                n: "02",
                title: "Find the waste",
                body: "Switch to Duplicates. Two-stage hashing finds exact copies. See how much space you can reclaim before deleting anything.",
              },
              {
                n: "03",
                title: "Apply, then undo if you want",
                body: "Click apply. If the result isn't right, one click reverses every move. Your files come back exactly where they were.",
              },
            ].map((s) => (
              <div key={s.n} className="space-y-3">
                <div className="text-xs font-mono text-sky-400 tracking-wider">{s.n}</div>
                <h3 className="text-xl font-medium tracking-tight">{s.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative z-10">
        <div className="mx-auto max-w-4xl px-6 py-20 md:py-28">
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-sky-500/10 via-cyan-500/5 to-transparent p-10 md:p-14 text-center">
            <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-sky-500/10 blur-3xl pointer-events-none" />
            <div className="absolute -bottom-24 -left-24 w-72 h-72 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
            <h2 className="relative text-3xl md:text-4xl font-semibold tracking-tight">
              Reclaim your disk in 60 seconds.
            </h2>
            <p className="relative mt-4 text-gray-400 max-w-xl mx-auto">
              Install once. AI renames, sorts, and finds the duplicates.
              Undo if you don&rsquo;t like the result.
            </p>
            <div className="relative mt-8 flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={handleInstall}
                disabled={installed}
                className="inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-[#0b1220] font-semibold text-sm shadow-lg shadow-sky-500/20 transition-all duration-200 disabled:opacity-60 cursor-pointer"
              >
                {installed ? (
                  <>
                    <Check className="w-4 h-4" /> Installed
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" /> {primaryLabel}
                  </>
                )}
              </button>
              <Link
                to="/app"
                className="inline-flex items-center justify-center gap-1.5 px-6 py-3.5 rounded-xl border border-white/10 hover:bg-white/[0.04] text-gray-100 text-sm transition-colors duration-200 cursor-pointer"
              >
                Try in browser first
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/[0.06]">
        <div className="mx-auto max-w-6xl px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-gray-500">
          <div className="flex items-center gap-2.5">
            <img src="/logo.svg" alt="DriveOrganizer" className="w-5 h-5 opacity-80" />
            <span>DriveOrganizer &copy; {new Date().getFullYear()}</span>
          </div>
          <div className="flex items-center gap-5">
            <Link to="/app" className="hover:text-gray-300 transition-colors duration-150">
              Open app
            </Link>
            <a href="#features" className="hover:text-gray-300 transition-colors duration-150">
              Features
            </a>
            <a
              href="https://github.com/Jar1r/DriveOrganizer"
              target="_blank"
              rel="noreferrer"
              className="hover:text-gray-300 transition-colors duration-150"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>

      {showHelp && (
        <InstallHelpModal
          onClose={() => setShowHelp(false)}
          platform={platform}
          browser={browser}
        />
      )}
    </div>
  );
}

function BackgroundFX() {
  return (
    <div aria-hidden className="absolute inset-x-0 top-0 h-[760px] overflow-hidden pointer-events-none">
      <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[1100px] h-[1100px] rounded-full bg-[radial-gradient(ellipse_at_center,_rgba(14,165,233,0.18),_rgba(14,165,233,0.05)_38%,_transparent_62%)]" />
      <div className="absolute top-32 right-0 w-[480px] h-[480px] rounded-full bg-[radial-gradient(ellipse_at_center,_rgba(34,211,238,0.12),_transparent_60%)]" />
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(ellipse at center top, black 30%, transparent 70%)",
          WebkitMaskImage: "radial-gradient(ellipse at center top, black 30%, transparent 70%)",
        }}
      />
    </div>
  );
}

function DemoCard() {
  const before = [
    { icon: ImageIcon, name: "screenshot-2025-04-23.png", color: "text-amber-400" },
    { icon: FileText, name: "tax_q1.pdf", color: "text-sky-400" },
    { icon: Music, name: "podcast-ep14.mp3", color: "text-fuchsia-400" },
    { icon: Film, name: "demo-recording.mov", color: "text-rose-400" },
    { icon: Archive, name: "old-project.zip", color: "text-gray-400" },
    { icon: ImageIcon, name: "logo-final-v3.png", color: "text-amber-400" },
    { icon: FileText, name: "notes.md", color: "text-sky-400" },
  ];
  const after = [
    { folder: "Images", count: 2, color: "#f59e0b" },
    { folder: "Documents", count: 2, color: "#0ea5e9" },
    { folder: "Audio", count: 1, color: "#a855f7" },
    { folder: "Videos", count: 1, color: "#ef4444" },
    { folder: "Archives", count: 1, color: "#737373" },
  ];
  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 md:gap-6 items-stretch">
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs uppercase tracking-wider text-gray-500">Before</span>
          <span className="text-xs text-gray-600">~/Downloads</span>
        </div>
        <ul className="space-y-1.5">
          {before.map((f, i) => {
            const Icon = f.icon;
            return (
              <li
                key={i}
                className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-white/[0.03] transition-colors duration-150"
              >
                <Icon className={`w-4 h-4 ${f.color}`} />
                <span className="text-sm text-gray-300 truncate">{f.name}</span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="hidden md:flex items-center justify-center">
        <div className="flex items-center gap-2 text-sky-400">
          <Wand2 className="w-5 h-5" />
          <ArrowRight className="w-5 h-5" />
        </div>
      </div>
      <div className="rounded-2xl border border-sky-500/20 bg-gradient-to-br from-sky-500/[0.05] to-transparent backdrop-blur-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs uppercase tracking-wider text-sky-400">After</span>
          <span className="text-xs text-gray-600">~/Downloads</span>
        </div>
        <ul className="space-y-1.5">
          {after.map((f, i) => (
            <li
              key={i}
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]"
            >
              <span
                className="w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: f.color }}
              />
              <FolderTree className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-200 flex-1">{f.folder}</span>
              <span className="text-xs text-gray-500 font-mono">{f.count}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function InstallHelpModal({
  onClose,
  platform,
  browser,
}: {
  onClose: () => void;
  platform: "mac" | "windows" | "other";
  browser: "chrome" | "edge" | "safari" | "firefox" | "other";
}) {
  const steps = getManualSteps(platform, browser);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-6 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#11192b] p-6 shadow-2xl animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors duration-150 cursor-pointer"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 mb-4">
          <Download className="w-5 h-5 text-sky-400" />
        </div>
        <h3 className="text-lg font-medium tracking-tight">Install DriveOrganizer</h3>
        <p className="mt-1 text-sm text-gray-400">{steps.intro}</p>
        <ol className="mt-5 space-y-3">
          {steps.steps.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex-none inline-flex items-center justify-center w-6 h-6 rounded-full bg-white/[0.04] border border-white/10 text-xs text-gray-400">
                {i + 1}
              </span>
              <span className="text-sm text-gray-300 leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>
        <button
          onClick={onClose}
          className="mt-6 w-full inline-flex items-center justify-center px-4 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-[#0b1220] font-semibold text-sm transition-colors duration-200 cursor-pointer"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

function getManualSteps(
  platform: "mac" | "windows" | "other",
  browser: "chrome" | "edge" | "safari" | "firefox" | "other"
): { intro: string; steps: string[] } {
  if (browser === "safari") {
    return {
      intro: "Safari can install DriveOrganizer as a Mac app on macOS Sonoma and later.",
      steps: [
        "Click the Share button in Safari's toolbar.",
        "Choose \"Add to Dock\".",
        "DriveOrganizer opens like any other Mac app.",
      ],
    };
  }
  if (browser === "firefox") {
    return {
      intro:
        "Firefox doesn't support installing web apps. Use Chrome, Edge, or Brave to install DriveOrganizer.",
      steps: [
        "Open this page in Chrome, Edge, Brave, or Arc.",
        "Look for the install icon on the right side of the address bar.",
        "Click it and confirm to add DriveOrganizer.",
      ],
    };
  }
  return {
    intro: "Your browser supports installing DriveOrganizer as a desktop app.",
    steps: [
      "Look for the install icon on the right side of the address bar.",
      "Click it, then choose \"Install\".",
      platform === "mac"
        ? "DriveOrganizer appears in your dock and Launchpad."
        : platform === "windows"
        ? "DriveOrganizer appears in your Start menu and taskbar."
        : "DriveOrganizer appears in your apps list.",
      "Don't see the icon? Open the browser menu and look for \"Install DriveOrganizer\".",
    ],
  };
}
