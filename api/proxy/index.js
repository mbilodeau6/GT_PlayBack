/**
 * Azure Function proxy for the Catan backend API.
 * Adds the API key from environment variables and forwards requests to the backend.
 *
 * This runs as part of Azure Static Web Apps managed functions.
 */

module.exports = async function (context, req) {
    const backendUrl = process.env.BACKEND_URL || 'https://gametest-heb2a9a4b9ecgmht.canadacentral-01.azurewebsites.net';
    const apiKey = process.env.BACKEND_API_KEY;

    // Azure SWA passes the original URL in x-ms-original-url header when rewriting
    // Fall back to req.url if header not present
    const originalUrl = req.headers['x-ms-original-url'] || req.url;

    // Extract the API path (everything after /api)
    // Original URL will be like https://domain/api/Games/xxx
    let apiPath = '';
    try {
        const url = new URL(originalUrl, 'https://placeholder.com');
        apiPath = url.pathname.replace(/^\/api/, '');
    } catch {
        // Fallback: try to extract from req.url
        apiPath = req.url.replace(/^\/api\/proxy/, '').replace(/^\/api/, '');
    }

    // Health check endpoint - direct call to /api/proxy
    if (!apiPath || apiPath === '/' || apiPath === '/proxy') {
        context.res = {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: { status: 'ok', version: '2025-01-06-v2', proxy: true }
        };
        return;
    }

    // Build the backend URL
    const targetUrl = `${backendUrl}/api${apiPath}`;

    // Prepare headers - forward content-type, add API key
    const headers = {
        'Content-Type': 'application/json'
    };

    if (apiKey) {
        headers['x-functions-key'] = apiKey;
    }

    // Prepare fetch options
    const fetchOptions = {
        method: req.method,
        headers
    };

    // Forward body for POST/PUT/PATCH/DELETE
    if (req.body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        fetchOptions.body = JSON.stringify(req.body);
    }

    try {
        context.log(`Proxy: ${req.method} ${targetUrl}`);
        const response = await fetch(targetUrl, fetchOptions);

        // Get response body
        let responseBody;
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            responseBody = await response.json();
        } else {
            responseBody = await response.text();
        }

        context.res = {
            status: response.status,
            headers: {
                'Content-Type': contentType || 'application/json'
            },
            body: responseBody
        };
    } catch (error) {
        context.log.error('Proxy error:', error);
        context.res = {
            status: 502,
            headers: {
                'Content-Type': 'application/json'
            },
            body: {
                success: false,
                errorCode: 502,
                errorMessage: 'Backend unavailable'
            }
        };
    }
};
