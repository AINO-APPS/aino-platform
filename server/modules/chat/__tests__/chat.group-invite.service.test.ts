import { createGroupInviteService, isOwnGroupAvatarUrl, isValidInviteToken, newInviteToken } from "../chat.group-invite.service";
import { ChatError } from "../chat.types";
import type { ChatDb } from "../chat.types";

/**
 * A tiny in-memory stand-in for the tenant database: it answers exactly the
 * statements in chat.group-invite.repository.ts, keyed on a distinctive
 * fragment of each one, so tests assert behaviour rather than call order.
 */
function fakeDb() {
    const group = {
        id: 10,
        name: "Design",
        description: null as string | null,
        avatar: null as string | null,
        org_id: 1,
        invite_enabled: false,
        invite_requires_approval: false,
        invite_token: null as string | null,
    };
    const users = new Map<number, { id: number; full_name: string; avatar: string | null; org_id: number; is_active: boolean }>([
        [1, { id: 1, full_name: "Owner", avatar: null, org_id: 1, is_active: true }],
        [2, { id: 2, full_name: "Bea", avatar: "/a/2.png", org_id: 1, is_active: true }],
        [3, { id: 3, full_name: "Other org", avatar: null, org_id: 2, is_active: true }],
        [4, { id: 4, full_name: "Inactive", avatar: null, org_id: 1, is_active: false }],
    ]);
    const participants = new Map<number, string>([[1, "owner"]]);
    const requests = new Set<number>();
    const ok = (rows: any[] = [], rowCount = rows.length) => ({ rows, rowCount });

    const db: ChatDb = {
        query: jest.fn(async (sql: string, p: any[] = []) => {
            if (sql.includes("FROM conversations WHERE id = $1 AND is_group")) return ok(p[0] === group.id ? [{ ...group }] : []);
            if (sql.includes("FROM conversations WHERE invite_token = $1")) return ok(group.invite_token && p[0] === group.invite_token ? [{ ...group }] : []);
            if (sql.includes("SET invite_enabled = $1")) {
                group.invite_enabled = p[0];
                group.invite_requires_approval = p[1];
                group.invite_token = p[2] ?? group.invite_token;
                return ok([], 1);
            }
            if (sql.includes("SET invite_token = $1")) { group.invite_token = p[0]; return ok([], 1); }
            if (sql.includes("FROM users WHERE id = $1 AND org_id = $2 AND is_active")) {
                const u = users.get(p[0]);
                return ok(u && u.org_id === p[1] && u.is_active ? [u] : []);
            }
            if (sql.includes("SELECT role FROM conversation_participants")) {
                return ok(participants.has(p[1]) ? [{ role: participants.get(p[1]) }] : []);
            }
            if (sql.includes("AS member_count")) return ok([{ member_count: participants.size, member_avatars: [] }]);
            if (sql.includes("INSERT INTO conversation_participants")) {
                if (participants.has(p[1])) return ok([], 0);
                participants.set(p[1], "member");
                return ok([], 1);
            }
            if (sql.includes("SELECT 1 FROM conversation_join_requests")) return ok(requests.has(p[1]) ? [{}] : []);
            if (sql.includes("INSERT INTO conversation_join_requests")) {
                if (requests.has(p[1])) return ok([], 0);
                requests.add(p[1]);
                return ok([], 1);
            }
            if (sql.includes("DELETE FROM conversation_join_requests")) return ok([], requests.delete(p[1]) ? 1 : 0);
            if (sql.includes("COUNT(*)::int AS c FROM conversation_join_requests")) return ok([{ c: requests.size }]);
            return ok();
        }),
    };
    return { db, group, participants, requests };
}

let seq = 0;
const service = () => createGroupInviteService(() => `token-${String(++seq).padStart(16, "0")}`);

