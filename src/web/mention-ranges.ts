export type MentionRange = {
  start: number;
  end: number;
  id: string;
  label: string;
};
export type MentionEdit = { start: number; end: number; nextEnd: number };

const wordCharacter = /[\p{L}\p{N}_]/u;

function isExactMention(value: string, mention: MentionRange) {
  if (value.slice(mention.start, mention.end) !== `@${mention.label}`) return false;
  const before = Array.from(value.slice(0, mention.start)).at(-1);
  const afterCodePoint = value.codePointAt(mention.end);
  const after =
    afterCodePoint === undefined ? undefined : String.fromCodePoint(afterCodePoint);
  return (
    (!before || !wordCharacter.test(before)) && (!after || !wordCharacter.test(after))
  );
}

export function reconcileMentionRanges(
  previous: string,
  next: string,
  ranges: MentionRange[],
  edit?: MentionEdit,
) {
  let prefix = edit?.start ?? 0;
  if (!edit)
    while (
      prefix < previous.length &&
      prefix < next.length &&
      previous[prefix] === next[prefix]
    )
      prefix++;
  // Do not let a shared name prefix align one selected token with a different
  // occurrence (for example deleted `@Ann` followed by retained `@Anna`).
  if (!edit)
    prefix = ranges.reduce(
      (boundary, mention) =>
        mention.start < boundary && boundary <= mention.end
          ? Math.min(boundary, mention.start)
          : boundary,
      prefix,
    );

  let suffix = edit ? previous.length - edit.end : 0;
  if (!edit)
    while (
      suffix < previous.length - prefix &&
      suffix < next.length - prefix &&
      previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
    )
      suffix++;

  const previousEditEnd = edit?.end ?? previous.length - suffix;
  const nextEditEnd = edit?.nextEnd ?? next.length - suffix;
  const shift = nextEditEnd - previousEditEnd;
  return ranges.flatMap((mention) => {
    let candidate: MentionRange;
    if (mention.end <= prefix) candidate = mention;
    else if (mention.start >= previousEditEnd)
      candidate = {
        ...mention,
        start: mention.start + shift,
        end: mention.end + shift,
      };
    else return [];
    return isExactMention(next, candidate) ? [candidate] : [];
  });
}

export function mentionIds(ranges: MentionRange[]) {
  return [...new Set(ranges.map((mention) => mention.id))];
}
