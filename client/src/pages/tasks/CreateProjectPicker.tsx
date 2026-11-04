import s from "./BacklogTab.module.css";

export default function CreateProjectPicker({ projects, value, onChange }: {
    projects: any[]; value: string | number | null; onChange: (value: string) => void;
}) {
    return <div className={s["form-extra-group"]}>
        <label htmlFor="create-ticket-project">Project</label>
        <select id="create-ticket-project" required value={value || ""}
            onChange={event => onChange(event.target.value)} disabled={projects.length === 0}>
            <option value="">Choose a project</option>
            {projects.map(project => <option key={project.id} value={project.id}>{project.key} · {project.name}</option>)}
        </select>
        {projects.length === 0 && <span role="status">No projects available. Ask a project admin for member access.</span>}
    </div>;
}
