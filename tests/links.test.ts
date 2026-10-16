import { describe, expect, test } from "bun:test";
import { renderLinks, renderPath } from "../src/links";
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

describe("neighbour rendering", () => {
  test("prints zero-count summaries for an isolated note and an empty collection", () => {
    const notes = [note("alone", "")];

    expect(renderLinks(notes, "alone", "out")).toBe("0 outgoing links\n");
    expect(renderLinks(notes, "alone", "in")).toBe("0 backlinks\n");
    expect(renderLinks([], "missing", "out")).toBe("0 outgoing links\n");
    expect(renderLinks([], "missing", "in")).toBe("0 backlinks\n");
  });

  test("prints singular outgoing and backlink summaries with original titles", () => {
    const notes = [note("a", "[[b]]"), note("b", "---\ntitle: Original B\n---\n")];

    expect(renderLinks(notes, "a", "out")).toBe("b  Original B\n1 outgoing link\n");
    expect(renderLinks(notes, "b", "in")).toBe("a  a\n1 backlink\n");
  });

  test("sorts three unique neighbours and two backlinks, ignoring duplicate and invalid links", () => {
    const notes = [
      note(
        "source",
        "[[target-z]] [[target-a]] [[target-a]] [[target-b]] [[source]] [[ghost]] [[shared]]",
      ),
      note("target-a", "---\ntitle: Alpha title\n---\n"),
      note("target-b", "---\ntitle: Beta title\n---\n"),
      note("target-z", "---\ntitle: Zeta title\n---\n"),
      note("incoming-a", "[[target-a]]"),
      note("conflict-one", "---\naliases: [shared]\n---\n"),
      note("conflict-two", "---\naliases: [shared]\n---\n"),
    ];

    expect(renderLinks(notes, "source", "out")).toBe(
      "target-a  Alpha title\ntarget-b  Beta title\ntarget-z  Zeta title\n" + "3 outgoing links\n",
    );
    expect(renderLinks(notes, "target-a", "in")).toBe(
      "incoming-a  incoming-a\nsource  source\n2 backlinks\n",
    );
  });

  test("orders supplementary and BMP ids by Unicode code point", () => {
    const supplementary = "\u{10000}";
    const bmp = "\uE000";
    const notes = [
      note("origin", `[[${supplementary}]] [[${bmp}]]`),
      note(supplementary, "---\ntitle: Supplementary\n---\n"),
      note(bmp, "---\ntitle: BMP\n---\n"),
    ];

    expect(renderLinks(notes, "origin", "out")).toBe(
      "  BMP\n𐀀  Supplementary\n2 outgoing links\n",
    );
  });

  test("reproduces the supplied five-note neighbour outputs", () => {
    const notes = fiveExampleNotes();

    expect(renderLinks(notes, "ideas", "out")).toBe(
      "projects/alpha  Alpha project\n1 outgoing link\n",
    );
    expect(renderLinks(notes, "projects/alpha", "in")).toBe(
      "ideas  Ideas\nprojects/beta  Beta project\n2 backlinks\n",
    );
  });
});

describe("path rendering", () => {
  test("returns exact same-node and direct-path results with hop boundaries", () => {
    const notes = [note("a", "[[b]]"), note("b", "")];

    expect(renderPath(notes, "a", "a")).toEqual({ text: "a\n0 hops\n", code: 0 });
    expect(renderPath(notes, "a", "b")).toEqual({ text: "a -> b\n1 hop\n", code: 0 });
  });

  test("chooses the code-point-first tied shortest path over a longer route and handles cycles", () => {
    const notes = [
      note("a", "[[c]] [[b]] [[q]]"),
      note("b", "[[d]]"),
      note("c", "[[d]]"),
      note("d", "[[t]] [[a]]"),
      note("q", "[[r]]"),
      note("r", "[[s]]"),
      note("s", "[[t]]"),
      note("t", "[[a]]"),
    ];

    expect(renderPath(notes, "a", "t")).toEqual({
      text: "a -> b -> d -> t\n3 hops\n",
      code: 0,
    });
  });

  test("reports reverse-only and isolated routes as no path", () => {
    const notes = [note("a", "[[b]]"), note("b", ""), note("isolated", "")];

    expect(renderPath(notes, "b", "a")).toEqual({
      text: "no path from b to a\n",
      code: 1,
    });
    expect(renderPath(notes, "isolated", "a")).toEqual({
      text: "no path from isolated to a\n",
      code: 1,
    });
  });

  test("reproduces the supplied five-note forward route and reverse no-path result", () => {
    const notes = fiveExampleNotes();

    expect(renderPath(notes, "ideas", "projects/beta")).toEqual({
      text: "ideas -> projects/alpha -> projects/beta\n2 hops\n",
      code: 0,
    });
    expect(renderPath(notes, "projects/beta", "ideas")).toEqual({
      text: "no path from projects/beta to ideas\n",
      code: 1,
    });
  });

  test("leaves notes and nested data unchanged when either renderer runs", () => {
    const notes = [
      note("a", "---\ntitle: Alpha\ntags: [topic]\naliases: [first]\n---\n[[b]] [[b]]"),
      note("b", "---\ntitle: Beta\n---\n[[a]]"),
    ];
    const before = structuredClone(notes);

    renderLinks(notes, "a", "out");
    renderLinks(notes, "a", "in");
    renderPath(notes, "a", "b");
    renderPath(notes, "b", "a");

    expect(notes).toEqual(before);
  });
});
