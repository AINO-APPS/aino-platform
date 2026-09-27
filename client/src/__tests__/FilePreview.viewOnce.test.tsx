import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const markMessageViewed = vi.fn();
vi.mock("../api/chat", () => ({ markMessageViewed: (...args: unknown[]) => markMessageViewed(...args) }));

import FilePreview from "../components/chat/FilePreview";

const baseProps = {
    fileUrl: "/uploads/org_1/chat/secret.png",
    fileName: "secret.png",
    fileType: "image/png",
    isMessage: true,
    messageId: 12,
    viewOnce: true,
};

describe("FilePreview view-once", () => {
    beforeEach(() => {
        markMessageViewed.mockReset().mockResolvedValue({ data: { fileUrl: "/uploads/org_1/chat/secret.png" } });
    });

    test("sender card is inert and reads Photo until a recipient views it", () => {
        render(<FilePreview {...baseProps} isMine viewOnceConsumed={false} />);
        const card = screen.getByRole("button", { name: /photo/i });
        expect(card).toBeDisabled();
        fireEvent.click(card);
        expect(markMessageViewed).not.toHaveBeenCalled();
        expect(screen.queryByRole("img")).not.toBeInTheDocument();
    });

    test("sender card reads Viewed once a recipient opened it", () => {
        render(<FilePreview {...baseProps} isMine viewOnceConsumed />);
        const card = screen.getByRole("button", { name: /viewed/i });
        expect(card).toBeDisabled();
    });

    test("recipient can open the media once", async () => {
        render(<FilePreview {...baseProps} isMine={false} viewOnceConsumed={false} />);
        fireEvent.click(screen.getByRole("button", { name: /photo/i }));
        await waitFor(() => expect(markMessageViewed).toHaveBeenCalledWith(12));
        expect(await screen.findByRole("img")).toHaveAttribute("src", "/uploads/org_1/chat/secret.png");
        expect(screen.getByRole("button", { name: /viewed/i })).toBeDisabled();
    });
});
