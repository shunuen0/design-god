import fs from "node:fs";
import path from "node:path";

export type CodeReferenceInput = {
  id: string;
  source: "absolute_path" | "attached_file";
  displayName: string;
  absolutePath?: string;
  relativePathHint?: string;
  content?: string;
  language?: string;
};

type ChatMessageInput = {
  role: "user" | "assistant";
  codeReferences?: CodeReferenceInput[];
};

type ResolvedCodeFile = {
  id: string;
  source: "absolute_path" | "attached_file" | "global_stylesheet";
  displayName: string;
  absolutePath?: string;
  relativePathHint?: string;
  content: string;
  language: string;
};

export type ResolvedRepoContext = {
  enabled: boolean;
  references: ResolvedCodeFile[];
  globalStyles: ResolvedCodeFile[];
  repoRoots: string[];
  referenceCount: number;
  globalStyleCount: number;
  repoRootDetected: boolean;
  promptBlock: string;
};

const GLOBAL_STYLE_CANDIDATES = [
  "global.css",
  "src/global.css",
  "src/styles.css",
  "src/styles/global.css",
  "app/globals.css",
  "styles/globals.css",
  "tailwind.css",
];

const ROOT_MARKERS = [".git", "package.json", "pnpm-workspace.yaml", "package-lock.json", "yarn.lock", "bun.lockb"];
const MAX_REFERENCE_COUNT = 12;
const MAX_FILE_CHARACTERS = 40_000;
const MAX_TOTAL_CHARACTERS = 120_000;

export function resolveRepoContext(messages: ChatMessageInput[]): ResolvedRepoContext {
  const rawReferences = dedupeReferences(
    messages
      .filter((message) => message.role === "user")
      .flatMap((message) => message.codeReferences ?? [])
  );

  if (rawReferences.length === 0) {
    return {
      enabled: false,
      references: [],
      globalStyles: [],
      repoRoots: [],
      referenceCount: 0,
      globalStyleCount: 0,
      repoRootDetected: false,
      promptBlock: "",
    };
  }

  if (rawReferences.length > MAX_REFERENCE_COUNT) {
    throw new Error(`Too many code references. Attach at most ${MAX_REFERENCE_COUNT} files per conversation.`);
  }

  let totalCharacters = 0;
  const repoRoots = new Set<string>();
  const references = rawReferences.map((reference) => {
    const resolved = resolveReference(reference);
    totalCharacters += resolved.content.length;
    if (totalCharacters > MAX_TOTAL_CHARACTERS) {
      throw new Error("Referenced code is too large. Trim the file set or use smaller files.");
    }
    if (resolved.absolutePath) {
      const repoRoot = findRepoRoot(resolved.absolutePath);
      if (repoRoot) {
        repoRoots.add(repoRoot);
        if (!resolved.relativePathHint) {
          resolved.relativePathHint = path.relative(repoRoot, resolved.absolutePath);
        }
      }
    }
    return resolved;
  });

  const referencedAbsolutePaths = new Set(
    references
      .map((reference) => reference.absolutePath)
      .filter((absolutePath): absolutePath is string => Boolean(absolutePath))
  );
  const globalStyles = Array.from(repoRoots)
    .flatMap((repoRoot) => discoverGlobalStyles(repoRoot, referencedAbsolutePaths))
    .map((style) => {
      totalCharacters += style.content.length;
      if (totalCharacters > MAX_TOTAL_CHARACTERS) {
        throw new Error("Referenced code is too large after including global styles. Reduce the file set.");
      }
      return style;
    });

  return {
    enabled: true,
    references,
    globalStyles,
    repoRoots: Array.from(repoRoots),
    referenceCount: references.length,
    globalStyleCount: globalStyles.length,
    repoRootDetected: repoRoots.size > 0,
    promptBlock: buildPromptBlock(references, globalStyles, Array.from(repoRoots)),
  };
}

