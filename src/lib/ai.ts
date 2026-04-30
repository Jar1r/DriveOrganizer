// LLM client for AI-powered rename + categorize.
// BYOK (bring-your-own-key) — calls go directly from the browser to the
// provider. No backend, no proxy, no key leaves the user's machine except to
// the provider they configured. This is fine because:
//  - The user explicitly pasted their own key into local Settings
//  - The PWA is local-first; we have no server to leak it through
//  - Providers' CORS policies allow direct browser calls

import type { Settings } from "./storage";
import { getActiveKey, getActiveModel } from "./storage";
import type { Category } from "./rules";

export type AIRenameRequest = {
  filename: string;
  size: number;
  lastModified: number;
  // Optional small text excerpt for plain-text files. Future: PDF / DOCX
  // extraction. For v1 we mostly rely on the filename — surprisingly effective.
  textExcerpt?: string;
};

export type AIRenameSuggestion = {
  filename: string;
  suggestedName: string;
  category: string; // lowercase category key (must match an existing rule)
  reason: string;
  confidence: number; // 0–1
};

export type AIUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type AIRenameResponse = {
  suggestions: AIRenameSuggestion[];
  usage: AIUsage;
};

const SYSTEM_PROMPT = `You are a file-organization assistant. The user gives you a list of filenames (with sizes, modified dates, and optional text excerpts). For each file, output:
- suggestedName: a clean, descriptive filename that a human would actually want. Title Case, spaces allowed, NO file extension (we add it back). Strip junk like "IMG_8472", "scan_001", "Untitled-3", random hex IDs. Infer the topic from filename semantics: dates, project names, document type, source app. If the filename is already good, return it unchanged.
- category: one of the provided category keys. Choose the BEST semantic match, not just by extension. A "tax_2024_w2.pdf" is "documents" but a project README is "code". Prefer the most specific category.
- reason: one short sentence explaining why.
- confidence: 0–1, how sure you are.

Be conservative: if you can't tell what a file is, return the original filename and confidence < 0.5.

Output strictly valid JSON, no markdown, no commentary outside the JSON.`;

export type BatchRenameInput = {
  settings: Settings;
  categories: Category[];
  files: AIRenameRequest[];
  signal?: AbortSignal;
};

export async function renameWithAI(input: BatchRenameInput): Promise<AIRenameResponse> {
  const { settings, categories, files, signal } = input;
  const key = getActiveKey(settings);
  if (!key) throw new Error("No API key configured. Add one in Settings.");
  if (files.length === 0) return { suggestions: [], usage: { inputTokens: 0, outputTokens: 0 } };

  const categoryList = categories.map((c) => `${c.key} (${c.label}: ${c.extensions.slice(0, 6).join(", ")})`).join("\n");
  const userMessage = buildUserMessage(files, categoryList);

  if (settings.aiProvider === "anthropic") {
    return callAnthropic(key, getActiveModel(settings), userMessage, signal);
  }
  return callOpenAI(key, getActiveModel(settings), userMessage, signal);
}

function buildUserMessage(files: AIRenameRequest[], categoryList: string): string {
  const fileBlock = files
    .map((f, i) => {
      const date = new Date(f.lastModified).toISOString().slice(0, 10);
      const excerpt = f.textExcerpt
        ? `\n  excerpt: ${JSON.stringify(f.textExcerpt.slice(0, 240))}`
        : "";
      return `${i + 1}. ${JSON.stringify(f.filename)}\n  size: ${f.size}\n  modified: ${date}${excerpt}`;
    })
    .join("\n\n");

  return `Available category keys:
${categoryList}

Files:
${fileBlock}

Return JSON: { "suggestions": [{ "filename": "<original>", "suggestedName": "<new without extension>", "category": "<key>", "reason": "<short>", "confidence": <0-1> }, ...] }`;
}

async function callAnthropic(
  key: string,
  model: string,
  userMessage: string,
  signal?: AbortSignal
): Promise<AIRenameResponse> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
    signal,
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${truncate(errBody, 200) || res.statusText}`);
  }
  const json = (await res.json()) as {
    content?: { type: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = (json.content ?? []).find((c) => c.type === "text")?.text ?? "";
  const suggestions = parseSuggestions(text);
  return {
    suggestions,
    usage: {
      inputTokens: json.usage?.input_tokens ?? 0,
      outputTokens: json.usage?.output_tokens ?? 0,
    },
  };
}

async function callOpenAI(
  key: string,
  model: string,
  userMessage: string,
  signal?: AbortSignal
): Promise<AIRenameResponse> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    }),
    signal,
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${truncate(errBody, 200) || res.statusText}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = json.choices?.[0]?.message?.content ?? "";
  const suggestions = parseSuggestions(text);
  return {
    suggestions,
    usage: {
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
    },
  };
}

function parseSuggestions(text: string): AIRenameSuggestion[] {
  // Strip markdown fences if the model added them despite instructions
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Some providers wrap the JSON in a top-level object differently. Try to
    // find a JSON object substring.
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Model returned non-JSON response");
    parsed = JSON.parse(match[0]);
  }
  const obj = parsed as { suggestions?: unknown };
  if (!Array.isArray(obj.suggestions)) throw new Error("Model response missing 'suggestions' array");
  return (obj.suggestions as AIRenameSuggestion[]).filter(
    (s) => s && typeof s.filename === "string" && typeof s.suggestedName === "string"
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}

// ============================================================================
// Folder rename — different prompt because the AI is summarizing a folder's
// contents into a name, not renaming a single file.
// ============================================================================

export type AIFolderRenameRequest = {
  currentName: string;
  parentPath: string;
  fileCount: number;
  subdirCount: number;
  // Up to 30 sample entries for context
  sampleEntries: { name: string; kind: "file" | "directory" }[];
};

export type AIFolderRenameSuggestion = {
  currentName: string;
  suggestedName: string;
  reason: string;
  confidence: number;
};

export type AIFolderRenameResponse = {
  suggestions: AIFolderRenameSuggestion[];
  usage: AIUsage;
};

const FOLDER_SYSTEM_PROMPT = `You are a file-organization assistant. The user gives you a list of folders that have generic default names (like "New folder", "untitled folder", "Untitled (3)") along with the contents of each folder. For each folder, output a clean, descriptive name based on what's actually inside.

