import React, { useRef, useState } from "react";
import { Plus } from "../../constants/icons";
import s from "./QuickAdd.module.css";

interface QuickAddProps {
    onCreate: (title: string) => Promise<void> | void;
    placeholder?: string;
}

/**
 * Quick-add at the top of the backlog.
 *
 * Typing a title and pressing Enter creates the task and keeps focus, so
 * consecutive entry never needs the mouse or a modal.
 */
export default function QuickAdd({ onCreate, placeholder = "Add a ticket…" }: QuickAddProps) {
    const [title, setTitle] = useState("");
    const [saving, setSaving] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        const trimmed = title.trim();
        if (!trimmed || saving) return;

        setSaving(true);
        try {
            await onCreate(trimmed);
            setTitle("");
        } finally {
            setSaving(false);
            // Keep focus for the next one.
            inputRef.current?.focus();
        }
    };

    return (
        <form className={s["quick-add"]} onSubmit={submit}>
            <Plus size={16} aria-hidden="true" className={s["quick-add-icon"]} />
            <input
                ref={inputRef}
                className={s["quick-add-input"]}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={placeholder}
                aria-label="New ticket title"
                maxLength={200}
            />
            <button
                type="submit"
                className={s["quick-add-submit"]}
                disabled={!title.trim() || saving}
            >
                Add
            </button>
        </form>
    );
}
