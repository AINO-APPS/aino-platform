import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("../api/client", () => ({ serverURL: "https://aino.example" }));
import LinkPreviewCard, { previewDomain } from "../components/chat/LinkPreviewCard";
import MessageBubble from "../components/chat/MessageBubble";

afterEach(cleanup);

const preview = {
    url: "https://www.share.google/abc",
    title: "Shared item",
    description: "A long description",
    image: "/uploads/previews/abc.jpg",
    siteName: "Google",
};

describe("LinkPreviewCard", () => {
    test("shows title, description and the bare domain, and resolves server-relative images", () => {
        const { container } = render(<LinkPreviewCard preview={preview} />);
        expect(screen.getByText("Shared item")).toBeInTheDocument();
        expect(screen.getByText("A long description")).toBeInTheDocument();
        expect(screen.getByText("share.google")).toBeInTheDocument();
        expect(container.querySelector("img")).toHaveAttribute("src", "https://aino.example/uploads/previews/abc.jpg");
        const link = screen.getByTestId("link-preview-card");
        expect(link).toHaveAttribute("href", preview.url);
        expect(link).toHaveAttribute("target", "_blank");
        expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });

    test("passes absolute image URLs through and omits the thumbnail without an image", () => {
        const { container, rerender } = render(<LinkPreviewCard preview={{ ...preview, image: "https://cdn.example/x.png" }} />);
        expect(container.querySelector("img")).toHaveAttribute("src", "https://cdn.example/x.png");
        rerender(<LinkPreviewCard preview={{ ...preview, image: null }} />);
        expect(container.querySelector("img")).toBeNull();
    });

    test("falls back to siteName for non-URL previews", () => {
        expect(previewDomain({ url: "not a url", siteName: "Example" })).toBe("Example");
    });

    test("composer variant is not a link and exposes a remove button", () => {
        const onRemove = vi.fn();
        render(<LinkPreviewCard preview={preview} isMine onRemove={onRemove} />);
        expect(screen.getByTestId("link-preview-card").tagName).toBe("DIV");
        fireEvent.click(screen.getByRole("button", { name: "Remove preview" }));
        expect(onRemove).toHaveBeenCalled();
    });
});

describe("MessageBubble link preview", () => {
    test("renders the preview card above the message text", () => {
        render(
            <MessageBubble
                msg={{
                    id: 1,
                    sender_id: 2,
                    sender_name: "Ann",
                    content: "Look https://www.share.google/abc",
                    created_at: "2026-01-01T10:00:00Z",
                    reactions: [],
                    link_preview: preview,
                }}
                isMine={false}
                userId={1}
            />,
        );
        const card = screen.getByTestId("link-preview-card");
        const textLink = screen.getByText("https://www.share.google/abc", { selector: "a" });
        expect(card.compareDocumentPosition(textLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});
