// lib/landing/format.ts — Fill {name} placeholders in landing copy so templates can cross into client components.

/** Replace each {key} with its value; unknown keys stay visible so a typo is caught in review and tests. */
export function fillTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match))
}
