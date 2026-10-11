import { useId, useState } from "react";
import { serverURL } from "../../api/client";
import type { ChatPoll, PollVoter } from "../../api/chat";
import { Trophy, X } from "../../constants/icons";
import PollDialog from "./PollDialog";
import { POLL_VISIBLE_VOTERS, pollResults, pollVoteLabel, samePollId } from "./pollHelpers";
import s from "./PollVotes.module.css";

interface Props {
    poll: ChatPoll | null;
    userId?: number | string;
    loading: boolean;
    pendingOption: number | null;
    loadError: string | null;
    voteError: string | null;
    onRetry: () => void;
    onClose: () => void;
}

function VoterAvatar({ voter }: { voter: PollVoter }) {
    const src = voter.avatar?.startsWith("/") ? `${serverURL}${voter.avatar}` : voter.avatar;
    const [loaded, setLoaded] = useState(false);
    const [failed, setFailed] = useState(false);
    const initials = voter.fullName.trim().split(/\s+/).map(word => word[0]).join("").slice(0, 2).toUpperCase() || "?";
    return <span className={s.avatar} aria-hidden="true">
        <span>{initials}</span>
        {src && !failed && <img src={src} alt="" className={loaded ? s.avatarLoaded : s.avatarLoading}
            onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />}
    </span>;
}

function VoterGroup({ group, userId }: {
    group: ReturnType<typeof pollResults>["groups"][number];
    userId?: number | string;
}) {
    const [expanded, setExpanded] = useState(false);
    const id = useId();
    return <section className={`${s.group} ${group.leading ? s.leading : ""}`} aria-labelledby={`${id}-title`}>
        <div className={s.groupHeader}>
            <h3 id={`${id}-title`}>{group.label}</h3><span>{pollVoteLabel(group.count)} · {group.percent}%</span>
        </div>
        {group.leading && <p className={s.leader}><Trophy size={14} aria-hidden="true" />
            {group.tied ? "Tied for most votes" : "Most votes"}</p>}
        {!group.count && <p className={s.muted}>No votes for this option</p>}
        <ul id={`${id}-voters`} className={s.voters}>
            {(expanded ? group.voters : group.voters.slice(0, POLL_VISIBLE_VOTERS)).map(voter =>
                <li key={voter.userId}>
                    <VoterAvatar key={`${voter.userId}:${voter.avatar}`} voter={voter} />
                    <span>{samePollId(voter.userId, userId) ? "You" : voter.fullName || "Member"}</span>
                </li>)}
        </ul>
        {group.count > POLL_VISIBLE_VOTERS && <button type="button" className={s.textButton}
            aria-expanded={expanded} aria-controls={`${id}-voters`} onClick={() => setExpanded(!expanded)}>
            {expanded ? "Show fewer" : `Show ${group.count - POLL_VISIBLE_VOTERS} more`}
        </button>}
    </section>;
}

export default function PollVotes({ poll, userId, loading, pendingOption, loadError, voteError, onRetry, onClose }: Props) {
    const id = useId();
    const results = poll ? pollResults(poll, userId) : null;
    return <PollDialog className={s.overlay} onClose={onClose}>
        <div className={s.dialog} role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby={`${id}-title`}>
            <header className={s.header}>
                <h2 id={`${id}-title`}>Poll votes</h2>
                <button type="button" className={s.textButton} onClick={onClose} aria-label="Close votes"><X size={20} /></button>
            </header>
            <div className={s.body}>
                {poll && results ? <>
                    <h3 className={s.question}>{poll.question}</h3>
                    <p className={s.muted}>{pollVoteLabel(results.total)} · {results.people} {results.people === 1 ? "person" : "people"}{poll.closed_at ? " · Closed" : ""}</p>
                    {!results.total && <p className={s.muted}>No votes yet. Results will appear here when someone votes.</p>}
                    <p className={s.muted}>Shares are based on all selections{poll.multi_select ? "; a person may vote for several options" : ""}.</p>
                </> : <p className={s.muted}>Votes aren't available yet.</p>}
                {(loading || pendingOption !== null) && <p role="status" className={s.muted}>{pendingOption !== null ? "Updating vote…" : "Refreshing votes…"}</p>}
                {loadError && <div role="alert"><p>{loadError}</p><button type="button" className={s.textButton}
                    disabled={loading || pendingOption !== null} onClick={onRetry}>Retry</button></div>}
                {voteError && <p role="alert">{voteError}</p>}
                {poll && results?.groups.map(group => <VoterGroup key={`${poll.id}:${group.index}`} group={group} userId={userId} />)}
            </div>
        </div>
    </PollDialog>;
}
