# DriveOrganizer

Local-first file organizer. Pick any folder on your Mac or Windows machine, and DriveOrganizer
sorts the contents into clean, categorized subfolders. Files never leave your machine.

Installs as a desktop app via your browser (Chrome/Edge/Brave/Arc on Mac & Windows). No App Store, no installer file.

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

## Privacy

Everything happens on-device. No analytics, no telemetry, no upload. The service worker is
a pass-through (no offline caching) so you always get the latest deploy.

## License

MIT
