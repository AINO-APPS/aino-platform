import { useState, useRef, useEffect, useId } from "react";
import { BarChart3, Plus, X } from "../../constants/icons";
import type { PollSubmitData } from "../../api/chat";
import { cleanPollDraft, pollActionError, pollCreationError } from "./pollHelpers";
import PollDialog from "./PollDialog";
import s from "./PollCreator.module.css";

interface PollOption {
    id: number;
    value: string;
}

interface PollCreatorProps {
    onSubmit: (data: PollSubmitData) => Promise<void>;
    onClose: () => void;
}

export default function PollCreator({ onSubmit, onClose }: PollCreatorProps) {
    const [question, setQuestion] = useState("");
    const [options, setOptions] = useState<PollOption[]>(() => [
        { id: 1, value: "" }, { id: 2, value: "" }
    ]);
    const [multiSelect, setMultiSelect] = useState(false);
    const optIdCounter = useRef(3);
    const sendingRef = useRef(false);
    const mounted = useRef(true);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const id = useId();
    const validation = pollCreationError(question, options.map(option => option.value));
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);
    const close = () => { if (!sendingRef.current) onClose(); };

    const addOption = () => {
        if (options.length < 10) setOptions(prev => [...prev, { id: optIdCounter.current++, value: "" }]);
    };

    const removeOption = (id: number) => {
        if (options.length > 2) setOptions(prev => prev.filter(o => o.id !== id));
    };

    const updateOption = (id: number, val: string) => {
        setOptions(prev => prev.map(o => o.id === id ? { ...o, value: val } : o));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (sendingRef.current || validation) return;
        sendingRef.current = true;
        setSending(true);
        setError(null);
        try {
            await onSubmit(cleanPollDraft({ question, options: options.map(option => option.value), multiSelect }));
            if (mounted.current) onClose();
        } catch (failure) {
            sendingRef.current = false;
            if (mounted.current) {
                setSending(false);
                setError(pollActionError(failure, "Could not create poll. Your draft is saved here; try again."));
            }
        }
    };

    return (
        <PollDialog className={s.overlay} onClose={close} dismissDisabled={sending}>
            <form className={s.modal} onSubmit={handleSubmit} role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby={`${id}-title`} aria-busy={sending}>
                <div className={s.header}>
                    <h3 id={`${id}-title`}><BarChart3 size={16} aria-hidden="true" />New poll</h3>
                    <button type="button" className={s.close} onClick={close} disabled={sending} aria-label="Close poll creator"><X size={18} /></button>
                </div>
                <div className={s.body}>
                    <label className={s.fieldLabel} htmlFor={`${id}-question`}>QUESTION</label>
                    <textarea
                        id={`${id}-question`}
                        className={s.input}
                        placeholder="What would you like to ask?"
                        value={question}
                        onChange={e => setQuestion(e.target.value.slice(0, 500))}
                        maxLength={500}
                        rows={2}
                        disabled={sending}
                        data-poll-autofocus
                    />
                    <span className={s.hint}>{question.length}/500</span>
                    <span className={s.fieldLabel}>OPTIONS · {options.length}/10</span>
                    <div className={s.optionsList}>
                        {options.map((opt, index) => (
                            <div key={opt.id} className={s.optionRow}>
                                <input
                                    className={s.input}
                                    placeholder={`Option ${index + 1}`}
                                    aria-label={`Option ${index + 1}`}
                                    value={opt.value}
                                    onChange={e => updateOption(opt.id, e.target.value.slice(0, 200))}
                                    maxLength={200}
                                    disabled={sending}
                                />
                                {options.length > 2 && (
                                    <button type="button" className={s.removeBtn} disabled={sending} aria-label={`Remove option ${index + 1}`} onClick={() => removeOption(opt.id)}><X size={16} /></button>
                                )}
                            </div>
                        ))}
                    </div>
                    <button type="button" className={s.addBtn} disabled={sending || options.length >= 10} onClick={addOption}>
                        <Plus size={16} aria-hidden="true" />{options.length >= 10 ? "Maximum of 10 options" : "Add option"}
                    </button>
                    <label className={s.check}>
                        <input type="checkbox" checked={multiSelect} disabled={sending} onChange={e => setMultiSelect(e.target.checked)} />
                        Allow multiple answers
                    </label>
                    <span className={s.hint}>People can choose more than one option.</span>
                    <p className={s.hint}>{validation || "Ready to send. Blank extra options are omitted."}</p>
                    {error && <p className={s.error} role="alert">{error}</p>}
                </div>
                <div className={s.footer}>
                    <button type="button" className={s.cancelBtn} disabled={sending} onClick={close}>Cancel</button>
                    <button
                        type="submit"
                        className={s.submitBtn}
                        disabled={!!validation || sending}
                    >{sending ? "Sending…" : "Send Poll"}</button>
                </div>
            </form>
        </PollDialog>
    );
}