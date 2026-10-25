/// <reference types="node" />
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { CATEGORIES, CONTENT_TYPES, DIFFICULTIES, ROLES } from "@shared/constants";
import { checkPassword } from "@shared/validation";
import { createInstance } from "i18next";
import { en } from "../src/i18n/en";
import { hi } from "../src/i18n/hi";
import { ALL_ERROR_CODES } from "../src/lib/errors";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[full] = value;
    else Object.assign(out, flatten(value, full));
  }
  return out;
}

const flatEn = flatten(en as unknown as Tree);
const flatHi = flatten(hi as unknown as Tree);
const placeholders = (text: string) => [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]!).sort();

describe("English and Hindi say the same things", () => {
  it("define exactly the same keys", () => {
    const onlyEn = Object.keys(flatEn).filter((k) => !(k in flatHi));
    const onlyHi = Object.keys(flatHi).filter((k) => !(k in flatEn));
    assert.deepEqual({ onlyEn, onlyHi }, { onlyEn: [], onlyHi: [] });
  });

  it("use the same {{placeholders}} in every sentence", () => {
    const mismatched = Object.keys(flatEn)
      .filter((key) => JSON.stringify(placeholders(flatEn[key]!)) !== JSON.stringify(placeholders(flatHi[key] ?? "")))
      .map((key) => `${key}: en ${JSON.stringify(placeholders(flatEn[key]!))} / hi ${JSON.stringify(placeholders(flatHi[key] ?? ""))}`);
    assert.deepEqual(mismatched, []);
  });

  it("have no empty text, and Hindi is actually Hindi (Devanagari) except for the app's name", () => {
    const empty = [...Object.entries(flatEn), ...Object.entries(flatHi)].filter(([, v]) => v.trim() === "").map(([k]) => k);
    assert.deepEqual(empty, []);
    const notHindi = Object.entries(flatHi)
      .filter(([key, value]) => key !== "common.appName" && !/[ऀ-ॿ]/.test(value))
      .map(([key]) => key);
    assert.deepEqual(notHindi, [], "Hindi text without a single Devanagari letter (left in English by mistake?)");
    const copied = Object.keys(flatEn).filter((key) => key !== "common.appName" && flatEn[key] === flatHi[key]);
    assert.deepEqual(copied, []);
  });

  it("give every plural both forms, in both languages", () => {
    for (const [name, flat] of [["en", flatEn], ["hi", flatHi]] as const) {
      for (const key of Object.keys(flat)) {
        if (key.endsWith("_one")) assert.ok(`${key.slice(0, -4)}_other` in flat, `${name}: ${key} has no _other`);
        if (key.endsWith("_other")) assert.ok(`${key.slice(0, -6)}_one` in flat, `${name}: ${key} has no _one`);
      }
    }
  });
});

