import type { CodeReference } from "./types";

const CODE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "css",
  "scss",
  "sass",
  "less",
  "html",
  "json",
  "md",
  "mdx",
  "txt",
  "py",
  "rb",
  "go",
  "java",
  "rs",
  "php",
  "sh",
  "yml",
  "yaml",
  "xml",
  "svg",
]);

const ABSOLUTE_PATH_PATTERN = /\/(?:[^\s"'`]+\/)*[^\s"'`]+\.[A-Za-z0-9._-]+/g;

export const ATTACHMENT_ACCEPT = [
  "image/*",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".json",
  ".md",
  ".mdx",
  ".txt",
  ".py",
  ".rb",
  ".go",
  ".java",
  ".rs",
  ".php",
  ".sh",
  ".yml",
  ".yaml",
  ".xml",
  ".svg",
].join(",");

export function isImageFile(file: File) {
  return file.type.startsWith("image/");
}

export function isCodeLikeFile(file: File) {
  if (file.type.startsWith("text/")) return true;
  if (file.type.includes("json") || file.type.includes("javascript") || file.type.includes("typescript")) return true;

  const extension = getExtension(file.name);
  return extension ? CODE_EXTENSIONS.has(extension) : false;
}

export async function fileToCodeReference(file: File): Promise<CodeReference> {
  const content = await file.text();
  return {
    id: crypto.randomUUID(),
    source: "attached_file",
    displayName: file.name,
    relativePathHint: file.webkitRelativePath || undefined,
    content,
    language: inferCodeLanguage(file.webkitRelativePath || file.name),
  };
}

export function extractAbsolutePathReferences(text: string): CodeReference[] {
  const matches = text.match(ABSOLUTE_PATH_PATTERN) ?? [];

  return dedupeCodeReferences(
    matches
      .map((match) => match.replace(/[),.;]+$/, ""))
      .filter((match) => match.startsWith("/"))
      .map((absolutePath) => ({
        id: crypto.randomUUID(),
        source: "absolute_path" as const,
        displayName: basename(absolutePath),
        absolutePath,
        language: inferCodeLanguage(absolutePath),
      }))
  );
}

export function dedupeCodeReferences(references: CodeReference[]) {
  const seen = new Set<string>();
  const result: CodeReference[] = [];

  for (const reference of references) {
    const key = JSON.stringify([
      reference.source,
      reference.absolutePath ?? "",
      reference.displayName,
      reference.relativePathHint ?? "",
      reference.content ?? "",
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(reference);
  }

  return result;
}

function inferCodeLanguage(fileLike: string) {
  switch (getExtension(fileLike)) {
    case "tsx":
      return "tsx";
    case "ts":
      return "ts";
    case "jsx":
      return "jsx";
    case "js":
    case "mjs":
    case "cjs":
      return "js";
    case "css":
      return "css";
    case "scss":
      return "scss";
    case "sass":
      return "sass";
    case "html":
      return "html";
    case "json":
      return "json";
    case "md":
    case "mdx":
      return "md";
    case "py":
      return "python";
    case "rb":
      return "ruby";
    case "go":
      return "go";
    case "java":
      return "java";
    case "rs":
      return "rust";
    case "php":
      return "php";
    case "sh":
      return "bash";
    case "svg":
      return "svg";
    case "yml":
    case "yaml":
      return "yaml";
    default:
      return "txt";
  }
}

function getExtension(fileLike: string) {
  const parts = fileLike.toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() : undefined;
}

function basename(fileLike: string) {
  const clean = fileLike.replace(/\/+$/, "");
  const parts = clean.split("/");
  return parts[parts.length - 1] || clean;
}
