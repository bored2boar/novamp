/**
 * Characters that look like ASCII letters but are not.
 *
 * This is the whole reason a naive `symbol === symbol` match misses most vamps.
 * `PEANUT` and `PEANUТ` (Cyrillic Te at the end) are different byte strings and
 * identical to the eye at 11px in a wallet. A launcher who swaps one glyph gets
 * a token that shares a chart-reading human's attention with the original and
 * nothing else.
 *
 * The table is deliberately hand-kept rather than pulled from the full Unicode
 * confusables file: the full file is 6000 lines, most of it irrelevant to ticker
 * symbols, and a smaller table that is auditable in one screen is worth more
 * here than completeness. Anything missing is a bug report with an obvious fix.
 *
 * Sources: Unicode TR39 confusables, restricted to Latin, Greek, Cyrillic,
 * fullwidth forms, mathematical alphanumerics and the small-caps block.
 */

export const CONFUSABLES: Readonly<Record<string, string>> = Object.freeze({
  // --- Cyrillic ------------------------------------------------------------
  "а": "a", // а
  "А": "a", // А
  "в": "b", // в
  "В": "b", // В
  "с": "c", // с
  "С": "c", // С
  "е": "e", // е
  "Е": "e", // Е
  "р": "p", // р
  "Р": "p", // Р
  "о": "o", // о
  "О": "o", // О
  "х": "x", // х
  "Х": "x", // Х
  "у": "y", // у
  "У": "y", // У
  "к": "k", // к
  "К": "k", // К
  "м": "m", // м
  "М": "m", // М
  "т": "t", // т
  "Т": "t", // Т
  "н": "h", // н
  "Н": "h", // Н
  "і": "i", // і
  "І": "i", // І
  "ј": "j", // ј
  "Ѕ": "s", // Ѕ
  "ѕ": "s", // ѕ

  // --- Greek ---------------------------------------------------------------
  "α": "a", // α
  "Α": "a", // Α
  "Β": "b", // Β
  "Ε": "e", // Ε
  "Η": "h", // Η
  "Ι": "i", // Ι
  "Κ": "k", // Κ
  "Μ": "m", // Μ
  "Ν": "n", // Ν
  "Ο": "o", // Ο
  "ο": "o", // ο
  "Ρ": "p", // Ρ
  "ρ": "p", // ρ
  "Τ": "t", // Τ
  "Υ": "y", // Υ
  "υ": "u", // υ
  "Χ": "x", // Χ
  "χ": "x", // χ
  "σ": "o", // σ
  "ι": "i", // ι
  "ν": "v", // ν

  // --- Latin lookalikes and accents that survive NFKD poorly ---------------
  "ı": "i", // ı
  "ł": "l", // ł
  "ø": "o", // ø
  "Ø": "o", // Ø
  "đ": "d", // đ
  "þ": "p", // þ
  "œ": "oe", // œ
  "æ": "ae", // æ
  "Æ": "ae", // Æ
  "ß": "ss", // ß

  // --- Symbols people use as letters ---------------------------------------
  "€": "e", // €
  "£": "l", // £
  "¥": "y", // ¥
  "$": "s", // $ inside a word, not the leading ticker marker
  "ℓ": "l", // ℓ
  "K": "k", // K (Kelvin sign)
  "Å": "a", // Å (Angstrom sign)
});

/**
 * Digits and punctuation used as letters. Applied after the confusables pass so
 * `PEAN0T`, `PE4NUT` and `P3ANUT` all collapse onto the same key.
 *
 * Kept separate because leetspeak is a lossier substitution than a homoglyph:
 * a token genuinely called `W3B3` is not trying to hide, and this pass will
 * still fold it. That trade is deliberate. A false join is visible in the output
 * table and costs the reader a glance; a missed vamp costs them money.
 */
export const LEET: Readonly<Record<string, string>> = Object.freeze({
  "0": "o",
  "1": "l",
  "3": "e",
  "4": "a",
  "5": "s",
  "6": "g",
  "7": "t",
  "8": "b",
  "9": "g",
  "!": "i",
  "|": "l",
  "@": "a",
});

/** Zero width and formatting characters that make two identical strings differ. */
export const INVISIBLE_RE =
  /[​-‏‪-‮⁠-⁤﻿­͏᠎]/g;

/** Combining marks left over after NFKD, so `pëanut` folds to `peanut`. */
export const COMBINING_RE = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃰]/g;
