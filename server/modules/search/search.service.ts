/** Search normalization, authorization and cache orchestration. */
import * as repository from "./search.repository";
import { EMPTY_SEARCH_RESULTS } from "./search.types";
import type { SearchActor, SearchDb, SearchResults } from "./search.types";

interface NotePage {
    id: string; title?: string; content?: string; tags?: string[]; pinned?: boolean;
    folderId?: string | null; updatedAt?: string | null;
}

interface SearchDependencies {
    getCached: (tenantId: SearchActor["tenantId"], userId: number, term: string) => Promise<unknown>;
    setCached: (tenantId: SearchActor["tenantId"], userId: number, term: string, value: SearchResults) => Promise<unknown>;
}

function searchNotes(raw: unknown, term: string): any[] {
    let notebook: { pages?: NotePage[] } | null = null;
    try { notebook = typeof raw === "string" ? JSON.parse(raw) : raw as { pages?: NotePage[] }; }
    catch { return []; }
    const lower = term.toLowerCase();
    return (notebook?.pages || []).filter((page) =>
        (page.title || "").toLowerCase().includes(lower)
        || (page.content || "").replace(/<[^>]*>/g, "").toLowerCase().includes(lower)
        || (page.tags || []).some((tag) => tag.toLowerCase().includes(lower)),
    ).slice(0, 15).map((page) => {
        const plainText = (page.content || "").replace(/<[^>]*>/g, "");
        const matchIndex = plainText.toLowerCase().indexOf(lower);
        const start = matchIndex > 20 ? Math.max(0, matchIndex - 40) : 0;
        return {
            id: page.id, title: page.title || "Untitled",
            snippet: `${start ? "…" : ""}${plainText.slice(start, start + 120)}`,
            tags: (page.tags || []).slice(0, 5), pinned: !!page.pinned,
            folderId: page.folderId || null, updatedAt: page.updatedAt || null,
        };
    });
}

export function createSearchService(deps: SearchDependencies) {
    return {
        async search(db: SearchDb, actor: SearchActor): Promise<SearchResults> {
            if (!actor.query || actor.query.trim().length < 2) return { ...EMPTY_SEARCH_RESULTS };
            const term = actor.query.trim().slice(0, 100);
            const cached = await deps.getCached(actor.tenantId, actor.userId, term);
            if (cached) return cached as SearchResults;
            const tsQuery = term.split(/\s+/).filter(Boolean)
                .map((word) => `${word.replace(/[^a-zA-Z0-9]/g, "")}:*`)
                .filter((part) => part.length > 1).join(" & ");
            const pattern = `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
            const tasks = tsQuery ? await repository.searchTasks(db, actor.userId, tsQuery) : [];
            const notes = searchNotes(await repository.getNotebookData(db, actor.userId), term);
            const users = actor.orgId ? await repository.searchUsers(db, actor.orgId, actor.userId, pattern) : [];
            const events = await repository.searchEvents(db, actor.userId, pattern);
            const leaves = await repository.searchLeaves(db, actor.userId, pattern);
            const teamId = await repository.findTeamId(db, actor.userId);
            const sprints = teamId ? await repository.searchSprints(db, teamId, pattern) : [];
            const logs = actor.canReadAuditLogs && actor.orgId
                ? await repository.searchAuditLogs(db, actor.orgId, pattern) : [];
            const results = { tasks, notes, users, events, leaves, sprints, logs };
            await deps.setCached(actor.tenantId, actor.userId, term, results);
            return results;
        },
    };
}