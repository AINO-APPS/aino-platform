import { useEffect, useState } from "react";
import { getProjects } from "../../api/tasks";
import sf from "../../pages/admin/AdminForms.module.css";

interface ProjectOption {
    id: number;
    key: string;
    name: string;
    is_archived?: boolean;
}

export default function ServiceDeskProjectPicker({ value, onChange }: {
    value: number | null;
    onChange: (value: number | null) => void;
}) {
    const [projects, setProjects] = useState<ProjectOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    useEffect(() => {
        let active = true;
        getProjects().then(({ data }) => {
            if (active) setProjects(data.filter((project: ProjectOption) => !project.is_archived));
        }).catch(() => {
            if (active) setError(true);
        }).finally(() => {
            if (active) setLoading(false);
        });
        return () => { active = false; };
    }, []);

    return <div className={sf.formGroup}>
        <label htmlFor="service-desk-project">Service Desk project</label>
        <select id="service-desk-project" value={value ?? ""} disabled={loading}
            aria-describedby="service-desk-project-help"
            onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}>
            <option value="">General (default)</option>
            {value !== null && !projects.some((project) => project.id === value) &&
                <option value={value}>Current project (unavailable)</option>}
            {projects.map((project) => <option key={project.id} value={project.id}>
                {project.key} · {project.name}
            </option>)}
        </select>
        <small id="service-desk-project-help">New Service Desk copies go here. Leave unset to use General.</small>
        {error && <div role="alert">Could not load projects. Your current selection is unchanged.</div>}
    </div>;
}
