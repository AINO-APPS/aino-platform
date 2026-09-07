export interface SearchDb {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number }>;
}

export interface SearchActor {
    query?: string;
    tenantId?: number | null;
    userId: number;
    orgId: number | null;
    canReadAuditLogs: boolean;
}

export interface SearchResults {
    tasks: any[];
    notes: any[];
    users: any[];
    events: any[];
    leaves: any[];
    sprints: any[];
    logs: any[];
}

export const EMPTY_SEARCH_RESULTS: SearchResults = {
    tasks: [], notes: [], users: [], events: [], leaves: [], sprints: [], logs: [],
};