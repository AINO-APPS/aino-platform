import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
    AlignLeft, AlignCenter, AlignRight, AlignJustify, Palette, Quote,
    FormatBold, FormatItalic, FormatUnderlined, FormatStrikethrough,
    FormatClear, Code2, Sigma, Heading1, Heading2, Heading3, Type,
    Image, Video, FormatIndentIncrease, FormatIndentDecrease, Link,
    List, ListChecks, ListOrdered, Subscript, Superscript, Table2,
    HorizontalRule, Clock, ChevronDown, Calendar, Info, Lightbulb,
    AlertTriangle, CheckCircle2, type IconComponent,
} from "../../constants/icons";

export function materialIconMarkup(Icon: IconComponent) {
    return renderToStaticMarkup(createElement(Icon, { size: 18 }))
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, "");
}

export function registerMaterialQuillIcons(Quill: { import: (name: string) => unknown }) {
    const icons = Quill.import("ui/icons") as Record<string, unknown>;
    Object.assign(icons, {
        align: { "": materialIconMarkup(AlignLeft), center: materialIconMarkup(AlignCenter), right: materialIconMarkup(AlignRight), justify: materialIconMarkup(AlignJustify) },
        background: materialIconMarkup(Palette), blockquote: materialIconMarkup(Quote), bold: materialIconMarkup(FormatBold),
        clean: materialIconMarkup(FormatClear), code: materialIconMarkup(Code2), "code-block": materialIconMarkup(Code2),
        color: materialIconMarkup(Palette), direction: { "": materialIconMarkup(AlignLeft), rtl: materialIconMarkup(AlignRight) },
        formula: materialIconMarkup(Sigma), header: { "1": materialIconMarkup(Heading1), "2": materialIconMarkup(Heading2), "3": materialIconMarkup(Heading3), "4": materialIconMarkup(Type), "5": materialIconMarkup(Type), "6": materialIconMarkup(Type) },
        italic: materialIconMarkup(FormatItalic), image: materialIconMarkup(Image),
        indent: { "+1": materialIconMarkup(FormatIndentIncrease), "-1": materialIconMarkup(FormatIndentDecrease) },
        link: materialIconMarkup(Link), list: { bullet: materialIconMarkup(List), check: materialIconMarkup(ListChecks), ordered: materialIconMarkup(ListOrdered) },
        script: { sub: materialIconMarkup(Subscript), super: materialIconMarkup(Superscript) },
        strike: materialIconMarkup(FormatStrikethrough), table: materialIconMarkup(Table2),
        underline: materialIconMarkup(FormatUnderlined), video: materialIconMarkup(Video),
        divider: materialIconMarkup(HorizontalRule), timestamp: materialIconMarkup(Clock), dropdown: materialIconMarkup(ChevronDown),
    });
    const Picker = Quill.import("ui/picker") as { prototype: { buildLabel: () => HTMLElement } };
    const buildLabel = Picker.prototype.buildLabel;
    Picker.prototype.buildLabel = function () {
        const label = buildLabel.call(this);
        label.querySelector("svg")?.remove();
        label.insertAdjacentHTML("beforeend", materialIconMarkup(ChevronDown));
        return label;
    };
    if (typeof document !== "undefined") {
        for (const [name, Icon] of Object.entries({ calendar: Calendar, chevron: ChevronDown, info: Info, tip: Lightbulb, warn: AlertTriangle, success: CheckCircle2 })) {
            document.documentElement.style.setProperty(`--mui-${name}-icon`, `url("data:image/svg+xml,${encodeURIComponent(materialIconMarkup(Icon))}")`);
        }
    }
}
