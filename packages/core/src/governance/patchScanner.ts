import type { PatchRisk } from "../schemas/index.js";

// ─── Secret patterns ──────────────────────────────────────────────────────────

const SECRET_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(?:api[_-]?key|apikey)\s*[=:]\s*['"]?[A-Za-z0-9_\-]{16,}/i, label: "api_key_assignment" },
  { pattern: /(?:secret|password|passwd|pwd)\s*[=:]\s*['"]?.{8,}/i, label: "secret_assignment" },
  { pattern: /['"]?sk-[A-Za-z0-9]{20,}['"]?/, label: "openai_key" },
  { pattern: /['"]?xox[baprs]-[A-Za-z0-9\-]{10,}['"]?/, label: "slack_token" },
  { pattern: /(?:aws_access_key_id|aws_secret_access_key)\s*[=:]\s*['"]?[A-Za-z0-9\/+]{16,}/i, label: "aws_credential" },
  { pattern: /['"]?ghp_[A-Za-z0-9]{36}['"]?/, label: "github_pat" },
  { pattern: /(?:bearer|token)\s*[=:]\s*['"]?[A-Za-z0-9_\-.]{20,}/i, label: "bearer_token" },
  { pattern: /ANTHROPIC_API_KEY\s*[=:]\s*['"]?sk-ant-[A-Za-z0-9_\-]{20,}/, label: "anthropic_key" },
];

// ─── Schema mutation patterns ─────────────────────────────────────────────────

const SCHEMA_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bALTER\s+TABLE\b/i, label: "sql_alter_table" },
  { pattern: /\bDROP\s+(?:TABLE|COLUMN|INDEX)\b/i, label: "sql_drop" },
  { pattern: /\bCREATE\s+TABLE\b/i, label: "sql_create_table" },
  { pattern: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/i, label: "sql_create_index" },
  { pattern: /\bADD\s+COLUMN\b/i, label: "sql_add_column" },
  { pattern: /migrate\s*\(/i, label: "migration_call" },
  { pattern: /schema\.prisma/, label: "prisma_schema_edit" },
  { pattern: /\.migration\.(ts|js|sql)['"]?\s*$/, label: "migration_file" },
];

// ─── Auth code patterns ───────────────────────────────────────────────────────

const AUTH_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bjwt\.(?:sign|verify|decode)\b/, label: "jwt_operation" },
  { pattern: /\bbcrypt\.(?:hash|compare)\b/, label: "bcrypt_operation" },
  { pattern: /\bpassport\.(?:use|authenticate)\b/, label: "passport_auth" },
  { pattern: /\bverifyToken\s*\(/, label: "verify_token_call" },
  { pattern: /\bcheckAuth\s*\(/, label: "check_auth_call" },
  { pattern: /\brequireAuth\b/, label: "require_auth_middleware" },
  { pattern: /\bauthorize\s*\(/, label: "authorize_call" },
  { pattern: /\brole\s*(?:===|!==|==)\s*['"][A-Za-z]+['"]/, label: "role_check" },
  { pattern: /\.hasPermission\s*\(/, label: "permission_check" },
  { pattern: /\bsession\.(?:user|userId|token)\b/, label: "session_access" },
];

// ─── Dependency change patterns ───────────────────────────────────────────────

const DEP_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /"dependencies"\s*:\s*\{/, label: "package_json_dependencies" },
  { pattern: /"devDependencies"\s*:\s*\{/, label: "package_json_dev_dependencies" },
  { pattern: /^[+-]\s*"[^"]+"\s*:\s*"[^"]+"/, label: "dependency_version_change" },
  { pattern: /\brequire\(['"][^'"]+['"]\)/, label: "new_require" },
  { pattern: /^import\s+.+from\s+['"][^.][^'"]+['"]/, label: "new_external_import" },
];

// ─── Parser ───────────────────────────────────────────────────────────────────

interface DiffLine {
  filePath: string;
  lineNumber: number;
  content: string;
}

function parseAddedLines(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let currentFile = "";
  let currentLineNumber = 0;

  for (const raw of diff.split("\n")) {
    // New file header
    if (raw.startsWith("+++ b/")) {
      currentFile = raw.slice(6).trim();
      currentLineNumber = 0;
      continue;
    }
    // Hunk header: @@ -a,b +c,d @@
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      currentLineNumber = parseInt(hunk[1]!, 10) - 1;
      continue;
    }
    // Context line
    if (raw.startsWith(" ")) {
      currentLineNumber++;
      continue;
    }
    // Removed line — doesn't affect new file numbering
    if (raw.startsWith("-")) {
      continue;
    }
    // Added line
    if (raw.startsWith("+") && currentFile) {
      currentLineNumber++;
      lines.push({ filePath: currentFile, lineNumber: currentLineNumber, content: raw.slice(1) });
    }
  }
  return lines;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Pure function — scans a unified diff string for semantic risks.
 * Returns one PatchRisk per match (may have multiple per line if multiple
 * pattern types match).
 */
export function scanPatch(diff: string): PatchRisk[] {
  if (!diff.trim()) return [];

  const addedLines = parseAddedLines(diff);
  const risks: PatchRisk[] = [];

  for (const { filePath, lineNumber, content } of addedLines) {
    // Secrets
    for (const { pattern, label } of SECRET_PATTERNS) {
      if (pattern.test(content)) {
        risks.push({
          pattern: label,
          severity: "critical",
          category: "secret",
          filePath,
          lineNumber,
          lineContext: content.trim().slice(0, 120),
        });
        break; // one secret finding per line is enough
      }
    }

    // Schema mutations
    for (const { pattern, label } of SCHEMA_PATTERNS) {
      if (pattern.test(content)) {
        risks.push({
          pattern: label,
          severity: "high",
          category: "schema_mutation",
          filePath,
          lineNumber,
          lineContext: content.trim().slice(0, 120),
        });
        break;
      }
    }

    // Auth code
    for (const { pattern, label } of AUTH_PATTERNS) {
      if (pattern.test(content)) {
        risks.push({
          pattern: label,
          severity: "medium",
          category: "auth_code",
          filePath,
          lineNumber,
          lineContext: content.trim().slice(0, 120),
        });
        break;
      }
    }

    // Dependency changes
    for (const { pattern, label } of DEP_PATTERNS) {
      if (pattern.test(content)) {
        risks.push({
          pattern: label,
          severity: "medium",
          category: "dependency_change",
          filePath,
          lineNumber,
          lineContext: content.trim().slice(0, 120),
        });
        break;
      }
    }
  }

  return risks;
}
