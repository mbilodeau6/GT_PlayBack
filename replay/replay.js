/**
 * Replay application controller.
 * Loads a game and allows stepping through the event record.
 */

const Replay = {
    gameData: null,
    currentEventIndex: -1, // -1 means "before any events" (empty board)

    // Computed board state at current event index
    currentBoardState: null,

    // Track the highlighted piece from the current event
    highlightedPiece: null, // { type: 'road'|'settlement'|'city'|'robber', id: string }

    // Track player resources at current event (starts at zero)
    playerResources: {}, // playerId -> { Brick: n, Wood: n, ... }
    resourceDeltas: {},  // playerId -> { Brick: +/-n, Wood: +/-n, ... } for current event

    // Track player development cards
    // Each card is { type: 'Knight'|'VictoryPoint'|'RoadBuilding'|'YearOfPlenty'|'Monopoly', played: boolean }
    playerDevCards: {}, // playerId -> array of card objects

    // Track special achievements
    largestArmyPlayerId: null,
    longestRoadPlayerId: null,

    // Track last dice roll (supports both old format with total and new format with individual dice)
    lastDiceRoll: null, // { total: n } or { die1: n, die2: n }

    // Track player lineup order from InitialSetUp event
    playerLineup: null, // array of player IDs in turn order

    // Track the first "real" event index (first PlaceFirstSettlement)
    firstRealEventIndex: 0,

    // Track undone events (from Undo actions)
    undoneEventIds: new Set(),    // Event IDs that were undone
    undoEventIndices: new Set(),  // Indices of Undo events themselves

    // Zoom state
    zoomLevel: 1.0,
    minZoom: 0.5,
    maxZoom: 2.5,
    zoomStep: 0.25,

    init() {
        // Initialize board
        const svgElement = document.getElementById('board');
        Board.init(svgElement);

        this.bindEventHandlers();
        this.updateSettingsUI();
    },

    bindEventHandlers() {
        // Load game
        document.getElementById('btn-load-game').addEventListener('click', () => this.loadGame());
        document.getElementById('game-id-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.loadGame();
        });

        // Zoom controls
        document.getElementById('btn-zoom-in').addEventListener('click', () => this.zoom(this.zoomStep));
        document.getElementById('btn-zoom-out').addEventListener('click', () => this.zoom(-this.zoomStep));
        document.getElementById('btn-zoom-reset').addEventListener('click', () => this.resetZoom());
        document.getElementById('board-container').addEventListener('wheel', (e) => {
            e.preventDefault();
            this.zoom(e.deltaY > 0 ? -this.zoomStep : this.zoomStep);
        });

        // Settings modal
        document.getElementById('btn-settings').addEventListener('click', () => this.openSettings());
        document.getElementById('btn-cancel-settings').addEventListener('click', () => this.closeSettings());

        // Error modal
        document.getElementById('btn-close-error').addEventListener('click', () => this.closeError());

        // Playback controls
        document.getElementById('btn-restart').addEventListener('click', () => this.restart());
        document.getElementById('btn-step-back').addEventListener('click', () => this.stepBack());
        document.getElementById('btn-step-forward').addEventListener('click', () => this.stepForward());
        document.getElementById('btn-play-pause').addEventListener('click', () => this.togglePlayPause());
    },

    // ==================== ZOOM ====================

    zoom(delta) {
        this.zoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoomLevel + delta));
        this.applyZoom();
    },

    resetZoom() {
        this.zoomLevel = 1.0;
        this.applyZoom();
    },

    applyZoom() {
        document.getElementById('board').style.transform = `scale(${this.zoomLevel})`;
        document.getElementById('zoom-level').textContent = `${Math.round(this.zoomLevel * 100)}%`;
    },

    // ==================== SETTINGS ====================

    openSettings() {
        document.getElementById('settings-modal').classList.remove('hidden');
    },

    closeSettings() {
        document.getElementById('settings-modal').classList.add('hidden');
    },

    // ==================== ERROR MODAL ====================

    showError(message) {
        document.getElementById('error-message').textContent = message;
        document.getElementById('error-modal').classList.remove('hidden');
    },

    closeError() {
        document.getElementById('error-modal').classList.add('hidden');
    },

    // ==================== GAME LOADING ====================

    async loadGame() {
        const gameId = document.getElementById('game-id-input').value.trim();
        if (!gameId) {
            this.showError('Please enter a Game ID');
            return;
        }

        try {
            const response = await API.getGame(gameId);
            if (response.success) {
                this.gameData = response.gameState;
                // Scan for undone events first
                this.scanForUndoneEvents();
                // Find the first real event (first PlaceFirstSettlement)
                this.firstRealEventIndex = this.findFirstRealEventIndex();
                // Auto-advance to the first real event
                this.currentEventIndex = this.firstRealEventIndex;
                this.renderInitialState();
                this.enablePlaybackControls();
            } else {
                this.showError(response.errorMessage || 'Failed to load game');
            }
        } catch (e) {
            this.showError('Failed to load game: ' + e.message);
            console.error(e);
        }
    },

    renderInitialState() {
        // Render empty board with just tiles (no pieces yet)
        this.renderBoard();
        this.renderPlayers();
        this.renderEventsList();
        this.renderEventDetail();
        this.updatePlaybackPosition();
    },

    enablePlaybackControls() {
        const hasEvents = this.gameData?.eventRecord?.length > 0;
        document.getElementById('btn-step-forward').disabled = !hasEvents;
        document.getElementById('btn-play-pause').disabled = !hasEvents;
        // Step back and restart disabled at start (at first real event)
        const atStart = this.currentEventIndex <= this.firstRealEventIndex;
        document.getElementById('btn-step-back').disabled = atStart;
        document.getElementById('btn-restart').disabled = atStart;
    },

    // ==================== RENDERING ====================

    renderBoard() {
        if (!this.gameData) return;

        // Build the board state up to the current event
        this.currentBoardState = this.buildBoardState(this.currentEventIndex);
        Board.render(this.currentBoardState);

        // Apply highlighting to the piece from the current event
        this.applyHighlight();

        // Update dice display
        this.renderDice();
    },

    renderDice() {
        const diceDisplay = document.getElementById('dice-display');
        const dice1 = document.getElementById('dice-1');
        const dice2 = document.getElementById('dice-2');

        if (this.lastDiceRoll !== null) {
            if (this.lastDiceRoll.die1 !== undefined && this.lastDiceRoll.die2 !== undefined) {
                // New format: show two separate dice
                dice1.textContent = this.lastDiceRoll.die1;
                dice2.textContent = this.lastDiceRoll.die2;
                dice2.classList.remove('hidden');
            } else {
                // Old format: show single die with total
                dice1.textContent = this.lastDiceRoll.total;
                dice2.classList.add('hidden');
            }
            diceDisplay.classList.remove('hidden');
        } else {
            diceDisplay.classList.add('hidden');
        }
    },

    // Build board state by replaying events up to the given index
    buildBoardState(upToIndex) {
        // Start with a copy of the base game data (tiles, ports, players, etc.)
        // but with empty pieces (no roads, settlements, cities)
        const state = {
            ...this.gameData,
            edges: this.gameData.edges.map(e => ({ ...e, playerId: undefined })),
            vertices: this.gameData.vertices.map(v => ({
                ...v,
                building: v.building === 'Blocked' ? 'Blocked' : undefined,
                playerId: undefined
            })),
            robberTileId: null // Robber position comes from PlaceRobber event
        };

        // Clear the highlight, dice roll, achievements, and player lineup
        this.highlightedPiece = null;
        this.lastDiceRoll = null;
        this.largestArmyPlayerId = null;
        this.longestRoadPlayerId = null;
        this.playerLineup = null;

        // Initialize all player resources to zero and dev cards to empty
        this.playerResources = {};
        this.resourceDeltas = {};
        this.playerDevCards = {};
        const resourceTypes = ['Brick', 'Wood', 'Ore', 'Grain', 'Wool'];
        this.gameData.players.forEach(p => {
            this.playerResources[p.id] = {};
            this.resourceDeltas[p.id] = {};
            this.playerDevCards[p.id] = [];
            resourceTypes.forEach(r => {
                this.playerResources[p.id][r] = 0;
                this.resourceDeltas[p.id][r] = 0;
            });
        });

        // Replay events up to and including upToIndex
        const events = this.gameData.eventRecord || [];
        for (let i = 0; i <= upToIndex && i < events.length; i++) {
            const event = events[i];
            this.currentBuildIndex = i; // Track current index for isRoadBuildingRoad

            // Skip undone events and Undo events - don't apply their state changes
            if (this.isEventSkipped(i)) {
                continue;
            }

            this.applyEvent(state, event, i === upToIndex);
        }

        return state;
    },

    findDesertTileId() {
        const desertTile = this.gameData.tiles.find(t => t.resource === 'Desert');
        return desertTile?.id || null;
    },

    // Scan eventRecord for Undo events and build sets of undone event IDs and Undo event indices
    scanForUndoneEvents() {
        this.undoneEventIds = new Set();
        this.undoEventIndices = new Set();

        const events = this.gameData?.eventRecord || [];
        events.forEach((event, index) => {
            if (event.action === 'Undo' && event.eventReversed !== undefined) {
                // Mark this as an Undo event
                this.undoEventIndices.add(index);
                // Mark the reversed event as undone
                this.undoneEventIds.add(event.eventReversed);
            }
        });
    },

    // Check if an event at a given index should be skipped (is undone or is an Undo event)
    isEventSkipped(index) {
        const events = this.gameData?.eventRecord || [];
        const event = events[index];
        if (!event) return false;

        // Skip if this is an Undo event
        if (this.undoEventIndices.has(index)) return true;

        // Skip if this event was undone (check by event ID)
        if (event.id !== undefined && this.undoneEventIds.has(event.id)) return true;

        return false;
    },

    // Find the index of the first "real" event (first PlaceFirstSettlement)
    // Setup events like PlaceRobber and InitialSetUp happen before this
    findFirstRealEventIndex() {
        const events = this.gameData?.eventRecord || [];
        for (let i = 0; i < events.length; i++) {
            if (events[i].action === 'PlaceFirstSettlement') {
                return i;
            }
        }
        // If no PlaceFirstSettlement found, start at 0
        return 0;
    },

    applyEvent(state, event, isCurrentEvent) {
        // Track resource changes for the current event
        if (isCurrentEvent) {
            // Reset deltas for this event
            Object.keys(this.resourceDeltas).forEach(playerId => {
                Object.keys(this.resourceDeltas[playerId]).forEach(r => {
                    this.resourceDeltas[playerId][r] = 0;
                });
            });
        }

        // Apply resource changes from event
        this.applyResourceChanges(event, isCurrentEvent);

        // Apply development card changes from event
        this.applyDevCardChanges(event);

        switch (event.action) {
            case 'PlaceFirstSettlement':
            case 'PlaceSecondSettlement':
            case 'PlaceSettlement': {
                const vertex = state.vertices.find(v => v.id === event.vertexId);
                if (vertex) {
                    vertex.building = 'Settlement';
                    vertex.playerId = event.playerId;
                    // Block adjacent vertices
                    this.blockAdjacentVertices(state, event.vertexId);
                }
                if (isCurrentEvent) {
                    this.highlightedPiece = { type: 'settlement', id: event.vertexId };
                }
                break;
            }

            case 'PlaceFirstRoad':
            case 'PlaceSecondRoad':
            case 'PlaceRoad': {
                const edge = state.edges.find(e => e.id === event.edgeId);
                if (edge) {
                    edge.playerId = event.playerId;
                }
                if (isCurrentEvent) {
                    this.highlightedPiece = { type: 'road', id: event.edgeId };
                }
                break;
            }

            case 'PlaceCity':
            case 'UpgradeSettlement': {
                const vertex = state.vertices.find(v => v.id === event.vertexId);
                if (vertex) {
                    vertex.building = 'City';
                }
                if (isCurrentEvent) {
                    this.highlightedPiece = { type: 'city', id: event.vertexId };
                }
                break;
            }

            case 'MoveRobber':
            case 'PlayKnight': {
                if (event.tileId) {
                    state.robberTileId = event.tileId;
                    if (isCurrentEvent) {
                        this.highlightedPiece = { type: 'robber', id: event.tileId };
                    }
                }
                break;
            }

            case 'PlaceRobber': {
                if (event.tileId) {
                    state.robberTileId = event.tileId;
                    // Only highlight if this is after the first real event (gameplay has started)
                    // Initial PlaceRobber happens before PlaceFirstSettlement, so no highlight
                    if (isCurrentEvent && this.currentBuildIndex >= this.firstRealEventIndex) {
                        this.highlightedPiece = { type: 'robber', id: event.tileId };
                    }
                }
                break;
            }

            case 'InitialSetUp': {
                // Store the player lineup order
                if (event.playerLineup) {
                    this.playerLineup = event.playerLineup;
                }
                break;
            }
        }

        // Track dice rolls - support both old format (diceRoll total) and new format (die1, die2)
        if (event.die1 !== undefined && event.die2 !== undefined) {
            this.lastDiceRoll = { die1: event.die1, die2: event.die2 };
        } else if (event.diceRoll !== undefined) {
            this.lastDiceRoll = { total: event.diceRoll };
        }
    },

    // Building resource costs
    buildingCosts: {
        Road: { Brick: 1, Wood: 1 },
        Settlement: { Brick: 1, Wood: 1, Grain: 1, Wool: 1 },
        City: { Ore: 3, Grain: 2 },
        DevCard: { Ore: 1, Grain: 1, Wool: 1 }
    },

    applyResourceChanges(event, isCurrentEvent) {
        const playerId = event.playerId;
        if (!playerId || !this.playerResources[playerId]) return;

        // Handle building costs (only for regular builds, not initial placement)
        this.applyBuildingCost(event, isCurrentEvent);

        // Handle resources received
        if (event.resourcesReceived) {
            for (const [resource, count] of Object.entries(event.resourcesReceived)) {
                this.playerResources[playerId][resource] = (this.playerResources[playerId][resource] || 0) + count;
                if (isCurrentEvent) {
                    this.resourceDeltas[playerId][resource] = (this.resourceDeltas[playerId][resource] || 0) + count;
                }
            }

            // For StealResource action, the target player loses what the stealing player received
            if (event.action === 'StealResource' && event.targetPlayerId) {
                const targetId = event.targetPlayerId;
                // Ensure target player has resource tracking initialized
                if (!this.playerResources[targetId]) {
                    this.playerResources[targetId] = { Brick: 0, Wood: 0, Ore: 0, Grain: 0, Wool: 0 };
                }
                if (!this.resourceDeltas[targetId]) {
                    this.resourceDeltas[targetId] = { Brick: 0, Wood: 0, Ore: 0, Grain: 0, Wool: 0 };
                }

                for (const [resource, count] of Object.entries(event.resourcesReceived)) {
                    this.playerResources[targetId][resource] = (this.playerResources[targetId][resource] || 0) - count;
                    if (isCurrentEvent) {
                        this.resourceDeltas[targetId][resource] = (this.resourceDeltas[targetId][resource] || 0) - count;
                    }
                }
            }
        }

        // Handle resources used/spent
        if (event.resourcesUsed) {
            for (const [resource, count] of Object.entries(event.resourcesUsed)) {
                this.playerResources[playerId][resource] = (this.playerResources[playerId][resource] || 0) - count;
                if (isCurrentEvent) {
                    this.resourceDeltas[playerId][resource] = (this.resourceDeltas[playerId][resource] || 0) - count;
                }
            }
        }

        // Handle discarded resources
        if (event.discardedResources) {
            for (const [resource, count] of Object.entries(event.discardedResources)) {
                this.playerResources[playerId][resource] = (this.playerResources[playerId][resource] || 0) - count;
                if (isCurrentEvent) {
                    this.resourceDeltas[playerId][resource] = (this.resourceDeltas[playerId][resource] || 0) - count;
                }
            }
        }

        // Handle stolen resources (robber/knight/StealResource action)
        if (event.stolenResource && event.targetPlayerId) {
            const targetId = event.targetPlayerId;
            // Ensure target player has resource tracking initialized
            if (!this.playerResources[targetId]) {
                this.playerResources[targetId] = { Brick: 0, Wood: 0, Ore: 0, Grain: 0, Wool: 0 };
            }
            if (!this.resourceDeltas[targetId]) {
                this.resourceDeltas[targetId] = { Brick: 0, Wood: 0, Ore: 0, Grain: 0, Wool: 0 };
            }

            // Target loses the resource
            this.playerResources[targetId][event.stolenResource] = (this.playerResources[targetId][event.stolenResource] || 0) - 1;
            // Player gains the resource
            this.playerResources[playerId][event.stolenResource] = (this.playerResources[playerId][event.stolenResource] || 0) + 1;

            if (isCurrentEvent) {
                this.resourceDeltas[targetId][event.stolenResource] = (this.resourceDeltas[targetId][event.stolenResource] || 0) - 1;
                this.resourceDeltas[playerId][event.stolenResource] = (this.resourceDeltas[playerId][event.stolenResource] || 0) + 1;
            }
        }
    },

    applyDevCardChanges(event) {
        const playerId = event.playerId;
        if (!playerId || !this.playerDevCards[playerId]) {
            // Initialize if needed
            if (playerId && !this.playerDevCards[playerId]) {
                this.playerDevCards[playerId] = [];
            } else {
                return;
            }
        }

        // Handle buying a development card
        if (event.action === 'BuyDevelopmentCard' && event.developmentCard) {
            this.playerDevCards[playerId].push({
                type: event.developmentCard,
                played: false
            });
        }

        // Handle playing development cards (mark first unplayed card of that type as played)
        // Knights are marked played but kept; other cards are removed
        const playActions = {
            'PlayKnight': 'Knight',
            'PlayMonopoly': 'Monopoly',
            'PlayYearOfPlenty': 'YearOfPlenty',
            'PlayRoadBuilding': 'RoadBuilding'
        };

        if (playActions[event.action]) {
            const cardType = playActions[event.action];
            const cards = this.playerDevCards[playerId];
            const cardIndex = cards.findIndex(c => c.type === cardType && !c.played);

            if (cardIndex !== -1) {
                if (cardType === 'Knight') {
                    // Knights stay in the list but get marked as played (shown in yellow)
                    cards[cardIndex].played = true;
                } else {
                    // Other cards are removed when played
                    cards.splice(cardIndex, 1);
                }
            }
        }

        // Handle achievement events
        if (event.action === 'GainedLargestArmy') {
            this.largestArmyPlayerId = playerId;
        }
        if (event.action === 'GainedLongestRoad') {
            this.longestRoadPlayerId = playerId;
        }
    },

    applyBuildingCost(event, isCurrentEvent) {
        const playerId = event.playerId;
        let cost = null;

        switch (event.action) {
            case 'PlaceRoad':
                // Check if this road is free (from Road Building dev card or setup phase)
                if (!this.isFreeRoad(event.playerId)) {
                    cost = this.buildingCosts.Road;
                }
                break;
            case 'PlaceSettlement':
                cost = this.buildingCosts.Settlement;
                break;
            case 'PlaceCity':
            case 'UpgradeSettlement':
                cost = this.buildingCosts.City;
                break;
            case 'BuyDevelopmentCard':
                cost = this.buildingCosts.DevCard;
                break;
            // Initial placements (PlaceFirstSettlement, PlaceSecondSettlement, PlaceFirstRoad, PlaceSecondRoad) are free
        }

        if (cost) {
            for (const [resource, count] of Object.entries(cost)) {
                this.playerResources[playerId][resource] = (this.playerResources[playerId][resource] || 0) - count;
                if (isCurrentEvent) {
                    this.resourceDeltas[playerId][resource] = (this.resourceDeltas[playerId][resource] || 0) - count;
                }
            }
        }
    },

    // Check if a PlaceRoad is free (setup phase or Road Building dev card)
    // Returns true if this road should be free, false otherwise
    isFreeRoad(playerId) {
        const events = this.gameData.eventRecord || [];
        const currentIdx = this.currentBuildIndex;

        // Check if we're in setup phase (road immediately after PlaceFirstSettlement or PlaceSecondSettlement)
        // Look at the immediately preceding event
        if (currentIdx > 0) {
            const prevEvent = events[currentIdx - 1];
            if ((prevEvent.action === 'PlaceFirstSettlement' || prevEvent.action === 'PlaceSecondSettlement')
                && prevEvent.playerId === playerId) {
                return true; // Free road during setup
            }
        }

        // Check for Road Building dev card
        // Search backwards to find PlayRoadBuilding, counting PlaceRoads by same player
        let roadsAfterRoadBuilding = 0;
        let foundRoadBuilding = false;

        for (let i = currentIdx - 1; i >= 0; i--) {
            const evt = events[i];

            // If we hit an EndTurn by this player, Road Building effect is over
            if (evt.action === 'EndTurn' && evt.playerId === playerId) {
                break;
            }

            if (evt.action === 'PlayRoadBuilding' && evt.playerId === playerId) {
                foundRoadBuilding = true;
                break;
            }

            if (evt.action === 'PlaceRoad' && evt.playerId === playerId) {
                roadsAfterRoadBuilding++;
            }
        }

        // Current road is free if Road Building was played and fewer than 2 roads have been placed since
        return foundRoadBuilding && roadsAfterRoadBuilding < 2;
    },

    blockAdjacentVertices(state, vertexId) {
        // Find adjacent vertices and mark them as blocked
        // Adjacent vertices share an edge with this vertex
        const vertex = state.vertices.find(v => v.id === vertexId);
        if (!vertex) return;

        // Find edges that include tiles from this vertex
        const vertexTileIds = new Set(vertex.tileIds);

        state.vertices.forEach(v => {
            if (v.id === vertexId || v.building) return;

            // Check if this vertex shares an edge with the placed vertex
            // Two vertices are adjacent if they share exactly 2 tiles
            const sharedTiles = v.tileIds.filter(tid => vertexTileIds.has(tid));
            if (sharedTiles.length === 2) {
                v.building = 'Blocked';
            }
        });
    },

    applyHighlight() {
        if (!this.highlightedPiece) return;

        const { type, id } = this.highlightedPiece;

        // Add highlight class after a brief delay to ensure DOM is ready
        setTimeout(() => {
            let element = null;

            switch (type) {
                case 'road':
                    // Draw a highlight overlay for the road
                    this.highlightRoad(id);
                    break;

                case 'settlement':
                case 'city':
                    element = document.querySelector(`[data-vertex-id="${id}"].settlement, [data-vertex-id="${id}"].city`);
                    if (element) {
                        element.classList.add('highlighted');
                    }
                    break;

                case 'robber':
                    element = document.querySelector('.robber');
                    if (element) {
                        element.classList.add('highlighted');
                    }
                    break;
            }
        }, 10);
    },

    highlightRoad(edgeId) {
        // Get the edge endpoints and draw a highlight overlay
        const endpoints = Board.edgePositions.get(edgeId);
        if (!endpoints) return;

        const highlight = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        highlight.setAttribute('x1', endpoints.x1);
        highlight.setAttribute('y1', endpoints.y1);
        highlight.setAttribute('x2', endpoints.x2);
        highlight.setAttribute('y2', endpoints.y2);
        highlight.setAttribute('class', 'road-highlight');
        Board.layers.robber.appendChild(highlight);
    },

    renderPlayers() {
        const container = document.getElementById('players-list');

        if (!this.gameData?.players?.length) {
            container.innerHTML = '<div class="empty-state">Load a game to see players</div>';
            return;
        }

        container.innerHTML = '';

        // Determine current player from the current event
        const events = this.gameData.eventRecord || [];
        const currentEvent = this.currentEventIndex >= 0 ? events[this.currentEventIndex] : null;
        const currentPlayerId = currentEvent?.playerId || null;

        // Order players by playerLineup if available, otherwise use default order
        let orderedPlayers = this.gameData.players;
        if (this.playerLineup && this.playerLineup.length > 0) {
            orderedPlayers = this.playerLineup
                .map(id => this.gameData.players.find(p => p.id === id))
                .filter(p => p); // Filter out any undefined
        }

        orderedPlayers.forEach(player => {
            const card = document.createElement('div');
            card.className = 'player-card';
            if (player.id === currentPlayerId) {
                card.classList.add('current-turn');
            }
            card.style.borderLeftColor = this.getPlayerCSSColor(player.color);

            // Use tracked resources (starting at zero) instead of current game state
            const resources = this.playerResources[player.id] || {};
            const deltas = this.resourceDeltas[player.id] || {};
            const resourcesHtml = this.renderResourceBoxes(resources, deltas);

            // Get dev cards display
            const devCardsHtml = this.renderDevCards(player.id);

            // Build achievement badges (same style as Presidio game)
            const badges = [];
            if (this.longestRoadPlayerId === player.id) {
                badges.push('<span class="player-badge road-badge" title="Longest Road"><i class="fa-solid fa-road"></i></span>');
            }
            if (this.largestArmyPlayerId === player.id) {
                badges.push('<span class="player-badge army-badge" title="Largest Army"><i class="fa-solid fa-shield-halved"></i></span>');
            }
            const badgesHtml = badges.length > 0 ? `<span class="player-badges">${badges.join('')}</span>` : '';

            // Current turn indicator (arrow) shown via CSS ::after on player-name when current-turn class is set
            card.innerHTML = `
                <div class="player-card-header">
                    <span class="player-name">${player.name}</span>${badgesHtml}
                </div>
                <div class="player-stats">
                    <span>VP: <span class="stat-value">${player.victoryPoints}</span></span>
                    <span class="dev-cards-display">Dev: ${devCardsHtml || '-'}</span>
                </div>
                <div class="player-resources-row">
                    <div class="player-resources">${resourcesHtml}</div>
                </div>
            `;

            container.appendChild(card);
        });
    },

    renderDevCards(playerId) {
        const cards = this.playerDevCards[playerId] || [];
        if (cards.length === 0) return '';

        // Map card types to letters
        const cardLetters = {
            'Knight': 'K',
            'VictoryPoint': 'V',
            'RoadBuilding': 'R',
            'YearOfPlenty': 'Y',
            'Monopoly': 'M'
        };

        return cards.map(card => {
            const letter = cardLetters[card.type] || '?';
            if (card.type === 'Knight' && card.played) {
                // Played knights are shown in yellow
                return `<span class="dev-card-letter played-knight">${letter}</span>`;
            }
            return `<span class="dev-card-letter">${letter}</span>`;
        }).join('');
    },

    renderResourceBoxes(resources, deltas = {}) {
        if (!resources) return '';

        const order = ['Brick', 'Wood', 'Ore', 'Grain', 'Wool'];
        return order.map(resource => {
            const count = resources[resource] || 0;
            const delta = deltas[resource] || 0;

            let deltaClass = '';
            let deltaText = '';
            if (delta > 0) {
                deltaClass = 'resource-gain';
                deltaText = ` <span class="delta">(+${delta})</span>`;
            } else if (delta < 0) {
                deltaClass = 'resource-loss';
                deltaText = ` <span class="delta">(${delta})</span>`;
            }

            return `<span class="resource-box resource-${resource} ${deltaClass}" title="${resource}">${count}${deltaText}</span>`;
        }).join('');
    },

    renderEventsList() {
        const container = document.getElementById('events-list');
        const events = this.gameData?.eventRecord || [];

        if (events.length === 0) {
            container.innerHTML = '<div class="empty-state">No events to display</div>';
            return;
        }

        container.innerHTML = '';

        events.forEach((event, index) => {
            const item = document.createElement('div');
            item.className = 'event-item';

            // Check if this event is undone or is an Undo event
            if (this.isEventSkipped(index)) {
                item.classList.add('undone');
            }

            if (index < this.currentEventIndex) {
                item.classList.add('past');
            } else if (index === this.currentEventIndex) {
                item.classList.add('current');
            }

            const playerName = this.getPlayerName(event.playerId);
            const eventId = event.id ?? index;
            item.innerHTML = `<span class="event-id">${eventId}</span><span class="event-action">${event.action}</span><span class="event-player">${playerName}</span>`;

            item.addEventListener('click', () => this.jumpToEvent(index));
            container.appendChild(item);
        });

        // Scroll current event into view
        const currentItem = container.querySelector('.event-item.current');
        if (currentItem) {
            currentItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    },

    renderEventDetail() {
        const container = document.getElementById('event-detail');
        const events = this.gameData?.eventRecord || [];

        if (this.currentEventIndex < 0 || this.currentEventIndex >= events.length) {
            container.innerHTML = '<div class="empty-state">Select an event to see details</div>';
            return;
        }

        const event = events[this.currentEventIndex];
        const formattedJson = JSON.stringify(event, null, 2);
        container.innerHTML = `<pre class="event-json">${this.escapeHtml(formattedJson)}</pre>`;
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    formatEvent(event) {
        const playerName = this.getPlayerName(event.playerId);

        switch (event.action) {
            case 'RollDice':
                return `${playerName} rolled ${event.diceRoll}`;
            case 'PlaceFirstSettlement':
                return `${playerName} placed first settlement at ${event.vertexId}`;
            case 'PlaceSecondSettlement':
                return `${playerName} placed second settlement at ${event.vertexId}`;
            case 'PlaceFirstRoad':
                return `${playerName} placed first road at ${event.edgeId}`;
            case 'PlaceSecondRoad':
                return `${playerName} placed second road at ${event.edgeId}`;
            case 'PlaceSettlement':
                return `${playerName} built settlement at ${event.vertexId}`;
            case 'PlaceRoad':
                return `${playerName} built road at ${event.edgeId}`;
            case 'PlaceCity':
                return `${playerName} upgraded to city at ${event.vertexId}`;
            case 'EndTurn':
                return `${playerName} ended turn`;
            case 'MoveRobber':
                return `${playerName} moved robber to ${event.tileId}`;
            default:
                return `${playerName}: ${event.action}`;
        }
    },

    getPlayerName(playerId) {
        const player = this.gameData?.players?.find(p => p.id === playerId);
        return player?.name || playerId || 'Unknown';
    },

    getPlayerCSSColor(colorName) {
        // Read color from CSS custom property (defined in :root in style.css)
        const varName = `--player-${colorName?.toLowerCase()}`;
        const color = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
        return color || '#888';
    },

    updatePlaybackPosition() {
        const events = this.gameData?.eventRecord || [];
        // Use the actual event ID from the event record, not the index
        const currentEvent = this.currentEventIndex >= 0 ? events[this.currentEventIndex] : null;
        const eventId = currentEvent?.id ?? this.currentEventIndex;
        document.getElementById('current-event').textContent = eventId;
        document.getElementById('total-events').textContent = events.length;
    },

    // ==================== PLAYBACK CONTROLS ====================

    restart() {
        // Go back to first real event (skipping setup events like PlaceRobber and InitialSetUp)
        this.currentEventIndex = this.firstRealEventIndex;
        this.applyCurrentState();
    },

    stepForward() {
        const events = this.gameData?.eventRecord || [];
        if (this.currentEventIndex < events.length - 1) {
            this.currentEventIndex++;
            this.applyCurrentState();
        }
    },

    stepBack() {
        // Don't step back before the first real event
        if (this.currentEventIndex > this.firstRealEventIndex) {
            this.currentEventIndex--;
            this.applyCurrentState();
        }
    },

    jumpToEvent(index) {
        this.currentEventIndex = index;
        this.applyCurrentState();
    },

    togglePlayPause() {
        // TODO: Implement auto-play functionality
        console.log('Play/pause toggled');
    },

    applyCurrentState() {
        // Update UI
        this.renderBoard();
        this.renderPlayers();
        this.renderEventsList();
        this.renderEventDetail();
        this.updatePlaybackPosition();
        this.updatePlaybackButtons();
    },

    updatePlaybackButtons() {
        const events = this.gameData?.eventRecord || [];
        // At start means we're at or before the first real event
        const atStart = this.currentEventIndex <= this.firstRealEventIndex;
        const atEnd = this.currentEventIndex >= events.length - 1;

        document.getElementById('btn-restart').disabled = atStart;
        document.getElementById('btn-step-back').disabled = atStart;
        document.getElementById('btn-step-forward').disabled = atEnd;
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => Replay.init());
