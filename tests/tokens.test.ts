import { describe, expect, test } from "bun:test";
import { words } from "../src/tokens";

describe("ASCII word tokenization", () => {
  test("returns ordered ASCII alphanumeric runs with duplicates", () => {
    const wordsContract: (text: string) => string[] = words;
    expect(wordsContract("Alpha ALPHA 2024 foo_bar café")).toEqual([
      "alpha",
      "alpha",
      "2024",
      "foo",
      "bar",
      "caf",
    ]);
    expect(words("Beta, alpha! BETA? 007")).toEqual(["beta", "alpha", "beta", "007"]);
    expect(words("A0 Z9 a0 z9 0a 9z _ é")).toEqual(["a0", "z9", "a0", "z9", "0a", "9z"]);
  });

  test("splits on punctuation, underscores, hyphens, and non-ASCII characters", () => {
    expect(words("red_blue red-blue l'été naïve 東京")).toEqual([
      "red",
      "blue",
      "red",
      "blue",
      "l",
      "t",
      "na",
      "ve",
    ]);
  });

  test("excludes exactly the supplied stop words", () => {
    expect(words("a an and are as at be by for from in is it of on or that the to with")).toEqual(
      [],
    );
    expect(
      words(
        "a1 an1 and1 are1 as1 at1 be1 by1 for1 from1 in1 is1 it1 of1 on1 or1 that1 the1 to1 with1",
      ),
    ).toEqual([
      "a1",
      "an1",
      "and1",
      "are1",
      "as1",
      "at1",
      "be1",
      "by1",
      "for1",
      "from1",
      "in1",
      "is1",
      "it1",
      "of1",
      "on1",
      "or1",
      "that1",
      "the1",
      "to1",
      "with1",
    ]);
    expect(words("about any aside also")).toEqual(["about", "any", "aside", "also"]);
  });

  test("returns no tokens for empty or punctuation-only text", () => {
    expect(words("")).toEqual([]);
    expect(words("... --- ___ !!! café 東京")).toEqual(["caf"]);
  });
});
