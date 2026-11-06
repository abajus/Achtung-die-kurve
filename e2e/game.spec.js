import { test, expect } from '@playwright/test';

async function canvasPixels(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#canvas-container canvas');
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let colored = 0;
    let checksum = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (Math.max(pixels[index], pixels[index + 1], pixels[index + 2]) - Math.min(pixels[index], pixels[index + 1], pixels[index + 2]) > 35) colored++;
      checksum += pixels[index] + pixels[index + 1] + pixels[index + 2];
    }
    return { colored, checksum, overflow: document.documentElement.scrollWidth > innerWidth };
  });
}

test('desktop renders trails, remaps keys, starts, steers, and pauses', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install();
  await page.goto('/');
  await expect(page.locator('#canvas-container canvas')).toBeVisible();
  await page.clock.runFor(700);
  const initial = await canvasPixels(page);
  expect(initial.colored).toBeGreaterThan(1000);
  expect(initial.overflow).toBe(false);
  await expect(page.locator('body>canvas')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Citron left key', exact: true }).click();
  await page.keyboard.press('z');
  await expect(page.getByRole('button', { name: 'Citron left key', exact: true })).toHaveText('Z');
  await page.locator('#add-player').click();
  await expect(page.locator('.player-row')).toHaveCount(3);
  await page.locator('#start-button').click();
  await page.clock.runFor(3500);
  await expect(page.locator('#arena-status')).toContainText('STILL STANDING');
  await expect(page.locator('#speed')).toBeDisabled();
  const before = await canvasPixels(page);
  await page.keyboard.down('z');
  await page.clock.runFor(300);
  await page.keyboard.up('z');
  expect((await canvasPixels(page)).checksum).not.toBe(before.checksum);
  await page.locator('#pause-button').click();
  await expect(page.locator('#overlay-title')).toContainText('Hold that');
  const paused = await canvasPixels(page);
  await page.clock.runFor(1500);
  expect((await canvasPixels(page)).checksum).toBe(paused.checksum);
  await page.locator('#start-button').click();
  await page.clock.runFor(100);
  await expect(page.locator('#arena-overlay')).toBeHidden();
  expect(errors).toEqual([]);
});

test('mobile fits its viewport and supports touch steering', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.clock.install();
  await page.goto('http://127.0.0.1:3100/');
  await expect(page.locator('#canvas-container canvas')).toBeVisible();
  await page.clock.runFor(700);
  expect((await canvasPixels(page)).overflow).toBe(false);
  expect((await canvasPixels(page)).colored).toBeGreaterThan(1000);
  const overflow = await page.locator('#overlay-title').evaluate(element => element.scrollWidth > element.clientWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
  await page.getByRole('combobox', { name: 'Rose type' }).selectOption('hard');
  await page.locator('#start-button').click();
  await page.clock.runFor(3500);
  await expect(page.locator('#touch-controls')).toBeVisible();
  const before = await canvasPixels(page);
  await page.locator('#touch-left').dispatchEvent('pointerdown', { pointerId: 1 });
  await page.clock.runFor(300);
  await page.locator('#touch-left').dispatchEvent('pointerup', { pointerId: 1 });
  expect((await canvasPixels(page)).checksum).not.toBe(before.checksum);
  await context.close();
});

test('two browser clients join a room and receive a synchronized match', async ({ page, browser }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('#online-tab').click();
  await page.locator('#online-name').fill('Host');
  await page.locator('#create-room').click();
  await expect(page.locator('#active-code')).toHaveText(/^[A-Z2-9]{5}$/);
  const code = await page.locator('#active-code').innerText();
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  guest.on('pageerror', error => errors.push(error.message));
  await guest.goto(`http://127.0.0.1:3100/?room=${code}`);
  await guest.locator('#online-name').fill('Guest');
  await guest.locator('#join-room').click();
  await expect(guest.locator('#active-code')).toHaveText(code);
  await expect(page.locator('.player-row')).toHaveCount(2);
  await expect(guest.locator('#start-button')).toBeDisabled();
  await page.locator('#online-bots').selectOption('0');
  await page.locator('#start-button').click();
  await expect(page.locator('#arena-status')).toContainText('STILL STANDING', { timeout: 10000 });
  await expect(guest.locator('#arena-status')).toContainText('STILL STANDING');
  await expect(guest.locator('#speed')).toBeDisabled();
  await guest.keyboard.down('ArrowLeft');
  await expect(guest.locator('#arena-overlay')).toBeHidden();
  await guest.keyboard.up('ArrowLeft');
  await expect(page.locator('#player-list input').first()).toHaveValue('Host');
  await expect(guest.locator('#player-list input').last()).toHaveValue('Guest');
  expect(errors).toEqual([]);
  await guestContext.close();
});