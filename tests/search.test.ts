import { describe, expect, test } from "bun:test";
import { parseNote } from "../src/note";
import { renderSearch } from "../src/search";
import { CliError, type Note } from "../src/types";

const encoder = new TextEncoder();

function note(id: string, text: string): Note {
  return parseNote(id, encoder.encode(text));
}

function expectCliError(action: () => unknown, message: string): void {
  let error: unknown;
  try {
    action();
  } catch (caught) {
    error = caught;
  }

  expect(error).toBeInstanceOf(CliError);
  expect(error instanceof Error ? error.message : "").toBe(message);
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

describe("ranked search query interpretation", () => {
  test("joins operands and splits all whitespace while requiring every ordinary word", () => {
    const notes = [
      note("only-needle", "---\ntitle: Needle\n---\nneedle"),
      note("both", "---\ntitle: Launch Notes\n---\nneedle launch extra"),
      note("only-launch", "---\ntitle: Launch\n---\nlaunch"),
    ];

    expect(renderSearch(notes, ["needle   launch", "\t"], 10)).toBe(
      "4.606  both  Launch Notes\n1 result\n",
    );
    expect(renderSearch(notes, ["needle", " \tlaunch"], 10)).toBe(
      "4.606  both  Launch Notes\n1 result\n",
    );
  });

  test("treats non-lowercase filter prefixes as ordinary search words", () => {
    const notes = [
      note("tagged", "---\ntitle: Tagged\ntags: [work]\n---\ntag work"),
      note("other", "---\ntitle: Other\ntags: [work]\n---\ntag"),
    ];

    expect(renderSearch(notes, ["TAG:work"], 10)).toBe("4.160  tagged  Tagged\n1 result\n");
  });

  test("requires all title words and applies tag ancestry with slash boundaries", () => {
    const notes = [
      note("active", "---\ntitle: Alpha Launch\ntags: [work/active]\n---\nneedle"),
      note("exact", "---\ntitle: Launch Alpha\ntags: [work]\n---\nneedle"),
      note("workforce", "---\ntitle: Alpha Launch\ntags: [workforce]\n---\nneedle"),
      note("body-only", "---\ntitle: Alpha\ntags: [work/active]\n---\nneedle launch"),
    ];

    expect(renderSearch(notes, ["tag:#WORK/", "title:launch-alpha"], 10)).toBe(
      "0.000  active  Alpha Launch\n0.000  exact  Launch Alpha\n2 results\n",
    );
    expect(renderSearch(notes, ["tag:work", "title:alpha", "needle"], 10)).toBe(
      "1.250  active  Alpha Launch\n1.250  body-only  Alpha\n1.250  exact  Launch Alpha\n3 results\n",
    );
  });

  test("requires every tag filter independently", () => {
    const notes = [
      note("both", "---\ntitle: Both\ntags: [work/active, plan/review]\n---\n"),
      note("plan-only", "---\ntitle: Plan\ntags: [plan/review]\n---\n"),
      note("work-only", "---\ntitle: Work\ntags: [work/active]\n---\n"),
      note("boundary", "---\ntitle: Boundary\ntags: [workforce, plan/review]\n---\n"),
    ];

    expect(renderSearch(notes, ["tag:work", "tag:plan"], 10)).toBe("0.000  both  Both\n1 result\n");
  });

  test("combines ordinary, tag and title filters, and excludes on any term", () => {
    const notes = [
      note("match", "---\ntitle: Alpha Launch\ntags: [work/active]\n---\nneedle"),
      note("wrong-tag", "---\ntitle: Alpha Launch\ntags: [workforce]\n---\nneedle"),
      note("wrong-title", "---\ntitle: Alpha\ntags: [work/active]\n---\nneedle launch"),
      note("excluded", "---\ntitle: Alpha Launch\ntags: [work/active]\n---\nneedle blocked"),
    ];

    expect(renderSearch(notes, ["needle", "tag:work", "title:alpha", "not:blocked"], 10)).toBe(
      "1.291  match  Alpha Launch\n1.291  wrong-title  Alpha\n2 results\n",
    );
    expect(renderSearch(notes, ["needle", "not:launch blocked"], 10)).toBe("0 results\n");
  });

  test("supports stop-word-only filter values when another positive filter remains", () => {
    const notes = [note("one", "---\ntitle: Alpha\ntags: [work]\n---\n")];

    expect(renderSearch(notes, ["tag:work", "title:the", "not:of"], 10)).toBe(
      "0.000  one  Alpha\n1 result\n",
    );
  });

  test("returns a zero-score match when a tagged corpus has zero total words", () => {
    const empty = note("empty", "---\ntitle: !!!\ntags: [work]\n---\n");

    expect(empty.words).toBe(0);
    expect(renderSearch([empty], ["tag:work"], 10)).toBe("0.000  empty  !!!\n1 result\n");
  });

  test("excludes matches for either word in a single multiword not: item", () => {
    const notes = [
      note("alpha", "---\ntitle: !!!\ntags: [work]\n---\nalpha"),
      note("beta", "---\ntitle: !!!\ntags: [work]\n---\nbeta"),
      note("stay", "---\ntitle: !!!\ntags: [work]\n---\n"),
    ];

    expect(renderSearch(notes, ["tag:work", "not:alpha-beta"], 10)).toBe(
      "0.000  stay  !!!\n1 result\n",
    );
  });

  test("rejects invalid filters with their original item and exact CliError type", () => {
    const notes = [note("one", "# One\n")];

    expectCliError(() => renderSearch(notes, ["tag:"], 10), 'invalid query item "tag:"');
    expectCliError(() => renderSearch(notes, ["title:"], 10), 'invalid query item "title:"');
    expectCliError(() => renderSearch(notes, ["not:"], 10), 'invalid query item "not:"');
    expectCliError(() => renderSearch(notes, ["tag:1"], 10), 'invalid query item "tag:1"');
    expectCliError(
      () => renderSearch(notes, ["tag:work//active"], 10),
      'invalid query item "tag:work//active"',
    );
  });

  test("reports empty queries after validating every item, including on an empty corpus", () => {
    expectCliError(() => renderSearch([], ["the"], 10), "empty query");
    expectCliError(() => renderSearch([], ["!!!"], 10), "empty query");
    expectCliError(() => renderSearch([], ["not:waiting"], 10), "empty query");
    expectCliError(() => renderSearch([], ["title:the"], 10), "empty query");
    expectCliError(() => renderSearch([], ["not:!!!"], 10), "empty query");
    expectCliError(() => renderSearch([], ["the", "tag:"], 10), 'invalid query item "tag:"');
    expect(renderSearch([], ["tag:work"], 10)).toBe("0 results\n");
  });

  test("uses title words as requirements and exclusions against weighted note terms", () => {
    const notes = [
      note("title-match", "---\ntitle: Needle Bonus\n---\nneedle"),
      note("body-match", "---\ntitle: Other\n---\nneedle bonus"),
    ];

    expect(renderSearch(notes, ["needle", "title:bonus", "not:blocked"], 10)).toBe(
      "2.538  title-match  Needle Bonus\n1 result\n",
    );
    expect(renderSearch(notes, ["needle", "not:bonus"], 10)).toBe("0 results\n");
  });
});

describe("ranked search scoring and ordering", () => {
  test("scores weighted title and body frequency with an independent hand calculation", () => {
    const weighted = note("weighted", "---\ntitle: Alpha\n---\nalpha alpha");

    // N=1, avg=len=3, df=1, tf=3 title + 2 body = 5:
    // 2 * (5*2.2 / (5 + 1.2)) = 22/6.2 = 3.548387..., hence 3.548.
    expect(renderSearch([weighted], ["alpha"], 10)).toBe("3.548  weighted  Alpha\n1 result\n");
    expect(renderSearch([weighted], ["alpha", "alpha"], 10)).toBe(
      "3.548  weighted  Alpha\n1 result\n",
    );

    const twoWords = note("two-words", "---\ntitle: Alpha Beta\n---\nalpha beta");
    // alpha and beta each score 2 * (4*2.2 / (4 + 1.2)) = 3.384615...;
    // repeated beta is deduplicated, and the distinct terms accumulate in first-use order.
    expect(renderSearch([twoWords], ["beta", "alpha", "beta"], 10)).toBe(
      "6.769  two-words  Alpha Beta\n1 result\n",
    );
  });

  test("uses whole-corpus N, average length and document frequency, not filtered matches", () => {
    const alpha = note("a", "---\ntitle: Alpha\n---\nneedle common common");
    const beta = note(
      "b",
      "---\ntitle: Beta\n---\nneedle filler filler filler filler filler filler",
    );
    const gamma = note("c", "---\ntitle: Gamma\n---\n");

    // N=3, total words=13, avg=13/3, df(needle)=2. For a:
    // 2 * (2.2 / (1 + 1.2*(49/52))) = 572/277 = 2.06498...
    // For b: 2 * (2.2 / (1 + 1.2*(85/52))) = 572/385 = 1.48571...
    expect(renderSearch([alpha, beta, gamma], ["needle"], 10)).toBe(
      "2.065  a  Alpha\n1.486  b  Beta\n2 results\n",
    );
  });

  test("scores only ordinary words; title requirements and absent exclusions do not add score", () => {
    const alpha = note("alpha", "---\ntitle: Needle Bonus\n---\nneedle");

    expect(renderSearch([alpha], ["needle"], 10)).toBe("3.385  alpha  Needle Bonus\n1 result\n");
    expect(renderSearch([alpha], ["needle", "title:bonus", "not:blocked"], 10)).toBe(
      "3.385  alpha  Needle Bonus\n1 result\n",
    );
  });

  test("preserves first-use accumulation order across three unequal score contributions", () => {
    const notes: Note[] = [
      {
        id: "target",
        hash: "00000000",
        words: 5,
        title: "!!!",
        tags: [],
        aliases: [],
        links: [],
        terms: [
          ["alpha", 1],
          ["beta", 1],
          ["gamma", 3],
        ],
      },
      {
        id: "other",
        hash: "00000000",
        words: 65,
        title: "!!!",
        tags: [],
        aliases: [],
        links: [],
        terms: [
          ["alpha", 1],
          ["filler", 63],
          ["gamma", 1],
        ],
      },
    ];

    // N=2, avg=35, target len=5; alpha, beta and gamma contribute 2.31, 4.62 and 2.8875.
    // Adding them in first-use order yields 9.817499999999999; reversing the order yields 9.8175.
    expect(renderSearch(notes, ["alpha beta gamma"], 10)).toBe("9.817  target  !!!\n1 result\n");
    expect(renderSearch(notes, ["gamma beta alpha"], 10)).toBe("9.818  target  !!!\n1 result\n");
  });

  test("breaks scaled-score ties by code-point id order rather than raw score", () => {
    const lowerRawScore: Note = {
      id: "a-low",
      hash: "00000000",
      words: 99,
      title: "Alpha",
      tags: [],
      aliases: [],
      links: [],
      terms: [
        ["alpha", 100],
        ["filler", 1],
      ],
    };
    const higherRawScore: Note = {
      id: "z-high",
      hash: "00000000",
      words: 99,
      title: "Alpha",
      tags: [],
      aliases: [],
      links: [],
      terms: [["alpha", 101]],
    };

    // Both scale to 3.261 with N=2, df=2 and len=avg=99; the raw score for z-high is larger.
    expect(renderSearch([higherRawScore, lowerRawScore], ["alpha"], 10)).toBe(
      "3.261  a-low  Alpha\n3.261  z-high  Alpha\n2 results\n",
    );
  });

  test("orders zero-score filter-only matches by case-sensitive code points", () => {
    const notes = [
      note("😀", "---\ntitle: Emoji\ntags: [work]\n---\n"),
      note("a", "---\ntitle: Lower\ntags: [work]\n---\n"),
      note("", "---\ntitle: Private\ntags: [work]\n---\n"),
      note("A", "---\ntitle: Upper\ntags: [work]\n---\n"),
    ];

    expect(renderSearch(notes, ["tag:work"], 10)).toBe(
      "0.000  A  Upper\n0.000  a  Lower\n0.000    Private\n0.000  😀  Emoji\n4 results\n",
    );
  });

  test("does not mutate input notes, terms, tags, or operands", () => {
    const notes = [
      note("b", "---\ntitle: Beta\ntags: [work]\n---\nneedle"),
      note("a", "---\ntitle: Alpha\ntags: [work/active]\n---\nneedle"),
    ];
    const operands = ["tag:work", "needle"];
    const notesBefore = JSON.stringify(notes);

    expect(renderSearch(notes, operands, 10)).toEndWith("2 results\n");
    expect(JSON.stringify(notes)).toBe(notesBefore);
    expect(notes.map(({ id }) => id)).toEqual(["b", "a"]);
    expect(operands).toEqual(["tag:work", "needle"]);
  });
});

describe("ranked search output", () => {
  test("copies the four supplied search outputs exactly", () => {
    const notes = fiveExampleNotes();

    expect(renderSearch(notes, ["launch", "plan"], 10)).toBe(
      "5.519  projects/alpha  Alpha project\n" +
        "4.467  daily/todo  todo\n" +
        "3.740  ideas  Ideas\n" +
        "3 results\n",
    );
    expect(renderSearch(notes, ["plan"], 1)).toBe(
      "2.967  projects/alpha  Alpha project\nshowing 1 of 3 results\n",
    );
    expect(renderSearch(notes, ["tag:work", "not:waiting"], 10)).toBe(
      "0.000  projects/alpha  Alpha project\n1 result\n",
    );
    expect(renderSearch(notes, ["title:project", "launch"], 10)).toBe(
      "2.552  projects/alpha  Alpha project\n1 result\n",
    );
  });

  test("renders empty, singular, plural, exact-limit and truncated summaries with LF", () => {
    const notes = fiveExampleNotes();

    expect(renderSearch(notes, ["tag:missing"], 10)).toBe("0 results\n");
    expect(renderSearch(notes, ["title:ideas"], 10)).toBe("0.000  ideas  Ideas\n1 result\n");
    expect(renderSearch(notes, ["plan"], 3)).toEndWith("3 results\n");
    expect(renderSearch(notes, ["plan"], 1)).toEndWith("showing 1 of 3 results\n");
    expect(renderSearch(notes, ["plan"], 999)).toEndWith("3 results\n");
    expect(renderSearch(notes, ["plan"], 1)).not.toContain("\r");
  });
});