Rules for suggestedName:
- 2–5 words, Title Case, spaces allowed.
- NO special characters: no /, \\, :, *, ?, ", <, >, |.
- Describe the THEME of the contents, not just one file. "Tax Documents 2024" not "1099-misc.pdf".
- If files share a date or year, include it.
- If the contents are random/mixed, fall back to a generic but still descriptive name like "Miscellaneous Photos" or "Old Downloads".
- If you genuinely can't tell what's inside, return the original name with confidence < 0.4.

Output strictly valid JSON, no markdown, no commentary outside the JSON.`;

export async function renameFoldersWithAI(input: {
  settings: Settings;
  folders: AIFolderRenameRequest[];
  signal?: AbortSignal;
}): Promise<AIFolderRenameResponse> {
  const { settings, folders, signal } = input;
  const key = getActiveKey(settings);
  if (!key) throw new Error("No API key configured. Add one in Settings.");
  if (folders.length === 0) return { suggestions: [], usage: { inputTokens: 0, outputTokens: 0 } };

  const folderBlock = folders
    .map((f, i) => {
      const sample = f.sampleEntries
        .slice(0, 30)
        .map((e) => (e.kind === "directory" ? `[DIR] ${e.name}` : e.name))
        .join(", ");
      const parent = f.parentPath ? ` (in ${f.parentPath})` : "";
      return `${i + 1}. "${f.currentName}"${parent}\n  files: ${f.fileCount}, subfolders: ${f.subdirCount}\n  contents: ${sample || "(empty)"}`;
    })
    .join("\n\n");

  const userMessage = `Folders to rename:

${folderBlock}

Return JSON: { "suggestions": [{ "currentName": "<original>", "suggestedName": "<new>", "reason": "<short>", "confidence": <0-1> }, ...] }`;

  if (settings.aiProvider === "anthropic") {
    return callAnthropicForFolders(key, getActiveModel(settings), userMessage, signal);
  }
  return callOpenAIForFolders(key, getActiveModel(settings), userMessage, signal);
}

async function callAnthropicForFolders(
  key: string,
  model: string,
  userMessage: string,
  signal?: AbortSignal
): Promise<AIFolderRenameResponse> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: FOLDER_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
    signal,
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${truncate(errBody, 200) || res.statusText}`);
  }
  const json = (await res.json()) as {
    content?: { type: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = (json.content ?? []).find((c) => c.type === "text")?.text ?? "";
  return {
    suggestions: parseFolderSuggestions(text),
    usage: {
      inputTokens: json.usage?.input_tokens ?? 0,
      outputTokens: json.usage?.output_tokens ?? 0,
    },
  };
}

async function callOpenAIForFolders(
  key: string,
  model: string,
  userMessage: string,
  signal?: AbortSignal
): Promise<AIFolderRenameResponse> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: FOLDER_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    }),
    signal,
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${truncate(errBody, 200) || res.statusText}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = json.choices?.[0]?.message?.content ?? "";
  return {
    suggestions: parseFolderSuggestions(text),
    usage: {
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
    },
  };
}

function parseFolderSuggestions(text: string): AIFolderRenameSuggestion[] {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Model returned non-JSON response");
    parsed = JSON.parse(match[0]);
  }
  const obj = parsed as { suggestions?: unknown };
  if (!Array.isArray(obj.suggestions)) throw new Error("Model response missing 'suggestions' array");
  return (obj.suggestions as AIFolderRenameSuggestion[]).filter(
    (s) => s && typeof s.currentName === "string" && typeof s.suggestedName === "string"
  );
}

// Best-effort text extraction for files where we can read content.
// Plain text + simple source code files. Skip binary files entirely; the model
// gets filename-only context for those.
const TEXT_EXTENSIONS = new Set([
  "txt", "md", "json", "yaml", "yml", "toml", "csv", "tsv",
  "js", "jsx", "ts", "tsx", "py", "rb", "go", "rs", "java",
  "c", "cc", "cpp", "h", "hpp", "css", "scss", "html", "xml", "sh"
]);

export async function maybeReadExcerpt(file: File, name: string): Promise<string | undefined> {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return undefined;
  const ext = name.slice(dot + 1).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext)) return undefined;
  if (file.size > 64 * 1024) return undefined; // Skip large text files
  try {
    const text = await file.text();
    return text.slice(0, 240).replace(/\s+/g, " ").trim();
  } catch {
    return undefined;
  }
}
