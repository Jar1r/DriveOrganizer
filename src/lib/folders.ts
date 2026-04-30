// Generic-folder detection and rename/delete operations.
//
// What's a "generic" folder? Names like "New folder", "New folder (2)",
// "untitled folder", or just "Untitled" — created by Windows / macOS when
// you press the new-folder shortcut and never name it. These pile up over
// years and are usually either empty or contain a small project the user
// forgot to name.

const SYSTEM_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

// Default patterns — case-insensitive. Users can override later if we
// expose this in Settings.
const DEFAULT_PATTERNS: RegExp[] = [
  /^new folder(?: \(\d+\))?$/i, // Windows: "New folder", "New folder (2)"
  /^new folder \d+$/i, // alt: "New folder 2"
  /^untitled folder(?: \d+)?$/i, // macOS: "untitled folder", "untitled folder 2"
  /^untitled(?: \(\d+\))?$/i, // bare "Untitled"
  /^untitled \d+$/i, // "Untitled 2"
  /^folder(?: ?\d+)?$/i, // "Folder", "Folder1", "Folder 2"
  /^folder \(\d+\)$/i, // "Folder (2)"
  /^new (?:archive|directory|folder)(?: \(\d+\))?$/i, // various locales
  /^document(?: \d+)?$/i, // sometimes folders get named "Document"
];

export type GenericFolder = {
  parent: FileSystemDirectoryHandle;
  parentPath: string; // POSIX-style for display (relative to root)
  handle: FileSystemDirectoryHandle;
  name: string;
  isEmpty: boolean; // empty or only contains system metadata files
  fileCount: number;
  subdirCount: number;
  totalBytes: number;
  // Up to 30 entries for AI context + UI preview
  sampleEntries: { name: string; kind: "file" | "directory"; size?: number }[];
};

export function isGenericName(name: string, patterns: RegExp[] = DEFAULT_PATTERNS): boolean {
  for (const p of patterns) if (p.test(name)) return true;
  return false;
}

export async function findGenericFolders(
  root: FileSystemDirectoryHandle,
  patterns: RegExp[] = DEFAULT_PATTERNS,
  signal?: AbortSignal,
  onProgress?: (scannedDirs: number) => void
): Promise<GenericFolder[]> {
  const found: GenericFolder[] = [];
  let scanned = 0;

  async function walk(dir: FileSystemDirectoryHandle, parentPath: string) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    scanned++;
    onProgress?.(scanned);

    // @ts-expect-error - .entries() exists at runtime in Chromium
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== "directory") continue;
      // Skip Windows system directories regardless
      if (name === "$RECYCLE.BIN" || name === "System Volume Information") continue;
      const subdir = handle as FileSystemDirectoryHandle;
      const childPath = parentPath ? `${parentPath}/${name}` : name;

      if (isGenericName(name, patterns)) {
        const inspection = await inspectFolder(subdir);
        found.push({
          parent: dir,
          parentPath,
          handle: subdir,
          name,
          ...inspection,
        });
      }
      // Recurse into ALL directories so we find generic folders at every depth
      try {
        await walk(subdir, childPath);
      } catch (err) {
        if ((err as Error)?.name === "AbortError") throw err;
        // Permission denied on a subfolder — skip silently
      }
    }
  }

  await walk(root, "");
  return found;
}

async function inspectFolder(dir: FileSystemDirectoryHandle): Promise<{
  isEmpty: boolean;
  fileCount: number;
  subdirCount: number;
  totalBytes: number;
  sampleEntries: GenericFolder["sampleEntries"];
}> {
  let fileCount = 0;
  let subdirCount = 0;
  let nonSystemCount = 0;
  let totalBytes = 0;
  const sample: GenericFolder["sampleEntries"] = [];

  try {
    // @ts-expect-error - .entries() exists at runtime in Chromium
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === "file") {
        fileCount++;
        if (!SYSTEM_FILES.has(name)) nonSystemCount++;
        if (sample.length < 30) {
          try {
            const file = await (handle as FileSystemFileHandle).getFile();
            sample.push({ name, kind: "file", size: file.size });
            totalBytes += file.size;
          } catch {
            sample.push({ name, kind: "file" });
          }
        } else {
          try {
            const file = await (handle as FileSystemFileHandle).getFile();
            totalBytes += file.size;
          } catch {
            /* skip */
          }
        }
      } else {
        subdirCount++;
        nonSystemCount++;
        if (sample.length < 30) {
          sample.push({ name, kind: "directory" });
        }
      }
    }
  } catch {
    // Permission denied or unreadable — treat as inspected with whatever we got
  }

  return {
    isEmpty: nonSystemCount === 0,
    fileCount,
    subdirCount,
    totalBytes,
    sampleEntries: sample,
  };
}

