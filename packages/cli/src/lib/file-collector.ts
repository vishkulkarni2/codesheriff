/**
 * FileCollector
 *
 * Reads files from disk and converts them into AnalysisFile objects that the
 * analyzer pipeline expects. Handles:
 *   - Directory scanning (recursive, filtered by extension)
 *   - Single-file mode
 *   - Staged git changes mode (for `codesheriff review`)
 *   - Respects .gitignore-style ignores (node_modules, dist, etc.)
 */

import { readFile, stat } from 'fs/promises';
import { resolve, relative, extname, basename } from 'path';
import { glob } from 'glob';
import { execSync } from 'child_process';
import type { AnalysisFile } from '@codesheriff/shared';

/** File extensions CodeSheriff understands */
const SUPPORTED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.kt',
  '.rb', '.php', '.cs', '.cpp', '.c', '.h',
  '.swift', '.scala', '.sh', '.bash',
]);

/** Directories to always skip */
const SKIP_DIRS = [
  'node_modules', 'dist', '.next', 'build', 'out', 'coverage',
  '.git', '.turbo', '__pycache__', '.venv', 'venv', 'target',
  'vendor', '.cache', 'tmp', 'temp',
];

/** Max file size to analyze (512 KB) */
const MAX_FILE_BYTES = 512 * 1024;

/** Max files to collect in a single scan */
const MAX_FILES = 200;

/** Map shebang interpreters to language names */
const SHEBANG_LANG_MAP: Record<string, string> = {
  'python3': 'python',
  'python': 'python',
  'node': 'javascript',
  'bash': 'bash',
  'sh': 'bash',
  'ruby': 'ruby',
  'perl': 'perl',
  'php': 'php',
};

/** Check the first line of a file for a shebang and return the language, or null */
function detectShebangLanguage(content: string): string | null {
  const firstLine = content.split('\n', 1)[0] ?? '';
  if (!firstLine.startsWith('#!')) return null;

  // Handle both "#!/usr/bin/env python3" and "#!/usr/bin/python3"
  const parts = firstLine.replace(/^#!\s*/, '').split(/\s+/);
  const exe = parts[parts.length - 1] ?? '';
  const base = exe.split('/').pop() ?? '';

  return SHEBANG_LANG_MAP[base] ?? null;
}

export interface CollectOptions {
  /** If true, only collect files staged in git (`git diff --cached`) */
  stagedOnly?: boolean;
  /** Max number of files to collect */
  maxFiles?: number;
}

export async function collectFiles(
  targetPath: string,
  opts: CollectOptions = {}
): Promise<AnalysisFile[]> {
  const { stagedOnly = false, maxFiles = MAX_FILES } = opts;

  const absPath = resolve(targetPath);
  const pathStat = await stat(absPath).catch(() => null);

  if (!pathStat) {
    throw new Error(`Path not found: ${targetPath}`);
  }

  let filePaths: string[];

  if (pathStat.isFile()) {
    filePaths = [absPath];
  } else if (stagedOnly) {
    filePaths = getStagedFiles(absPath);
    if (filePaths.length === 0) {
      // Fall back to all files if nothing is staged
      filePaths = await globFiles(absPath);
    }
  } else {
    filePaths = await globFiles(absPath);
  }

  // Deduplicate and cap
  const unique = [...new Set(filePaths)].slice(0, maxFiles);

  const analysisFiles: AnalysisFile[] = [];

  for (const filePath of unique) {
    const file = await readAnalysisFile(filePath, absPath);
    if (file) analysisFiles.push(file);
  }

  return analysisFiles;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function globFiles(dir: string): Promise<string[]> {
  const ignore = SKIP_DIRS.map((d) => `**/${d}/**`);

  const files = await glob('**/*', {
    cwd: dir,
    absolute: true,
    nodir: true,
    ignore,
  });

  return files.filter((f) => {
    const ext = extname(f);
    // Include files with supported extensions
    if (SUPPORTED_EXTENSIONS.has(ext)) return true;
    // Also include extensionless files (they might have shebangs)
    if (ext === '') return true;
    return false;
  });
}

function getStagedFiles(repoRoot: string): string[] {
  try {
    const output = execSync('git diff --cached --name-only --diff-filter=ACM', {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (!output) return [];

    return output
      .split('\n')
      .map((f) => resolve(repoRoot, f))
      .filter((f) => {
        const ext = extname(f);
        return SUPPORTED_EXTENSIONS.has(ext) || ext === '';
      });
  } catch {
    return [];
  }
}

async function readAnalysisFile(
  filePath: string,
  rootDir: string
): Promise<AnalysisFile | null> {
  try {
    const fileStat = await stat(filePath);

    // Skip large files
    if (fileStat.size > MAX_FILE_BYTES) return null;

    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const ext = extname(filePath);
    const relPath = relative(rootDir, filePath);

    // Determine language: use extension first, fall back to shebang detection
    let language = extToLanguage(ext);
    if (language === 'unknown' && ext === '') {
      const shebangLang = detectShebangLanguage(content);
      if (!shebangLang) return null; // Skip extensionless files without a recognized shebang
      language = shebangLang;
    }

    return {
      path: relPath || basename(filePath),
      content,
      language,
      lineCount: lines.length,
      status: 'modified',
      patch: null,
    };
  } catch {
    return null;
  }
}

function extToLanguage(ext: string): string {
  const map: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.kt': 'kotlin',
    '.rb': 'ruby',
    '.php': 'php',
    '.cs': 'csharp',
    '.cpp': 'cpp',
    '.c': 'c',
    '.h': 'c',
    '.swift': 'swift',
    '.scala': 'scala',
    '.sh': 'bash',
    '.bash': 'bash',
  };
  return map[ext] ?? 'unknown';
}
