const { test, expect } = require('@playwright/test');
const path = require('path');

test('Frappe Setup Wizard Completion', async ({ page }) => {
    test.setTimeout(120000); // 2 minutes

    console.log("Navigating to /");
    await page.goto('/');
    const loadingScreen = page.locator('#loading-screen');
    await expect(loadingScreen).toBeHidden({ timeout: 60000 });

    const iframe = page.frameLocator('#frappe-desk');

    // Wait for the login form to appear
    console.log("Logging in...");
    await expect(iframe.locator('#login_email')).toBeVisible({ timeout: 30000 });
    
    // Fill in credentials
    await iframe.locator('#login_email').fill('Administrator');
    await iframe.locator('#login_password').fill('admin');
    
    // Click login
    await iframe.locator('.btn-login').click();

    // Verify the login button disappears
    console.log("Waiting for login to complete...");
    await expect(iframe.locator('.btn-login')).toBeHidden({ timeout: 30000 });

    // We should be redirected to the Setup Wizard
    // Wait for the Setup Wizard language selection
    console.log("Waiting for Setup Wizard to start...");
    await expect(iframe.locator('.setup-wizard-slide.active')).toBeVisible({ timeout: 30000 });
    
    // Slide 1: Language
    console.log("Slide 1: Language");
    await iframe.locator('button[data-action="next_slide"]').click();

    // Slide 2: Region
    console.log("Slide 2: Region");
    await expect(iframe.locator('select[data-fieldname="country"]')).toBeVisible({ timeout: 10000 });
    await iframe.locator('select[data-fieldname="country"]').selectOption('United States');
    await page.waitForTimeout(1000); // Wait for timezone to auto-populate
    await iframe.locator('button[data-action="next_slide"]').click();

    // Slide 3: User
    console.log("Slide 3: User");
    await expect(iframe.locator('input[data-fieldname="full_name"]')).toBeVisible({ timeout: 10000 });
    await iframe.locator('input[data-fieldname="full_name"]').fill('Test User');
    await iframe.locator('input[data-fieldname="email"]').fill('test@example.com');
    await iframe.locator('input[data-fieldname="password"]').fill('admin');
    await iframe.locator('button[data-action="next_slide"]').click();

    // Slide 4: Organization
    console.log("Slide 4: Organization");
    await expect(iframe.locator('input[data-fieldname="company_name"]')).toBeVisible({ timeout: 10000 });
    await iframe.locator('input[data-fieldname="company_name"]').fill('Test Company');
    await iframe.locator('select[data-fieldname="industry"]').selectOption('Technology');
    await iframe.locator('button[data-action="complete_setup"]').click();

    // Now wait for the setup to complete
    console.log("Waiting for Setup to complete... This takes a while.");
    await expect(iframe.locator('.setup-wizard-slide')).toBeHidden({ timeout: 60000 });

    console.log("Setup complete! Reloading page to test persistence...");
    await page.reload();

    const loadingScreen2 = page.locator('#loading-screen');
    await expect(loadingScreen2).toBeHidden({ timeout: 60000 });

    // After reload, we should be on the desk, not the setup wizard!
    console.log("Verifying we are on the desk...");
    await expect(iframe.locator('.setup-wizard-slide')).toBeHidden({ timeout: 10000 });
    await expect(iframe.locator('body.desk-body')).toBeVisible({ timeout: 30000 });

    console.log("Success! Setup Wizard survived reload.");
});
