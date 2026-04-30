// File System Access API helpers.
// Supported in Chromium-based browsers (Chrome, Edge, Brave, Opera, Arc).
// Safari and Firefox do not support showDirectoryPicker yet.

export type ScannedFile = {
  name: string;
  size: number;
  lastModified: number;
  handle: FileSystemFileHandle;
  parent: FileSystemDirectoryHandle;
  relativePath: string;
};

export function isSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!isSupported()) {
    throw new Error("Your browser doesn't support folder access. Use Chrome, Edge, or Brave.");
  }
  try {
    return await (window as unknown as {
      showDirectoryPicker: (opts?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker({ mode: "readwrite" });
  } catch (err) {
    const e = err as DOMException;
    if (e?.name === "AbortError") return null;
    throw err;
  }
}

export async function scanDirectory(
  root: FileSystemDirectoryHandle,
  options: { recursive?: boolean; ignore?: Set<string> } = {}
): Promise<ScannedFile[]> {
  const recursive = options.recursive ?? false;
  const ignore = options.ignore ?? new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
  const results: ScannedFile[] = [];

  async function walk(dir: FileSystemDirectoryHandle, prefix: string) {
    // @ts-expect-error - .entries() exists at runtime
    for await (const [name, handle] of dir.entries()) {
      if (ignore.has(name)) continue;
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
          /* skip unreadable files */
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
  return root.getDirectoryHandle(name, { create: true });
}

export async function moveFile(
  file: ScannedFile,
  destDir: FileSystemDirectoryHandle
): Promise<void> {
  // No native move API. Pattern: copy → remove source.
  const source = await file.handle.getFile();
  const destName = await uniqueName(destDir, file.name);
  const destHandle = await destDir.getFileHandle(destName, { create: true });
  const writable = await destHandle.createWritable();
  await writable.write(await source.arrayBuffer());
  await writable.close();
  await file.parent.removeEntry(file.name);
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
