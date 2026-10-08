// components/chrome/navigation.browser.cjs — Real-browser regressions; the visual runner supplies a CDP session and signed-in/out fixtures.
const assert = require('node:assert/strict')

async function press(send, key, modifiers = 0) {
  const code = { Enter: 13, Escape: 27, Tab: 9 }[key]
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', {
    type, key, code: key, windowsVirtualKeyCode: code, modifiers,
    ...(type === 'keyDown' && key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}),
  })
}

async function publicNavigation({ evaluate }) {
  const header = await evaluate(`(() => {
    const nav = document.querySelector('[data-screen-label="Nav"]');
    return { links: [...nav.querySelectorAll('a')].map(a => a.getAttribute('href')),
      buttons: nav.querySelectorAll('button').length,
      actions: [...nav.querySelectorAll('a')].slice(1).map(a => {
        const style = getComputedStyle(a);
        return { height: a.getBoundingClientRect().height, border: style.borderColor,
          borderWidth: style.borderWidth, font: style.fontSize, padding: style.paddingLeft };
      }),
      footerLinks: [...document.querySelector('footer').querySelectorAll('a')].map(a => a.getAttribute('href')),
      width: document.documentElement.scrollWidth, viewport: innerWidth };
  })()`)
  assert.deepEqual(header.links, ['/', '/login', '/register'])
  assert.equal(header.buttons, 0)
  for (const action of header.actions) assert.ok(action.height >= 44)
  assert.equal(header.actions[0].borderWidth, '1px')
  assert.notEqual(header.actions[0].border, 'rgba(0, 0, 0, 0)')
  assert.equal(header.actions[0].font, header.viewport < 768 ? '14px' : '15px')
  assert.equal(header.actions[0].padding, header.viewport < 768 ? '8px' : '16px')
  assert.ok(header.footerLinks.every(href => href === '/' || href.startsWith('mailto:')))
  assert.equal(header.width, header.viewport)
}

