/**
 * Main application controller.
 */

const App = {
    currentGame: null,
    currentGameId: null,
    possibleActions: [],
    selectedPlayerId: null,
    selectionMode: null, // 'vertex', 'edge', 'tile'
    selectableIds: [],
    pendingAction: null,

    // Zoom state
    zoomLevel: 1.0,
    minZoom: 0.5,
    maxZoom: 2.5,
    zoomStep: 0.25,

    init() {
        // Initialize board
        const svgElement = document.getElementById('board');
        Board.init(svgElement);

        // Set up board click handlers
        Board.onVertexClick = (vertexId) => this.handleBoardClick('vertex', vertexId);
        Board.onEdgeClick = (edgeId) => this.handleBoardClick('edge', edgeId);
        Board.onTileClick = (tileId) => this.handleBoardClick('tile', tileId);

        this.bindEventHandlers();
        this.loadSavedGameId();
        this.updateSettingsUI();

        this.log('Application initialized');
    },

    bindEventHandlers() {
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
        document.getElementById('btn-save-settings').addEventListener('click', () => this.saveSettings());
        document.getElementById('btn-cancel-settings').addEventListener('click', () => this.closeSettings());

        // Game setup
        document.getElementById('btn-new-game').addEventListener('click', () => this.createNewGame());
        document.getElementById('btn-load-game').addEventListener('click', () => this.loadGameById());
        document.getElementById('btn-refresh').addEventListener('click', () => this.refreshGameState());

        // Players
        document.getElementById('btn-add-player').addEventListener('click', () => this.addPlayer());
        document.getElementById('btn-start-game').addEventListener('click', () => this.startGame());

        // Selection cancel
        document.getElementById('btn-cancel-selection').addEventListener('click', () => this.cancelSelection());

        // Modal cancels
        document.getElementById('btn-cancel-trade').addEventListener('click', () => this.closeModal('trade-modal'));
        document.getElementById('btn-confirm-trade').addEventListener('click', () => this.confirmTrade());
        document.getElementById('btn-cancel-discard').addEventListener('click', () => this.closeModal('discard-modal'));
        document.getElementById('btn-confirm-discard').addEventListener('click', () => this.confirmDiscard());
        document.getElementById('btn-cancel-resource').addEventListener('click', () => this.closeModal('resource-modal'));
        document.getElementById('btn-confirm-resource').addEventListener('click', () => this.confirmResourceSelection());
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
        document.getElementById('api-url-input').value = API.baseUrl;
        document.getElementById('api-key-input').value = API.apiKey;
        document.getElementById('settings-modal').classList.remove('hidden');
    },

    saveSettings() {
        const url = document.getElementById('api-url-input').value.trim();
        const key = document.getElementById('api-key-input').value.trim();
        API.configure(url, key);
        this.closeSettings();
        this.log('Settings saved', 'success');
    },

    closeSettings() {
        document.getElementById('settings-modal').classList.add('hidden');
    },

    updateSettingsUI() {
        document.getElementById('api-url-input').value = API.baseUrl;
    },

    // ==================== GAME MANAGEMENT ====================

    async createNewGame() {
        const gameType = document.getElementById('game-type-select').value;
        this.log(`Creating new ${gameType} game...`);

        const response = await API.createGame(gameType);
        if (response.success) {
            this.handleGameResponse(response);
            this.saveGameId(response.gameState.id);
            this.log(`Game created: ${response.gameState.id}`, 'success');
        } else {
            this.log(`Error: ${response.errorMessage}`, 'error');
        }
    },

    async loadGameById() {
        const gameId = document.getElementById('game-id-input').value.trim();
        if (!gameId) {
            this.log('Please enter a game ID', 'error');
            return;
        }

        this.log(`Loading game ${gameId}...`);
        const response = await API.getGame(gameId);
        if (response.success) {
            this.handleGameResponse(response);
            this.saveGameId(gameId);
            this.log('Game loaded', 'success');
        } else {
            this.log(`Error: ${response.errorMessage}`, 'error');
        }
    },

    async refreshGameState() {
        if (!this.currentGameId) {
            this.log('No game loaded', 'error');
            return;
        }

        this.log('Refreshing game state...');
        const response = await API.getGame(this.currentGameId);
        if (response.success) {
            this.handleGameResponse(response);
            this.log('Game state refreshed', 'success');
        } else {
            this.log(`Error: ${response.errorMessage}`, 'error');
        }
    },

    saveGameId(gameId) {
        this.currentGameId = gameId;
        localStorage.setItem('catan_current_game', gameId);
        document.getElementById('game-id-input').value = gameId;
    },

    loadSavedGameId() {
        const savedGameId = localStorage.getItem('catan_current_game');
        if (savedGameId) {
            document.getElementById('game-id-input').value = savedGameId;
        }
    },

    handleGameResponse(response) {
        this.currentGame = response.gameState;
        this.currentGameId = response.gameState.id;
        this.possibleActions = response.possibleActions || [];

        this.displayGame();
        this.updateUI();
    },

    displayGame() {
        const game = this.currentGame;

        // Update header
        document.getElementById('game-id').textContent = `Game: ${game.id.substring(0, 8)}...`;
        document.getElementById('game-phase').textContent = game.phase?.phaseState || '';

        // Update current player
        if (game.phase?.currentPlayerId) {
            const currentPlayer = game.players.find(p => p.id === game.phase.currentPlayerId);
            if (currentPlayer) {
                document.getElementById('current-player').textContent = `Current: ${currentPlayer.name}`;
                document.getElementById('current-player').style.color = this.getPlayerCSSColor(currentPlayer.color);
            }
        } else {
            document.getElementById('current-player').textContent = '';
        }

        // Update dice display
        if (game.dice && (game.dice.die1.value > 0 || game.dice.die2.value > 0)) {
            document.getElementById('dice-display').classList.remove('hidden');
            document.getElementById('die1').textContent = game.dice.die1.value || '-';
            document.getElementById('die2').textContent = game.dice.die2.value || '-';
        } else {
            document.getElementById('dice-display').classList.add('hidden');
        }

        // Render board
        Board.render(game);

        // Render players
        this.renderPlayers();

        // Enable refresh button
        document.getElementById('btn-refresh').disabled = false;
    },

    updateUI() {
        const game = this.currentGame;
        const phase = game?.phase?.phaseState;

        // Show/hide sections based on phase
        const isSetup = phase === 'SettingUpBoard';
        const isPlaying = phase && phase !== 'SettingUpBoard' && phase !== 'GameOver';

        document.getElementById('add-player-form').classList.toggle('hidden', !isSetup);
        document.getElementById('btn-start-game').classList.toggle('hidden', !isSetup || game.players.length < 2);
        document.getElementById('actions-section').classList.toggle('hidden', !isPlaying && this.possibleActions.length === 0);

        // Update actions
        this.renderActions();
    },

    // ==================== PLAYERS ====================

    renderPlayers() {
        const container = document.getElementById('players-list');
        container.innerHTML = '';

        if (!this.currentGame?.players) return;

        const isSetup = this.currentGame.phase?.phaseState === 'SettingUpBoard';

        this.currentGame.players.forEach(player => {
            const card = document.createElement('div');
            card.className = 'player-card';
            card.style.borderLeftColor = this.getPlayerCSSColor(player.color);

            if (this.currentGame.phase?.currentPlayerId === player.id) {
                card.classList.add('current');
            }

            let html = `
                <div class="player-card-header">
                    <div class="player-name">${player.name} ${player.isBot ? '(Bot)' : ''}</div>
                    ${isSetup ? `<button class="remove-btn" data-player-id="${player.id}">Remove</button>` : ''}
                </div>
                <div class="player-stats">
                    VP: ${player.victoryPoints} |
                    Cards: ${player.resourceCount} |
                    Dev: ${player.developmentCardCount}
                </div>
            `;

            // Show resources for human players or all in dev mode
            if (!player.isBot && player.resources) {
                const res = player.resources;
                html += `<div class="player-resources">
                    B:${res.Brick} W:${res.Wood} O:${res.Ore} G:${res.Grain} S:${res.Wool}
                </div>`;
            }

            card.innerHTML = html;

            // Bind remove button if in setup
            if (isSetup) {
                const removeBtn = card.querySelector('.remove-btn');
                if (removeBtn) {
                    removeBtn.addEventListener('click', () => this.removePlayer(player.id));
                }
            }

            container.appendChild(card);
        });
    },

    async addPlayer() {
        if (!this.currentGameId) {
            this.log('No game loaded', 'error');
            return;
        }

        const name = document.getElementById('player-name-input').value.trim();
        const color = document.getElementById('player-color-select').value;
        const isBot = document.getElementById('player-is-bot').checked;

        if (!name) {
            this.log('Please enter a player name', 'error');
            return;
        }

        this.log(`Adding player ${name}...`);
        const response = await API.addPlayer(this.currentGameId, name, isBot, color || null);

        if (response.success) {
            this.handleGameResponse(response);
            document.getElementById('player-name-input').value = '';
            this.log(`Player ${name} added`, 'success');
        } else {
            this.log(`Error: ${response.errorMessage}`, 'error');
        }
    },

    async removePlayer(playerId) {
        if (!this.currentGameId) return;

        this.log(`Removing player ${playerId}...`);
        const response = await API.removePlayer(this.currentGameId, playerId);

        if (response.success) {
            this.handleGameResponse(response);
            this.log('Player removed', 'success');
        } else {
            this.log(`Error: ${response.errorMessage}`, 'error');
        }
    },

    async startGame() {
        if (!this.currentGameId) return;

        this.log('Starting game...');
        const response = await API.startGame(this.currentGameId);

        if (response.success) {
            this.handleGameResponse(response);
            this.log('Game started!', 'success');
        } else {
            this.log(`Error: ${response.errorMessage}`, 'error');
        }
    },

    // ==================== ACTIONS ====================

    renderActions() {
        const container = document.getElementById('actions-list');
        container.innerHTML = '';

        if (!this.possibleActions || this.possibleActions.length === 0) {
            container.innerHTML = '<div class="log-entry">No actions available</div>';
            return;
        }

        // Group actions by type for cleaner display
        this.possibleActions.forEach(action => {
            const btn = document.createElement('button');
            btn.className = 'action-btn';

            switch (action.action) {
                case 'RollDice':
                    btn.textContent = 'Roll Dice';
                    btn.classList.add('highlight');
                    btn.onclick = () => this.doRollDice(this.currentGame.phase.currentPlayerId);
                    break;

                case 'PlaceSettlement':
                    btn.textContent = `Place Settlement (${action.vertexIds?.length || 0} spots)`;
                    btn.onclick = () => this.startSelection('vertex', action.vertexIds, this.currentGame.phase.currentPlayerId, 'PlaceSettlement');
                    break;

                case 'PlaceRoad':
                    btn.textContent = `Place Road (${action.edgeIds?.length || 0} spots)`;
                    btn.onclick = () => this.startSelection('edge', action.edgeIds, this.currentGame.phase.currentPlayerId, 'PlaceRoad');
                    break;

                case 'UpgradeSettlement':
                    btn.textContent = `Upgrade to City (${action.vertexIds?.length || 0})`;
                    btn.onclick = () => this.startSelection('vertex', action.vertexIds, this.currentGame.phase.currentPlayerId, 'UpgradeSettlement');
                    break;

                case 'PlaceRobber':
                    btn.textContent = `Place Robber (${action.tileIds?.length || 0} tiles)`;
                    btn.onclick = () => this.startSelection('tile', action.tileIds, this.currentGame.phase.currentPlayerId, 'PlaceRobber');
                    break;

                case 'StealResource':
                    btn.textContent = `Steal from: ${action.targetPlayerIds?.join(', ')}`;
                    btn.onclick = () => this.showStealOptions(action);
                    break;

                case 'DiscardCards':
                    // Calculate discard count: half of resources (rounded down) for players with > 7 cards
                    const discardPlayer = this.currentGame.players.find(p => p.id === this.currentGame.phase.currentPlayerId);
                    const discardCount = discardPlayer ? Math.floor(discardPlayer.resourceCount / 2) : 0;
                    btn.textContent = `Discard ${discardCount} Cards`;
                    btn.classList.add('highlight');
                    btn.onclick = () => this.showDiscardModal({ ...action, count: discardCount });
                    break;

                case 'BuyDevelopmentCard':
                    btn.textContent = 'Buy Dev Card';
                    btn.onclick = () => this.doBuyDevCard(this.currentGame.phase.currentPlayerId);
                    break;

                case 'TradeWithBank':
                    btn.textContent = 'Bank Trade';
                    btn.onclick = () => this.showTradeModal(action);
                    break;

                case 'PlayKnight':
                    btn.textContent = 'Play Knight';
                    btn.onclick = () => this.startSelection('tile', action.tileIds, this.currentGame.phase.currentPlayerId, 'PlayKnight');
                    break;

                case 'PlayRoadBuilding':
                    btn.textContent = 'Play Road Building';
                    btn.onclick = () => this.doPlayRoadBuilding(this.currentGame.phase.currentPlayerId);
                    break;

                case 'PlayYearOfPlenty':
                    btn.textContent = 'Play Year of Plenty';
                    btn.onclick = () => this.showYearOfPlentyModal(this.currentGame.phase.currentPlayerId);
                    break;

                case 'PlayMonopoly':
                    btn.textContent = 'Play Monopoly';
                    btn.onclick = () => this.showMonopolyModal(this.currentGame.phase.currentPlayerId);
                    break;

                case 'EndTurn':
                    btn.textContent = 'End Turn';
                    btn.classList.add('secondary');
                    btn.onclick = () => this.doEndTurn(this.currentGame.phase.currentPlayerId);
                    break;

                default:
                    btn.textContent = action.action;
                    btn.disabled = true;
            }

            container.appendChild(btn);
        });
    },

    // ==================== SELECTION MODE ====================

    startSelection(mode, ids, playerId, actionType) {
        if (!ids || ids.length === 0) {
            this.log('No valid locations for this action', 'error');
            return;
        }

        this.selectionMode = mode;
        this.selectableIds = ids;
        this.selectedPlayerId = playerId;
        this.pendingAction = actionType;

        // Show selection info
        document.getElementById('selection-info').classList.remove('hidden');
        document.getElementById('selection-type').textContent = `${actionType} - click a ${mode}`;

        // Update board to show selectable elements
        Board.setSelectableElements(mode, ids);

        this.log(`Select a ${mode} for ${actionType}`);
    },

    cancelSelection() {
        this.selectionMode = null;
        this.selectableIds = [];
        this.selectedPlayerId = null;
        this.pendingAction = null;

        document.getElementById('selection-info').classList.add('hidden');
        Board.clearSelectableElements();

        this.log('Selection cancelled');
    },

    async handleBoardClick(type, id) {
        console.log('handleBoardClick:', type, id, 'selectionMode:', this.selectionMode, 'selectableIds:', this.selectableIds);
        if (this.selectionMode !== type) return;
        if (!this.selectableIds.includes(id)) return;

        const playerId = this.selectedPlayerId;
        const action = this.pendingAction;

        this.cancelSelection();

        this.log(`${action}: ${id}`);

        let response;
        switch (action) {
            case 'PlaceSettlement':
                response = await API.buildSettlement(this.currentGameId, playerId, id);
                break;
            case 'PlaceRoad':
                response = await API.buildRoad(this.currentGameId, playerId, id);
                break;
            case 'UpgradeSettlement':
                response = await API.buildCity(this.currentGameId, playerId, id);
                break;
            case 'PlaceRobber':
                response = await API.placeRobber(this.currentGameId, playerId, id);
                break;
            case 'PlayKnight':
                response = await API.playKnight(this.currentGameId, playerId, id);
                break;
        }

        if (response?.success) {
            this.handleGameResponse(response);
            this.log(`${action} completed`, 'success');
        } else {
            this.log(`Error: ${response?.errorMessage}`, 'error');
        }
    },

    // ==================== GAME ACTIONS ====================

    async doRollDice(playerId) {
        this.log('Rolling dice...');
        const response = await API.rollDice(this.currentGameId);

        if (response.success) {
            this.handleGameResponse(response);
            const dice = response.gameState.dice;
            this.log(`Rolled ${dice.die1.value} + ${dice.die2.value} = ${dice.die1.value + dice.die2.value}`, 'success');
        } else {
            this.log(`Error: ${response.errorMessage}`, 'error');
        }
    },

    async doEndTurn(playerId) {
        this.log('Ending turn...');
        const response = await API.endTurn(this.currentGameId);

        if (response.success) {
            this.handleGameResponse(response);
            this.log('Turn ended', 'success');
        } else {
            this.log(`Error: ${response.errorMessage}`, 'error');
        }
    },

    async doBuyDevCard(playerId) {
        this.log('Buying development card...');
        const response = await API.buyDevCard(this.currentGameId, playerId);

        if (response.success) {
            this.handleGameResponse(response);
            this.log('Development card purchased', 'success');
        } else {
            this.log(`Error: ${response.errorMessage}`, 'error');
        }
    },

    async doPlayRoadBuilding(playerId) {
        this.log('Playing Road Building...');
        const response = await API.playRoadBuilding(this.currentGameId, playerId);

        if (response.success) {
            this.handleGameResponse(response);
            this.log('Road Building played', 'success');
        } else {
            this.log(`Error: ${response.errorMessage}`, 'error');
        }
    },

    // ==================== MODALS ====================

    showTradeModal(action) {
        const playerId = this.currentGame.phase.currentPlayerId;
        const player = this.currentGame.players.find(p => p.id === playerId);
        if (!player) return;

        // Determine best trade rates based on ports
        this.tradeRates = this.calculateTradeRates(playerId);
        this.selectedTradeOffer = [];
        this.selectedTradeRequest = null;

        // Render offer cards (player's resources)
        const offerContainer = document.getElementById('trade-offer-cards');
        offerContainer.innerHTML = '';

        const resourceAbbrev = { Brick: 'B', Wood: 'W', Ore: 'O', Grain: 'G', Wool: 'S' };
        const resources = player.resources;

        Object.entries(resources).forEach(([resource, count]) => {
            for (let i = 0; i < count; i++) {
                const card = document.createElement('div');
                card.className = `discard-card resource-${resource}`;
                card.textContent = resourceAbbrev[resource] || resource.substring(0, 1);
                card.dataset.resource = resource;
                card.onclick = () => this.toggleTradeOfferCard(card, resource);
                offerContainer.appendChild(card);
            }
        });

        // Render request options (all 5 resource types)
        const requestContainer = document.getElementById('trade-request-options');
        requestContainer.innerHTML = '';

        ['Brick', 'Wood', 'Ore', 'Grain', 'Wool'].forEach(resource => {
            const option = document.createElement('div');
            option.className = `resource-option resource-${resource}`;
            option.textContent = resource;
            option.dataset.resource = resource;
            option.onclick = () => this.selectTradeRequest(option, resource);
            requestContainer.appendChild(option);
        });

        this.updateTradeSummary();
        document.getElementById('trade-modal').classList.remove('hidden');
    },

    calculateTradeRates(playerId) {
        // Default 4:1 for all resources
        const rates = {
            Brick: 4, Wood: 4, Ore: 4, Grain: 4, Wool: 4
        };

        // Check ports for better rates
        if (this.currentGame.ports) {
            this.currentGame.ports.forEach(port => {
                // Check if player has a building on either port vertex
                const hasPort = port.vertices.some(vertexId => {
                    const vertex = this.currentGame.vertices.find(v => v.id === vertexId);
                    return vertex && vertex.playerId === playerId &&
                           (vertex.building === 'Settlement' || vertex.building === 'City');
                });

                if (hasPort) {
                    if (port.type === 'ThreeToOne') {
                        // 3:1 for all resources
                        Object.keys(rates).forEach(r => {
                            if (rates[r] > 3) rates[r] = 3;
                        });
                    } else {
                        // 2:1 for specific resource
                        if (rates[port.type] > 2) rates[port.type] = 2;
                    }
                }
            });
        }

        return rates;
    },

    toggleTradeOfferCard(card, resource) {
        if (card.classList.contains('selected')) {
            card.classList.remove('selected');
            const idx = this.selectedTradeOffer.indexOf(resource);
            if (idx > -1) this.selectedTradeOffer.splice(idx, 1);
        } else {
            card.classList.add('selected');
            this.selectedTradeOffer.push(resource);
        }
        this.updateTradeSummary();
    },

    selectTradeRequest(option, resource) {
        // Deselect previous
        document.querySelectorAll('#trade-request-options .resource-option').forEach(el => {
            el.classList.remove('selected');
        });
        option.classList.add('selected');
        this.selectedTradeRequest = resource;
        this.updateTradeSummary();
    },

    updateTradeSummary() {
        const summary = document.getElementById('trade-summary');
        const confirmBtn = document.getElementById('btn-confirm-trade');

        if (this.selectedTradeOffer.length === 0) {
            summary.textContent = 'Select resources to offer';
            confirmBtn.disabled = true;
            return;
        }

        // Count resources by type
        const offerCounts = {};
        this.selectedTradeOffer.forEach(r => {
            offerCounts[r] = (offerCounts[r] || 0) + 1;
        });

        // Check if we have a valid trade (all same type and meets rate)
        const resourceTypes = Object.keys(offerCounts);
        if (resourceTypes.length !== 1) {
            summary.textContent = 'Select cards of the same type';
            confirmBtn.disabled = true;
            return;
        }

        const offerResource = resourceTypes[0];
        const offerCount = offerCounts[offerResource];
        const requiredRate = this.tradeRates[offerResource];

        if (offerCount < requiredRate) {
            summary.textContent = `Need ${requiredRate} ${offerResource} (have ${offerCount} selected)`;
            confirmBtn.disabled = true;
            return;
        }

        if (offerCount % requiredRate !== 0) {
            summary.textContent = `Select a multiple of ${requiredRate} cards`;
            confirmBtn.disabled = true;
            return;
        }

        const receiveCount = offerCount / requiredRate;

        if (!this.selectedTradeRequest) {
            summary.textContent = `Trading ${offerCount} ${offerResource} - select what you want`;
            confirmBtn.disabled = true;
            return;
        }

        if (this.selectedTradeRequest === offerResource) {
            summary.textContent = `Cannot trade ${offerResource} for ${offerResource}`;
            confirmBtn.disabled = true;
            return;
        }

        summary.textContent = `Trade ${offerCount} ${offerResource} for ${receiveCount} ${this.selectedTradeRequest}`;
        confirmBtn.disabled = false;
    },

    async confirmTrade() {
        const playerId = this.currentGame.phase.currentPlayerId;

        // Build offer object
        const offer = {};
        this.selectedTradeOffer.forEach(r => {
            offer[r] = (offer[r] || 0) + 1;
        });

        // Build request object
        const offerResource = Object.keys(offer)[0];
        const offerCount = offer[offerResource];
        const requiredRate = this.tradeRates[offerResource];
        const receiveCount = offerCount / requiredRate;

        const request = { [this.selectedTradeRequest]: receiveCount };

        this.closeModal('trade-modal');
        this.log('Trading with bank...');

        const response = await API.tradeWithBank(this.currentGameId, playerId, offer, request);

        if (response.success) {
            this.handleGameResponse(response);
            this.log('Trade completed', 'success');
        } else {
            this.log(`Error: ${response.errorMessage}`, 'error');
        }
    },

    showDiscardModal(action) {
        const playerId = this.currentGame.phase.currentPlayerId;
        const player = this.currentGame.players.find(p => p.id === playerId);
        if (!player) return;

        document.getElementById('discard-info').textContent =
            `${player.name} must discard ${action.count} cards:`;

        const container = document.getElementById('discard-selection');
        container.innerHTML = '';

        this.discardCount = action.count;
        this.discardPlayerId = playerId;
        this.selectedDiscards = [];

        // Create cards for each resource the player has
        const resourceAbbrev = { Brick: 'B', Wood: 'W', Ore: 'O', Grain: 'G', Wool: 'S' };
        const resources = player.resources;
        Object.entries(resources).forEach(([resource, count]) => {
            for (let i = 0; i < count; i++) {
                const card = document.createElement('div');
                card.className = `discard-card resource-${resource}`;
                card.textContent = resourceAbbrev[resource] || resource.substring(0, 1);
                card.dataset.resource = resource;
                card.onclick = () => this.toggleDiscardCard(card, resource);
                container.appendChild(card);
            }
        });

        document.getElementById('btn-confirm-discard').disabled = true;
        document.getElementById('discard-modal').classList.remove('hidden');
    },

    toggleDiscardCard(card, resource) {
        if (card.classList.contains('selected')) {
            card.classList.remove('selected');
            const idx = this.selectedDiscards.indexOf(resource);
            if (idx > -1) this.selectedDiscards.splice(idx, 1);
        } else if (this.selectedDiscards.length < this.discardCount) {
            card.classList.add('selected');
            this.selectedDiscards.push(resource);
        }

        document.getElementById('btn-confirm-discard').disabled =
            this.selectedDiscards.length !== this.discardCount;
    },

    async confirmDiscard() {
        this.closeModal('discard-modal');
        this.log(`Discarding ${this.selectedDiscards.length} cards...`);

        const response = await API.discardCards(
            this.currentGameId,
            this.discardPlayerId,
            this.selectedDiscards
        );

        if (response.success) {
            this.handleGameResponse(response);
            this.log('Cards discarded', 'success');
        } else {
            this.log(`Error: ${response.errorMessage}`, 'error');
        }
    },

    showStealOptions(action) {
        const playerId = this.currentGame.phase.currentPlayerId;
        // For now, if there's only one target, steal from them directly
        if (action.targetPlayerIds.length === 1) {
            this.doSteal(playerId, action.targetPlayerIds[0]);
        } else {
            // TODO: Show modal to pick target
            this.log('Multiple steal targets - picking first one');
            this.doSteal(playerId, action.targetPlayerIds[0]);
        }
    },

    async doSteal(playerId, targetPlayerId) {
        this.log(`Stealing from ${targetPlayerId}...`);
        // Note: The steal happens automatically after placing robber in most implementations
        // If your API requires a separate call, add it here
    },

    showYearOfPlentyModal(playerId) {
        document.getElementById('resource-modal-title').textContent = 'Year of Plenty - Select 2 Resources';
        this.resourceModalType = 'YearOfPlenty';
        this.resourceModalPlayerId = playerId;
        this.selectedResources = [];

        this.renderResourceOptions(2);
        document.getElementById('resource-modal').classList.remove('hidden');
    },

    showMonopolyModal(playerId) {
        document.getElementById('resource-modal-title').textContent = 'Monopoly - Select 1 Resource';
        this.resourceModalType = 'Monopoly';
        this.resourceModalPlayerId = playerId;
        this.selectedResources = [];

        this.renderResourceOptions(1);
        document.getElementById('resource-modal').classList.remove('hidden');
    },

    renderResourceOptions(maxSelect) {
        this.maxResourceSelect = maxSelect;
        const container = document.getElementById('resource-selection');
        container.innerHTML = '';

        const resources = ['Brick', 'Wood', 'Ore', 'Grain', 'Wool'];
        resources.forEach(resource => {
            const div = document.createElement('div');
            div.className = `resource-option resource-${resource}`;
            div.dataset.resource = resource;

            // For maxSelect > 1, show count and +/- buttons
            if (maxSelect > 1) {
                div.innerHTML = `
                    <span class="resource-name">${resource}</span>
                    <span class="resource-count" data-resource="${resource}">0</span>
                `;
                div.onclick = () => this.incrementResourceOption(resource);
            } else {
                div.textContent = resource;
                div.onclick = () => this.toggleResourceOption(div, resource);
            }
            container.appendChild(div);
        });

        this.updateResourceSelectionUI();
    },

    toggleResourceOption(div, resource) {
        // For single-select (Monopoly)
        document.querySelectorAll('#resource-selection .resource-option').forEach(el => {
            el.classList.remove('selected');
        });
        div.classList.add('selected');
        this.selectedResources = [resource];

        document.getElementById('btn-confirm-resource').disabled = false;
    },

    incrementResourceOption(resource) {
        // Count how many of this resource are already selected
        const currentCount = this.selectedResources.filter(r => r === resource).length;
        const totalSelected = this.selectedResources.length;

        if (totalSelected < this.maxResourceSelect) {
            // Add one more of this resource
            this.selectedResources.push(resource);
        } else if (currentCount > 0) {
            // Already at max, remove one of this resource
            const idx = this.selectedResources.indexOf(resource);
            if (idx > -1) this.selectedResources.splice(idx, 1);
        }

        this.updateResourceSelectionUI();
    },

    updateResourceSelectionUI() {
        const resources = ['Brick', 'Wood', 'Ore', 'Grain', 'Wool'];
        resources.forEach(resource => {
            const count = this.selectedResources.filter(r => r === resource).length;
            const countEl = document.querySelector(`#resource-selection .resource-count[data-resource="${resource}"]`);
            if (countEl) {
                countEl.textContent = count;
            }
            const optionEl = document.querySelector(`#resource-selection .resource-option[data-resource="${resource}"]`);
            if (optionEl) {
                optionEl.classList.toggle('selected', count > 0);
            }
        });

        document.getElementById('btn-confirm-resource').disabled =
            this.selectedResources.length !== this.maxResourceSelect;
    },

    async confirmResourceSelection() {
        this.closeModal('resource-modal');

        let response;
        if (this.resourceModalType === 'YearOfPlenty') {
            this.log('Playing Year of Plenty...');
            response = await API.playYearOfPlenty(
                this.currentGameId,
                this.resourceModalPlayerId,
                this.selectedResources[0],
                this.selectedResources[1]
            );
        } else if (this.resourceModalType === 'Monopoly') {
            this.log('Playing Monopoly...');
            response = await API.playMonopoly(
                this.currentGameId,
                this.resourceModalPlayerId,
                this.selectedResources[0]
            );
        }

        if (response?.success) {
            this.handleGameResponse(response);
            this.log(`${this.resourceModalType} played`, 'success');
        } else {
            this.log(`Error: ${response?.errorMessage}`, 'error');
        }
    },

    closeModal(modalId) {
        document.getElementById(modalId).classList.add('hidden');
    },

    // ==================== UTILITIES ====================

    getPlayerCSSColor(colorName) {
        const colors = {
            'Red': '#e74c3c',
            'Blue': '#3498db',
            'Orange': '#e67e22',
            'White': '#ecf0f1'
        };
        return colors[colorName] || '#888';
    },

    log(message, type = '') {
        const container = document.getElementById('status-log');
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.textContent = `${new Date().toLocaleTimeString()}: ${message}`;
        container.insertBefore(entry, container.firstChild);

        // Keep only last 50 entries
        while (container.children.length > 50) {
            container.removeChild(container.lastChild);
        }

        console.log(`[${type || 'info'}] ${message}`);
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
