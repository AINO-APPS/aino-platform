import { useState } from "react";
import { BarChart3, Check } from "../../constants/icons";
import s from "./PollDisplay.module.css";
import usePoll from "./usePoll";
import PollVotes from "./PollVotes";
import { pollIdKey, pollResults, pollVoteLabel } from "./pollHelpers";

interface PollDisplayProps {
    pollId: number | string;
    userId?: number | string;
    isMine?: boolean;
    interactionEnabled?: boolean;
}

export default function PollDisplay({ pollId, userId, isMine, interactionEnabled = true }: PollDisplayProps) {
    const state = usePoll(pollId);
    const { poll, loading, loadError, voteError, pendingOption, refresh, vote } = state;
    const [resultsOpenFor, setResultsOpenFor] = useState<string | null>(null);
    const results = poll ? pollResults(poll, userId) : null;
    const voting = pendingOption !== null;
    const canVote = !loading && !voting && !loadError && !poll?.closed_at;

    return (
        <div className={`${s.poll} ${isMine ? s.pollMine : ""}`}
            onTouchStart={event => { if (interactionEnabled) event.stopPropagation(); }}
            onTouchEnd={event => { if (interactionEnabled) event.stopPropagation(); }}>
            {poll && <>
                <div className={s.question}><BarChart3 size={16} aria-hidden="true" />{poll.question}</div>
                <p className={s.meta}>{poll.closed_at ? "Poll closed · Results only" : poll.multi_select
                    ? "Choose one or more · Tap again to remove" : "Choose one · Tap again to remove"}</p>
                <div className={s.options}>
                    {results?.groups.map(group => <button type="button" key={group.index}
                        className={`${s.option} ${group.mine ? s.voted : ""}`}
                        aria-pressed={group.mine} aria-busy={pendingOption === group.index}
                        aria-label={`${group.label}, ${pollVoteLabel(group.count)}, ${group.percent} percent${group.mine ? ", selected" : ""}`}
                        onClick={event => {
                            if (!interactionEnabled) return;
                            event.stopPropagation();
                            if (canVote) vote(group.index);
                        }}
                        disabled={interactionEnabled && !canVote}>
                        <div className={s.optBar} style={{ width: `${group.percent}%` }} />
                        <span className={`${s.marker} ${poll.multi_select ? s.multiMarker : ""}`} aria-hidden="true">
                            {group.mine && <Check size={14} />}
                        </span>
                        <span className={s.optLabel}>{group.label}</span>
                        <span className={s.optCount}>{pendingOption === group.index ? "Updating…" : `${group.count} (${group.percent}%)`}</span>
                    </button>)}
                </div>
                <div className={s.meta}>{pollVoteLabel(results?.total || 0)}{poll.multi_select && " · Multiple choice"}</div>
            </>}
            {(loading || voting) && <p role="status" className={s.meta}>{voting ? "Updating vote…" : poll ? "Refreshing votes…" : "Loading poll…"}</p>}
            {loadError && <div role="alert" className={s.error}>{loadError}
                <button type="button" className={s.viewVotes} disabled={!interactionEnabled || loading || voting}
                    onClick={event => { event.stopPropagation(); refresh(); }}>Retry</button>
            </div>}
            {voteError && <p role="alert" className={s.error}>{voteError}</p>}
            <button type="button" className={s.viewVotes} disabled={!interactionEnabled}
                onClick={event => { event.stopPropagation(); setResultsOpenFor(pollIdKey(pollId)); }}>View votes</button>
            {resultsOpenFor === pollIdKey(pollId) && interactionEnabled && <PollVotes {...state} userId={userId}
                onRetry={refresh} onClose={() => setResultsOpenFor(null)} />}
        </div>
    );
}