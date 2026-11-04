// Issue-key helpers (Jira-style "PROJ-123").
//
// Ticket keys are persisted on the task row; project and number are not
// recombined on reads, so a later project-key change cannot rewrite history.
//
// Examples:
//   { project: { key: 'PSSPMT' }, task_number: 123 } → 'PSSPMT-123'

interface DbLike {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number }>;
}

const { findByIssueKey, findTaskIdsByIssueKeys } = require("../../../modules/tasks/tasks.repository");

// Regex for parsing an issue key out of arbitrary text (branch names, PR
// titles, commit messages). Word-boundary anchored so we don't match
// substrings like "FOO-12-BAR". Case-insensitive; project keys are stored
// upper-case so we always re-upper-case before lookup.
const ISSUE_KEY_RE = /\b([A-Z][A-Z0-9_]{1,9})-(\d{1,9})\b/gi;
const PROJECT_KEY_RE = /^[A-Z][A-Z0-9_]{1,9}$/;
const FULL_ISSUE_KEY_RE = /^([A-Z][A-Z0-9_]{1,9})-([1-9]\d{0,8})$/i;

function isValidProjectKey(projectKey: string): boolean {
    return typeof projectKey === "string" && PROJECT_KEY_RE.test(projectKey);
}

function formatIssueKey(projectKey: string | null | undefined, taskNumber: number | null | undefined): string | null {
    if (!projectKey || !isValidProjectKey(projectKey.toUpperCase())
        || !Number.isInteger(taskNumber) || !taskNumber || taskNumber < 1 || taskNumber > 999_999_999) return null;
    return `${String(projectKey).toUpperCase()}-${taskNumber}`;
}

function parseIssueKey(value: string | null | undefined): { projectKey: string; taskNumber: number; raw: string } | null {
    const match = typeof value === "string" ? value.match(FULL_ISSUE_KEY_RE) : null;
    if (!match) return null;
    const projectKey = match[1].toUpperCase();
    const taskNumber = Number.parseInt(match[2], 10);
    return { projectKey, taskNumber, raw: `${projectKey}-${taskNumber}` };
}

async function resolveIssueKey(
    value: string | { projectKey: string; taskNumber: number; raw: string } | null | undefined,
    orgId: number | null | undefined,
    db: DbLike,
): Promise<{ task: any; task_id: number; is_alias: boolean } | null> {
    const key = typeof value === "string" ? parseIssueKey(value) : value;
    if (!key || !orgId) return null;
    const task = await findByIssueKey(db, orgId, key.projectKey, key.taskNumber);
    if (!task) return null;
    return {
        task,
        task_id: task.id,
        is_alias: task.ticket_key !== key.raw,
    };
}

/**
 * Extract every distinct (projectKey, taskNumber) pair referenced anywhere
 * in `text`. Returns `Array<{ projectKey: string, taskNumber: number, raw: string }>`.
 */
function extractIssueKeys(text: string | null | undefined): { projectKey: string; taskNumber: number; raw: string }[] {
    if (!text) return [];
    const seen = new Set<string>();
    const out: { projectKey: string; taskNumber: number; raw: string }[] = [];
    const re = new RegExp(ISSUE_KEY_RE.source, 'gi');
    let m;
    while ((m = re.exec(String(text))) !== null) {
        const projectKey = m[1].toUpperCase();
        const taskNumber = parseInt(m[2], 10);
        const raw = `${projectKey}-${taskNumber}`;
        if (seen.has(raw)) continue;
        seen.add(raw);
        out.push({ projectKey, taskNumber, raw });
    }
    return out;
}

/**
 * Resolve a list of issue keys against the org's tasks. Returns an array of
 * `{ key, task_id }` for keys that exist; unknown keys are silently dropped.
 */
async function resolveIssueKeys(keys: { projectKey: string; taskNumber: number }[], orgId: number | null | undefined, db: DbLike): Promise<{ key: string; task_id: number; is_alias: boolean }[]> {
    if (!keys || !keys.length || !orgId) return [];
    const projectKeys = keys.map(k => k.projectKey);
    const taskNumbers = keys.map(k => k.taskNumber);
    const rows = await findTaskIdsByIssueKeys(db, orgId, projectKeys, taskNumbers);
    return rows.map((r: any) => ({
        key: r.key,
        task_id: r.id,
        is_alias: Boolean(r.is_alias),
    }));
}

export = {
    isValidProjectKey,
    formatIssueKey,
    parseIssueKey,
    resolveIssueKey,
    extractIssueKeys,
    resolveIssueKeys,
    ISSUE_KEY_RE,
};