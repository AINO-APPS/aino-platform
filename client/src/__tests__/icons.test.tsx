import { execFileSync } from "node:child_process";
import { createRef, type ComponentType } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Home, Phone, ChevronDown, type IconProps } from "../constants/icons";
import ChatAvatar from "../components/chat/ChatAvatar";
import { RippleTickGlyph } from "../components/chat/DeliveryStatus";
import { applyRealtimeConversationMessage } from "../pages/chat/chatRealtimeReducers";
import { attachmentPreview } from "../pages/chat/convListParts";
import { registerMaterialQuillIcons } from "../components/DailyNotes/quillMaterialIcons";

describe("Material icon compatibility", () => {
    it("has no Lucide, bespoke UI SVGs, CSS glyph icons or decorative emoji consumers", () => {
        const report = execFileSync(process.execPath, ["scripts/check-ui-icons.mjs"], { cwd: process.cwd(), encoding: "utf8" });
        expect(report).toContain("0 leftovers");
    });

    it("renders genuine Material paths with numeric sizing, color, class, styles and SVG refs", () => {
        const ref = createRef<SVGSVGElement>();
        render(<Home size={20} color="red" className="custom" style={{ marginLeft: 3 }} ref={ref} data-testid="icon" />);
        const svg = screen.getByTestId("icon");
        expect(svg).toHaveClass("MuiSvgIcon-root", "custom");
        expect(svg).toHaveStyle({ width: "20px", height: "20px", marginLeft: "3px" });
        expect(svg).toHaveAttribute("color", "red");
        expect(svg).toHaveAttribute("aria-hidden", "true");
        expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
        expect(svg.querySelector("path")).not.toBeNull();
        expect(ref.current).toBe(svg);
    });

    it("preserves CSS size, explicit dimensions, style overrides and dynamic ComponentType contracts", () => {
        const Dynamic: ComponentType<IconProps> = Phone;
        render(<Dynamic size="1.5rem" width={18} style={{ height: 12 }} aria-label="Call" role="img" />);
        expect(screen.getByRole("img", { name: "Call" })).toHaveStyle({ width: "18px", height: "12px" });
        expect(screen.getByRole("img", { name: "Call" })).not.toHaveAttribute("aria-hidden");
    });

    it("supports labels, labelledby, explicit hidden and accessible SVG titles", () => {
        const { rerender } = render(<ChevronDown titleAccess="Expand" />);
        expect(screen.getByRole("img", { name: "Expand" })).not.toHaveAttribute("aria-hidden");
        rerender(<ChevronDown aria-label="Expand" aria-hidden="true" />);
        expect(screen.getByLabelText("Expand")).toHaveAttribute("aria-hidden", "true");
        rerender(<><span id="label">Expand details</span><ChevronDown role="img" aria-labelledby="label" /></>);
        expect(screen.getByRole("img", { name: "Expand details" })).not.toHaveAttribute("aria-hidden");
    });

    it("keeps avatar status icons within their CSS dot and delivery states distinguishable", () => {
        const { container, rerender } = render(<ChatAvatar name="Test" userStatus="available" />);
        expect(container.querySelector("svg")).toHaveStyle({ width: "100%", height: "100%" });
        const shapes: string[] = [];
        for (const state of ["sent", "delivered", "read"] as const) {
            rerender(<RippleTickGlyph state={state} size={14} />);
            const svg = container.querySelector("svg")!;
            expect(svg).toHaveAttribute("width", "14");
            expect(svg).toHaveAttribute("viewBox", "0 0 16 16");
            shapes.push(svg.innerHTML);
        }
        expect(new Set(shapes).size).toBe(3);
    });

    it("uses icons in typed attachment fallbacks without altering filenames", () => {
        const { container } = render(<span>{attachmentPreview("image/png", "user 👋.png", "/photo")}</span>);
        expect(screen.getByText("Photo")).toBeInTheDocument();
        expect(container.querySelector("svg")).toHaveClass("MuiSvgIcon-root");
    });

    it("retains file metadata for realtime attachment icon previews", () => {
        const result = applyRealtimeConversationMessage({ id: 1 }, { senderId: 2, fileUrl: "/file", fileName: "report 👋.pdf", fileType: "application/pdf" }, 1, false);
        expect(result).toMatchObject({ last_message: "", last_file_url: "/file", last_file_name: "report 👋.pdf", last_file_type: "application/pdf" });
    });

    it("replaces Quill toolbar icons and its hard-coded picker glyph with Material markup", () => {
        const icons: Record<string, unknown> = { bold: "old" };
        class Picker { buildLabel() { const label = document.createElement("span"); label.innerHTML = "<svg><polygon /></svg>"; return label; } }
        registerMaterialQuillIcons({ import: name => name === "ui/icons" ? icons : Picker });
        expect(icons.bold).toContain("MuiSvgIcon-root");
        expect(icons.bold).not.toContain("<style");
        expect(new Picker().buildLabel().querySelector("svg")).toHaveClass("MuiSvgIcon-root");
        expect(document.documentElement.style.getPropertyValue("--mui-calendar-icon")).toContain("data:image/svg+xml");
    });
});
