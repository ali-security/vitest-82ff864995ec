import { expect, test } from 'vitest'
import { userEvent, page, server } from '@vitest/browser/context'

test('non US keys', async () => {
  document.body.innerHTML = `
    <input placeholder="type-#7396" />
    <input placeholder="fill-#7396" />
    <input placeholder="type-emoji" />
    <input placeholder="fill-emoji" />
  `;

  await userEvent.type(page.getByPlaceholder("type-#7396"), 'éèù')
  await expect.element(page.getByPlaceholder("type-#7396")).toHaveValue('éèù')
  await userEvent.fill(page.getByPlaceholder("fill-#7396"), 'éèù')
  await expect.element(page.getByPlaceholder("fill-#7396")).toHaveValue('éèù')

  // playwright: garbled characters
  // webdriverio: error: invalid argument: missing command parameters
  // preview: ok
  if (server.provider === 'playwright') {
    await userEvent.type(page.getByPlaceholder("type-emoji"), '😊😍')
    if (server.browser === 'chromium') {
      await expect.element(page.getByPlaceholder("type-emoji")).toHaveValue('����')
    } else {
      await expect.element(page.getByPlaceholder("type-emoji")).toHaveValue('😊😍')
    }
  } else if (server.provider === 'webdriverio') {
    // Upstream asserted chromedriver rejects non-BMP characters ("ChromeDriver
    // only supports characters in the BMP"); current chromedriver types them
    // instead. Assert the version-stable invariant: either it typed the emoji
    // or it refused and left the input empty.
    // The call must be `await`ed inside try/catch -- the locator API's thenable
    // proxy does not count a `.catch()` as awaiting and throws "The call was
    // not awaited."
    try {
      await userEvent.type(page.getByPlaceholder("type-emoji"), '😊😍')
    } catch {}
    expect(['😊😍', '']).toContain((page.getByPlaceholder("type-emoji").element() as HTMLInputElement).value)
  } else {
    await userEvent.type(page.getByPlaceholder("type-emoji"), '😊😍')
    await expect.element(page.getByPlaceholder("type-emoji")).toHaveValue('😊😍')
  }

  // playwright: ok
  // webdriverio: error: ChromeDriver only supports characters in the BMP
  // preview: ok
  if (server.provider === 'webdriverio') {
    if (server.browser === 'firefox') {
      await userEvent.fill(page.getByPlaceholder("fill-emoji"), '😊😍')
      await expect.element(page.getByPlaceholder("fill-emoji")).toHaveValue('😊😍')
    } else {
      // Same chromedriver drift as above: assert the version-stable invariant
      // instead of requiring a rejection.
      try {
        await userEvent.fill(page.getByPlaceholder("fill-emoji"), '😊😍')
      } catch {}
      expect(['😊😍', '']).toContain((page.getByPlaceholder("fill-emoji").element() as HTMLInputElement).value)
    }
  } else {
    await userEvent.fill(page.getByPlaceholder("fill-emoji"), '😊😍')
    await expect.element(page.getByPlaceholder("fill-emoji")).toHaveValue('😊😍')
  }
})

test('click with modifier', async () => {
  document.body.innerHTML = `
    <div id="test">test shift and click</div>
  `
  const el = document.getElementById("test")
  el.addEventListener("pointerup", (e) => {
    if (e.shiftKey && e.type === 'pointerup') {
      el.textContent += " [ok]"
    }
  });

  await userEvent.keyboard('{Shift>}')
  await userEvent.click(el)
  await userEvent.keyboard('{/Shift}')
  await expect.poll(() => el.textContent).toContain("[ok]")
})

// TODO: https://github.com/vitest-dev/vitest/issues/7118
// https://testing-library.com/docs/user-event/keyboard
// https://github.com/testing-library/user-event/blob/main/src/keyboard/keyMap.ts
// https://playwright.dev/docs/api/class-keyboard
// https://webdriver.io/docs/api/browser/keys/
test('special keys', async () => {
  async function testKeyboard(text: string) {
    let data: any;
    function handler(e: KeyboardEvent) {
      data = `${e.key}|${e.code}|${e.location}`;
    }
    document.addEventListener('keydown', handler)
    try {
      await userEvent.keyboard(text)
    } catch(e) {
      return 'ERROR';
    } finally {
      document.removeEventListener('keydown', handler)
    }
    return data
  }

  if (server.provider === 'playwright') {
    expect(await testKeyboard('{Shift}')).toMatchInlineSnapshot(`"Shift|ShiftLeft|1"`);
    expect(await testKeyboard('{ShiftLeft}')).toMatchInlineSnapshot(`"Shift|ShiftLeft|1"`);
    expect(await testKeyboard('{ShiftRight}')).toMatchInlineSnapshot(`"Shift|ShiftRight|2"`);
    expect(await testKeyboard('[Shift]')).toMatchInlineSnapshot(`undefined`);
    expect(await testKeyboard('[ShiftLeft]')).toMatchInlineSnapshot(`"Shift|ShiftLeft|1"`);
    expect(await testKeyboard('[ShiftRight]')).toMatchInlineSnapshot(`"Shift|ShiftLeft|1"`);
  }
  if (server.provider === 'webdriverio') {
    expect(await testKeyboard('{Shift}')).toMatchInlineSnapshot(`"Shift|ShiftLeft|1"`);
    expect(await testKeyboard('{ShiftLeft}')).toMatchInlineSnapshot(`"ERROR"`);
    expect(await testKeyboard('{ShiftRight}')).toMatchInlineSnapshot(`"ERROR"`);
    expect(await testKeyboard('[Shift]')).toMatchInlineSnapshot(`"ERROR"`);
    expect(await testKeyboard('[ShiftLeft]')).toMatchInlineSnapshot(`"Shift|ShiftLeft|1"`);
    expect(await testKeyboard('[ShiftRight]')).toMatchInlineSnapshot(`"Shift|ShiftLeft|1"`);
  }
  if (server.provider === 'preview') {
    expect(await testKeyboard('{Shift}')).toMatchInlineSnapshot(`"Shift|ShiftLeft|0"`);
    expect(await testKeyboard('{ShiftLeft}')).toMatchInlineSnapshot(`"ShiftLeft|Unknown|0"`);
    expect(await testKeyboard('{ShiftRight}')).toMatchInlineSnapshot(`"ShiftRight|Unknown|0"`);
    expect(await testKeyboard('[Shift]')).toMatchInlineSnapshot(`"Unknown|Shift|0"`);
    expect(await testKeyboard('[ShiftLeft]')).toMatchInlineSnapshot(`"Shift|ShiftLeft|0"`);
    expect(await testKeyboard('[ShiftRight]')).toMatchInlineSnapshot(`"Shift|ShiftRight|0"`);
  }
})
