import s from './TaskTimePanel.module.css';

const messages: Record<string, string> = {
    ON_LEAVE: 'The author has approved leave on this day.',
    EXCEEDS_ATTENDANCE: 'The author’s total work logged for this day exceeds their clocked-in working time.',
};

export default function WorklogWarnings({ warnings }: { warnings: string[] }) {
    const visible = [...new Set(warnings)].filter(code => messages[code]);
    if (!visible.length) return null;
    return <div className={s['worklog-warnings']} role="status" aria-atomic="true">
        <strong>Work saved — check this day</strong>
        <ul>{visible.map(code => <li key={code}>{messages[code]}</li>)}</ul>
    </div>;
}
