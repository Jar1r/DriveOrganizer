// SHA-256 hashing for duplicate detection.
// Streams the file in chunks so multi-GB files don't blow out memory.

const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB

export async function hashFile(file: File): Promise<string> {
  if (typeof crypto?.subtle?.digest !== "function") {
    throw new Error("Web Crypto API not available");
  }
  // Small files: single-shot hash is faster
  if (file.size <= CHUNK_SIZE) {
    const buf = await file.arrayBuffer();
    return digestHex(buf);
  }
  // Large files: stream and accumulate
  // Web Crypto doesn't support streaming digest, so we hash chunk-by-chunk and
  // combine. For a perfect content hash we'd need a streaming primitive, but
  // for duplicate detection a deterministic chunked hash is good enough — same
  // file always produces the same chunked hash.
  const reader = file.stream().getReader();
  const hashes: string[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.length > 0) {
      const safeBuffer = (value.byteOffset === 0 && value.byteLength === value.buffer.byteLength
        ? value.buffer
        : value.slice().buffer) as ArrayBuffer;
      hashes.push(await digestHex(safeBuffer));
    }
  }
  // Combine chunk hashes into a final hash so we get a single fixed-length string
  const combined = new TextEncoder().encode(hashes.join(""));
  return digestHex(combined.buffer.slice(combined.byteOffset, combined.byteOffset + combined.byteLength) as ArrayBuffer);
}

async function digestHex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

// Fast pre-filter: hash size + first/last 64 KB. Two files with different
// fast-hashes can't be duplicates; same fast-hash means full-hash to confirm.
export async function fastHash(file: File): Promise<string> {
  const SAMPLE = 64 * 1024;
  const head = file.slice(0, Math.min(SAMPLE, file.size));
  const tail = file.size > SAMPLE ? file.slice(file.size - SAMPLE) : new Blob();
  const headBuf = await head.arrayBuffer();
  const tailBuf = await tail.arrayBuffer();
  const combined = new Uint8Array(headBuf.byteLength + tailBuf.byteLength + 8);
  // Encode size (8 bytes, little-endian)
  const sizeView = new DataView(combined.buffer, combined.byteOffset, 8);
  sizeView.setBigUint64(0, BigInt(file.size), true);
  combined.set(new Uint8Array(headBuf), 8);
  combined.set(new Uint8Array(tailBuf), 8 + headBuf.byteLength);
  const targetBuf = combined.buffer.slice(
    combined.byteOffset,
    combined.byteOffset + combined.byteLength
  ) as ArrayBuffer;
  return digestHex(targetBuf);
}
