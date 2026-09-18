// Fail fast when the base URL is not actually the playground.
//
// playwright.config.js sets reuseExistingServer, which only checks that
// *something* answers on the port. The Frappe devcontainer forwards ports
// 8000-8005 and 9000-9005 to the host, and its bench server answers every path
// with the SPA index.html — including /sw.js. Reusing it runs the whole suite
// against the wrong application, where every test fails with a confusing
// "#frappe-desk element(s) not found" instead of naming the real problem.
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8102';

module.exports = async () => {
    let response;
    try {
        response = await fetch(new URL('/sw.js', BASE_URL));
    } catch (error) {
        throw new Error(
            `Could not reach the playground preview at ${BASE_URL}: ${error.message}\n`
            + 'Build it first with `npm run build`.'
        );
    }

    const body = await response.text();
    const contentType = response.headers.get('content-type') || '';
    const looksLikeHtml = contentType.includes('text/html') || /^\s*<(!doctype|html)/i.test(body);

    if (!response.ok || looksLikeHtml) {
        throw new Error(
            `${BASE_URL} is serving something other than the Frappe Playground.\n`
            + `GET /sw.js returned ${response.status} ${contentType || '(no content-type)'}, `
            + `which looks like ${looksLikeHtml ? 'an HTML page' : 'an error'} rather than the service worker.\n\n`
            + 'Another server is almost certainly holding the port. The Frappe devcontainer\n'
            + 'forwards 8000-8005 and 9000-9005 to the host, and its bench server answers\n'
            + 'every path with index.html.\n\n'
            + `Free the port, or point the suite elsewhere with PLAYWRIGHT_BASE_URL.`
        );
    }
};
