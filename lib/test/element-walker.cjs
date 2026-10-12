// lib/test/element-walker.cjs — One React element walker for node:test suites; never imported by production code.

// Real React elements carry $$typeof; suites that stub React produce plain { type, props } objects.
function isElement(value) {
  return Boolean(value) && typeof value === 'object' &&
    ('$$typeof' in value || ('type' in value && typeof value.props === 'object' && value.props !== null))
}

/** List every React element reachable from `element`: children, element-valued props such as a
 * PageBand `aside`, arrays and fragments. `expand: true` renders every synchronous function
 * component (except names in `skip`) so its output is walked too; an array expands only those names.
 */
function elementNodes(element, { expand = false, skip = [] } = {}) {
  const shouldExpand = node => typeof node.type === 'function' && (Array.isArray(expand)
    ? expand.includes(node.type.name) : expand === true && !skip.includes(node.type.name))
  const found = []
  const seen = new Set()
  const visit = value => {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (!isElement(value) || seen.has(value)) return
    seen.add(value)
    found.push(value)
    for (const prop of Object.values(value.props ?? {})) visit(prop)
    if (shouldExpand(value)) {
      const rendered = value.type(value.props)
      if (rendered && typeof rendered.then !== 'function') visit(rendered)
    }
  }
  visit(element)
  return found
}

/** First element whose type (component or tag) matches. */
function findElement(element, type, options) {
  return elementNodes(element, options).find(node => node.type === type ||
    (typeof type === 'string' && node.type?.name === type))
}

module.exports = { elementNodes, findElement }
