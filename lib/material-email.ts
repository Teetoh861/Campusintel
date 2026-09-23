export const MATERIAL_EMAIL = 'campusintell@gmail.com'

function buildMaterialEmailUrl(subject: string, body: string): string {
  return `mailto:${MATERIAL_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

/** Builds a private, course-aware email link for requesting study material. */
export function buildMaterialRequestEmailUrl(
  courseContext: string,
  requestedMaterial = 'study material',
): string {
  return buildMaterialEmailUrl(
    `${courseContext} — ${requestedMaterial} request`,
    `Hi, I'd like to request ${requestedMaterial} for ${courseContext}.`,
  )
}

/** Builds a private, course-aware email link for sharing study material. */
export function buildMaterialShareEmailUrl(courseContext: string): string {
  return buildMaterialEmailUrl(
    `${courseContext} — material to share`,
    `Hi, I'd like to share study material for ${courseContext}.`,
  )
}