describe("every text the code asks for exists", () => {
  const root = path.resolve(process.cwd(), "client/src");
  const files: string[] = [];
  (function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "i18n") walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
    }
  })(root);
  const sources = files.map((file) => ({ file: path.relative(root, file), text: fs.readFileSync(file, "utf8") }));

  const staticKeys = new Set<string>();
  const dynamicKeys = new Set<string>();
  const pluralBases = new Set<string>();
  const literalKeys = new Set<string>();
  const tCall = /\bt\(\s*(["'`])((?:\\.|(?!\1).)*?)\1/g;
  const countCall = /countText\(\s*t\s*,\s*(["'`])([^"'`]+)\1/g;
  const families = "common|wait|tabs|nav|categories|difficulty|contentType|auth|learn|search|course|module|lesson|quiz|tasks|profile|config|unreachable|boundary|validation|errors";
  const literal = new RegExp(`["'\`]((?:${families})\\.[A-Za-z0-9_.]+)["'\`]`, "g");
  for (const { text } of sources) {
    for (const m of text.matchAll(tCall)) (m[2]!.includes("${") ? dynamicKeys : staticKeys).add(m[2]!);
    for (const m of text.matchAll(countCall)) pluralBases.add(m[2]!);
    for (const m of text.matchAll(literal)) literalKeys.add(m[1]!);
  }

  it("finds the screens' text calls (guards the scan itself)", () => {
    assert.ok(staticKeys.size > 150, `only ${staticKeys.size} static keys found`);
    assert.ok(pluralBases.size >= 5);
  });

  it("has a text for every key used in the code, in both languages", () => {
    const missing: string[] = [];
    for (const key of [...staticKeys, ...literalKeys]) {
      if (!(key in flatEn) && !(`${key}_one` in flatEn)) missing.push(`en ${key}`);
      if (!(key in flatHi) && !(`${key}_one` in flatHi)) missing.push(`hi ${key}`);
    }
    for (const base of pluralBases) {
      for (const suffix of ["_one", "_other"]) {
        if (!(base + suffix in flatEn)) missing.push(`en ${base}${suffix}`);
        if (!(base + suffix in flatHi)) missing.push(`hi ${base}${suffix}`);
      }
    }
    assert.deepEqual(missing, []);
  });

  it("only builds keys dynamically from families this test knows how to check", () => {
    const known = ["difficulty.${", "categories.${", "errors.${", "contentType.${", "profile.role.${", "config.problem.${", "${key}_${"];
    const unknown = [...dynamicKeys].filter((key) => !known.some((prefix) => key.startsWith(prefix)));
    assert.deepEqual(unknown, [], "extend the dynamic-family checks below for these");
  });

  it("covers every value the dynamic families can take", () => {
    const missing: string[] = [];
    const families: [string, readonly string[]][] = [
      ["categories", CATEGORIES],
      ["difficulty", DIFFICULTIES],
      ["contentType", CONTENT_TYPES],
      ["profile.role", ROLES],
      ["errors", ALL_ERROR_CODES],
      ["config.problem", ["missing", "insecure", "placeholder", "invalid"]],
    ];
    for (const [family, values] of families) {
      for (const value of values) {
        if (!(`${family}.${value}` in flatEn)) missing.push(`en ${family}.${value}`);
        if (!(`${family}.${value}` in flatHi)) missing.push(`hi ${family}.${value}`);
      }
    }
    // and nothing extra in them: a translated code that no longer exists is dead text
    for (const [family, values] of families) {
      for (const key of Object.keys(flatEn)) {
        if (key.startsWith(`${family}.`) && key.split(".").length === family.split(".").length + 1 && !values.includes(key.slice(family.length + 1))) missing.push(`unused ${key}`);
      }
    }
    assert.deepEqual(missing, []);
  });

  it("covers every reason a password can be refused (the register and password forms show them)", () => {
    const reasons = new Set<string>();
    for (const [password, context] of [
      ["short", {}],
      ["x".repeat(200), {}],
      ["password", {}],
      ["12345678", {}],
      ["alice1234", { username: "alice1234" }],
      ["tooshortstaff", { staff: true }],
    ] as const) {
      const problem = checkPassword(password, context);
      if (problem) reasons.add(problem);
    }
    assert.ok(reasons.size >= 3, "the sample passwords no longer trigger the refusal reasons");
    for (const reason of reasons) assert.ok(`errors.${reason}` in flatEn && `errors.${reason}` in flatHi, `errors.${reason}`);
  });

  it("has no text that nothing uses", () => {
    const used = new Set<string>([...staticKeys, ...literalKeys]);
    for (const base of pluralBases) {
      used.add(`${base}_one`);
      used.add(`${base}_other`);
    }
    const dynamicPrefixes = ["categories.", "difficulty.", "contentType.", "errors.", "profile.role.", "config.problem."];
    const unused = Object.keys(flatEn).filter((key) => !used.has(key) && !dynamicPrefixes.some((prefix) => key.startsWith(prefix)));
    assert.deepEqual(unused, []);
  });
});

describe("the sentences read well once filled in", () => {
  const sample: Record<string, string> = {
    n: "5",
    wait: "5 minutes",
    percent: "40",
    name: "Priya",
    query: "helmet",
    done: "2",
    total: "6",
    score: "70",
    current: "3",
    correct: "4",
    date: "12 Oct 2026",
    number: "FS-2026-0001",
    course: "Safety Basics",
    url: "https://example.org/verify/1",
    phone: "1800 000 000",
    email: "help@example.org",
    version: "3.0.0",
  };

  for (const lang of ["en", "hi"] as const) {
    it(`${lang}: every key resolves, leaves no {{placeholder}} behind and never falls back to the raw key`, async () => {
      const instance = createInstance();
      await instance.init({ resources: { en: { translation: en }, hi: { translation: hi } }, lng: lang, fallbackLng: "en", interpolation: { escapeValue: false }, initAsync: false });
      const bad: string[] = [];
      for (const key of Object.keys(flatEn)) {
        const options: Record<string, string> = {};
        for (const name of placeholders(flatEn[key]!)) {
          assert.ok(name in sample, `add a sample value for {{${name}}} (${key})`);
          options[name] = sample[name]!;
        }
        const text = instance.t(key, options);
        if (text === key || text.includes("{{") || text.includes("}}") || text.trim() === "") bad.push(`${key} → ${JSON.stringify(text)}`);
      }
      assert.deepEqual(bad, []);
    });
  }

  it("does not escape what the learner typed (names with & or ' stay readable)", async () => {
    const instance = createInstance();
    await instance.init({ resources: { en: { translation: en } }, lng: "en", interpolation: { escapeValue: false }, initAsync: false });
    assert.equal(instance.t("learn.hello", { name: "D'Souza & Sons" }), "Hello, D'Souza & Sons");
  });
});
