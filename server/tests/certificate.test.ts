import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateCertificateNumber, parseCertificateNumber, renderCertificatePdf, splitRuns, type GlyphTable } from "../services/certificate";

describe("certificate numbers", () => {
  it("are 12 unambiguous characters in three groups and do not repeat", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const n = generateCertificateNumber();
      assert.match(n, /^FSWA-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}$/);
      seen.add(n);
    }
    assert.equal(seen.size, 500);
  });

  it("are parsed leniently (case, spaces) and the legacy shape still verifies", () => {
    assert.equal(parseCertificateNumber(" fswa-abcd-efgh-jkmn "), "FSWA-ABCD-EFGH-JKMN");
    assert.equal(parseCertificateNumber("FSWA-LZ3K9-1A2B3C"), "FSWA-LZ3K9-1A2B3C");
    for (const bad of ["", "ABCD-EFGH", "FSWA", "FSWA-<script>", "FSWA-ABCD-EFGH-JKMN-PQRS-TUVW", "'; DROP TABLE certificates;--"]) {
      assert.equal(parseCertificateNumber(bad), null, bad);
    }
  });
});

describe("certificate text runs", () => {
  // Noto Sans has Latin + punctuation; Noto Sans Devanagari has the Devanagari block (+ the rupee sign) only.
  const glyphs: GlyphTable = {
    has: (script, cp) =>
      script === "sans" ? (cp >= 0x20 && cp <= 0x24f) || (cp >= 0x2010 && cp <= 0x2027) : (cp >= 0x900 && cp <= 0x97f) || cp === 0x20b9 || cp === 0x20,
  };

  it("draws Latin letters, digits and brackets inside Hindi text with the Latin font", () => {
    assert.deepEqual(splitRuns("सुरक्षा (PPE)", false, glyphs), [
      { text: "सुरक्षा", font: "deva" },
      { text: " (PPE)", font: "sans" },
    ]);
  });

  it("keeps a Hindi word with its conjunct joiners in one run", () => {
    const runs = splitRuns("क्‍ष स्तर 2", true, glyphs);
    assert.equal(runs[0].font, "devaBold");
    assert.ok(runs[0].text.startsWith("क्‍ष"));
    assert.equal(runs[runs.length - 1].text.trim().endsWith("2"), true);
  });

  it("replaces characters no font can draw instead of printing empty boxes", () => {
    assert.equal(splitRuns("Safety 🦺 தமிழ்", false, glyphs, "?").map((r) => r.text).join(""), "Safety ? ?????");
    assert.equal(splitRuns("Safety 🦺", false, glyphs).map((r) => r.text).join(""), "Safety ");
  });

  it("takes the rupee sign from the font that has it", () => {
    assert.deepEqual(splitRuns("₹500", false, glyphs), [
      { text: "₹", font: "deva" },
      { text: "500", font: "sans" },
    ]);
  });
});

describe("certificate PDF", () => {
  const base = { certificateNumber: "FSWA-TEST-AAAA-BBBB", earnedAt: new Date("2026-10-18T05:00:00Z"), fallbackOrigin: "https://api.example.com" };

  it("renders a one-page A4 landscape PDF with embedded Noto fonts", async () => {
    const pdf = await renderCertificatePdf({ ...base, holderName: "Asha Kumari", courseTitle: "Construction Site Safety" });
    const text = pdf.toString("latin1");
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.match(text, /\/MediaBox \[0 0 841\.89 595\.28\]/);
    assert.match(text, /NotoSans-Bold/);
    assert.equal((text.match(/\/Type \/Page\b/g) ?? []).length, 1);
  });

  it("embeds the Devanagari font when the name or title is Hindi", async () => {
    const pdf = await renderCertificatePdf({ ...base, holderName: "रमेश कुमार", courseTitle: "Construction Site Safety (Sample)", courseTitleHi: "निर्माण स्थल सुरक्षा (नमूना) — PPE स्तर 2" });
    assert.match(pdf.toString("latin1"), /NotoSansDevanagari/);
  });

  it("copes with unprintable characters and very long titles", async () => {
    const title = "Advanced Scaffolding Erection, Inspection and Dismantling ".repeat(3).trim();
    const pdf = await renderCertificatePdf({ ...base, holderName: "Anil 🦺 Kumar", courseTitle: title, courseTitleHi: "ऊँची इमारतों के लिए मचान ".repeat(6) });
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.ok(pdf.length > 5_000);
  });

  it("encodes the public verification URL (QR + printed link)", async () => {
    const pdf = await renderCertificatePdf({ ...base, holderName: "Asha", courseTitle: "Safety" });
    assert.match(pdf.toString("latin1"), /https:\/\/api\.example\.com\/verify\/FSWA-TEST-AAAA-BBBB/);
  });
});
