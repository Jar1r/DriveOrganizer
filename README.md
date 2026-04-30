# DriveOrganizer

Local-first AI disk cleaner. Pick any folder on your Mac or Windows machine — AI renames the
ugly filenames, sorts everything by meaning, and finds the duplicates eating your storage.
One-click undo if you don't like the result. Files never leave your machine.

Installs as a desktop app via your browser (Chrome/Edge/Brave/Arc on Mac & Windows). No App Store, no installer file.

## What it does

**Sort** — categorizes every file in a folder, optionally with AI-generated names. Built-in
rules cover images, video, audio, docs, code, archives, fonts, installers, shortcuts; rules
are editable per-category and persist locally.

**AI rename + categorize** — bring your own Anthropic or OpenAI key. AI reads filenames
(plus a 240-char excerpt for small text/code files), suggests a clean human-readable name,
and picks the best semantic category. You preview every rename before anything moves.

**Find duplicates** — two-stage hashing (size+head+tail fast hash → full SHA-256 only on
candidates) finds exact duplicates without melting your RAM. Pick which copy to keep,
reclaim space.

**Undo** — every move is logged in-session. One click reverses every file to its original
location with its original name.

## Stack

- Vite + React 18 + TypeScript
- Tailwind CSS
- React Router
- File System Access API (Chromium-based browsers)
- PWA installable

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:5173 — you'll land on the marketing page. Click **Open app** (or go to `/app`) to use the organizer.

## Build

```bash
npm run build
npm run preview
```

## Deploy to Vercel

The repo includes `vercel.json` with SPA rewrites and PWA headers.

```bash
# from the project root, on your machine:
npx vercel deploy        # creates a preview deployment
npx vercel deploy --prod # promotes to production
```

Or connect this GitHub repo to a Vercel project and pushes to `main` will auto-deploy.

## How it works

The organizer page uses the **File System Access API** (`window.showDirectoryPicker`)
to read the folder you choose. It walks the directory, categorizes each file by
extension, and shows you a preview before any move happens.

When you click **Apply**, DriveOrganizer:

1. Creates a subfolder for each category (e.g. `Images/`, `Documents/`, `Code/`).
2. Moves each file into the appropriate subfolder. Move = read original + write to destination + delete original (the API has no native move).
3. Handles name collisions by appending `(1)`, `(2)`, etc.

Default categories live in `src/lib/rules.ts`. Custom folder names persist to `localStorage`.

## Browser support

| Browser            | Read folders | Install as app |
| ------------------ | ------------ | -------------- |
| Chrome / Edge      | ✅           | ✅             |
| Brave / Arc / Opera| ✅           | ✅             |
| Safari (macOS)     | ❌           | ✅ (Add to Dock) |
| Firefox            | ❌           | ❌             |

The organizer page falls back to a friendly "browser not supported" screen on Safari/Firefox.
The landing page works everywhere.

## Drive support

DriveOrganizer is **drive-agnostic**. It operates on whatever folder you pick via the
File System Access API — drive letter, mount point, or path don't matter.

| Setup                              | Works |
| ---------------------------------- | ----- |
| Single drive (C: only)             | ✅    |
| Dual drive (C: SSD + D: HDD, e.g. Lenovo Legion Y720) | ✅    |
| External USB / Thunderbolt drive   | ✅    |
| Mapped network drive (Z:)          | ✅ (slower) |
| OneDrive synced folder             | ✅ (see caveats below) |

**Cross-drive limitation:** the organizer only sorts files *within* the folder you pick.
It can't move a file from `C:\Downloads` to `D:\Sorted` in one operation. If you want
to consolidate across drives, drag files into a single folder first, then run the
organizer on that folder.

## Windows 11 notes

Windows 11's protections cause specific failure modes. The app classifies and reports
each one so you know how to fix it.

**Folders that work:**
- Documents, Desktop, Downloads, Pictures, Music, Videos
- Any folder you created (`C:\Users\<you>\Code`, `D:\Projects`, etc.)
- USB drives, external SSDs, network shares

**Folders that won't work** (Windows blocks browser access):
- `C:\Windows`, `C:\Program Files`, `C:\Program Files (x86)`
- `AppData` and other hidden system directories
- The root of `C:\Users\<you>\` (you can pick subfolders, just not the root)

**OneDrive Files-On-Demand:** if your Documents/Desktop are redirected to OneDrive,
files marked "online-only" must download before they can be moved. The app warns when
it detects a OneDrive folder. To force a file local: right-click in File Explorer →
"Always keep on this device".

**Files in use by another app:** Windows file locks (Word, Photoshop, anything with
the file open) cause moves to fail with a clear error. Close the app and retry —
already-moved files won't be re-touched.

**Long paths:** Windows still has a 260-char path limit unless long paths are enabled
in the registry. The app catches name-too-long errors and reports them.

**Permission revocation:** Windows 11 + Edge can drop the File System Access permission
between scan and apply. The app re-prompts before writing instead of silently failing.

## Privacy

Everything happens on-device. No analytics, no telemetry, no upload. The service worker is
a pass-through (no offline caching) so you always get the latest deploy.

## License

MIT
