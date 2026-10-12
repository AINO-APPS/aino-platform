import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
const chartFiles = new Set([
    "components/agile/AgileWorkflowPanels.tsx", "pages/SprintInsights.tsx",
    "components/FloatingTimer/FloatingTimer.tsx", "components/dashboard/WorkTimerCard.tsx",
    "pages/dashboard/TimerCard.tsx",
    // Message receipts mirror Android's custom-drawn SignalReceiptIcon; no Material glyph matches.
    "components/chat/DeliveryStatus.tsx",
]);
const contentFiles = new Map([
    ["components/DailyNotes/templates.ts", "Editable note template prose"],
    ["components/DailyNotes/notesMarkdown.ts", "Plain-text/Markdown exported content"],
    ["components/DailyNotes/components/IconPicker.tsx", "User-selected page emoji"],
    ["components/DailyNotes/components/ReactionsBar.tsx", "User reactions"],
    ["components/DailyNotes/useNotesFilters.ts", "User reaction keys"],
    ["components/chat/MessageToolbar.tsx", "User quick reactions"],
    ["components/chat/ReactionPicker.tsx", "User reactions"],
    ["components/chat/call/index.tsx", "Call reaction content"],
    ["pages/meeting/MeetingBottomBar.tsx", "Meeting reaction content"],
    ["pages/SprintInsights.tsx", "User retrospective mood choices"],
    ["pages/chat/ChatMessages.tsx", "Friendly prose: Say hello!"],
]);

export function inventoryUiIcons() {
    const violations = [], exceptions = [];
    let scanned = 0;
    for (const relative of fs.readdirSync(root, { recursive: true })) {
        const file = relative.replaceAll("\\", "/");
        if (!/\.(tsx?|css)$/.test(file) || file.startsWith("__tests__/") || file.startsWith("emoji/")) continue;
        const source = fs.readFileSync(path.join(root, relative), "utf8");
        scanned++;
        const report = (position, reason) => violations.push(`${file}:${source.slice(0, position).split("\n").length}: ${reason}`);
        if (file.endsWith(".css")) {
            for (const match of source.matchAll(/content\s*:\s*["']([^"']+)["']/g)) {
                if (!["[[", "]]"] .includes(match[1])) report(match.index, `Non-Material CSS icon/content: ${match[1]}`);
            }
            continue;
        }
        const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        function walk(node) {
            if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
                const module = node.moduleSpecifier?.text || "";
                if (module === "lucide-react") report(node.getStart(ast), "Lucide consumer");
                if (module.startsWith("@mui/icons-material") && file !== "constants/icons.ts") report(node.getStart(ast), "Material import outside shared registry");
                if (module === "@mui/icons-material") report(node.getStart(ast), "Non-tree-shakeable Material barrel import");
            }
            if ((ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "svg") || (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "svg")) {
                if (chartFiles.has(file)) exceptions.push(`${file}: ${file.endsWith("DeliveryStatus.tsx") ? "Android receipt glyph parity" : "chart/progress drawing"}`);
                else report(node.getStart(ast), "Bespoke SVG UI icon");
            }
            if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) {
                const text = ts.isJsxText(node) ? node.getText(ast) : node.text;
                if (/\p{Extended_Pictographic}|[✓✕✗➤▶⏹☑☐↻↺▸▾▲▼]/u.test(text)) {
                    const reason = contentFiles.get(file);
                    if (reason) exceptions.push(`${file}: ${reason}`);
                    else report(node.getStart(ast), `Decorative/control glyph: ${text.slice(0, 70)}`);
                }
            }
            ts.forEachChild(node, walk);
        }
        walk(ast);
    }
    return { scanned, violations, exceptions: [...new Set(exceptions)].sort() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const result = inventoryUiIcons();
    console.log(`UI icon inventory: ${result.scanned} files scanned; ${result.violations.length} leftovers.`);
    for (const item of result.exceptions) console.log(`Preserved: ${item}`);
    for (const item of result.violations) console.error(item);
    if (result.violations.length) process.exitCode = 1;
}