// Delete a folder (recursive). Uses the recursive removeEntry option so it
// also nukes the system metadata files inside "empty" folders.
export async function deleteFolder(
  parent: FileSystemDirectoryHandle,
  name: string
): Promise<void> {
  await parent.removeEntry(name, { recursive: true });
}

// Rename a folder by creating a new one, moving contents, and deleting the old.
// FileSystemDirectoryHandle has no native rename; this is the standard pattern.
// Best-effort: if any file fails to move, the original folder is preserved.
export async function renameFolder(
  parent: FileSystemDirectoryHandle,
  oldName: string,
  desiredName: string
): Promise<{ ok: true; finalName: string } | { ok: false; error: string }> {
  const cleaned = sanitizeFolderName(desiredName);
  if (!cleaned) return { ok: false, error: "Empty name after sanitization" };
  if (cleaned === oldName) return { ok: true, finalName: oldName };

  // Find a non-colliding name
  let finalName: string;
  try {
    finalName = await uniqueFolderName(parent, cleaned);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "name lookup failed" };
  }

  let oldDir: FileSystemDirectoryHandle;
  try {
    oldDir = await parent.getDirectoryHandle(oldName);
  } catch (err) {
    return { ok: false, error: `Couldn't open source: ${err instanceof Error ? err.message : "unknown"}` };
  }

  let newDir: FileSystemDirectoryHandle;
  try {
    newDir = await parent.getDirectoryHandle(finalName, { create: true });
  } catch (err) {
    return { ok: false, error: `Couldn't create destination: ${err instanceof Error ? err.message : "unknown"}` };
  }

  try {
    await moveTreeContents(oldDir, newDir);
    await parent.removeEntry(oldName, { recursive: true });
    return { ok: true, finalName };
  } catch (err) {
    // Best-effort cleanup of the partially-populated new directory
    try {
      await parent.removeEntry(finalName, { recursive: true });
    } catch {
      /* ignore */
    }
    return { ok: false, error: err instanceof Error ? err.message : "move failed" };
  }
}

async function moveTreeContents(
  src: FileSystemDirectoryHandle,
  dest: FileSystemDirectoryHandle
): Promise<void> {
  // @ts-expect-error - .entries() exists at runtime
  for await (const [name, handle] of src.entries()) {
    if (handle.kind === "file") {
      const fileHandle = handle as FileSystemFileHandle;
      const blob = await fileHandle.getFile();
      const targetName = await uniqueFileName(dest, name);
      const targetHandle = await dest.getFileHandle(targetName, { create: true });
      const writable = await targetHandle.createWritable();
      await blob.stream().pipeTo(writable);
    } else {
      const subSrc = handle as FileSystemDirectoryHandle;
      const subDest = await dest.getDirectoryHandle(name, { create: true });
      await moveTreeContents(subSrc, subDest);
    }
  }
}

function sanitizeFolderName(name: string): string {
  // Windows forbids: \ / : * ? " < > |
  return name.replace(/[\\/:*?"<>|]/g, "-").trim().replace(/^\.+$/, "").slice(0, 200);
}

async function uniqueFolderName(
  parent: FileSystemDirectoryHandle,
  name: string
): Promise<string> {
  const exists = async (n: string): Promise<boolean> => {
    try {
      await parent.getDirectoryHandle(n);
      return true;
    } catch {
      return false;
    }
  };
  if (!(await exists(name))) return name;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${name} (${i})`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${name}-${Date.now()}`;
}

async function uniqueFileName(
  dir: FileSystemDirectoryHandle,
  name: string
): Promise<string> {
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
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${base}-${Date.now()}${ext}`;
}
