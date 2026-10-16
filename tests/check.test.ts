import { describe, expect, test } from "bun:test";
import { renderCheck } from "../src/check";
import { parseNote } from "../src/note";
import type { Note } from "../src/types";

const encoder = new TextEncoder();

function note(id: string, text: string): Note {
  return parseNote(id, encoder.encode(text));
}

function fiveExampleNotes(): Note[] {
  return [
    note(
      "ideas",
      "---\ntitle: Ideas\ntags: [inbox]\naliases: [brainstorm]\n---\n" +
        "Rough ideas for the [[projects/alpha|alpha launch]] and a #garden plan.\n" +
        "See [[todo]] and [[missing-note]].",
    ),
    note(
      "projects/alpha",
      "---\ntitle: Alpha project\ntags: [work/active, Plan]\n---\n# Alpha\n" +
        "Plan the launch with [[projects/beta]]. The launch needs a plan and a plan review.\n" +
        "```text\n[[not-a-link]] #nottag\n```",
    ),
    note(
      "projects/beta",
      "# Beta project\nWaiting for the [[alpha]] review. Tags: #work/active #2024",
    ),
    note(
      "daily/todo",
      "---\naliases: [brainstorm]\n---\nWater the plants. Read about the launch plan.",
    ),
    note("work/todo", "# Todo\nCall the vendor about the garden."),
  ];
}

