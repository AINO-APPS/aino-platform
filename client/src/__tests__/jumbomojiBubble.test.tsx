import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("../api/client", () => ({ serverURL: "" }));
import MessageBubble from "../components/chat/MessageBubble";

afterEach(cleanup);

const base = { id: 1, sender_id: 2, sender_name: "Ann", created_at: "2026-01-01T10:00:00Z", reactions: [] };

function renderMsg(extra: Record<string, unknown>) {
    return render(<MessageBubble msg={{ ...base, ...extra }} isMine={false} userId={1} />);
}

describe("MessageBubble jumbomoji", () => {
    test("emoji-only text renders large without a bubble and keeps the time footer", () => {
        const { container } = renderMsg({ content: "😀😀" });
        const text = screen.getByText("😀😀");
        expect(text).toHaveStyle({ fontSize: "40px" });
        expect(text.parentElement?.className).toMatch(/jumbo/);
        expect(container.querySelector('[class*="meta"]')).not.toBeNull();
    });

    test.each([
        ["a reply", { reply_to_id: 9, reply_content: "hi" }],
        ["a forward", { forwarded_from_id: 9 }],
        ["an attachment", { file_url: "/f.png", file_type: "image/png", file_name: "f.png" }],
    ])("%s keeps the normal bubble", (_name, extra) => {
        const { container } = renderMsg({ content: "😀", ...extra });
        expect(container.querySelector('[class*="jumbo"]')).toBeNull();
    });

    test("mixed text is not jumbo", () => {
        const { container } = renderMsg({ content: "hi 😀" });
        expect(container.querySelector('[class*="jumbo"]')).toBeNull();
    });
});
