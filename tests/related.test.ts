import { describe, expect, test } from "bun:test";
import { parseNote } from "../src/note";
import { renderRelated } from "../src/related";
import type { Note } from "../src/types";

const encoder = new TextEncoder();

function note(id: string, title: string, terms: [string, number][] = []): Note {
  return {
    id,
    hash: "0123abcd",
    words: 0,
    title,
    tags: [],
    aliases: [],
    links: [],
    terms,
  };
}

function fiveExampleNotes(): Note[] {
  return [
    parseNote(
      "daily/todo",
      encoder.encode(
        "---\naliases: [brainstorm]\n---\nWater the plants. Read about the launch plan.",
      ),
    ),
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
      encoder.encode("# Beta project\nWaiting for the [[alpha]] review. Tags: #work/active #2024"),
    ),
    parseNote("work/todo", encoder.encode("# Todo\nCall the vendor about the garden.")),
  ];
}

describe("related note cosine", () => {
  test("uses corpus-wide document frequency and weighted tf with sorted-word arithmetic", () => {
    const notes = [
      note("a", "Source", [
        ["x", 1],
        ["y", 1],
      ]),
      note("b", "Peer", [["x", 1]]),
    ];
    const original = structuredClone(notes);

    // For N=2, x has df=2 and weight 1.5; y has df=1 and weight 3.
    // Sorted x,y accumulation gives source norm squared 11.25, peer norm squared 2.25,
    // and dot product 2.25, so cosine = 2.25 / sqrt(11.25 * 2.25) = 0.447...
    expect(renderRelated(notes, "a", 5)).toBe("0.447  b  Peer\n1 related note\n");
    expect(notes).toEqual(original);
  });

  test("retains sorted multiword accumulation at a rounding boundary", () => {
    const notes = [
      note("a", "Source", [
        ["a", 2],
        ["b", 524288],
        ["c", 35184372088832],
      ]),
      note("b", "Peer", [
        ["a", 2],
        ["b", 524288],
        ["c", 35184372088832],
        ["d", 45229329366625],
      ]),
    ];

    // N=2 gives a, b, and c weight 1.5 times tf, while d has df=1 and weight 3 times tf.
    // Thus the source vector is (3, 786432, 52776558133248); the peer adds
    // 135687988099875 as its d coordinate. In code-point order a,b,c,d, the
    // squared norms accumulate the coordinates in that order, and the source-word
    // dot product accumulates 3*3, 786432^2, then 52776558133248^2. This yields
    // cosine 0.36249999999999993 (scaled 362); reversing the peer norm's order
    // yields 0.3625 (scaled 363).
    expect(renderRelated(notes, "a", 5)).toBe("0.362  b  Peer\n1 related note\n");
  });

  test("weights repeated terms and excludes an orthogonal candidate", () => {
    const notes = [
      note("a", "Source", [
        ["x", 2],
        ["y", 1],
      ]),
      note("b", "Peer", [["x", 1]]),
      note("c", "Orthogonal", [["z", 1]]),
    ];

    // N=3 gives x weight 4 in the source and 2 in b, while y weighs 4;
    // their cosine is 8 / (sqrt(32) * 2) = 0.707...
    expect(renderRelated(notes, "a", 5)).toBe("0.707  b  Peer\n1 related note\n");
  });

  test("returns one for proportional vectors and omits zero-similarity vectors", () => {
    const notes = [
      note("a", "Source", [
        ["x", 1],
        ["y", 1],
      ]),
      note("b", "Proportional", [
        ["x", 2],
        ["y", 2],
      ]),
      note("c", "Orthogonal", [["z", 1]]),
    ];

    expect(renderRelated(notes, "a", 5)).toBe("1.000  b  Proportional\n1 related note\n");
  });

  test("returns zero related notes for empty source or candidate vectors", () => {
    const emptySource = [note("a", "Empty source"), note("b", "Has terms", [["x", 1]])];
    const emptyCandidate = [note("a", "Source", [["x", 1]]), note("b", "Empty candidate")];

    expect(renderRelated(emptySource, "a", 5)).toBe("0 related notes\n");
    expect(renderRelated(emptyCandidate, "a", 5)).toBe("0 related notes\n");
  });

  test("excludes the source even when it is the only nonempty note", () => {
    expect(renderRelated([note("a", "Only note", [["x", 1]])], "a", 999)).toBe("0 related notes\n");
  });

  test("filters positive similarities that scale to zero and includes one that scales to one", () => {
    const roundsToZero = [
      note("a", "Source", [
        ["x", 1],
        ["z", 1000],
      ]),
      note("b", "Peer", [["x", 1]]),
    ];
    const roundsToOne = [
      note("a", "Source", [
        ["x", 1],
        ["z", 999],
      ]),
      note("b", "Peer", [["x", 1]]),
    ];

    expect(renderRelated(roundsToZero, "a", 5)).toBe("0 related notes\n");
    expect(renderRelated(roundsToOne, "a", 5)).toBe("0.001  b  Peer\n1 related note\n");
  });
});