describe("renderCheck", () => {
  test("reproduces the supplied five-note diagnostics exactly", () => {
    expect(renderCheck(fiveExampleNotes())).toEqual({
      text:
        'daily/todo: NS003 alias "brainstorm" is also used by ideas\n' +
        "daily/todo: NS004 note has no links in or out\n" +
        'ideas: NS003 alias "brainstorm" is also used by daily/todo\n' +
        'ideas:7: NS001 broken link "missing-note"\n' +
        'ideas:7: NS002 ambiguous link "todo" (daily/todo or work/todo)\n' +
        "work/todo: NS004 note has no links in or out\n" +
        "6 problems in 3 notes\n",
      code: 1,
    });
  });

  test("reports every broken and ambiguous occurrence with original targets and sorted candidates", () => {
    const notes = [
      note("source", "[[missing]] [[Needle]] [[missing]]\n[[needle]]"),
      note("owner-z", "---\naliases: [Needle]\n---\n"),
      note("owner-a", "---\naliases: [needle]\n---\n"),
    ];

    expect(renderCheck(notes)).toEqual({
      text:
        'owner-a: NS003 alias "needle" is also used by owner-z\n' +
        "owner-a: NS004 note has no links in or out\n" +
        'owner-z: NS003 alias "Needle" is also used by owner-a\n' +
        "owner-z: NS004 note has no links in or out\n" +
        "source: NS004 note has no links in or out\n" +
        'source:1: NS001 broken link "missing"\n' +
        'source:1: NS001 broken link "missing"\n' +
        'source:1: NS002 ambiguous link "Needle" (owner-a or owner-z)\n' +
        'source:2: NS002 ambiguous link "needle" (owner-a or owner-z)\n' +
        "9 problems in 3 notes\n",
      code: 1,
    });
  });

  test("uses resolved exact ids and ignores resolved ordinary and self-links", () => {
    const notes = [
      note("target", "---\naliases: [shared]\n---\n"),
      note("owner-a", "---\naliases: [target, shared]\n---\n"),
      note("owner-b", "---\naliases: [target, shared]\n---\n"),
      note("source", "[[target]] [[source]] [[shared]]"),
    ];

    const result = renderCheck(notes);

    expect(result.text).toContain(
      'source:1: NS002 ambiguous link "shared" (owner-a or owner-b or target)\n',
    );
    expect(result.text).not.toContain('source:1: NS001 broken link "target"');
    expect(result.text).not.toContain('source:1: NS002 ambiguous link "target"');
    expect(result.text).not.toContain('source:1: NS001 broken link "source"');
    expect(result.text).not.toContain('source:1: NS002 ambiguous link "source"');
    expect(result.code).toBe(1);
  });

  test("reports three alias owners with preserved spelling and unique sorted other ids", () => {
    const notes = [
      note("z-owner", "---\naliases: [Garden]\n---\n"),
      note("a-owner", "---\naliases: [garden]\n---\n"),
      note("m-owner", "---\naliases: [GARDEN]\n---\n"),
    ];

    expect(renderCheck(notes).text).toBe(
      'a-owner: NS003 alias "garden" is also used by m-owner, z-owner\n' +
        "a-owner: NS004 note has no links in or out\n" +
        'm-owner: NS003 alias "GARDEN" is also used by a-owner, z-owner\n' +
        "m-owner: NS004 note has no links in or out\n" +
        'z-owner: NS003 alias "Garden" is also used by a-owner, m-owner\n' +
        "z-owner: NS004 note has no links in or out\n" +
        "6 problems in 3 notes\n",
    );
  });

  test("does not call case variants in one note a collision, but reports each preserved spelling across notes", () => {
    const alone = [note("one", "---\naliases: [Brainstorm, brainstorm]\n---\n")];
    expect(renderCheck(alone)).toEqual({
      text: "one: NS004 note has no links in or out\n1 problem in 1 note\n",
      code: 1,
    });

    const shared = [
      note("one", "---\naliases: [Brainstorm, brainstorm]\n---\n"),
      note("two", "---\naliases: [BRAINSTORM, brainstorm]\n---\n"),
    ];
    expect(renderCheck(shared).text).toBe(
      'one: NS003 alias "Brainstorm" is also used by two\n' +
        'one: NS003 alias "brainstorm" is also used by two\n' +
        "one: NS004 note has no links in or out\n" +
        'two: NS003 alias "BRAINSTORM" is also used by one\n' +
        'two: NS003 alias "brainstorm" is also used by one\n' +
        "two: NS004 note has no links in or out\n" +
        "6 problems in 2 notes\n",
    );
  });

  test("folds ASCII only when checking aliases", () => {
    const notes = [
      note("upper", "---\naliases: [Älias]\n---\n"),
      note("lower", "---\naliases: [älias]\n---\n"),
    ];

    expect(renderCheck(notes).text).toBe(
      "lower: NS004 note has no links in or out\n" +
        "upper: NS004 note has no links in or out\n" +
        "2 problems in 2 notes\n",
    );
  });

  test("marks isolated, self-only, and unresolved-only notes as orphans", () => {
    const notes = [
      note("isolated", ""),
      note("self", "[[self]]"),
      note("unresolved", "[[missing]]"),
    ];

    expect(renderCheck(notes)).toEqual({
      text:
        "isolated: NS004 note has no links in or out\n" +
        "self: NS004 note has no links in or out\n" +
        "unresolved: NS004 note has no links in or out\n" +
        'unresolved:1: NS001 broken link "missing"\n' +
        "4 problems in 3 notes\n",
      code: 1,
    });
  });

  test("does not mark inbound-only or outbound-only notes as orphans", () => {
    const notes = [note("outbound", "[[inbound]]"), note("inbound", "")];

    expect(renderCheck(notes)).toEqual({
      text: "ok, 2 notes\n",
      code: 0,
    });
  });

  test("sorts ids, numeric lines, codes, note-level records, and stable ties", () => {
    const notes = [
      note("z", "[[missing-z]]"),
      note(
        "a",
        "---\naliases: [Second, First, Ambiguous]\n---\n" +
          "[[broken-z]] [[Ambiguous]] [[broken-a]]\n" +
          "[[ambiguous]]\n" +
          "[[broken-late]]\n" +
          "[[broken-early]]",
      ),
      note("b-owner", "---\naliases: [Ambiguous, Second, First]\n---\n"),
      note("a-owner", "---\naliases: [Ambiguous, Second, First]\n---\n"),
      note("b", ""),
    ];

    expect(renderCheck(notes).text).toBe(
      'a: NS003 alias "Second" is also used by a-owner, b-owner\n' +
        'a: NS003 alias "First" is also used by a-owner, b-owner\n' +
        'a: NS003 alias "Ambiguous" is also used by a-owner, b-owner\n' +
        "a: NS004 note has no links in or out\n" +
        'a:4: NS001 broken link "broken-z"\n' +
        'a:4: NS001 broken link "broken-a"\n' +
        'a:4: NS002 ambiguous link "Ambiguous" (a or a-owner or b-owner)\n' +
        'a:5: NS002 ambiguous link "ambiguous" (a or a-owner or b-owner)\n' +
        'a:6: NS001 broken link "broken-late"\n' +
        'a:7: NS001 broken link "broken-early"\n' +
        'a-owner: NS003 alias "Ambiguous" is also used by a, b-owner\n' +
        'a-owner: NS003 alias "Second" is also used by a, b-owner\n' +
        'a-owner: NS003 alias "First" is also used by a, b-owner\n' +
        "a-owner: NS004 note has no links in or out\n" +
        "b: NS004 note has no links in or out\n" +
        'b-owner: NS003 alias "Ambiguous" is also used by a, a-owner\n' +
        'b-owner: NS003 alias "Second" is also used by a, a-owner\n' +
        'b-owner: NS003 alias "First" is also used by a, a-owner\n' +
        "b-owner: NS004 note has no links in or out\n" +
        "z: NS004 note has no links in or out\n" +
        'z:1: NS001 broken link "missing-z"\n' +
        "21 problems in 5 notes\n",
    );
  });

  test("uses Unicode code-point order for diagnostics, ambiguous candidates, and alias owners", () => {
    const notes = [
      note("source", "[[shared]]"),
      note("z-owner", "---\naliases: [Shared]\n---\n"),
      note("\u{10000}", "---\naliases: [shared]\n---\n"),
      note("\uE000", "---\naliases: [SHARED]\n---\n"),
      note("\uF000", "---\naliases: [sHaReD]\n---\n"),
    ];

    expect(renderCheck(notes).text).toBe(
      "source: NS004 note has no links in or out\n" +
        'source:1: NS002 ambiguous link "shared" (z-owner or  or  or 𐀀)\n' +
        'z-owner: NS003 alias "Shared" is also used by , , 𐀀\n' +
        "z-owner: NS004 note has no links in or out\n" +
        ': NS003 alias "SHARED" is also used by z-owner, , 𐀀\n' +
        ": NS004 note has no links in or out\n" +
        ': NS003 alias "sHaReD" is also used by z-owner, , 𐀀\n' +
        ": NS004 note has no links in or out\n" +
        '𐀀: NS003 alias "shared" is also used by z-owner, , \n' +
        "𐀀: NS004 note has no links in or out\n" +
        "10 problems in 5 notes\n",
    );
  });

  test("returns clean results for empty and connected valid graphs", () => {
    expect(renderCheck([])).toEqual({ text: "ok, 0 notes\n", code: 0 });
    expect(renderCheck([note("a", "[[b]]"), note("b", "")])).toEqual({
      text: "ok, 2 notes\n",
      code: 0,
    });
  });

  test("uses singular summaries and counts multiple problems for one note once", () => {
    expect(renderCheck([note("a", "")])).toEqual({
      text: "a: NS004 note has no links in or out\n1 problem in 1 note\n",
      code: 1,
    });

    expect(renderCheck([note("a", "[[missing]] [[other]]")])).toEqual({
      text:
        "a: NS004 note has no links in or out\n" +
        'a:1: NS001 broken link "missing"\n' +
        'a:1: NS001 broken link "other"\n' +
        "3 problems in 1 note\n",
      code: 1,
    });
  });

  test("preserves input notes and nested arrays and is deterministic across calls", () => {
    const notes = [
      note("a", "---\ntags: [one]\naliases: [Shared]\n---\n[[missing]]"),
      note("b", "---\naliases: [shared]\n---\n"),
    ];
    const original = structuredClone(notes);

    const first = renderCheck(notes);
    const second = renderCheck(notes);

    expect(notes).toEqual(original);
    expect(first).toEqual(second);
  });

  test("always uses LF and terminates output with LF", () => {
    const result = renderCheck([note("a", "")]);

    expect(result.text.endsWith("\n")).toBe(true);
    expect(result.text.includes("\r")).toBe(false);
  });
});
