// The look of the menus and HUD: the browser build's style sheet, rewritten
// class-based in tools/ui-style.css and converted once with `starhermit css`
// into assets/ui-style.json (`npm run css`), registered at start with the
// theme the runtime's own widgets (checkboxes, selects, scroll bars) fall
// back to. The browser build's body attributes that swapped the palette are
// token sets here: the four colour-vision palettes (the game's setting) and
// high contrast (the runtime's accessibility option).
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";

type Tokens = Record<string, string | number>;
let base: Tokens = {};

const PALETTES: Record<string, Tokens> = {
  deuteranopia: { accent: "#e0a13a", good: "#3a9ee0", bad: "#e04a7a" },
  protanopia: { accent: "#d9b23a", good: "#3aa8e0", bad: "#8a7ae0" },
  tritanopia: { accent: "#e06a4a", good: "#3ad0a0", bad: "#e04a4a" },
  mono: { accent: "#e8e8e8", "accent-2": "#b8b8b8", good: "#d0d0d0", bad: "#707070" },
};
const HIGH_CONTRAST: Tokens = { bg: "#000000", panel: "#0a0a0a", "panel-2": "#141414", ink: "#ffffff", "ink-dim": "#e0e0e0", hover: "#2a2a2a" };

export function initStyles(): void {
  const css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  base = { ...(css.tokens as Tokens) };
  ui.setTheme({
    fontSize: 16, smallSize: 13.6, headingSize: 24, padding: 8, spacing: 8, radius: 12,
    text: "#f4e8d8", muted: "#c9b49a", panel: "#221409", control: "#2e1c0e", hovered: "#3d2812",
    pressed: "#3d2812", field: "#2e1c0e", accent: "#ff8c3a", focus: "#6ab8ff", outline: "#00000088",
  });
  ui.setTokens(css.tokens);
  ui.setAnimations(css.animations);
  ui.setStyles({
    ...css.styles,
    label: { text: { color: "$ink" } },
    paragraph: { text: { color: "$ink" } },
    checkbox: {
      text: { color: "$ink" }, minHeight: 36,
      parts: { box: { background: "$panel-2", border: { width: 1, color: "$ink-dim" }, radius: 4 }, mark: { background: "$accent" } },
    },
    select: { text: { color: "$ink" }, background: "$panel-2", border: { width: 1, color: "#00000066" }, radius: 6, minHeight: 36 },
    scrollArea: { parts: { bar: { background: "$ink-dim", radius: 4 } } },
  });
}

let paletteKey = "";
/** The palette tokens: high contrast over the colour-vision palette over the sheet's. */
export function applyPalette(palette: string, highContrast: boolean): void {
  const key = `${palette}:${highContrast}`;
  if (key === paletteKey) return;
  paletteKey = key;
  const tokens: Tokens = { ...base, ...(PALETTES[palette] ?? {}) };
  if (highContrast) Object.assign(tokens, HIGH_CONTRAST);
  ui.setTokens(tokens);
}