function dedupeReferences(references: CodeReferenceInput[]) {
  const seen = new Set<string>();
  const result: CodeReferenceInput[] = [];

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

function resolveReference(reference: CodeReferenceInput): ResolvedCodeFile {
  if (reference.source === "absolute_path") {
    const absolutePath = normalizeAbsoluteFilePath(reference.absolutePath);
    const content = readTextFileWithLimit(absolutePath);
    return {
      id: reference.id,
      source: "absolute_path",
      displayName: reference.displayName || path.basename(absolutePath),
      absolutePath,
      relativePathHint: reference.relativePathHint,
      content,
      language: normalizeLanguage(reference.language, absolutePath),
    };
  }

  const content = (reference.content ?? "").trimEnd();
  if (!content) {
    throw new Error(`Attached file "${reference.displayName}" is empty or unreadable.`);
  }
  if (content.length > MAX_FILE_CHARACTERS) {
    throw new Error(`Attached file "${reference.displayName}" is too large. Keep files under ${MAX_FILE_CHARACTERS} characters.`);
  }

  return {
    id: reference.id,
    source: "attached_file",
    displayName: reference.displayName,
    relativePathHint: reference.relativePathHint,
    content,
    language: normalizeLanguage(reference.language, reference.relativePathHint || reference.displayName),
  };
}

function normalizeAbsoluteFilePath(rawPath?: string) {
  const absolutePath = (rawPath ?? "").trim();
  if (!absolutePath || !path.isAbsolute(absolutePath)) {
    throw new Error("Absolute code references must use absolute file paths.");
  }
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Referenced file does not exist: ${absolutePath}`);
  }
  const stats = fs.statSync(absolutePath);
  if (!stats.isFile()) {
    throw new Error(`Referenced path is not a file: ${absolutePath}`);
  }
  return path.resolve(absolutePath);
}

function readTextFileWithLimit(filePath: string) {
  const content = fs.readFileSync(filePath, "utf8");
  if (content.includes("\u0000")) {
    throw new Error(`Referenced file is not a readable text file: ${filePath}`);
  }
  const trimmed = content.trimEnd();
  if (!trimmed) {
    throw new Error(`Referenced file is empty: ${filePath}`);
  }
  if (trimmed.length > MAX_FILE_CHARACTERS) {
    throw new Error(`Referenced file is too large: ${filePath}. Keep files under ${MAX_FILE_CHARACTERS} characters.`);
  }
  return trimmed;
}

function findRepoRoot(filePath: string) {
  let current = path.dirname(filePath);

  while (true) {
    if (ROOT_MARKERS.some((marker) => fs.existsSync(path.join(current, marker)))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function discoverGlobalStyles(repoRoot: string, referencedAbsolutePaths: Set<string>) {
  const styles: ResolvedCodeFile[] = [];

  for (const candidate of GLOBAL_STYLE_CANDIDATES) {
    const absolutePath = path.join(repoRoot, candidate);
    if (!fs.existsSync(absolutePath) || referencedAbsolutePaths.has(absolutePath)) continue;
    const stats = fs.statSync(absolutePath);
    if (!stats.isFile()) continue;

    styles.push({
      id: `global:${absolutePath}`,
      source: "global_stylesheet",
      displayName: path.basename(absolutePath),
      absolutePath,
      relativePathHint: path.relative(repoRoot, absolutePath),
      content: readTextFileWithLimit(absolutePath),
      language: normalizeLanguage("css", absolutePath),
    });
  }

  return styles;
}

function normalizeLanguage(input: string | undefined, fileLike: string) {
  if (input) return input.toLowerCase();

  switch (path.extname(fileLike).toLowerCase()) {
    case ".tsx":
      return "tsx";
    case ".ts":
      return "ts";
    case ".jsx":
      return "jsx";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "js";
    case ".css":
      return "css";
    case ".scss":
      return "scss";
    case ".sass":
      return "sass";
    case ".json":
      return "json";
    case ".html":
      return "html";
    case ".md":
      return "md";
    case ".py":
      return "python";
    case ".rb":
      return "ruby";
    case ".go":
      return "go";
    case ".java":
      return "java";
    case ".rs":
      return "rust";
    case ".php":
      return "php";
    default:
      return "txt";
  }
}

function codeFence(content: string, language: string) {
  const fence = content.includes("```") ? "````" : "```";
  return `${fence}${language}\n${content}\n${fence}`;
}

function buildPromptBlock(references: ResolvedCodeFile[], globalStyles: ResolvedCodeFile[], repoRoots: string[]) {
  const lines = [
    "TRUSTED IMPLEMENTATION CONTEXT",
    "",
    "Treat the following files as the source of truth for implementation details. Do not contradict declared values in these files.",
  ];

  if (repoRoots.length > 0) {
    lines.push("", `Detected repo root${repoRoots.length > 1 ? "s" : ""}:`);
    for (const repoRoot of repoRoots) {
      lines.push(`- ${repoRoot}`);
    }
  }

  lines.push("", "Referenced files:");
  for (const reference of references) {
    lines.push(
      "",
      `File: ${reference.relativePathHint || reference.displayName}`,
      `Source: ${reference.absolutePath ?? "attached file"}`,
      codeFence(reference.content, reference.language)
    );
  }

  if (globalStyles.length > 0) {
    lines.push("", "Discovered global stylesheets:");
    for (const style of globalStyles) {
      lines.push(
        "",
        `Global stylesheet: ${style.relativePathHint || style.displayName}`,
        `Source: ${style.absolutePath ?? style.displayName}`,
        codeFence(style.content, style.language)
      );
    }
  }

  return lines.join("\n");
}
