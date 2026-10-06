/** Follow-ups that need the previous topic rather than a new standalone query. */
export function refersToPrevious(question: string): boolean {
  return /\b(?:it|its|they|them|their|that|those|there)\b|^\s*(?:(?:and|also|or|but|so|what about|how about|what came before|tell me more|explain (?:in )?(?:more detail|further)|give (?:a|an|another|one more|a different) .{0,20}example)\b|why(?: not)?\s*[?.!]*$|elaborate\s*[?.!]*$)/i.test(question);
}
