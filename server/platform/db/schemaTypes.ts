type SchemaQuery = (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;

export type { SchemaQuery };
