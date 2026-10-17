// Theory question labels shared by Course Detail and Theory practice so both pages number questions alike.

/** Authored display numbers win; unnumbered questions continue after the highest, in published order.
 * Pass every published theory question, including those without a model answer, so labels match across pages.
 */
export function theoryDisplayNumbers(items: ReadonlyArray<{ displayNumber?: number }>): number[] {
  let next = Math.max(0, ...items.map(item => item.displayNumber ?? 0)) + 1
  return items.map(item => item.displayNumber ?? next++)
}
