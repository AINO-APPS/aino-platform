import { useId } from "react";
import s from "./ProjectTypeControl.module.css";

import type { ProjectType } from "../../types/generated/tasks";
export type { ProjectType } from "../../types/generated/tasks";
const TYPES = {
    scrum: { label: "Scrum", description: "Plan a backlog into sprints, with a sprint board and reports." },
    kanban: { label: "Kanban", description: "Keep work flowing on one continuous board, without sprints." },
    task_list: { label: "Task list", description: "Plain ticketing with list, board and calendar views." },
};
export function projectTypeLabel(type: ProjectType): string { return TYPES[type]?.label ?? "Project"; }

export function ProjectTypeControl({ value, availableTypes, changeableTypes, canChangeType = true, onChange, error }: {
    value: ProjectType;
    availableTypes: ProjectType[];
    changeableTypes?: ProjectType[];
    canChangeType?: boolean;
    onChange: (type: ProjectType) => void;
    error?: string;
}) {
    const id = useId();
    const options = [...new Set([value, ...availableTypes])];
    return <div className={s.control}>
        <label htmlFor={id}>Project type</label>
        <select id={id} value={value} disabled={!canChangeType} aria-describedby={`${id}-description`}
            onChange={(event) => onChange(event.target.value as ProjectType)}>
            {options.map((type) => <option key={type} value={type}
                disabled={type !== value && !(changeableTypes ?? availableTypes).includes(type)}>{projectTypeLabel(type)}</option>)}
        </select>
        <p id={`${id}-description`} className={s.description}>{TYPES[value]?.description}</p>
        {availableTypes.length === 1 && <p className={s.hint}>This organization offers Task list for new projects and type changes. Existing types keep working.</p>}
        {canChangeType && value === "scrum" && changeableTypes?.every((type) => type === "scrum") &&
            <p className={s.hint}>Complete or remove every planned, active or paused sprint before leaving Scrum.</p>}
        {error && <p role="alert" className={s.error}>{error}</p>}
    </div>;
}
