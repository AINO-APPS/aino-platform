export type Query = (
  sql: string,
  params?: unknown[],
) => Promise<{ rows: any[]; rowCount?: number | null }>;

export interface DbLike {
  query: Query;
  transaction?: (fn: (client: unknown) => Promise<unknown>) => Promise<unknown>;
}

/** Per-connection state attached to the native `ws` socket. */
export interface ExtWS {
  readyState: number;
  isAlive?: boolean;
  db?: DbLike;
  tenantId?: number | null;
  userId?: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  ping(): void;
  on(event: string, cb: (...args: any[]) => void): void;
  [key: string]: any;
}

export type WSType = string;

export type SendToUser = (
  tenantId: number | null | undefined,
  userId: number,
  type: WSType,
  data: unknown,
) => void;
