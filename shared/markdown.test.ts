import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inlineText, parseInline, parseMarkdown } from "./markdown";

describe("inline formatting", () => {
  it("handles bold, italic, code and nesting", () => {
    assert.deepEqual(parseInline("a **b _c_** `d`"), [
      { type: "text", text: "a " },
      { type: "bold", children: [{ type: "text", text: "b " }, { type: "italic", children: [{ type: "text", text: "c" }] }] },
      { type: "text", text: " " },
      { type: "code", text: "d" },
    ]);
  });

  it("leaves snake_case, stray asterisks and unmatched marks alone", () => {
    assert.equal(inlineText(parseInline("use safety_helmet_2 and 3 * 4 = 12")), "use safety_helmet_2 and 3 * 4 = 12");
    assert.equal(inlineText(parseInline("**not closed")), "**not closed");
  });

  it("works with Devanagari text", () => {
    const nodes = parseInline("**हेलमेट** पहनें और _सुरक्षा_ जाँचें");
    assert.equal(nodes[0].type, "bold");
    assert.equal(inlineText(nodes), "हेलमेट पहनें और सुरक्षा जाँचें");
  });

  it("keeps links to safe schemes and drops the rest down to their words", () => {
    assert.deepEqual(parseInline("[site](https://example.com/a?b=1)"), [{ type: "link", href: "https://example.com/a?b=1", children: [{ type: "text", text: "site" }] }]);
    assert.deepEqual(parseInline("[call](tel:+911234567890)")[0], { type: "link", href: "tel:+911234567890", children: [{ type: "text", text: "call" }] });
    for (const bad of ["javascript:alert(1)", "data:text/html;base64,AAAA", "file:///etc/passwd", "//evil.example.com", "vbscript:x"]) {
      const nodes = parseInline(`[click](${bad})`);
      assert.deepEqual(nodes, [{ type: "text", text: "click" }], bad);
    }
  });

  it("does not turn HTML into anything but text", () => {
    const nodes = parseInline('<img src=x onerror=alert(1)> <script>alert(1)</script>');
    assert.deepEqual(nodes, [{ type: "text", text: '<img src=x onerror=alert(1)> <script>alert(1)</script>' }]);
  });

  it("supports backslash escapes", () => {
    assert.equal(inlineText(parseInline("\\*not italic\\* and \\_x\\_")), "*not italic* and _x_");
  });

  it("stays fast on hostile input", () => {
    const started = Date.now();
    parseInline("*".repeat(20_000));
    parseInline("[".repeat(20_000));
    parseInline("**a".repeat(5_000));
    parseInline("_a ".repeat(5_000));
    assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`);
  });
});

describe("blocks", () => {
  it("reads headings, paragraphs, lists, quotes and rules", () => {
    const blocks = parseMarkdown(["# Title", "", "First line", "second line", "", "- one", "- two", "  continued", "", "1. a", "2. b", "", "> mind the gap", "", "---", "", "### Small"].join("\n"));
    assert.deepEqual(
      blocks.map((b) => b.type),
      ["heading", "paragraph", "list", "list", "quote", "rule", "heading"]
    );
    const [h, p, ul, ol, q, , h3] = blocks;
    assert.equal(h.type === "heading" && h.level, 1);
    assert.equal(p.type === "paragraph" && inlineText(p.children), "First line second line");
    assert.equal(ul.type === "list" && ul.ordered, false);
    assert.equal(ul.type === "list" && inlineText(ul.items[1]), "two continued");
    assert.equal(ol.type === "list" && ol.ordered, true);
    assert.equal(q.type === "quote" && inlineText(q.children), "mind the gap");
    assert.equal(h3.type === "heading" && h3.level, 3);
  });

  it("accepts Windows line endings and bullets typed as •", () => {
    const blocks = parseMarkdown("• one\r\n• two\r\n");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type === "list" && blocks[0].items.length, 2);
  });

  it("returns nothing for blank input and never throws", () => {
    assert.deepEqual(parseMarkdown(""), []);
    assert.deepEqual(parseMarkdown("\n\n  \n"), []);
    for (const nasty of ["#", "# ", "-", "> ", "1.", "***", "- - -", "\u0000", "a b"]) assert.doesNotThrow(() => parseMarkdown(nasty), nasty);
  });
});
