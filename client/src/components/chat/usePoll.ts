import { useEffect, useRef, useState } from "react";
import { getPoll, votePoll, type ChatPoll } from "../../api/chat";
import { normalizePoll, pollActionError, pollIdKey, samePollId } from "./pollHelpers";

type PollState = {
    key: string;
    poll: ChatPoll | null;
    loading: boolean;
    pendingOption: number | null;
    loadError: string | null;
    voteError: string | null;
};
const initialState = (key: string): PollState => ({ key, poll: null, loading: true,
    pendingOption: null, loadError: null, voteError: null });

export default function usePoll(pollId: number | string) {
    const key = pollIdKey(pollId);
    const [state, setState] = useState(() => initialState(key));
    const actions = useRef({ refresh: () => {}, vote: (_index: number) => {} });

    useEffect(() => {
        let disposed = false;
        let dirty = false;
        let running = false;
        let voting = false;
        let current = initialState(key);
        const update = (patch: Partial<PollState>) => {
            if (disposed) return;
            current = { ...current, ...patch };
            setState(current);
        };
        update(current);
        // Realtime is an invalidation, not a snapshot: only rich GETs may replace identities.
        const drain = async (afterVote = false) => {
            if (running || disposed) return;
            running = true;
            update({ loading: true, loadError: null });
            try {
                while (dirty && !disposed) {
                    dirty = false;
                    try {
                        const { data } = await getPoll(key);
                        if (!dirty) update({ poll: normalizePoll(data), loadError: null });
                    } catch (error) {
                        if (!dirty) update({ loadError: afterVote
                            ? "Vote sent, but results could not refresh. Retry to see the latest votes."
                            : pollActionError(error, "Could not load votes. Try again.") });
                    }
                }
            } finally {
                running = false;
                update({ loading: false });
            }
        };
        const refresh = () => {
            dirty = true;
            if (!voting) void drain();
        };
        const vote = async (index: number) => {
            if (disposed || running || voting || current.loadError || !current.poll || current.poll.closed_at ||
                !Number.isInteger(index) || index < 0 || index >= current.poll.options.length) return;
            voting = true;
            update({ pendingOption: index, voteError: null });
            try {
                const { data } = await votePoll(key, index);
                if (data.ok === false) throw new Error("Vote rejected");
                if (disposed) return;
                dirty = true;
                await drain(true);
            } catch (error) {
                update({ voteError: pollActionError(error, "Could not update vote. Tap an option to try again.") });
            } finally {
                voting = false;
                update({ pendingOption: null });
                if (dirty && !disposed) void drain();
            }
        };
        actions.current = { refresh, vote };
        const onVote = (event: Event) => {
            if (samePollId((event as CustomEvent<{ pollId?: unknown }>).detail?.pollId, key)) refresh();
        };
        window.addEventListener("poll_vote_update", onVote);
        if (key) refresh();
        else update({ loading: false, loadError: "Poll unavailable." });
        return () => {
            disposed = true;
            window.removeEventListener("poll_vote_update", onVote);
        };
    }, [key]);

    const { key: _scopeKey, ...visibleState } = state.key === key ? state : initialState(key);
    return { ...visibleState, refresh: () => actions.current.refresh(), vote: (index: number) => actions.current.vote(index) };
}
