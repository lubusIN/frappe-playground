const { test, expect } = require('@playwright/test');
const { bootLoginAndReachDesk, getFrappeFrame } = require('./helpers/frappeFlow');

// Frappe assumes it owns the origin root, so the playground re-adds /scope:<id>/
// via a bootstrap script that patches fetch, XMLHttpRequest, window.open and
// target=_blank links. Every new Frappe UI pattern is a chance for a request to
// slip past that patching and hit the origin root unscoped.
//
// This test does not try to fix escapes. It makes them visible: it exercises
// Desk and fails with an inventory of any backend request that left its scope.
// That inventory is the evidence for upstream issue 7 (application base path).

test('no Frappe backend request escapes its scope to the origin root', async ({ page, browserName }) => {
    test.skip(
        browserName === 'webkit',
        'WebKit blocks the module worker path under COEP; scope routing is covered on Chromium.'
    );
    test.setTimeout(600000);

    // Reuse the service worker's own path classification so this test cannot
    // drift from the routing rules it is policing.
    const { isStaticPath, isDevelopmentPath, isShellStaticPath } =
        await import('../../packages/service-worker/src/routing.js');

    const escapes = [];
    const origin = new URL(page.context()._options?.baseURL || 'http://127.0.0.1:8002').origin;

    page.on('request', request => {
        let url;
        try {
            url = new URL(request.url());
        } catch (_) {
            return;
        }
        if (url.origin !== origin) return;

        const { pathname } = url;
        if (pathname.startsWith('/scope:')) return;          // correctly scoped
        if (pathname === '/' || pathname === '') return;      // the shell itself
        if (isShellStaticPath(pathname)) return;              // shell assets
        if (isStaticPath(pathname)) return;                   // shared immutable assets
        if (isDevelopmentPath(pathname)) return;              // vite dev only
        if (pathname.startsWith('/socket.io/')) return;        // handled at origin root by design

        escapes.push({
            method: request.method(),
            path: pathname + url.search,
            frame: request.frame() === page.mainFrame() ? 'main' : 'iframe',
            initiator: request.resourceType(),
        });
    });

    await bootLoginAndReachDesk(page);

    // Exercise routes that historically generate root-relative URLs: a list
    // view, a form view, and an API round trip issued by Frappe's own client.
    const frame = await getFrappeFrame(page);
    for (const route of ['/app/todo', '/app/user', '/app/todo/new']) {
        await frame.evaluate(target => {
            if (window.frappe?.set_route) return window.frappe.set_route(target.replace(/^\/app/, ''));
            return location.assign(target);
        }, route).catch(() => {});
        await page.waitForTimeout(3000);
    }

    await frame.evaluate(() => window.frappe?.call?.({ method: 'frappe.client.get_count', args: { doctype: 'ToDo' } }))
        .catch(() => {});
    await page.waitForTimeout(3000);

    if (escapes.length) {
        const inventory = escapes
            .map(e => `  ${e.frame.padEnd(6)} ${e.method.padEnd(5)} ${e.initiator.padEnd(10)} ${e.path}`)
            .join('\n');
        console.log(`\nScope escapes detected (${escapes.length}):\n${inventory}\n`);
    }

    expect(
        escapes,
        `Backend requests escaped their scope to the origin root. Each one is a URL that `
        + `Frappe emitted root-relative and the bootstrap script failed to rewrite:\n`
        + escapes.map(e => `  ${e.method} ${e.path} (${e.initiator}, ${e.frame})`).join('\n')
    ).toEqual([]);
});
