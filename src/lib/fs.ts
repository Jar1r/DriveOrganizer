// File System Access API helpers.
// Supported in Chromium-based browsers (Chrome, Edge, Brave, Opera, Arc).
// Safari and Firefox do not support showDirectoryPicker yet.
//
// Drive-agnostic: works on any drive letter (C:, D:, E:, USB, network share)
// because we only operate on the FileSystemDirectoryHandle the user picks.
// We never assume a specific drive layout. A single-drive Surface and a
// dual-drive Lenovo Legion both work identically.

export type ScannedFile = {
  name: string;
  size: number;
  lastModified: number;
  handle: FileSystemFileHandle;
  parent: FileSystemDirectoryHandle;
  relativePath: string;
};

export type MoveErrorCode =
  | "permission-denied"
  | "file-locked"
  | "onedrive-offline"
  | "destination-exists"
  | "source-missing"
  | "quota-exceeded"
  | "name-too-long"
  | "unknown";

export type MoveError = {
  file: ScannedFile;
  code: MoveErrorCode;
  message: string;
};

export type MoveResult =
  | { ok: true; destName: string }
  | { ok: false; error: MoveError };

export type FileSystemHandlePermissionDescriptor = {
  mode?: "read" | "readwrite";
};

type PermissionAwareHandle = FileSystemHandle & {
  queryPermission?: (d: FileSystemHandlePermissionDescriptor) => Promise<PermissionState>;
  requestPermission?: (d: FileSystemHandlePermissionDescriptor) => Promise<PermissionState>;
};