async function studentNavigation({ evaluate, send, waitFor, click }) {
  const closed = await evaluate(`(() => {
    const nav = document.querySelector('[data-screen-label="Nav"]'), trigger = nav.querySelector('button[aria-label="Open menu"]');
    return { height: nav.getBoundingClientRect().height, main: document.querySelector('main').getBoundingClientRect().y,
      viewport: innerWidth,
      triggerVisible: trigger.getBoundingClientRect().width > 0,
      visibleLinks: [...nav.querySelectorAll('a')].filter(a => a.getBoundingClientRect().width).map(a => a.getAttribute('href')),
      logoutCount: [...nav.querySelectorAll('button')].filter(button => button.textContent.trim() === 'Log out').length,
      footerLinks: [...document.querySelector('footer').querySelectorAll('a')]
        .filter(a => a.getAttribute('href').startsWith('/') && !a.hasAttribute('aria-label'))
        .map(a => [a.textContent.trim(), a.getAttribute('href')]),
      footer: { text: document.querySelector('footer').textContent.trim(),
        marks: document.querySelectorAll('footer img[src*="campusintell-mark"]').length,
        height: document.querySelector('footer').getBoundingClientRect().height } };
  })()`)
  assert.deepEqual(closed.footerLinks, [])
  assert.equal(closed.footer.text, 'The inside track on every paper.')
  assert.equal(closed.footer.marks, 1)
  assert.ok(closed.footer.height <= 80, 'compact Student App footer')
  assert.equal(closed.logoutCount, 0)
  if (!closed.triggerVisible) {
    assert.deepEqual(closed.visibleLinks, ['/dashboard', '/courses', '/tutors', '/contact', '/account'])
    assert.equal(await evaluate('document.querySelectorAll("[role=dialog]").length'), 0)
    return { desktop: true }
  }
  assert.deepEqual(closed.visibleLinks, ['/dashboard'])
  const open = async () => {
    await evaluate('document.querySelector(`[data-screen-label=Nav] button[aria-label="Open menu"]`).focus()')
    await press(send, 'Enter')
    await waitFor(() => evaluate('Boolean(document.querySelector("[role=dialog]"))'), Boolean, 'student Sheet open')
    await waitFor(() => evaluate('document.querySelector("[role=dialog]").contains(document.activeElement)'), Boolean, 'initial focus inside Sheet')
    await waitFor(() => evaluate('document.querySelector("[role=dialog]").getAnimations().every(animation => animation.playState === "finished")'), Boolean, 'Sheet opening transition')
  }
  await open()
  const modal = await evaluate(`(() => {
    const nav = document.querySelector('[data-screen-label="Nav"]'), dialog = document.querySelector('[role=dialog]');
    const close = [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === 'Close');
    return { height: nav.getBoundingClientRect().height, main: document.querySelector('main').getBoundingClientRect().y,
      width: dialog.getBoundingClientRect().width, viewport: innerWidth, closeHeight: close.getBoundingClientRect().height,
      visibleLinks: [...dialog.querySelectorAll('a')].filter(a => a.getBoundingClientRect().width)
        .map(a => [a.textContent.trim(), a.getAttribute('href')]),
      logoutCount: [...dialog.querySelectorAll('button')].filter(button => button.textContent.trim() === 'Log out').length,
      scrollLocked: document.body.hasAttribute('data-scroll-locked'), backgroundHidden: nav.closest('[aria-hidden=true]') !== null };
  })()`)
  assert.equal(modal.height, closed.height)
  assert.equal(modal.main, closed.main)
  assert.ok(modal.width <= Math.min(modal.viewport, 384))
  assert.ok(modal.closeHeight >= 44)
  assert.deepEqual(modal.visibleLinks, [['Dashboard', '/dashboard'], ['All Courses', '/courses'],
    ['Tutors', '/tutors'], ['Help & Support', '/contact'], ['Account', '/account']])
  assert.equal(modal.logoutCount, 0)
  assert.equal(modal.scrollLocked, true)
  assert.equal(modal.backgroundHidden, true)
  for (let i = 0; i < 16; i++) {
    await press(send, 'Tab', i >= 12 ? 1 : 0)
    assert.equal(await evaluate('document.querySelector("[role=dialog]").contains(document.activeElement)'), true)
  }
  await press(send, 'Escape')
  await waitFor(() => evaluate('document.querySelector("[role=dialog]") === null'), Boolean, 'Escape closes Sheet')
  assert.equal(await evaluate('document.activeElement === document.querySelector(`[data-screen-label=Nav] button[aria-label="Open menu"]`)'), true)
  assert.equal(await evaluate('document.body.hasAttribute("data-scroll-locked")'), false)
  await open()
  await click('[role="dialog"] > button')
  await waitFor(() => evaluate('document.querySelector("[role=dialog]") === null'), Boolean, 'close control')
  assert.equal(await evaluate('document.activeElement === document.querySelector(`[data-screen-label=Nav] button[aria-label="Open menu"]`)'), true)
  await open()
  await click('[role="dialog"] a[href="/account"]')
  await waitFor(() => evaluate('document.querySelector("[role=dialog]") === null'), Boolean, 'navigation closes Sheet')
  await waitFor(() => evaluate('location.pathname === "/account"'), Boolean, 'Account navigation')
  return { desktop: false, headerStable: true, focusContained: true, escapeAndRestore: true, closeAndRestore: true, navigationCloses: true }
}

async function savedTitleClearance({ evaluate }) {
  const collisions = await evaluate(`(() => [...document.querySelectorAll('main article')].map(card => {
    const title = card.querySelector('h3'), remove = card.querySelector('button');
    if (!title || !remove) return false;
    const range = document.createRange(); range.selectNodeContents(title);
    const button = remove.getBoundingClientRect();
    return [...range.getClientRects()].some(line => line.x < button.right && line.right > button.x && line.y < button.bottom && line.bottom > button.y);
  }))()`)
  assert.ok(collisions.length > 0, 'populated Saved cards are required')
  assert.ok(collisions.every(collision => !collision), 'no rendered title may intersect a remove control')
}

module.exports = { publicNavigation, studentNavigation, savedTitleClearance }
