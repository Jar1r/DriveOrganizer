// In-session undo log for sort + folder operations.
// Tracks every successful move/rename/delete so the user can reverse it.
//
// Scope: this session only. We don't persist the FileSystemDirectoryHandle to
// IndexedDB yet — page refresh wipes the undo history. That's a deliberate
// trade-off; cross-session undo would need IDB plumbing and revoked-permission
// handling. Easy to add later.

import type { ScannedFile } from "./fs";
import { renameFolder } from "./folders";

export type MoveRecord = {
  // The file's name at its destination (may differ from originalName if there was a collision)
  destName: string;
  destDir: FileSystemDirectoryHandle;
  // Where it came from
  originalName: string;
  originalParent: FileSystemDirectoryHandle;
  size: number;
};

export type SortOperation = {
  id: string;
  timestamp: number;
  rootName: string;
  moves: MoveRecord[];
};

export type FolderRenameRecord = {
  parent: FileSystemDirectoryHandle;
  parentPath: string;
  oldName: string;
  // Final name we wrote (may have a "(2)" suffix if there was a collision)
  finalName: string;
};

export type FolderDeleteRecord = {
  parent: FileSystemDirectoryHandle;
  parentPath: string;
  name: string;
  // We only allow undo for deletes that WERE empty when removed. Restoring
  // contents from a recursive delete isn't possible here.
  wasEmpty: true;
};

export type FolderOperation = {
  kind: "folder";
  id: string;
  timestamp: number;
  rootName: string;
  renames: FolderRenameRecord[];
  deletes: FolderDeleteRecord[];
};

export type Operation = (SortOperation & { kind?: "sort" }) | FolderOperation;

export type UndoResult = {
  reversed: number;
  failed: { reason: string; label: string }[];
};

export class UndoManager {
  private log: Operation[] = [];
  private listeners = new Set<() => void>();

  begin(rootName: string): MoveRecorder {
    const op: SortOperation = {
      id: cryptoRandomId(),
      timestamp: Date.now(),
      rootName,
      moves: [],
    };
    return {
      record: (move) => op.moves.push(move),
      commit: () => {
        if (op.moves.length > 0) {
          this.log.push(op);
          this.notify();
        }
      },
    };
  }

  beginFolder(rootName: string): FolderRecorder {
    const op: FolderOperation = {
      kind: "folder",
      id: cryptoRandomId(),
      timestamp: Date.now(),
      rootName,
      renames: [],
      deletes: [],
    };
    return {
      recordRename: (record) => op.renames.push(record),
      recordDelete: (record) => op.deletes.push(record),
      commit: () => {
        if (op.renames.length > 0 || op.deletes.length > 0) {
          this.log.push(op);
          this.notify();
        }
      },
    };
  }

  latest(): Operation | null {
    return this.log[this.log.length - 1] ?? null;
  }

  latestSort(): SortOperation | null {
    for (let i = this.log.length - 1; i >= 0; i--) {
      const op = this.log[i];
      if (!isFolderOp(op)) return op;
    }
    return null;
  }

  latestFolder(): FolderOperation | null {
    for (let i = this.log.length - 1; i >= 0; i--) {
      const op = this.log[i];
      if (isFolderOp(op)) return op;
    }
    return null;
  }

  count(): number {
    return this.log.length;
  }

  async undo(operation: Operation): Promise<UndoResult> {
    if (isFolderOp(operation)) {
      return this.undoFolder(operation);
    }
    return this.undoSort(operation);
  }

  private async undoSort(operation: SortOperation): Promise<UndoResult> {
    const failed: UndoResult["failed"] = [];
    let reversed = 0;
    for (const move of [...operation.moves].reverse()) {
      try {
        const destFile = await move.destDir.getFileHandle(move.destName);
        const blob = await destFile.getFile();
        const restored = await uniqueName(move.originalParent, move.originalName);
        const restoredHandle = await move.originalParent.getFileHandle(restored, { create: true });
        const writable = await restoredHandle.createWritable();
        await blob.stream().pipeTo(writable);
        await move.destDir.removeEntry(move.destName);
        reversed++;
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        failed.push({ reason: message, label: move.originalName });
      }
    }
    this.log = this.log.filter((o) => o.id !== operation.id);
    this.notify();
    return { reversed, failed };
  }

  private async undoFolder(operation: FolderOperation): Promise<UndoResult> {
    const failed: UndoResult["failed"] = [];
    let reversed = 0;
    // Reverse renames first (they can fail noisily) then re-create deletes.
    for (const r of [...operation.renames].reverse()) {
      try {
        const result = await renameFolder(r.parent, r.finalName, r.oldName);
        if (result.ok) reversed++;
        else failed.push({ reason: result.error, label: `rename ${r.finalName} → ${r.oldName}` });
      } catch (err) {
        failed.push({
          reason: err instanceof Error ? err.message : "unknown",
          label: `rename ${r.finalName} → ${r.oldName}`,
        });
      }
    }
    for (const d of [...operation.deletes].reverse()) {
      try {
        // Recreating an empty folder is trivial — just create the directory.
        await d.parent.getDirectoryHandle(d.name, { create: true });
        reversed++;
      } catch (err) {
        failed.push({
          reason: err instanceof Error ? err.message : "unknown",
          label: `recreate ${d.name}`,
        });
      }
    }
    this.log = this.log.filter((o) => o.id !== operation.id);
    this.notify();
    return { reversed, failed };
  }

  clear() {
    this.log = [];
    this.notify();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    for (const fn of this.listeners) fn();
  }
}

function isFolderOp(op: Operation): op is FolderOperation {
  return (op as FolderOperation).kind === "folder";
}

export type MoveRecorder = {
  record: (move: MoveRecord) => void;
  commit: () => void;
};

export type FolderRecorder = {
  recordRename: (record: FolderRenameRecord) => void;
  recordDelete: (record: FolderDeleteRecord) => void;
  commit: () => void;
};

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
    const candidate = `${base} (restored ${i})${ext}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${base}-restored-${Date.now()}${ext}`;
}

function cryptoRandomId(): string {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Helper: derive a sensible original-parent path label for display
export function describeOperation(op: SortOperation): string {
  return `${op.moves.length} move${op.moves.length === 1 ? "" : "s"} in "${op.rootName}"`;
}

// Helper: total bytes moved in an operation
export function operationBytes(op: SortOperation): number {
  let sum = 0;
  for (const m of op.moves) sum += m.size;
  return sum;
}

// Build a MoveRecord from a successful moveFile() call
export function makeRecord(
  file: ScannedFile,
  destDir: FileSystemDirectoryHandle,
  destName: string
): MoveRecord {
  return {
    destName,
    destDir,
    originalName: file.name,
    originalParent: file.parent,
    size: file.size,
  };
}
