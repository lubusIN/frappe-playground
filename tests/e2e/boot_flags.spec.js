import { test, expect } from '@playwright/test';
test.describe('Boot Flags (URL Configuration)', () => {
    test('?onboarding=0 completely bypasses the setup wizard', async ({ page }) => {
        // Go directly to a new instance with the skip onboarding flag
        const uniqueName = `BootFlagTest_${Date.now()}`;
        await page.goto(`/?name=${uniqueName}&onboarding=0`);

        // Loading screen should disappear
        await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 600000 });

        // We should land straight into the frappe desk iframe
        const iframe = page.locator('#frappe-desk');
        await expect(iframe).toBeVisible({ timeout: 120000 });

        // Verify the desk URL inside the iframe (it shouldn't be /setup-wizard)
        const frame = page.frameLocator('#frappe-desk');
        // Check for an element unique to the desk, like the navbar or page content
        await expect(frame.locator('.navbar')).toBeVisible({ timeout: 60000 });
        
        // Ensure no IntroDialog is shown
        await expect(page.locator('.intro-dialog')).toBeHidden();
    });

    test('?login=1 auto-logs in but still requires onboarding if not skipped', async ({ page }) => {
        const uniqueName = `BootFlagTest_${Date.now()}`;
        await page.goto(`/?name=${uniqueName}&login=1`);

        // Loading screen should disappear
        await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 600000 });

        // We should land on the setup wizard
        const iframe = page.locator('#frappe-desk');
        await expect(iframe).toBeVisible({ timeout: 120000 });

        const frame = page.frameLocator('#frappe-desk');
        // Setup wizard should be visible
        await expect(frame.locator('.slides-wrapper')).toBeVisible({ timeout: 60000 });
    });

    test('?path redirects to the specified route after boot', async ({ page }) => {
        const uniqueName = `BootFlagTest_${Date.now()}`;
        // Using onboarding=0 so we don't get stuck in setup wizard
        await page.goto(`/?name=${uniqueName}&onboarding=0&path=/app/user`);

        // Loading screen should disappear
        await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 600000 });

        const iframe = page.locator('#frappe-desk');
        await expect(iframe).toBeVisible({ timeout: 120000 });

        const frame = page.frameLocator('#frappe-desk');
        // We should see the User list view instead of the desk
        await expect(frame.locator('.page-title').filter({ hasText: 'User' })).toBeVisible({ timeout: 60000 });
    });
    test('?apps installs without waiting for the dialog catalog request', async ({ page }) => {
        await page.addInitScript(() => {
            if (window !== window.top) return;
            const originalFetch = window.fetch.bind(window);
            window.releaseDialogCatalog = () => { window.fetch = originalFetch; };
            window.fetch = (input, options) => {
                const url = new URL(input instanceof Request ? input.url : input, location.href);
                if (url.pathname === '/apps/catalog.json') return new Promise(() => {});
                return originalFetch(input, options);
            };
        });
        await page.goto(`/?name=BootApp_${Date.now()}&apps=frappe_vault&onboarding=0`);
        await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 600000 });
        await expect(page.locator('#frappe-desk')).toBeVisible();
        await page.evaluate(() => window.releaseDialogCatalog());
        await page.getByRole('button', { name: 'Manage apps' }).click();
        await expect(page.getByTestId('uninstall-app-frappe_vault')).toBeVisible({ timeout: 30000 });
    });
});
