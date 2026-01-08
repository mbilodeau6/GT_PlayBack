/**
 * API interaction layer for the Catan backend.
 *
 * In production (Azure Static Web App): calls go through /api/proxy which adds the API key
 * In local development (localhost): calls go directly to the local backend (no key needed)
 */

const API = {
    // Default to production Azure backend
    backendUrl: 'https://gametest-heb2a9a4b9ecgmht.canadacentral-01.azurewebsites.net',

    // Local development backend (Azure Functions running locally)
    localBackendUrl: 'http://localhost:7071',

    // Check if running locally (Live Server, etc.)
    isLocal() {
        const host = window.location.hostname;
        return host === 'localhost' || host === '127.0.0.1';
    },

    // Get the appropriate base URL for API calls
    getBaseUrl() {
        if (this.isLocal()) {
            // Local dev: call local backend directly
            return this.localBackendUrl;
        }
        // Production: use the proxy (same origin, API key added server-side)
        return '';
    },

    configure(backendUrl) {
        this.backendUrl = backendUrl.replace(/\/$/, ''); // Remove trailing slash
        this.saveConfig();
    },

    saveConfig() {
        localStorage.setItem('catan_backend_url', this.backendUrl);
    },

    loadConfig() {
        const savedUrl = localStorage.getItem('catan_backend_url');
        if (savedUrl) this.backendUrl = savedUrl;

        // Migrate old config format (remove apiKey from localStorage)
        localStorage.removeItem('catan_api_key');
        const oldUrl = localStorage.getItem('catan_api_url');
        if (oldUrl) {
            localStorage.removeItem('catan_api_url');
            // Don't migrate the old URL - let it use the new default
        }
    },

    async request(method, endpoint, body = null) {
        const baseUrl = this.getBaseUrl();
        const url = `${baseUrl}${endpoint}`;
        const headers = {
            'Content-Type': 'application/json'
        };

        // No API key header needed - handled by proxy in production, not needed locally

        const options = {
            method,
            headers
        };

        if (body) {
            options.body = JSON.stringify(body);
        }

        try {
            console.log(`API ${method} ${endpoint}`, body || '');
            const response = await fetch(url, options);

            // Check for HTTP errors before parsing JSON
            if (!response.ok) {
                if (response.status === 401) {
                    return {
                        success: false,
                        errorCode: 401,
                        errorMessage: 'Unauthorized - authentication failed'
                    };
                }
                if (response.status === 403) {
                    return {
                        success: false,
                        errorCode: 403,
                        errorMessage: 'Forbidden - access denied'
                    };
                }
                if (response.status === 404) {
                    return {
                        success: false,
                        errorCode: 404,
                        errorMessage: 'Not found - the requested resource does not exist'
                    };
                }
                // For other HTTP errors, try to get error details from response body
                try {
                    const errorData = await response.json();
                    return errorData;
                } catch {
                    return {
                        success: false,
                        errorCode: response.status,
                        errorMessage: `HTTP ${response.status}: ${response.statusText}`
                    };
                }
            }

            const data = await response.json();
            console.log('API Response:', data);
            return data;
        } catch (error) {
            console.error('API request failed:', error);
            return {
                success: false,
                errorCode: -1,
                errorMessage: error.message
            };
        }
    },

    // ==================== GAMES ====================

    async createGame(gameType, playerToken) {
        return this.request('POST', '/api/Games', { gameType, playerToken });
    },

    async getGame(gameId, playerId = null) {
        // Use POST with playerId in body (encrypted with TLS) when playing as a player
        // Use GET without body for replay/viewer mode
        if (playerId) {
            return this.request('POST', `/api/Games/${gameId}`, { playerId });
        }
        return this.request('GET', `/api/Games/${gameId}`);
    },

    async getGameSummary(gameId) {
        return this.request('GET', `/api/Games/${gameId}/Summary`);
    },

    async startGame(gameId) {
        return this.request('POST', `/api/Games/${gameId}/start`);
    },

    // ==================== PLAYERS ====================

    async addPlayer(gameId, playerName, isBot = false, preferredColor = null) {
        const body = { playerName, isBot };
        if (preferredColor) {
            body.preferredColor = preferredColor;
        }
        return this.request('POST', `/api/Games/${gameId}/players`, body);
    },

    async removePlayer(gameId, playerId) {
        return this.request('DELETE', `/api/Games/${gameId}/Players/${playerId}`);
    },

    // ==================== GAME FLOW ====================

    async rollDice(gameId) {
        return this.request('POST', `/api/Games/${gameId}/roll`);
    },

    async endTurn(gameId) {
        return this.request('POST', `/api/Games/${gameId}/end-turn`);
    },

    async runBots(gameId) {
        return this.request('POST', `/api/Games/${gameId}/Run`);
    },

    // ==================== BUILDING ====================

    async buildSettlement(gameId, playerId, vertexId) {
        return this.request('POST', `/api/Games/${gameId}/build/settlement`, {
            playerId,
            vertexId
        });
    },

    async buildRoad(gameId, playerId, edgeId) {
        return this.request('POST', `/api/Games/${gameId}/build/road`, {
            playerId,
            edgeId
        });
    },

    async buildCity(gameId, playerId, vertexId) {
        return this.request('POST', `/api/Games/${gameId}/build/city`, {
            playerId,
            vertexId
        });
    },

    // ==================== ROBBER ====================

    async placeRobber(gameId, playerId, tileId) {
        return this.request('POST', `/api/Games/${gameId}/place-robber`, {
            playerId,
            tileId
        });
    },

    async discardCards(gameId, playerId, selectedResources) {
        return this.request('POST', `/api/Games/${gameId}/discard-cards`, {
            playerId,
            selectedResources
        });
    },

    async selectTarget(gameId, playerId, targetPlayerId) {
        return this.request('POST', `/api/Games/${gameId}/select-target`, {
            playerId,
            targetPlayerId
        });
    },

    // ==================== TRADING ====================

    async tradeWithBank(gameId, playerId, offer, request) {
        return this.request('POST', `/api/Games/${gameId}/trades/bank`, {
            playerId,
            offer,
            request
        });
    },

    async openTrade(gameId, playerId, offer, request) {
        return this.request('POST', `/api/Games/${gameId}/trades/open`, {
            playerId,
            offer,
            request
        });
    },

    async respondToTrade(gameId, playerId, responseType, offer = null, request = null) {
        const body = { playerId, responseType };
        if (offer) body.offer = offer;
        if (request) body.request = request;
        return this.request('POST', `/api/Games/${gameId}/trades/respond`, body);
    },

    async acceptTrade(gameId, playerId, acceptedPlayerId) {
        return this.request('POST', `/api/Games/${gameId}/trades/accept`, {
            playerId,
            acceptedPlayerId
        });
    },

    async rejectAllOffers(gameId, playerId) {
        return this.request('POST', `/api/Games/${gameId}/trades/reject-all`, {
            playerId
        });
    },

    // ==================== DEVELOPMENT CARDS ====================

    async buyDevCard(gameId, playerId) {
        return this.request('POST', `/api/Games/${gameId}/dev-card/buy`, {
            playerId
        });
    },

    async playDevCard(gameId, playerId, devCardType, options = {}) {
        const body = { playerId, devCardType, ...options };
        return this.request('POST', `/api/Games/${gameId}/dev-card/play`, body);
    },

    async playKnight(gameId, playerId, tileId) {
        return this.playDevCard(gameId, playerId, 'Knight', { tileId });
    },

    async playRoadBuilding(gameId, playerId) {
        return this.playDevCard(gameId, playerId, 'RoadBuilding');
    },

    async playYearOfPlenty(gameId, playerId, resource1, resource2) {
        return this.playDevCard(gameId, playerId, 'YearOfPlenty', {
            selectedResources: [resource1, resource2]
        });
    },

    async playMonopoly(gameId, playerId, resource) {
        return this.playDevCard(gameId, playerId, 'Monopoly', {
            selectedResources: [resource]
        });
    },

    // ==================== UNDO ====================

    async undo(gameId, playerId) {
        return this.request('POST', `/api/Games/${gameId}/undo`, {
            playerId
        });
    },

    // ==================== TEST CONNECTION ====================

    // Tests the API connection using the current routing (local or proxy)
    // Returns { success: true } if we get a valid API response (even an error)
    // Returns { success: false, errorMessage: ... } for HTTP errors or network errors
    async testConnection() {
        const baseUrl = this.getBaseUrl();
        const url = `${baseUrl}/api/Games/Test`;
        const headers = {
            'Content-Type': 'application/json'
        };

        try {
            const response = await fetch(url, { method: 'GET', headers });

            // Check for HTTP errors
            if (!response.ok) {
                if (response.status === 401) {
                    return {
                        success: false,
                        errorCode: 401,
                        errorMessage: 'Unauthorized - authentication failed'
                    };
                }
                if (response.status === 403) {
                    return {
                        success: false,
                        errorCode: 403,
                        errorMessage: 'Forbidden - access denied'
                    };
                }
                if (response.status === 404 || response.status === 400) {
                    // 404 or 400 for the "Test" game ID is expected - this means the API is working
                    // (400 occurs because "Test" isn't a valid GUID format)
                    return { success: true };
                }
                return {
                    success: false,
                    errorCode: response.status,
                    errorMessage: `HTTP ${response.status}: ${response.statusText}`
                };
            }

            // If we get a valid response (even an application error), the connection works
            return { success: true };
        } catch (error) {
            return {
                success: false,
                errorCode: -1,
                errorMessage: 'Connection failed - backend may not be running'
            };
        }
    }
};

// Load saved configuration on startup
API.loadConfig();