describe("related note ordering and rendering", () => {
  test("orders equal scaled scores by code point id instead of the unequal raw scores", () => {
    const notes = [
      note("a", "Raw score is lower", [
        ["x", 102],
        ["y", 100],
      ]),
      note("source", "Source", [
        ["x", 100],
        ["y", 100],
      ]),
      note("z", "Raw score is higher", [
        ["x", 101],
        ["y", 100],
      ]),
    ];

    // All vectors contain x and y, so df is uniform. Both cosines round to 1.000,
    // but z is closer to the source; the contract breaks the scaled tie by id.
    expect(renderRelated(notes, "source", 5)).toBe(
      "1.000  a  Raw score is lower\n1.000  z  Raw score is higher\n2 related notes\n",
    );
  });

  test("uses Unicode code point ordering for scaled-score ties", () => {
    const bmpId = "\uE000";
    const supplementaryId = "\u{10000}";
    const notes = [
      note(bmpId, "BMP", [["x", 1]]),
      note(supplementaryId, "Supplementary", [["x", 1]]),
      note("source", "Source", [["x", 1]]),
    ];

    expect(renderRelated(notes, "source", 5)).toBe(
      `1.000  ${bmpId}  BMP\n1.000  ${supplementaryId}  Supplementary\n2 related notes\n`,
    );
  });

  test("limits rows while reporting the total eligible count and handles limit 999", () => {
    const notes = [
      note("a", "Alpha", [["x", 1]]),
      note("b", "Beta", [["x", 1]]),
      note("c", "Gamma", [["x", 1]]),
      note("source", "Source", [["x", 1]]),
    ];

    expect(renderRelated(notes, "source", 1)).toBe("1.000  a  Alpha\n3 related notes\n");
    expect(renderRelated(notes, "source", 999)).toBe(
      "1.000  a  Alpha\n1.000  b  Beta\n1.000  c  Gamma\n3 related notes\n",
    );
  });

  test("preserves ids and titles and uses exact two-space fields with LF", () => {
    const notes = [
      note("folder/a", "A  title with spacing", [["x", 1]]),
      note("source", "Source", [["x", 1]]),
    ];

    const output = renderRelated(notes, "source", 1);

    expect(output).toBe("1.000  folder/a  A  title with spacing\n1 related note\n");
    expect(output).not.toContain("\r");
    expect(output.endsWith("\n")).toBe(true);
  });

  test("matches the supplied five-note related example exactly", () => {
    expect(renderRelated(fiveExampleNotes(), "projects/alpha", 5)).toBe(
      "0.455  projects/beta  Beta project\n" +
        "0.093  daily/todo  todo\n" +
        "0.078  ideas  Ideas\n" +
        "3 related notes\n",
    );
  });
});
