export type Client = "android" | "desktop" | "web";
export interface VersionConfig {
    mode: "off" | "report";
    minimums: Record<Client, string>;
}
export interface Observation { client: Client; version: string }
export type Query = (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
export interface SessionObservation { userId: number; sid: string; query: Query }
export interface VersionReport { client: string; version: string; users: number }
export interface VersionRepository {
    record(identity: string, observation: Observation, session?: SessionObservation): Promise<void>;
    report(): Promise<VersionReport[]>;
}
