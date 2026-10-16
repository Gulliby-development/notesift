import { describe, expect, test } from "bun:test";
import { parseNote } from "../src/note";
import { renderStats } from "../src/stats";
import type { Link, Note } from "../src/types";

const encoder = new TextEncoder();

function statNote(
  id: string,
  words: number,
  tags: string[] = [],
  links: Link[] = [],
  aliases: string[] = [],
): Note {
  return { id, hash: "", words, title: id, tags, aliases, links, terms: [] };
}

function link(target: string): Link {
  return { line: 1, target };
}

function expectPureReport(notes: Note[], expected: string): void {
  const original = structuredClone(notes);
  const first = renderStats(notes);
  const second = renderStats(notes);

  expect(first).toBe(expected);
  expect(second).toBe(first);
  expect(notes).toEqual(original);
}

describe("renderStats", () => {
  test("renders the exact report for an empty folder", () => {
    expectPureReport(
      [],
      "notes: 0\nwords: 0\ntags: 0\nlinks: 0\nbroken links: 0\nambiguous links: 0\norphans: 0\ncomponents: 0\n",
    );
  });

  test("counts distinct tags, words, isolated notes, and components", () => {
    const notes = [statNote("a", 1, ["x"]), statNote("b", 2, ["x", "y"]), statNote("c", 3)];

    expectPureReport(
      notes,
      "notes: 3\nwords: 6\ntags: 2\nlinks: 0\nbroken links: 0\nambiguous links: 0\norphans: 3\ncomponents: 3\n",
    );
  });

  test("counts unique directed edges but every broken and ambiguous occurrence", () => {
    const notes = [
      statNote(
        "a",
        1,
        ["x"],
        [
          link("b"),
          link("b"),
          link("a"),
          link("missing"),
          link("missing"),
          link("shared"),
          link("shared"),
        ],
      ),
      statNote("b", 2, ["x", "y"], [link("a")]),
      statNote("c", 3, [], [link("b")]),
      statNote("d", 4, [], [], ["shared"]),
      statNote("e", 5, [], [], ["shared"]),
    ];

    expectPureReport(
      notes,
      "notes: 5\nwords: 15\ntags: 2\nlinks: 3\nbroken links: 2\nambiguous links: 2\norphans: 2\ncomponents: 3\n",
    );
  });

  test("self-links and broken links do not stop an otherwise isolated note being an orphan", () => {
    const notes = [statNote("solo", 0, [], [link("solo"), link("missing")])];

    expectPureReport(
      notes,
      "notes: 1\nwords: 0\ntags: 0\nlinks: 0\nbroken links: 1\nambiguous links: 0\norphans: 1\ncomponents: 1\n",
    );
  });

  test("does not count the endpoints of a one-way edge as orphans", () => {
    const notes = [statNote("source", 1, [], [link("target")]), statNote("target", 1)];

    expectPureReport(
      notes,
      "notes: 2\nwords: 2\ntags: 0\nlinks: 1\nbroken links: 0\nambiguous links: 0\norphans: 0\ncomponents: 1\n",
    );
  });

  test("matches the report for the five Markdown notes from the request", () => {
    const notes = [
      parseNote(
        "ideas",
        encoder.encode(
          "---\ntitle: Ideas\ntags: [inbox]\naliases: [brainstorm]\n---\n" +
            "Rough ideas for the [[projects/alpha|alpha launch]] and a #garden plan.\n" +
            "See [[todo]] and [[missing-note]].",
        ),
      ),
      parseNote(
        "projects/alpha",
        encoder.encode(
          "---\ntitle: Alpha project\ntags: [work/active, Plan]\n---\n# Alpha\n" +
            "Plan the launch with [[projects/beta]]. The launch needs a plan and a plan review.\n" +
            "```text\n[[not-a-link]] #nottag\n```",
        ),
      ),
      parseNote(
        "projects/beta",
        encoder.encode(
          "# Beta project\nWaiting for the [[alpha]] review. Tags: #work/active #2024",
        ),
      ),
      parseNote(
        "daily/todo",
        encoder.encode(
          "---\naliases: [brainstorm]\n---\nWater the plants. Read about the launch plan.",
        ),
      ),
      parseNote("work/todo", encoder.encode("# Todo\nCall the vendor about the garden.")),
    ];

    expectPureReport(
      notes,
      "notes: 5\nwords: 47\ntags: 4\nlinks: 3\nbroken links: 1\nambiguous links: 1\norphans: 2\ncomponents: 3\n",
    );
  });
});
