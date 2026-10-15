import { createChatService } from "../chat.service";
import { ChatError } from "../chat.types";
import type { ChatDb } from "../chat.types";

function makeDb(responses: Array<{ rows: any[]; rowCount?: number }>): ChatDb {
    let call = 0;
    return {
        query: jest.fn(async () => {
            const r = responses[call] ?? { rows: [], rowCount: 0 };
            call += 1;
            return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
        }),
    };
}

function makeTransactionalDb(responses: Array<{ rows: any[]; rowCount?: number }>): ChatDb {
    const db = makeDb(responses);
    db.transaction = async (fn) => fn(db);
    return db;
}

describe("chat.service toggleReaction", () => {
    test("rejects reactions on deleted messages", async () => {
        const db = makeDb([
            { rows: [{ id: 12, conversation_id: 10, deleted_at: new Date().toISOString() }] },
        ]);
        const service = createChatService();

        await expect(service.toggleReaction(db, 1, 12, "👍")).rejects.toThrow(/deleted/i);
    });

    describe("chat.service toggleConversationArchive", () => {
        test("toggles a participating user's archived state", async () => {
            const db = makeDb([{ rows: [{ user_id: 1 }] }, { rows: [{ is_archived: true }] }]);

            await expect(createChatService().toggleConversationArchive(db, 1, 12)).resolves.toBe(true);
        });

        test("rejects a non-participant", async () => {
            const db = makeDb([{ rows: [] }]);

            await expect(createChatService().toggleConversationArchive(db, 1, 12)).rejects.toThrow(
                /participant/i,
            );
        });
    });

    test("rejects reactions from non-participants", async () => {
        const db = makeDb([
            { rows: [{ id: 12, conversation_id: 10, deleted_at: null }] },
            { rows: [] }, // verifyParticipant miss
        ]);
        const service = createChatService();

        await expect(service.toggleReaction(db, 1, 12, "👍")).rejects.toThrow(/participant/i);
    });

    test("adds a reaction when none exists yet", async () => {
        const db = makeDb([
            { rows: [{ id: 12, conversation_id: 10, sender_id: 2, deleted_at: null }] }, // getMessage
            { rows: [{ user_id: 1 }] }, // verifyParticipant hit
            { rows: [] }, // findExistingReaction miss
            { rows: [{ id: 91, created_at: "2026-10-11T12:00:00Z" }] }, // insertReaction
            { rows: [{ full_name: "Alice", avatar: "/uploads/alice.png" }] }, // getUserNameAndAvatar
            { rows: [{ user_id: 1 }, { user_id: 2 }] }, // getConversationParticipantIds
        ]);
        const service = createChatService();

        const result = await service.toggleReaction(db, 1, 12, "👍");
        expect(result.action).toBe("added");
        expect(result.participantIds).toEqual([1, 2]);
        expect(result).toMatchObject({ messageOwnerId: 2, reactionId: 91, sentAt: 1791720000, senderName: "Alice", senderAvatar: "/uploads/alice.png" });
        expect(db.query).toHaveBeenCalledWith(expect.stringContaining("RETURNING id, created_at"), [12, 1, "👍"]);
    });

    test("removal has no addition identity and re-add uses a fresh persisted id", async () => {
        const db = makeDb([
            { rows: [{ id: 12, conversation_id: 10, sender_id: 2, deleted_at: null }] },
            { rows: [{ user_id: 1 }] }, { rows: [{ id: 91 }] }, { rows: [] },
            { rows: [{ full_name: "Alice" }] }, { rows: [{ user_id: 1 }, { user_id: 2 }] },
            { rows: [{ id: 12, conversation_id: 10, sender_id: 2, deleted_at: null }] },
            { rows: [{ user_id: 1 }] }, { rows: [] },
            { rows: [{ id: 92, created_at: "2026-10-11T12:01:00Z" }] },
            { rows: [{ full_name: "Alice" }] }, { rows: [{ user_id: 1 }, { user_id: 2 }] },
        ]);
        const service = createChatService();
        expect(await service.toggleReaction(db, 1, 12, "👍")).toMatchObject({
            action: "removed", reactionId: null, sentAt: null, senderAvatar: null,
        });
        expect(await service.toggleReaction(db, 1, 12, "👍")).toMatchObject({
            action: "added", reactionId: 92, sentAt: 1791720060,
        });
    });

    test("an insertion conflict has no addition identity to push", async () => {
        const db = makeDb([
            { rows: [{ id: 12, conversation_id: 10, sender_id: 2, deleted_at: null }] },
            { rows: [{ user_id: 1 }] }, { rows: [] }, { rows: [] },
            { rows: [{ full_name: "Alice" }] }, { rows: [] },
        ]);
        expect(await createChatService().toggleReaction(db, 1, 12, "👍")).toMatchObject({
            reactionId: null, sentAt: null,
        });
    });
});

