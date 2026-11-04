import API from "./client";

export interface MigrationProject {
  id: number;
  name: string;
  key: string;
  key_published: boolean;
  type: string;
  ticket_count: number;
  grants: { user_id: number | null; team_id: number | null; role: string; name: string | null }[];
}
export interface MigrationReview {
  project_ownership: boolean;
  switched_at: string | null;
  projects: MigrationProject[];
  moves: {
    task_id: number;
    old_key: string | null;
    new_key: string;
    migration_key: string;
    sprint_id: number | null;
    sprint_name: string | null;
  }[];
}
export const getMigrationReview = () => API.get<MigrationReview>("/projects/migration/review");
export const switchToProjects = () => API.post("/projects/migration/switch");
export const switchBackToTeams = () => API.post("/projects/migration/switch-back");
