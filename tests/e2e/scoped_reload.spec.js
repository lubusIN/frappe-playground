const { test, expect } = require('@playwright/test');

test('iframe and main page reload keep the same scoped runtime', async ({ page, browserName }) => {
    test.skip(
        browserName === 'webkit',
        'Playwright WebKit blocks the module worker reload path under COEP even though real Safari allows it.'
    );

    test.setTimeout(600000);

    page.on('console', msg => console.log(`[PAGE] ${msg.type()}: ${msg.text()}`));

    await page.goto('/');
    await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 600000 });

    const firstInstanceId = await page.evaluate(() => localStorage.getItem('frappe_playground_instance_id'));
    const iframe = page.locator('#frappe-desk');

    // Wait for the iframe to be fully loaded and visible
    await expect(iframe).toBeVisible({ timeout: 120000 });
    
    // The instance id should be preserved and the scope should remain identical
    await expect(iframe).toHaveAttribute('src', `/scope:${firstInstanceId}/`);

    const scopedPage = await page.context().newPage();
    const scopedResponse = await scopedPage.goto(`/scope:${firstInstanceId}/`);
    expect(scopedResponse.status()).toBe(200);
    // The backend route remains scoped, while the injected bootstrap hides the
    // virtual scope from the document's visible address.
    expect(new URL(scopedPage.url()).pathname).toBe('/');
    await scopedPage.close();

    const frame = await iframe.elementHandle();
    const contentFrame = await frame.contentFrame();
    console.log('Reloading iframe...');
    await contentFrame.evaluate(() => location.reload());
    console.log('Iframe reloaded! Checking src...');
    await expect(iframe).toHaveAttribute('src', `/scope:${firstInstanceId}/`);

    console.log('Waiting 2s for iframe reload to settle...');
    await page.waitForTimeout(2000);

    console.log('Reloading main page...');
    await page.goto('/');
    console.log('Main page reloaded! Waiting for loading screen to be hidden...');
    await expect(page.locator('#loading-screen')).toBeHidden({ timeout: 600000 });
    console.log('Loading screen hidden!');

    const reloadedInstanceId = await page.evaluate(() => localStorage.getItem('frappe_playground_instance_id'));
    await expect(page.locator('#frappe-desk')).toHaveAttribute('src', `/scope:${firstInstanceId}/`);
    expect(reloadedInstanceId).toBe(firstInstanceId);

    console.log('Closing the playground tab and revisiting in a new tab...');
    const context = page.context();
    await page.close();
    const revisitedPage = await context.newPage();
    revisitedPage.on('console', msg => console.log(`[REVISIT] ${msg.type()}: ${msg.text()}`));
    await revisitedPage.goto('/');
    await expect(revisitedPage.locator('#loading-screen')).toBeHidden({ timeout: 600000 });
    await expect(revisitedPage.locator('#frappe-desk')).toBeVisible({ timeout: 120000 });
    expect(
        await revisitedPage.evaluate(() => localStorage.getItem('frappe_playground_instance_id'))
    ).toBe(firstInstanceId);
});
