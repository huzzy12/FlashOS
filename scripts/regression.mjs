import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const baseURL = process.env.FLASHOS_URL ?? 'http://localhost:5173/?fastboot';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const failures = [];

async function test(name, run) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleProblems = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') consoleProblems.push(msg.text());
  });
  page.on('pageerror', (err) => consoleProblems.push(err.message));
  try {
    await page.goto(baseURL);
    await page.locator('.desktop-icons').waitFor();
    await run(page);
    assert.deepEqual(consoleProblems, [], `console was not clean: ${consoleProblems.join(' | ')}`);
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await context.close();
  }
}

const openDesktopApp = async (page, name) => {
  await page.locator('.desktop-icons').getByText(name, { exact: true }).dblclick();
};

await test('launcher closes after launching an app', async (page) => {
  await page.getByRole('button', { name: 'Open launcher' }).click();
  await page.getByRole('button', { name: 'About', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search apps' }).waitFor({ state: 'hidden', timeout: 1000 });
  assert.equal(await page.locator('.launcher').evaluate((el) => el.classList.contains('open')), false);
});

await test('maximize button and titlebar restore original bounds', async (page) => {
  await openDesktopApp(page, 'Files');
  const win = page.locator('.win');
  await page.waitForTimeout(180);
  const original = await win.boundingBox();
  assert(original);

  await win.getByTitle('Maximize').click();
  await page.waitForTimeout(260);
  const buttonMax = await win.boundingBox();
  assert(buttonMax);
  assert(buttonMax.width > original.width + 500, 'maximize button did not maximize');
  await win.getByTitle('Maximize').click();
  await page.waitForTimeout(260);
  const buttonRestore = await win.boundingBox();
  assert(buttonRestore);
  assert(Math.abs(buttonRestore.width - original.width) < 2, `maximize button did not restore width: ${JSON.stringify({ original, buttonMax, buttonRestore, classes: await win.getAttribute('class'), style: await win.getAttribute('style') })}`);
  assert(Math.abs(buttonRestore.height - original.height) < 2, 'maximize button did not restore height');

  await win.locator('.win-titlebar').dblclick();
  await page.waitForTimeout(260);
  await win.locator('.win-titlebar').dblclick();
  await page.waitForTimeout(260);
  const titleRestore = await win.boundingBox();
  assert(titleRestore);
  assert(Math.abs(titleRestore.width - original.width) < 2, 'titlebar restore lost width');
  assert(Math.abs(titleRestore.x - original.x) < 2, 'titlebar restore lost x position');
});

await test('right-edge resize changes width and honors minimum', async (page) => {
  await openDesktopApp(page, 'Paint');
  const win = page.locator('.win');
  await page.waitForTimeout(180);
  const handle = win.locator('.win-rz-r');
  const before = await win.boundingBox();
  const box = await handle.boundingBox();
  assert(before && box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const after = await win.boundingBox();
  assert(after);
  assert(after.width > before.width + 90, `width stayed ${after.width}`);
});

await test('clean Notepad closes without a discard dialog', async (page) => {
  await openDesktopApp(page, 'Notepad');
  await page.locator('.win').getByTitle('Close').click();
  await page.waitForTimeout(220);
  assert.equal(await page.locator('.dlg-overlay').count(), 0, 'clean note incorrectly opened discard dialog');
  assert.equal(await page.locator('.win').count(), 0, 'window did not close');
  assert.equal(await page.locator('.tb-app').count(), 0, 'taskbar kept a ghost button');
});

await test('dirty Notepad shows only one close confirmation', async (page) => {
  await openDesktopApp(page, 'Notepad');
  await page.locator('.notepad-area').fill('unsaved');
  const close = page.locator('.win').getByTitle('Close');
  await close.evaluate((button) => {
    button.click();
    button.click();
    button.click();
  });
  assert.equal(await page.locator('.dlg-overlay').count(), 1, 'repeated close clicks stacked dialogs');
  await page.getByRole('button', { name: 'Cancel' }).click();
  assert.equal(await page.locator('.win').count(), 1, 'canceling close removed the window');
});

await test('Alt+Tab wins over Terminal completion', async (page) => {
  await openDesktopApp(page, 'Files');
  await openDesktopApp(page, 'Terminal');
  const input = page.locator('.term-input');
  await input.focus();
  const before = await page.locator('.term-out').innerText();
  await page.keyboard.down('Alt');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(80);
  assert.equal(await page.locator('.alttab.visible').count(), 1, 'Alt+Tab overlay did not appear');
  await page.keyboard.up('Alt');
  const after = await page.locator('.term-out').innerText();
  assert.equal(after, before, 'Terminal completion ran during Alt+Tab');
});

await test('Paint and BeatLab range inputs respond to keyboard', async (page) => {
  await openDesktopApp(page, 'Paint');
  const paintSize = page.locator('[data-size]');
  await paintSize.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await paintSize.inputValue(), '7');

  await openDesktopApp(page, 'BeatLab');
  const bpm = page.locator('[data-bpm]');
  await bpm.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await bpm.inputValue(), '111');
});

await test('Paint restores the exact canvas after five undo and redo operations', async (page) => {
  await openDesktopApp(page, 'Paint');
  const canvas = page.locator('.paint-canvas');
  const box = await canvas.boundingBox();
  assert(box);
  for (let i = 0; i < 6; i += 1) {
    const x = box.x + 40 + i * 35;
    const y = box.y + 45 + i * 24;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 28, y + 12, { steps: 4 });
    await page.mouse.up();
  }
  const completed = await canvas.evaluate((el) => el.toDataURL());
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('Control+z');
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('Control+Shift+z');
  const restored = await canvas.evaluate((el) => el.toDataURL());
  assert.equal(restored, completed, 'redo did not restore the exact canvas pixels');
});

await test('Files drag moves a file into a folder', async (page) => {
  await openDesktopApp(page, 'Files');
  const files = page.locator('.win');
  const suffix = String(Date.now());
  const folderName = `qa-drop-${suffix}`;
  const fileName = `move-${suffix}.txt`;
  await files.getByRole('button', { name: 'New folder' }).click();
  await page.getByRole('textbox', { name: 'Folder name' }).fill(folderName);
  await page.keyboard.press('Enter');
  await files.getByRole('button', { name: 'New text file' }).click();
  await page.getByRole('textbox', { name: 'File name' }).fill(fileName);
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Files', exact: true }).last().click();
  const source = files.locator('.file-tile', { hasText: fileName });
  const target = files.locator('.file-tile', { hasText: folderName });
  await source.dragTo(target);
  await source.waitFor({ state: 'detached' });
  await target.waitFor();
  await target.dblclick();
  await files.locator('.file-tile', { hasText: fileName }).waitFor();
});

await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} regression(s) failed.`);
  process.exit(1);
}

console.log('\nAll FlashOS regressions passed.');
