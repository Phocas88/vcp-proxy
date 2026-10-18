export function canApply(text, original) {
  if (typeof text !== 'string' || typeof original !== 'string' || !original) return false;
  const index = text.indexOf(original);
  return index !== -1 && text.indexOf(original, index + 1) === -1;
}

// PDF imports can wrap a sentence differently from an AI quotation. Resolve only
// a unique whitespace-equivalent match; wording and punctuation must still match.
export function resolveOriginal(text, quote) {
  if (canApply(text, quote)) return quote;
  if (typeof quote !== 'string' || !quote.trim()) return null;
  let normalized = ''; const starts = []; const ends = [];
  for (let i = 0; i < text.length; i++) {
    const char = /\s/u.test(text[i]) ? ' ' : text[i];
    if (char === ' ' && normalized.endsWith(' ')) { ends[ends.length - 1] = i + 1; continue; }
    normalized += char; starts.push(i); ends.push(i + 1);
  }
  const target = quote.replace(/\s+/gu, ' ').trim();
  const index = normalized.indexOf(target);
  if (index < 0 || normalized.indexOf(target, index + 1) !== -1) return null;
  return text.slice(starts[index], ends[index + target.length - 1]);
}

export function applyCorrections(text, suggestions) {
  const applied = [];
  let result = text;
  for (const suggestion of suggestions) {
    if (canApply(result, suggestion.original) && typeof suggestion.replacement === 'string' && suggestion.replacement.trim()) {
      result = result.replace(suggestion.original, () => suggestion.replacement);
      applied.push(suggestion.id);
    }
  }
  return { text: result, applied };
}
