/**
 * Colour and CSS-token helpers shared by the design-token generator, its
 * validator and its contract test.
 *
 * Before this module existed the `#rgb` / `#rrggbb` / `rgba()` parsing and the
 * CSS custom-property walk were written out three times, which is precisely the
 * class of duplication the token pipeline exists to remove. Node built-ins only.
 */

/** A colour split into its channels, so any platform literal can render it. */
export function decomposeColour(value) {
  const hex = String(value).trim();
  const short = /^#([0-9a-f]{3})$/i.exec(hex);
  if (short) {
    const [r, g, b] = short[1].split("").map(c => c + c);
    return { alpha: 255, r: parseInt(r, 16), g: parseInt(g, 16), b: parseInt(b, 16) };
  }
  const full = /^#([0-9a-f]{6})$/i.exec(hex);
  if (full) {
    return {
      alpha: 255,
      r: parseInt(full[1].slice(0, 2), 16),
      g: parseInt(full[1].slice(2, 4), 16),
      b: parseInt(full[1].slice(4, 6), 16),
    };
  }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+)\s*)?\)$/i.exec(hex);
  if (rgba) {
    return {
      alpha: Math.round(Number(rgba[4] ?? 1) * 255),
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
    };
  }
  throw new Error(`unsupported colour value: ${value}`);
}

const hex2 = n => n.toString(16).padStart(2, "0").toUpperCase();

/** Android/Compose ARGB literal, e.g. `0xFF2383E2`. */
export function toArgb(value) {
  const { alpha, r, g, b } = decomposeColour(value);
  return `0x${hex2(alpha)}${hex2(r)}${hex2(g)}${hex2(b)}`;
}

/** SwiftUI sRGB initialiser at full precision. */
export function toSwiftColor(value) {
  const { alpha, r, g, b } = decomposeColour(value);
  const channel = n => (n / 255).toFixed(3);
  return `Color(.sRGB, red: ${channel(r)}, green: ${channel(g)}, blue: ${channel(b)}, opacity: ${(alpha / 255).toFixed(3)})`;
}

/** CSS kebab token name to a camelCase platform identifier. */
export const camel = name => name.replace(/^--/, "").replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

export const isColourValue = value => /^(#[0-9a-f]{3,8}|rgba?\(|color-mix\()/i.test(String(value));

/**
 * Walks every top-level block that declares CSS custom properties.
 * Returns `{ selector, vars }` in source order.
 */
export function parseCustomPropertyBlocks(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /([^{}]+)\{([^{}]*)\}/g;
  const blocks = [];
  let match;
  while ((match = re.exec(clean)) !== null) {
    const vars = {};
    for (const declaration of match[2].split(";")) {
      const pair = declaration.trim().match(/^(--[a-z0-9-]+)\s*:\s*(.+)$/);
      if (pair) vars[pair[1]] = pair[2].trim();
    }
    if (Object.keys(vars).length > 0) {
      blocks.push({ selector: match[1].trim().replace(/\s+/g, " "), vars });
    }
  }
  return blocks;
}

/** The custom properties declared for a given theme selector, or null. */
export function themeVars(css, theme) {
  const blocks = parseCustomPropertyBlocks(css);
  const block = blocks.find(b => new RegExp(`data-theme=["']?${theme}["']?`).test(b.selector));
  return block ? block.vars : null;
}

/**
 * True when a file contains an ARGB literal for the colour.
 * Alpha is compared with a 1/255 tolerance: a stylesheet keeps alpha as a
 * fraction (0.81) while a platform literal must pick an integer, and rounding
 * differs from truncation by at most one step.
 */
export function containsArgbFor(uppercasedFile, value) {
  const { alpha, r, g, b } = decomposeColour(value);
  const rgb = `${hex2(r)}${hex2(g)}${hex2(b)}`;
  for (let a = alpha - 1; a <= alpha + 1; a += 1) {
    if (a < 0 || a > 255) continue;
    if (uppercasedFile.includes(`0X${hex2(a)}${rgb}`)) return true;
  }
  return false;
}
