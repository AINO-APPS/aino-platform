import hljs from "../../hljs-setup";

export interface PriorityOption {
    value: string;
    label: string;
    icon: string;
    /** The tone: rail, dot and border. */
    color: string;
    /** The chip text colour, darkened/lightened to clear 4.5:1 on its own tint. */
    ink: string;
}

export const PRIORITIES: PriorityOption[] = [
    { value: "high", label: "High", icon: "●", color: "var(--danger)", ink: "var(--danger-ink)" },
    { value: "medium", label: "Medium", icon: "●", color: "var(--warning)", ink: "var(--warning-ink)" },
    { value: "low", label: "Low", icon: "●", color: "var(--success)", ink: "var(--success-ink)" },
];

export interface ColumnDef {
    id: string;
    label: string;
    icon: string;
    /** The tone: rail, dot and border. */
    color: string;
    /** The chip text colour, darkened/lightened to clear 4.5:1 on its own tint. */
    ink: string;
}

export const COLUMNS: ColumnDef[] = [
    { id: "pending", label: "New", icon: "○", color: "var(--text-muted)", ink: "var(--text-secondary)" },
    { id: "in_progress", label: "In Progress", icon: "◐", color: "var(--warning)", ink: "var(--warning-ink)" },
    { id: "in_review", label: "In Review", icon: "◑", color: "var(--primary-light)", ink: "var(--primary-light-ink)" },
    { id: "done", label: "Done", icon: "●", color: "var(--success)", ink: "var(--success-ink)" },
];

export const COMMENT_QUILL_MODULES = {
    toolbar: [
        ["bold", "italic", "underline", "strike"],
        ["code-block"],
        [{ list: "ordered" }, { list: "bullet" }],
        ["link"],
        ["clean"],
    ],
    syntax: { highlight: (text: string) => hljs.highlightAuto(text).value },
};