describe("chat.service togglePin", () => {
    test("rejects pin from non-participants", async () => {
        const db = makeDb([
            { rows: [{ id: 12, conversation_id: 10, deleted_at: null, pinned_at: null }] },
            { rows: [] },
        ]);
        const service = createChatService();

        await expect(service.togglePin(db, 1, 12)).rejects.toThrow(/participant/i);
    });

    const pinnedMsg = (pinnedBy: number | null) => ({
        rows: [{ id: 12, conversation_id: 10, deleted_at: null, pinned_at: "2026-10-01T00:00:00Z", pinned_by: pinnedBy }],
    });
    const unpinTail = [{ rows: [], rowCount: 1 }, { rows: [{ full_name: "Alice" }] }, { rows: [{ user_id: 1 }, { user_id: 2 }] }];
    const unpinCalled = (db: ChatDb) => (db.query as jest.Mock).mock.calls.some(([sql]) => String(sql).includes("pinned_at = NULL"));

    test("the pinner can unpin without a group lookup", async () => {
        const db = makeDb([pinnedMsg(1), { rows: [{ user_id: 1 }] }, ...unpinTail]);
        await expect(createChatService().togglePin(db, 1, 12)).resolves.toMatchObject({ pinned: false, conversationId: 10 });
        expect(unpinCalled(db)).toBe(true);
    });

    test("another group member cannot unpin someone else's pin", async () => {
        const db = makeDb([pinnedMsg(2), { rows: [{ user_id: 1 }] }, { rows: [{ is_group: true }] }, { rows: [{ role: "member" }] }]);
        const err = await createChatService().togglePin(db, 1, 12).catch((e) => e);
        expect(err).toBeInstanceOf(ChatError);
        expect(err.statusCode).toBe(403);
        expect(err.message).toBe("Only the person who pinned this message or a group admin can unpin it");
        expect(unpinCalled(db)).toBe(false);
    });

    test.each(["admin", "owner"])("a group %s can unpin someone else's pin", async (role) => {
        const db = makeDb([pinnedMsg(2), { rows: [{ user_id: 1 }] }, { rows: [{ is_group: true }] }, { rows: [{ role }] }, ...unpinTail]);
        await expect(createChatService().togglePin(db, 1, 12)).resolves.toMatchObject({ pinned: false });
        expect(unpinCalled(db)).toBe(true);
    });

    test("org governance can unpin any pin", async () => {
        const db = makeDb([pinnedMsg(2), { rows: [{ user_id: 1 }] }, ...unpinTail]);
        await expect(createChatService().togglePin(db, 1, 12, 4)).resolves.toMatchObject({ pinned: false });
    });

    test("the other 1:1 participant cannot unpin", async () => {
        const db = makeDb([pinnedMsg(2), { rows: [{ user_id: 1 }] }, { rows: [{ is_group: false }] }, { rows: [{ role: "member" }] }]);
        await expect(createChatService().togglePin(db, 1, 12)).rejects.toMatchObject({ statusCode: 403 });
        expect(unpinCalled(db)).toBe(false);
    });

    test("legacy 1:1 pins without pinned_by can be unpinned by either participant", async () => {
        const db = makeDb([pinnedMsg(null), { rows: [{ user_id: 1 }] }, { rows: [{ is_group: false }] }, { rows: [{ role: "member" }] }, ...unpinTail]);
        await expect(createChatService().togglePin(db, 1, 12)).resolves.toMatchObject({ pinned: false });
        expect(unpinCalled(db)).toBe(true);
    });

    test("legacy group pins without pinned_by need a group admin", async () => {
        const db = makeDb([pinnedMsg(null), { rows: [{ user_id: 1 }] }, { rows: [{ is_group: true }] }, { rows: [{ role: "member" }] }]);
        await expect(createChatService().togglePin(db, 1, 12)).rejects.toMatchObject({ statusCode: 403 });
    });

    test("any participant can pin", async () => {
        const db = makeDb([{ rows: [{ id: 12, conversation_id: 10, deleted_at: null, pinned_at: null, pinned_by: null }] }, { rows: [{ user_id: 1 }] }, ...unpinTail]);
        await expect(createChatService().togglePin(db, 1, 12)).resolves.toMatchObject({ pinned: true });
    });

    describe("chat.service listConversationMembers", () => {
        test("rejects a non-participant", async () => {
            const db = makeDb([{ rows: [] }]);

            await expect(createChatService().listConversationMembers(db, 1, 12)).rejects.toThrow(
                /participant/i,
            );
        });

        describe("chat.service toggleConversationPin", () => {
            test("toggles a participating user's pin state", async () => {
                const db = makeDb([{ rows: [{ user_id: 1 }] }, { rows: [{ is_pinned: true }] }]);

                await expect(createChatService().toggleConversationPin(db, 1, 12)).resolves.toBe(true);
            });

            describe("chat.service toggleConversationFavourite", () => {
                test("toggles a participating user's favourite state", async () => {
                    const db = makeDb([{ rows: [{ user_id: 1 }] }, { rows: [{ is_favourite: true }] }]);

                    await expect(createChatService().toggleConversationFavourite(db, 1, 12)).resolves.toBe(true);
                });

                describe("chat.service setConversationMute", () => {
                    test("sets a permanent mute for a participant", async () => {
                        const db = makeDb([{ rows: [{ user_id: 1 }] }, { rows: [{ is_muted: true, muted_until: null }] }]);

                        await expect(createChatService().setConversationMute(db, 1, 12, "always")).resolves.toEqual({
                            is_muted: true,
                            muted_until: null,
                        });

                    });

                    test("rejects an invalid duration", async () => {
                        const db = makeDb([{ rows: [{ user_id: 1 }] }]);

                        await expect(createChatService().setConversationMute(db, 1, 12, "2h")).rejects.toThrow(
                            /invalid duration/i,
                        );
                    });
                });

                test("rejects a non-participant", async () => {
                    const db = makeDb([{ rows: [] }]);

                    await expect(createChatService().toggleConversationFavourite(db, 1, 12)).rejects.toThrow(
                        /participant/i,
                    );
                });
            });

            test("rejects a non-participant", async () => {
                const db = makeDb([{ rows: [] }]);

                await expect(createChatService().toggleConversationPin(db, 1, 12)).rejects.toThrow(
                    /participant/i,
                );
            });
        });

        test("returns members for a participant", async () => {
            const members = [{ id: 1, role: "owner" }, { id: 2, role: "member" }];
            const db = makeDb([{ rows: [{ user_id: 1 }] }, { rows: members }]);

            await expect(createChatService().listConversationMembers(db, 1, 12)).resolves.toEqual(members);
        });
    });
});

