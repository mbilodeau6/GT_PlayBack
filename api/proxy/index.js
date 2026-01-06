/**
 * Azure Function proxy for the Catan backend API.
 * Adds the API key from environment variables and forwards requests to the backend.
 *
 * This runs as part of Azure Static Web Apps managed functions.
 */

module.exports = async function (context, req) {
    const backendUrl = process.env.BACKEND_URL || 'https://gametest-heb2a9a4b9ecgmht.canadacentral-01.azurewebsites.net';
    const apiKey = process.env.BACKEND_API_KEY;

    // Get the path after /api/proxy
    // After rewrite, URL will be like /api/proxy/Games/xxx
    // We need to extract /Games/xxx to forward to backend
    const originalUrl = req.url;
    const apiPath = originalUrl.replace(/^\/api\/proxy/, '');

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
