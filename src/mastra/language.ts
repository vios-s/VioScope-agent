/** True when most letters are outside the Latin script, i.e. the text is not written in English. */
export function isMostlyNonEnglish(text: string): boolean {
  const letters = text.match(/\p{L}/gu) || [];
  const latin = text.match(/\p{Script=Latin}/gu) || [];
  // ponytail: script ratio, not language detection; other Latin-script languages pass. Use a detector if that matters.
  return letters.length > 0 && (letters.length - latin.length) / letters.length > 0.3;
}