describe("chat.service toggleStar", () => {
    test("stars an unstarred message", async () => {
        const db = makeDb([
            { rows: [{ id: 12, conversation_id: 10, deleted_at: null }] }, // getMessage
            { rows: [{ user_id: 1 }] }, // verifyParticipant hit
            { rows: [] }, // findStarred miss
            { rows: [] }, // insertStar
        ]);
        const service = createChatService();

        const result = await service.toggleStar(db, 1, 12);
        expect(result.starred).toBe(true);
    });
});

describe("chat.service blockUser/unblockUser", () => {
    test("rejects blocking yourself", async () => {
        const db = makeDb([]);
        const service = createChatService();

        await expect(service.blockUser(db, 1, 1)).rejects.toThrow(/invalid user/i);
    });

    describe("chat.service findOrCreateDirectConversation", () => {
        test("creates a self conversation when one does not exist", async () => {
            const db = makeTransactionalDb([
                { rows: [{ id: 1, org_id: 5 }] },
                { rows: [] },
                { rows: [{ id: 12 }] },
                { rows: [] },
            ]);

            await expect(createChatService().findOrCreateDirectConversation(db, 1, 1)).resolves.toEqual({
                id: 12,
            });

        });

        test("rejects direct conversations across organizations", async () => {
            const db = makeDb([{ rows: [{ id: 1, org_id: 5 }, { id: 2, org_id: 6 }] }]);

            await expect(createChatService().findOrCreateDirectConversation(db, 1, 2)).rejects.toThrow(
                /same organization/i,
            );
        });
    });

    describe("chat.service repository delegation", () => {
        test("builds a paginated message query with the original parameter positions", async () => {
            const db = makeDb([{ rows: [] }]);

            await createChatService().listMessages(db, 7, 12, 99, 50);

            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining("m.id < $3 ORDER BY m.created_at DESC LIMIT $4"),
                [7, 12, 99, 50],
            );
        });

        test("builds an oldest-first delta query for ?after= catch-up", async () => {
            const db = makeDb([{ rows: [] }]);

            await createChatService().listMessages(db, 7, 12, null, 100, 345);

            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining("m.id > $3 ORDER BY m.created_at ASC, m.id ASC LIMIT $4"),
                [7, 12, 345, 100],
            );
        });

        test("uses the scoped message search statement for a conversation", async () => {
            const db = makeDb([{ rows: [] }]);

            await createChatService().searchMessages(db, 7, 12, "%hello%");

            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining("WHERE m.conversation_id = $1"),
                [12, "%hello%", 7],
            );
        });
    });

    describe("chat.service createGroupConversation", () => {
        test("creates a group with the creator as owner", async () => {
            const db = makeTransactionalDb([
                { rows: [{ org_id: 5 }] },
                { rows: [{ id: 1 }, { id: 2 }] },
                { rows: [{ id: 12 }] },
                { rows: [] },
                { rows: [] },
            ]);

            const result = await createChatService().createGroupConversation(db, 1, " Team ", [2]);

            expect(result).toEqual({ conversation: { id: 12 }, participantIds: [2] });
            expect(db.query).toHaveBeenLastCalledWith(
                expect.stringContaining("INSERT INTO conversation_participants"),
                [12, 2, "member"],
            );
        });

        test("rejects members outside the creator organization", async () => {
            const db = makeDb([
                { rows: [{ org_id: 5 }] },
                { rows: [{ id: 1 }] },
            ]);

            await expect(createChatService().createGroupConversation(db, 1, "Team", [2])).rejects.toThrow(
                /not found/i,
            );
        });
    });

    test("rejects blocking a user outside the org", async () => {
        const db = makeDb([
            { rows: [{ org_id: 5 }] }, // getUserOrgId
            { rows: [] }, // getUserInOrg miss
        ]);
        const service = createChatService();

        await expect(service.blockUser(db, 1, 2)).rejects.toThrow(/not found/i);
    });

    test("blocks a valid same-org user", async () => {
        const db = makeDb([
            { rows: [{ org_id: 5 }] }, // getUserOrgId
            { rows: [{ id: 2 }] }, // getUserInOrg hit
            { rows: [] }, // insertBlock
        ]);
        const service = createChatService();

        await expect(service.blockUser(db, 1, 2)).resolves.toBeUndefined();
    });

    test("unblocks a user (idempotent, no lookup required)", async () => {
        const db = makeDb([{ rows: [] }]); // deleteBlock
        const service = createChatService();

        await expect(service.unblockUser(db, 1, 2)).resolves.toBeUndefined();
    });
});
