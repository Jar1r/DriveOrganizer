// In-session undo log for sort operations.
// Tracks every successful move so the user can reverse a whole sort with one click.
//
// Scope: this session only. We don't persist the FileSystemDirectoryHandle to
// IndexedDB yet — page refresh wipes the undo history. That's a deliberate
// trade-off; cross-session undo would need IDB plumbing and revoked-permission
// handling. Easy to add later.

import type { ScannedFile } from "./fs";

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

export type UndoResult = {
  reversed: number;
  failed: { record: MoveRecord; reason: string }[];
};

export class UndoManager {
  private log: SortOperation[] = [];
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

  latest(): SortOperation | null {
    return this.log[this.log.length - 1] ?? null;
  }

  count(): number {
    return this.log.length;
  }

  async undo(operation: SortOperation): Promise<UndoResult> {
    const failed: UndoResult["failed"] = [];
    let reversed = 0;
    // Reverse in opposite order so any name-collision logic during apply
    // unwinds cleanly.
    for (const move of [...operation.moves].reverse()) {
      try {
        const destFile = await move.destDir.getFileHandle(move.destName);
        const blob = await destFile.getFile();
        // Restore original name into original parent
        const restored = await uniqueName(move.originalParent, move.originalName);
        const restoredHandle = await move.originalParent.getFileHandle(restored, { create: true });
        const writable = await restoredHandle.createWritable();
        await blob.stream().pipeTo(writable);
        await move.destDir.removeEntry(move.destName);
        reversed++;
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        failed.push({ record: move, reason: message });
      }
    }
    // Remove the undone operation from the log
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

export type MoveRecorder = {
  record: (move: MoveRecord) => void;
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
