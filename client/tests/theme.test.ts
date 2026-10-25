/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CATEGORY_COLOR, CATEGORY_ICON, Colors, MAX_FONT_SCALE, MIN_TOUCH, Typography } from "../src/constants/theme";
import { CATEGORIES } from "@shared/constants";

/** WCAG 2.x relative luminance and contrast ratio. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("contrast helper", () => {
  it("matches the published reference values", () => {
    assert.equal(contrast("#000000", "#FFFFFF").toFixed(2), "21.00");
    assert.equal(contrast("#777777", "#FFFFFF").toFixed(2), "4.48");
    assert.equal(contrast("#FF6B2C", "#FFFFFF").toFixed(2), "2.84"); // the old button: white text on the brand orange
  });
});

for (const mode of ["light", "dark"] as const) {
  const c = Colors[mode];
  describe(`${mode} colours`, () => {
    it("text is readable on every surface it is drawn on (WCAG AA, 4.5:1)", () => {
      const pairs: [string, string, string][] = [
        ["text on background", c.text, c.background],
        ["text on surface", c.text, c.surface],
        ["text on inputs and chips", c.text, c.surfaceAlt],
        ["secondary text on background", c.textSecondary, c.background],
        ["secondary text on surface", c.textSecondary, c.surface],
        ["secondary text / placeholder on inputs", c.textSecondary, c.surfaceAlt],
        ["button label on the primary button", c.onPrimary, c.primary],
        ["orange link text on background", c.primaryText, c.background],
        ["orange link text on surface", c.primaryText, c.surface],
        ["orange text on its tint", c.primaryText, c.primaryTint],
        ["success text on surface", c.success, c.surface],
        ["success text on its banner", c.success, c.successTint],
        ["error text on background", c.error, c.background],
        ["error text on surface", c.error, c.surface],
        ["error text on its banner", c.error, c.errorTint],
        ["warning text on its banner", c.warning, c.warningTint],
        ["warning text on surface", c.warning, c.surface],
      ];
      const failing = pairs.map(([name, fg, bg]) => ({ name, ratio: contrast(fg, bg) })).filter((p) => p.ratio < 4.5).map((p) => `${p.name}: ${p.ratio.toFixed(2)}`);
      assert.deepEqual(failing, []);
    });

    it("the outline of a control can be seen (WCAG non-text contrast, 3:1)", () => {
      const pairs: [string, string, string][] = [
        ["control outline on background", c.controlBorder, c.background],
        ["control outline on surface", c.controlBorder, c.surface],
        ["control outline on input fill", c.controlBorder, c.surfaceAlt],
        ["primary button on background", c.primary, c.background],
        ["primary button on surface", c.primary, c.surface],
        ["progress fill on its track", c.primaryText, c.border],
        ["error outline on background", c.error, c.background],
      ];
      const failing = pairs.map(([name, fg, bg]) => ({ name, ratio: contrast(fg, bg) })).filter((p) => p.ratio < 3).map((p) => `${p.name}: ${p.ratio.toFixed(2)}`);
      assert.deepEqual(failing, []);
    });
  });
}

describe("sizes", () => {
  it("keep text and touch targets worker-friendly", () => {
    for (const [name, style] of Object.entries(Typography)) assert.ok(style.fontSize >= 13, `${name} is smaller than 13`);
    assert.ok(Typography.body.fontSize >= 16);
    assert.ok(MIN_TOUCH >= 48);
    assert.ok(MAX_FONT_SCALE >= 1.3 && MAX_FONT_SCALE <= 2);
  });

  it("give every course category a colour and an icon", () => {
    for (const category of CATEGORIES) {
      assert.match(CATEGORY_COLOR[category] ?? "", /^#[0-9A-F]{6}$/i, category);
      assert.ok(CATEGORY_ICON[category], category);
    }
  });
});
