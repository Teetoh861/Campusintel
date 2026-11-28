// Adapt existing authored text for self-review without generating criteria or mark weights.
const LIST_POINT = /^\s*(?:[-*•]|\d+[.)]|[a-zA-Z][.)]|\([a-zA-Z0-9]+\))\s+\S/

/** Keep explicit authored list items and their indented continuations verbatim.
 * Unstructured prose remains one whole-rubric review item; it is never rewritten into criteria.
 */
export function authoredRubricPoints(body: string): string[] {
  const points: string[] = []
  let continuing = false
  for (const line of body.split(/\r?\n/)) {
    if (LIST_POINT.test(line)) {
      points.push(line)
      continuing = true
    } else if (continuing && /^\s+\S/.test(line)) {
      points[points.length - 1] += `\n${line}`
    } else {
      continuing = false
    }
  }
  return points.length > 0 ? points : [body]
}