export function isSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!isSupported()) {
    throw new Error("Your browser doesn't support folder access. Use Chrome, Edge, or Brave on Mac or Windows.");
  }
  try {
    const handle = await (window as unknown as {
      showDirectoryPicker: (opts?: { mode?: "read" | "readwrite"; id?: string; startIn?: string }) => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker({ mode: "readwrite", id: "drive-organizer-root" });
    return handle;
  } catch (err) {
    const e = err as DOMException;
    if (e?.name === "AbortError") return null;
    if (e?.name === "SecurityError") {
      throw new Error(
        "That folder is protected by Windows. Try Documents, Desktop, Downloads, or any custom folder you created."
      );
    }
    throw err;
  }
}

export async function ensureWritePermission(
  handle: FileSystemDirectoryHandle
): Promise<boolean> {
  const h = handle as PermissionAwareHandle;
  if (!h.queryPermission || !h.requestPermission) return true;
  const opts: FileSystemHandlePermissionDescriptor = { mode: "readwrite" };
  if ((await h.queryPermission(opts)) === "granted") return true;
  return (await h.requestPermission(opts)) === "granted";
}

// Default ignore list:
//  - macOS metadata (.DS_Store)
//  - Windows metadata (Thumbs.db, desktop.ini)
//  - Windows shortcut files (.lnk) — handled by category, not ignored entirely
const DEFAULT_IGNORE = new Set([".DS_Store", "Thumbs.db", "desktop.ini", "$RECYCLE.BIN", "System Volume Information"]);

export async function scanDirectory(
  root: FileSystemDirectoryHandle,
  options: { recursive?: boolean; ignore?: Set<string> } = {}
): Promise<ScannedFile[]> {
  const recursive = options.recursive ?? false;
  const ignore = options.ignore ?? DEFAULT_IGNORE;
  const results: ScannedFile[] = [];

  async function walk(dir: FileSystemDirectoryHandle, prefix: string) {
    // @ts-expect-error - .entries() exists at runtime in Chromium
    for await (const [name, handle] of dir.entries()) {
      if (ignore.has(name)) continue;
      // Skip hidden files starting with '.' EXCEPT well-known dotfiles users care about
      if (name.startsWith(".") && !name.startsWith(".env") && name !== ".gitignore") continue;
      if (handle.kind === "file") {
        try {
          const file = await (handle as FileSystemFileHandle).getFile();
          results.push({
            name,
            size: file.size,
            lastModified: file.lastModified,
            handle: handle as FileSystemFileHandle,
            parent: dir,
            relativePath: prefix ? `${prefix}/${name}` : name,
          });
        } catch {
          // Unreadable file — likely OneDrive online-only that failed to hydrate,
          // permission-locked, or in use by another process. Skip silently here;
          // it'll show up as an error during the move phase if user tries to move it.
        }
      } else if (recursive && handle.kind === "directory") {
        await walk(handle as FileSystemDirectoryHandle, prefix ? `${prefix}/${name}` : name);
      }
    }
  }

  await walk(root, "");
  return results;
}

export async function ensureSubdirectory(
  root: FileSystemDirectoryHandle,
  name: string
): Promise<FileSystemDirectoryHandle> {
  // Sanitize folder name: Windows forbids \ / : * ? " < > |
  const safe = name.replace(/[\\/:*?"<>|]/g, "-").trim() || "Sorted";
  return root.getDirectoryHandle(safe, { create: true });
}

export async function moveFile(
  file: ScannedFile,
  destDir: FileSystemDirectoryHandle
): Promise<MoveResult> {
  // No native move API. Pattern: read source → write to destination → remove source.
  // Each step can fail in distinct ways on Windows 11; classify the failure for the user.
  let source: File;
  try {
    source = await file.handle.getFile();
  } catch (err) {
    return { ok: false, error: classifyError(file, err, "read") };
  }

  let destName: string;
  try {
    destName = await uniqueName(destDir, file.name);
  } catch (err) {
    return { ok: false, error: classifyError(file, err, "name") };
  }

  let destHandle: FileSystemFileHandle;
  try {
    destHandle = await destDir.getFileHandle(destName, { create: true });
  } catch (err) {
    return { ok: false, error: classifyError(file, err, "create") };
  }

  try {
    const writable = await destHandle.createWritable();
    // Stream chunks instead of loading entire file into memory — avoids OOM on
    // multi-GB videos and is friendlier to Win11 OneDrive Files-On-Demand.
    await source.stream().pipeTo(writable);
  } catch (err) {
    // Best-effort cleanup of partial destination file
    try {
      await destDir.removeEntry(destName);
    } catch {
      /* ignore */
    }
    return { ok: false, error: classifyError(file, err, "write") };
  }

  try {
    await file.parent.removeEntry(file.name);
  } catch (err) {
    return { ok: false, error: classifyError(file, err, "remove") };
  }

  return { ok: true, destName };
}

// Move with an optional override name (used by AI rename — we want to write
// the file under a new, AI-suggested name instead of preserving file.name).
export async function moveFileAs(
  file: ScannedFile,
  destDir: FileSystemDirectoryHandle,
  desiredName: string
): Promise<MoveResult> {
  // Sanitize the AI-proposed name and preserve the original extension if the
  // model dropped it
  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
  const cleaned = desiredName.replace(/[\\/:*?"<>|]/g, "-").trim() || file.name;
  const finalName = cleaned.toLowerCase().endsWith(ext.toLowerCase())
    ? cleaned
    : ext
    ? cleaned + ext
    : cleaned;

  // Build a virtual ScannedFile with the desired name so the rest of the move
  // pipeline doesn't need a different code path
  const virtual: ScannedFile = { ...file, name: file.name }; // keep original name for source read
  // We can't reuse moveFile directly because uniqueName uses file.name. Inline:
  let source: File;
  try {
    source = await virtual.handle.getFile();
  } catch (err) {
    return { ok: false, error: classifyError(virtual, err, "read") };
  }
  let destName: string;
  try {
    destName = await uniqueName(destDir, finalName);
  } catch (err) {
    return { ok: false, error: classifyError(virtual, err, "name") };
  }
  let destHandle: FileSystemFileHandle;
  try {
    destHandle = await destDir.getFileHandle(destName, { create: true });
  } catch (err) {
    return { ok: false, error: classifyError(virtual, err, "create") };
  }
  try {
    const writable = await destHandle.createWritable();
    await source.stream().pipeTo(writable);
  } catch (err) {
    try {
      await destDir.removeEntry(destName);
    } catch {
      /* ignore */
    }
    return { ok: false, error: classifyError(virtual, err, "write") };
  }
  try {
    await virtual.parent.removeEntry(virtual.name);
  } catch (err) {
    return { ok: false, error: classifyError(virtual, err, "remove") };
  }
  return { ok: true, destName };
}

function classifyError(file: ScannedFile, err: unknown, phase: string): MoveError {
  const e = err as DOMException & { message?: string };
  const name = e?.name ?? "";
  const message = e?.message ?? String(err);
  const lower = message.toLowerCase();

  if (name === "NotAllowedError" || name === "SecurityError") {
    return {
      file,
      code: "permission-denied",
      message: "Permission denied. Re-grant access to the folder and try again.",
    };
  }
  if (name === "NotFoundError") {
    return {
      file,
      code: "source-missing",
      message: "File no longer exists. It may have been moved or deleted in another window.",
    };
  }
  if (name === "QuotaExceededError" || lower.includes("quota") || lower.includes("space")) {
    return {
      file,
      code: "quota-exceeded",
      message: "Not enough disk space to move this file.",
    };
  }
  if (lower.includes("onedrive") || lower.includes("offline") || lower.includes("hydration")) {
    return {
      file,
      code: "onedrive-offline",
      message: "OneDrive online-only file couldn't download. Right-click the file in Explorer and choose 'Always keep on this device', then retry.",
    };
  }
  if (lower.includes("locked") || lower.includes("being used") || lower.includes("in use") || lower.includes("sharing violation")) {
    return {
      file,
      code: "file-locked",
      message: "File is open in another app (Word, Photoshop, etc.). Close it and retry.",
    };
  }
  if (lower.includes("name") && (lower.includes("long") || lower.includes("invalid"))) {
    return {
      file,
      code: "name-too-long",
      message: "File name or path is too long for Windows. Try a shorter destination folder name.",
    };
  }
  return {
    file,
    code: "unknown",
    message: `${phase} failed: ${message || "unknown error"}`,
  };
}

async function uniqueName(dir: FileSystemDirectoryHandle, name: string): Promise<string> {
  const exists = async (n: string): Promise<boolean> => {
    try {
      await dir.getFileHandle(n);
      return true;
    } catch {
      return false;
    }
  };
  if (!(await exists(name))) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 1; i < 1000; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${base}-${Date.now()}${ext}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
