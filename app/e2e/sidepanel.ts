// sidepanel.ts — shared opener for the IDE side-panel tabs (v1.17.2, THE
// PANEL MENU law): DESKTOP opens the ▤ Panel ▾ dropdown and clicks the
// tab item; PHONE taps the edge-rail chip (which opens the drawer on that
// tab directly). nth() selects the window (the farm co-runs IDEs).
import type { Page } from '@playwright/test';

export async function openSide(page: Page, tab: string, nth = 0,
  prefix = 'xenon'): Promise<void> {
  const rail = page.getByTestId(`${prefix}-rail-${tab}`).nth(nth);
  if (await rail.count()) {
    await rail.click();
    return;
  }
  await page.getByTestId(`${prefix}-side-open`).nth(nth).click();
  await page.getByTestId(`${prefix}-side-${tab}`).click();
}
