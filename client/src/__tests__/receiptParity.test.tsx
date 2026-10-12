import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import DeliveryStatus, { RippleTickGlyph } from "../components/chat/DeliveryStatus";
import MessageContent from "../components/chat/MessageContent";

// Geometry copied from Android SignalReceiptIcon (16-unit grid).
describe("Android receipt parity", () => {
    test("sent is an outlined ring with the outer check", () => {
        const { container } = render(<RippleTickGlyph state="sent" />);
        const circle = container.querySelector("circle")!;
        expect(circle).toHaveAttribute("r", "6.6");
        expect(circle).toHaveAttribute("fill", "none");
        expect(container.querySelector("path")).toHaveAttribute("d", "M4.9 8.2L7 10.3L11.1 5.8");
    });
    test("delivered is a solid disc with the check punched out", () => {
        const { container } = render(<RippleTickGlyph state="delivered" />);
        const disc = container.querySelector("circle")!;
        expect(disc).toHaveAttribute("r", "7");
        expect(disc).toHaveAttribute("fill", "currentColor");
        // The check is a transparent cut-out, so it shows the bubble behind it in any theme.
        const mask = container.querySelector("mask")!;
        expect(disc.getAttribute("mask")).toBe(`url(#${mask.id})`);
        expect(mask.querySelector("path")).toHaveAttribute("d", "M4.9 8.2L7 10.3L11.1 5.8");
    });
    test("read is a filled inner disc with a 45% ring and the inner check", () => {
        const { container } = render(<RippleTickGlyph state="read" />);
        const [ring, disc] = Array.from(container.querySelectorAll("circle"));
        expect(ring).toHaveAttribute("r", "7.2");
        expect(ring).toHaveAttribute("stroke-opacity", "0.45");
        expect(disc).toHaveAttribute("r", "5.2");
        expect(container.querySelector("path")).toHaveAttribute("d", "M5.6 8.1L7.2 9.7L10.4 6.3");
    });
    test("state transitions follow Android deliveryTick", () => {
        const base = { id: 9, created_at: "2026-10-12T10:00:00Z" };
        const view = render(<DeliveryStatus isMine msg={base} participantCount={2} userId={1} />);
        expect(screen.getByLabelText("Sent")).toBeInTheDocument();
        view.rerender(<DeliveryStatus isMine msg={{ ...base, delivered_to: [2] }} participantCount={2} userId={1} />);
        expect(screen.getByLabelText("Delivered")).toBeInTheDocument();
        view.rerender(<DeliveryStatus isMine msg={{ ...base, delivered_to: [2] }} participantCount={2} userId={1}
            readReceipts={{ 2: "2026-10-12T10:01:00Z" }} />);
        expect(screen.getByLabelText("Read")).toBeInTheDocument();
        view.rerender(<DeliveryStatus isMine msg={{ ...base, id: "pending_1" }} participantCount={2} userId={1} />);
        expect(screen.getByLabelText("Sending")).toBeInTheDocument();
    });
});

describe("single-row footer", () => {
    test("time and receipt share the text's last line: a hidden spacer reserves room, the visible footer is pinned", () => {
        const meta = <div data-testid="meta"><span>10:42</span><span aria-label="Read">r</span></div>;
        const { container } = render(<MessageContent text="Hello there" meta={meta} />);
        const block = container.firstElementChild!;
        const [spacer, visible] = Array.from(block.children);
        expect(block.firstChild!.textContent).toBe("Hello there");
        expect(spacer).toHaveAttribute("aria-hidden", "true");
        expect(visible).not.toHaveAttribute("aria-hidden");
        expect(screen.getAllByTestId("meta")).toHaveLength(2);
        // Assistive technology sees exactly one receipt: the spacer copy is hidden.
        const exposed = screen.getAllByLabelText("Read").filter((el) => !el.closest("[aria-hidden='true']"));
        expect(exposed).toEqual([visible.querySelector("[aria-label='Read']")]);
    });
    test("code blocks keep the footer on its own row", () => {
        const meta = <div data-testid="meta">10:42</div>;
        const { container } = render(<MessageContent text={"```js\nx\n```"} meta={meta} />);
        expect(container.firstElementChild).not.toContainElement(screen.getByTestId("meta"));
    });
});
