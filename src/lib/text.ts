/** Lowercase, remove diacritics, turn curly apostrophes into straight ones. */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[\u2018\u2019]/g, "'")
    .toLowerCase();
}

/** Word tokens of normalized text. Times like 9:30 stay one token. */
export function tokenize(s: string): string[] {
  return normalize(s).match(/\d+(?::\d+)?|[\p{L}\d]+(?:'[\p{L}]+)*/gu) ?? [];
}
