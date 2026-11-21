// lib/test/element-walker.test.cjs — The shared walker reaches props, fragments and nested components.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const React = require('react')
const { elementNodes, findElement } = require('./element-walker.cjs')

const Inner = () => React.createElement('em', null, 'inner')
const Band = ({ aside, children }) => React.createElement('header', null, aside, children)
const Client = () => { throw new Error('client components must not be expanded') }

test('walks children, element-valued props, arrays and fragments', () => {
  const aside = React.createElement('button', { type: 'button' }, 'Bookmark')
  const tree = React.createElement('div', null,
    React.createElement(Band, { aside }, React.createElement(React.Fragment, null,
      [React.createElement('p', { key: 'a' }, 'one'), React.createElement('p', { key: 'b' }, 'two')])))
  const nodes = elementNodes(tree)
  assert.ok(nodes.includes(aside), 'element in a non-children prop is reached')
  assert.equal(nodes.filter(node => node.type === 'p').length, 2)
  assert.equal(nodes.filter(node => node.type === 'em').length, 0, 'components are not expanded by default')
  assert.equal(findElement(tree, 'button'), aside)
})

test('expands synchronous components on request, skipping named ones and async output', () => {
  const tree = React.createElement(Band, { aside: React.createElement(Client) },
    React.createElement(Inner), React.createElement(async function Server() { return null }))
  const expanded = elementNodes(tree, { expand: true, skip: ['Client'] })
  assert.ok(expanded.some(node => node.type === 'em'), 'nested sync component output is walked')
  assert.ok(expanded.some(node => node.type === 'header'))
  assert.equal(findElement(tree, 'Client', { expand: true, skip: ['Client'] }).type, Client)
  assert.throws(() => elementNodes(tree, { expand: true }), /client components must not be expanded/)
  const allowlisted = elementNodes(tree, { expand: ['Inner'] })
  assert.ok(allowlisted.some(node => node.type === 'em'), 'allowlisted component is expanded')
  assert.equal(allowlisted.some(node => node.type === 'header'), false, 'others stay unexpanded')
})

test('ignores plain data props and cycles without reporting them as elements', () => {
  const data = { course: { title: 'Not an element' }, list: [1, 'two', null] }
  const tree = React.createElement('section', data, 'text')
  assert.deepEqual(elementNodes(tree), [tree])
  assert.deepEqual(elementNodes(null), [])
  const stubbed = { type: 'div', props: { children: [{ type: 'span', props: { children: 'stub' } }, 'text'] } }
  assert.equal(elementNodes(stubbed).length, 2, 'stubbed React element shapes are walked')
})
