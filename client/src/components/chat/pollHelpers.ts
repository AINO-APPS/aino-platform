import type { ChatPoll, PollSubmitData, PollVoter } from "../../api/chat";

export const POLL_VISIBLE_VOTERS = 5;
export const pollIdKey = (id: unknown): string =>
    typeof id === "string" ? id.trim() : typeof id === "number" && Number.isFinite(id) ? String(id) : "";
export const samePollId = (a: unknown, b: unknown) => !!pollIdKey(a) && pollIdKey(a) === pollIdKey(b);
export const pollVoteLabel = (count: number) => `${count} vote${count === 1 ? "" : "s"}`;

export function normalizePoll(data: ChatPoll): ChatPoll {
    if (!data || !Array.isArray(data.options) || data.options.some(o => typeof o !== "string")) {
        throw new Error("Invalid poll response");
    }
    const votes: ChatPoll["votes"] = {};
    for (const [index, entries] of Object.entries(data.votes || {})) {
        if (!Array.isArray(entries)) continue;
        votes[index] = entries.flatMap((entry: unknown): PollVoter[] => {
            const voter: { userId?: unknown; fullName?: string; avatar?: string | null } =
                entry && typeof entry === "object" ? entry as Partial<PollVoter> : { userId: entry };
            const userId = pollIdKey(voter.userId);
            return userId ? [{ userId, fullName: typeof voter.fullName === "string" ? voter.fullName.trim() || "Member" : "Member",
                avatar: typeof voter.avatar === "string" && voter.avatar.trim() ? voter.avatar : null }] : [];
        });
    }
    return { ...data, votes };
}

export function pollResults(poll: ChatPoll, userId?: number | string) {
    const allVoters = Object.values(poll.votes).flat();
    const total = allVoters.length;
    const groups = poll.options.map((label, index) => {
        const voters = [...(poll.votes[index] || [])].sort((a, b) =>
            Number(samePollId(b.userId, userId)) - Number(samePollId(a.userId, userId)) ||
            a.fullName.toLowerCase().localeCompare(b.fullName.toLowerCase()) ||
            pollIdKey(a.userId).localeCompare(pollIdKey(b.userId), undefined, { numeric: true }));
        return { index, label, voters, count: voters.length,
            percent: total ? Math.round(voters.length * 100 / total) : 0,
            mine: voters.some(voter => samePollId(voter.userId, userId)) };
    });
    const maximum = Math.max(0, ...groups.map(group => group.count));
    const tied = maximum > 0 && groups.filter(group => group.count === maximum).length > 1;
    return { total, people: new Set(allVoters.map(voter => pollIdKey(voter.userId))).size,
        groups: groups.map(group => ({ ...group, leading: maximum > 0 && group.count === maximum,
            tied: tied && group.count === maximum })) };
}

export function pollCreationError(question: string, options: string[]): string | null {
    if (!question.trim()) return "Add a question.";
    if (question.length > 500) return "Keep the question within 500 characters.";
    if (options.length < 2 || options.length > 10) return "Use between 2 and 10 options.";
    if (options.some(option => option.length > 200)) return "Keep each option within 200 characters.";
    if (options.filter(option => option.trim()).length < 2) return "Add at least two options.";
    return null;
}

export function cleanPollDraft(data: PollSubmitData): PollSubmitData {
    const error = pollCreationError(data.question, data.options);
    if (error) throw new Error(error);
    return { ...data, question: data.question.trim(), options: data.options.map(option => option.trim()).filter(Boolean) };
}

export function pollActionError(error: unknown, fallback: string): string {
    const message = (error as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
    return typeof message === "string" && message.trim() ? message : fallback;
}
