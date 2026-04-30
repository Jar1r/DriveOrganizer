// Duplicate detection using two-stage hashing for speed.
// Stage 1: fast hash (size + head + tail 64KB) — eliminates non-candidates
//          without reading the full file
// Stage 2: full SHA-256 only on files that share a fast-hash group
//
// On a 10K-file folder, this typically reads <5% of the total bytes.

import { fastHash, hashFile } from "./hash";
import type { ScannedFile } from "./fs";

export type DupeGroup = {
  hash: string;
  files: ScannedFile[];
  bytesPerFile: number;
  reclaimableBytes: number; // (count - 1) * bytesPerFile
};

export type DupeReport = {
  groups: DupeGroup[];
  totalReclaimable: number;
  filesScanned: number;
};

export type ProgressCb = (phase: "fast" | "full", done: number, total: number) => void;

export async function findDuplicates(
  files: ScannedFile[],
  onProgress?: ProgressCb,
  signal?: AbortSignal
): Promise<DupeReport> {
  // Stage 1: group by fast hash
  const fastGroups = new Map<string, ScannedFile[]>();
  let fastDone = 0;
  for (const file of files) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (file.size === 0) {
      fastDone++;
      continue; // skip empty files
    }
    try {
      const blob = await file.handle.getFile();
      const fh = await fastHash(blob);
      const list = fastGroups.get(fh) ?? [];
      list.push(file);
      fastGroups.set(fh, list);
    } catch {
      // Unreadable file, skip
    }
    fastDone++;
    onProgress?.("fast", fastDone, files.length);
  }

  // Only groups with 2+ files are candidates for duplicates
  const candidates = Array.from(fastGroups.values()).filter((g) => g.length >= 2);
  const totalCandidateFiles = candidates.reduce((sum, g) => sum + g.length, 0);

  // Stage 2: full hash within each candidate group
  const dupeGroups: DupeGroup[] = [];
  let fullDone = 0;
  for (const group of candidates) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const byHash = new Map<string, ScannedFile[]>();
    for (const file of group) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        const blob = await file.handle.getFile();
        const fh = await hashFile(blob);
        const list = byHash.get(fh) ?? [];
        list.push(file);
        byHash.set(fh, list);
      } catch {
        // Unreadable, skip
      }
      fullDone++;
      onProgress?.("full", fullDone, totalCandidateFiles);
    }
    for (const [hash, members] of byHash) {
      if (members.length < 2) continue;
      const bytesPerFile = members[0].size;
      dupeGroups.push({
        hash,
        files: members,
        bytesPerFile,
        reclaimableBytes: (members.length - 1) * bytesPerFile,
      });
    }
  }

  dupeGroups.sort((a, b) => b.reclaimableBytes - a.reclaimableBytes);
  const totalReclaimable = dupeGroups.reduce((sum, g) => sum + g.reclaimableBytes, 0);
  return { groups: dupeGroups, totalReclaimable, filesScanned: files.length };
}

// Decide which file to keep when deleting extras: oldest by lastModified
// (assumed to be the "original"), with shortest path as tiebreaker.
export function pickKeeper(group: DupeGroup): ScannedFile {
  return [...group.files].sort((a, b) => {
    if (a.lastModified !== b.lastModified) return a.lastModified - b.lastModified;
    return a.relativePath.length - b.relativePath.length;
  })[0];
}

export async function deleteExtras(
  group: DupeGroup,
  keeper: ScannedFile
): Promise<{ deleted: number; failed: { file: ScannedFile; reason: string }[] }> {
  let deleted = 0;
  const failed: { file: ScannedFile; reason: string }[] = [];
  for (const file of group.files) {
    if (file === keeper) continue;
    try {
      await file.parent.removeEntry(file.name);
      deleted++;
    } catch (err) {
      failed.push({
        file,
        reason: err instanceof Error ? err.message : "unknown error",
      });
    }
  }
  return { deleted, failed };
}