describe("group invite links", () => {
    test("first enable issues a token; disabling hides it and kills the link", async () => {
        const { db } = fakeDb();
        const s = service();
        const on = await s.updateInviteLink(db, 10, { enabled: true });
        expect(on.enabled).toBe(true);
        expect(on.token).toMatch(/^token-/);

        const off = await s.updateInviteLink(db, 10, { enabled: false });
        expect(off.token).toBeNull();
        await expect(s.previewInvite(db, 2, on.token)).rejects.toMatchObject({ statusCode: 404 });
    });

    test("re-enabling keeps the same token; reset rotates it", async () => {
        const { db } = fakeDb();
        const s = service();
        const first = await s.updateInviteLink(db, 10, { enabled: true });
        await s.updateInviteLink(db, 10, { enabled: false });
        const again = await s.updateInviteLink(db, 10, { enabled: true });
        expect(again.token).toBe(first.token);

        const reset = await s.resetInviteLink(db, 10);
        expect(reset.token).not.toBe(first.token);
        await expect(s.joinByInvite(db, 2, first.token)).rejects.toMatchObject({ statusCode: 404 });
    });

    test("an open link adds a same-org user once", async () => {
        const { db, participants } = fakeDb();
        const s = service();
        const { token } = await s.updateInviteLink(db, 10, { enabled: true });

        await expect(s.joinByInvite(db, 2, token)).resolves.toMatchObject({ status: "joined", added: true });
        expect(participants.get(2)).toBe("member");
        await expect(s.joinByInvite(db, 2, token)).resolves.toMatchObject({ status: "joined", added: false });
    });

    test("users outside the group's organization, or inactive, cannot join", async () => {
        const { db, participants } = fakeDb();
        const s = service();
        const { token } = await s.updateInviteLink(db, 10, { enabled: true });

        await expect(s.joinByInvite(db, 3, token)).rejects.toMatchObject({ statusCode: 403 });
        await expect(s.joinByInvite(db, 4, token)).rejects.toMatchObject({ statusCode: 403 });
        expect(participants.has(3)).toBe(false);
    });

    test("approval mode queues a request; approve adds, deny drops", async () => {
        const { db, participants, requests } = fakeDb();
        const s = service();
        const { token } = await s.updateInviteLink(db, 10, { enabled: true, requiresApproval: true });

        await expect(s.joinByInvite(db, 2, token)).resolves.toMatchObject({ status: "pending", created: true });
        expect(participants.has(2)).toBe(false);
        await expect(s.previewInvite(db, 2, token)).resolves.toMatchObject({ pending: true, alreadyMember: false });
        expect((await s.getInviteLink(db, 10)).pendingRequests).toBe(1);

        await expect(s.resolveJoinRequest(db, 10, 2, true)).resolves.toMatchObject({ added: true });
        expect(participants.get(2)).toBe("member");
        expect(requests.size).toBe(0);
        await expect(s.resolveJoinRequest(db, 10, 2, false)).rejects.toMatchObject({ statusCode: 404 });
    });

    test("malformed tokens never reach the database", async () => {
        const { db } = fakeDb();
        await expect(service().previewInvite(db, 2, "../etc")).rejects.toBeInstanceOf(ChatError);
        expect(db.query).not.toHaveBeenCalled();
    });

    test("generated tokens are URL-safe and pass validation", () => {
        const token = newInviteToken();
        expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(isValidInviteToken(token)).toBe(true);
        expect(isValidInviteToken("short")).toBe(false);
    });
});

describe("group photo ownership", () => {
    const own = "/uploads/tenant_7/org_1/avatars/group_9f3ca1b2c3d4e5f60718293a4b5c6d7e.jpg";

    test("accepts only this tenant/org's uploaded group photos", () => {
        expect(isOwnGroupAvatarUrl(own, 7, 1)).toBe(true);
        expect(isOwnGroupAvatarUrl(own, 8, 1)).toBe(false);
        expect(isOwnGroupAvatarUrl(own, 7, 2)).toBe(false);
    });

    test("rejects other kinds, traversal and junk", () => {
        expect(isOwnGroupAvatarUrl("/uploads/tenant_7/org_1/avatars/user_abc.jpg", 7, 1)).toBe(false);
        expect(isOwnGroupAvatarUrl("/uploads/tenant_7/org_1/chat/group_abc.jpg", 7, 1)).toBe(false);
        expect(isOwnGroupAvatarUrl("/uploads/tenant_7/org_1/avatars/group_../../x.jpg", 7, 1)).toBe(false);
        expect(isOwnGroupAvatarUrl("/uploads/tenant_7/org_1/avatars/group_a.svg", 7, 1)).toBe(false);
        expect(isOwnGroupAvatarUrl(null, 7, 1)).toBe(false);
        expect(isOwnGroupAvatarUrl(own, undefined, 1)).toBe(false);
    });
});

describe("active group call", () => {
    test("non-members are refused", async () => {
        const { db } = fakeDb();
        await expect(service().getActiveGroupCall(db, 2, 10)).rejects.toMatchObject({ statusCode: 403 });
    });

    test("returns null when no huddle is running", async () => {
        const { db } = fakeDb();
        await expect(service().getActiveGroupCall(db, 1, 10)).resolves.toBeNull();
    });
});
