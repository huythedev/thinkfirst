import { expect, test } from '@playwright/test';
import { createSession, createStudent } from './fixtures';

/**
 * Phase 9's responsive criterion, and the parts of section 40 a browser can
 * actually decide.
 *
 * The ledger has carried this row as partial with the evidence "Tailwind
 * responsive utilities throughout; not tested at breakpoints", which is an
 * honest way of saying nobody looked. Responsive utilities in the source prove
 * that someone intended a mobile layout, not that one renders. These checks run
 * at a phone viewport and at a desktop viewport and assert properties that fail
 * loudly when a layout breaks: no horizontal overflow, the primary control
 * reachable, and the skip link focusable.
 */

const PHONE = { width: 412, height: 915 };
const DESKTOP = { width: 1440, height: 900 };

test.describe('responsive and accessibility basics', () => {
  test('the sign-in page does not overflow horizontally at either size', async ({ page }) => {
    for (const viewport of [PHONE, DESKTOP]) {
      await page.setViewportSize(viewport);
      await page.goto('/sign-in');
      await page.waitForLoadState('domcontentloaded');

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      // A couple of pixels of rounding is tolerable; a broken layout is not.
      expect(overflow, `horizontal overflow at ${viewport.width}px`).toBeLessThanOrEqual(2);
    }
  });

  test('the learning workspace is usable at a phone viewport', async ({
    context,
    page,
    baseURL,
  }) => {
    const student = await createStudent(context, baseURL!, { grade: 9 });
    const sessionId = await createSession(student.uid);

    await page.setViewportSize(PHONE);
    await page.goto(`/student/session/${sessionId}`);

    const composer = page.getByLabel('Your message to the tutor');
    await expect(composer).toBeVisible();

    // The composer must be inside the viewport, not pushed off the side.
    const box = await composer.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(PHONE.width + 2);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(2);
  });

  test('the skip link is the first focusable element and becomes visible on focus', async ({
    context,
    page,
    baseURL,
  }) => {
    await createStudent(context, baseURL!, { grade: 9 });

    await page.setViewportSize(DESKTOP);
    await page.goto('/student');
    await page.waitForLoadState('domcontentloaded');

    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        text: element.textContent?.trim() ?? '',
        href: element.getAttribute('href') ?? '',
        visible: rect.width > 0 && rect.height > 0,
      };
    });

    expect(focused).not.toBeNull();
    expect(focused!.text.toLowerCase()).toContain('skip to main content');
    expect(focused!.href).toBe('#main-content');
    // sr-only until focused, then visible: an invisible skip link is no link.
    expect(focused!.visible).toBe(true);
  });

  test('the workspace exposes a live region so screen readers hear the tutor reply', async ({
    context,
    page,
    baseURL,
  }) => {
    const student = await createStudent(context, baseURL!, { grade: 9 });
    const sessionId = await createSession(student.uid);

    await page.goto(`/student/session/${sessionId}`);

    // Section 40: "Screen-reader announcements for AI response loading and
    // completion." A `log` region is the mechanism, so its absence is a real
    // accessibility defect rather than a stylistic preference.
    const log = page.getByRole('log', { name: /conversation with your tutor/i });
    await expect(log).toBeVisible();
    await expect(log).toHaveAttribute('aria-live', /polite|assertive/);
  });
});
