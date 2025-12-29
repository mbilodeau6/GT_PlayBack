/**
 * API interaction layer for the Catan backend.
 */

const API = {
    baseUrl: 'https://gametest-heb2a9a4b9ecgmht.canadacentral-01.azurewebsites.net',
    apiKey: '',

    configure(baseUrl, apiKey) {
        this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
        this.apiKey = apiKey;
        this.saveConfig();
    },

    saveConfig() {
        localStorage.setItem('catan_api_url', this.baseUrl);
        localStorage.setItem('catan_api_key', this.apiKey);
    },

    loadConfig() {
        const savedUrl = localStorage.getItem('catan_api_url');
        const savedKey = localStorage.getItem('catan_api_key');
        if (savedUrl) this.baseUrl = savedUrl;
        if (savedKey) this.apiKey = savedKey;
    },

    async request(method, endpoint, body = null) {
        const url = `${this.baseUrl}${endpoint}`;
        const headers = {
            'Content-Type': 'application/json'
        };

        if (this.apiKey) {
            headers['x-functions-key'] = this.apiKey;
        }

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

    async createGame(gameType = 'Starter') {
        return this.request('POST', '/api/Games', { gameType });
    },

    async getGame(gameId) {
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

    async undo(gameId, playerId, eventId) {
        return this.request('POST', `/api/Games/${gameId}/undo`, {
            playerId,
            eventId
        });
    }
};

// Load saved configuration on startup
API.loadConfig();
