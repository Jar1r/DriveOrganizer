export type Category = {
  key: string;
  label: string;
  folder: string;
  extensions: string[];
  color: string;
};

export const DEFAULT_CATEGORIES: Category[] = [
  {
    key: "images",
    label: "Images",
    folder: "Images",
    color: "#f59e0b",
    extensions: ["jpg", "jpeg", "png", "gif", "webp", "svg", "heic", "heif", "bmp", "tiff", "tif", "avif"],
  },
  {
    key: "videos",
    label: "Videos",
    folder: "Videos",
    color: "#ef4444",
    extensions: ["mp4", "mov", "avi", "mkv", "webm", "m4v", "wmv", "flv"],
  },
  {
    key: "audio",
    label: "Audio",
    folder: "Audio",
    color: "#a855f7",
    extensions: ["mp3", "wav", "flac", "m4a", "ogg", "aac", "wma", "opus"],
  },
  {
    key: "documents",
    label: "Documents",
    folder: "Documents",
    color: "#0ea5e9",
    extensions: ["pdf", "doc", "docx", "txt", "rtf", "md", "odt", "pages", "epub"],
  },
  {
    key: "spreadsheets",
    label: "Spreadsheets",
    folder: "Spreadsheets",
    color: "#10b981",
    extensions: ["xls", "xlsx", "csv", "tsv", "ods", "numbers"],
  },
  {
    key: "presentations",
    label: "Presentations",
    folder: "Presentations",
    color: "#f97316",
    extensions: ["ppt", "pptx", "key", "odp"],
  },
  {
    key: "archives",
    label: "Archives",
    folder: "Archives",
    color: "#737373",
    extensions: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz"],
  },
  {
    key: "code",
    label: "Code",
    folder: "Code",
    color: "#22d3ee",
    extensions: [
      "js", "jsx", "ts", "tsx", "py", "rb", "go", "rs", "java", "c", "cc", "cpp", "h",
      "hpp", "swift", "kt", "kts", "php", "html", "css", "scss", "sql", "sh", "json", "yaml", "yml", "toml"
    ],
  },
  {
    key: "design",
    label: "Design",
    folder: "Design",
    color: "#ec4899",
    extensions: ["psd", "ai", "fig", "sketch", "xd", "indd", "afdesign", "afphoto"],
  },
  {
    key: "fonts",
    label: "Fonts",
    folder: "Fonts",
    color: "#84cc16",
    extensions: ["ttf", "otf", "woff", "woff2"],
  },
  {
    key: "installers",
    label: "Installers",
    folder: "Installers",
    color: "#64748b",
    extensions: ["dmg", "exe", "msi", "pkg", "deb", "rpm", "appimage"],
  },
];

export const OTHER_CATEGORY: Category = {
  key: "other",
  label: "Other",
  folder: "Other",
  color: "#475569",
  extensions: [],
};

const STORAGE_KEY = "drive-organizer:rules:v1";

export function loadCategories(): Category[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CATEGORIES;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((c) => c && typeof c.key === "string")) {
      return parsed as Category[];
    }
  } catch {
    /* fall through */
  }
  return DEFAULT_CATEGORIES;
}

export function saveCategories(cats: Category[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cats));
}

export function resetCategories(): Category[] {
  localStorage.removeItem(STORAGE_KEY);
  return DEFAULT_CATEGORIES;
}

export function categorize(filename: string, cats: Category[]): Category {
  const ext = getExtension(filename);
  if (!ext) return OTHER_CATEGORY;
  const match = cats.find((c) => c.extensions.includes(ext));
  return match ?? OTHER_CATEGORY;
}

export function getExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot === -1 || dot === 0 || dot === filename.length - 1) return "";
  return filename.slice(dot + 1).toLowerCase();
}
