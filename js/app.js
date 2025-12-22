/**
 * Main application controller.
 */

const App = {
    currentGame: null,
    currentGameId: null,
    possibleActions: [],
    selectedPlayerId: null,
    playingAsPlayerId: null, // The player the user is playing as (persisted)
    selectionMode: null, // 'vertex', 'edge', 'tile'
    selectableIds: [],
    pendingAction: null,

    // Zoom state
    zoomLevel: 1.0,
    minZoom: 0.5,
    maxZoom: 2.5,
    zoomStep: 0.25,

    // Auto-refresh
    autoRefreshInterval: null,
    autoRefreshDelay: 3000, // 3 seconds
    autoRefreshEnabled: false, // Controlled via Settings toggle

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

        // Load auto-refresh setting from session (defaults to false)
        this.autoRefreshEnabled = this.loadAutoRefreshSetting();

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

        // Game menu modal
        document.getElementById('btn-game-menu').addEventListener('click', () => this.openGameMenu());
        document.getElementById('btn-close-game-menu').addEventListener('click', () => this.closeGameMenu());
        document.getElementById('menu-btn-new-game').addEventListener('click', () => this.createNewGame());
        document.getElementById('menu-btn-load-game').addEventListener('click', () => this.loadGameById());
        document.getElementById('menu-btn-add-player').addEventListener('click', () => this.addPlayer());
        document.getElementById('menu-btn-start-game').addEventListener('click', () => this.startGame());
        document.getElementById('menu-playing-as-select').addEventListener('change', (e) => this.onPlayingAsChanged(e.target.value));

        // Refresh button
        document.getElementById('btn-refresh').addEventListener('click', () => this.refreshGameState());

        // Selection cancel
        document.getElementById('btn-cancel-selection').addEventListener('click', () => this.cancelSelection());

        // Modal cancels
        document.getElementById('btn-cancel-trade').addEventListener('click', () => this.closeModal('trade-modal'));
        document.getElementById('btn-confirm-trade').addEventListener('click', () => this.confirmTrade());
        document.getElementById('btn-cancel-discard').addEventListener('click', () => this.closeModal('discard-modal'));
        document.getElementById('btn-confirm-discard').addEventListener('click', () => this.confirmDiscard());
        document.getElementById('btn-cancel-resource').addEventListener('click', () => this.closeModal('resource-modal'));
        document.getElementById('btn-confirm-resource').addEventListener('click', () => this.confirmResourceSelection());
        document.getElementById('btn-cancel-player-trade').addEventListener('click', () => this.closeModal('player-trade-modal'));
        document.getElementById('btn-confirm-player-trade').addEventListener('click', () => this.confirmPlayerTrade());
        document.getElementById('btn-accept-trade').addEventListener('click', () => this.acceptTradeOffer());
        document.getElementById('btn-reject-trade').addEventListener('click', () => this.rejectTradeOffer());
        document.getElementById('btn-cancel-accept-trade').addEventListener('click', () => this.closeModal('accept-trade-modal'));
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
        document.getElementById('auto-refresh-toggle').checked = this.autoRefreshEnabled;
        document.getElementById('settings-modal').classList.remove('hidden');
    },

    saveSettings() {
        const url = document.getElementById('api-url-input').value.trim();
        const key = document.getElementById('api-key-input').value.trim();
        API.configure(url, key);

        // Handle auto-refresh toggle
        const autoRefreshEnabled = document.getElementById('auto-refresh-toggle').checked;
        this.setAutoRefreshEnabled(autoRefreshEnabled);

        this.closeSettings();
        this.log('Settings saved', 'success');
    },

    setAutoRefreshEnabled(enabled) {
        this.autoRefreshEnabled = enabled;
        sessionStorage.setItem('catan_auto_refresh', enabled ? 'true' : 'false');

        if (enabled && this.currentGameId) {
            this.startAutoRefresh();
            this.log('Auto-refresh enabled');
        } else {
            this.stopAutoRefresh();
            if (!enabled) {
                this.log('Auto-refresh disabled');
            }
        }
    },

    loadAutoRefreshSetting() {
        const saved = sessionStorage.getItem('catan_auto_refresh');
        return saved === 'true';
    },

    closeSettings() {
        document.getElementById('settings-modal').classList.add('hidden');
    },

    updateSettingsUI() {
        document.getElementById('api-url-input').value = API.baseUrl;
    },

    // ==================== GAME MENU ====================

    openGameMenu() {
        // Update the playing-as dropdown in the menu
        this.populateMenuPlayerDropdown();
        // Show/hide player management section based on game phase
        this.updateGameMenuUI();
        document.getElementById('game-menu-modal').classList.remove('hidden');
    },

    updateGameMenuUI() {
        const isSetup = this.currentGame?.phase?.phaseState === 'SettingUpBoard';
        const hasGame = !!this.currentGame;

        // Show player management only during setup
        document.getElementById('menu-player-management').classList.toggle('hidden', !isSetup);

        // Show/hide playing as based on whether game has started
        document.getElementById('menu-playing-as-container').classList.toggle('hidden', !hasGame || isSetup);

        // Update start game button visibility
        const canStart = isSetup && this.currentGame?.players?.length >= 2;
        document.getElementById('menu-btn-start-game').classList.toggle('hidden', !canStart);
    },

    closeGameMenu() {
        this.closeModal('game-menu-modal');
        // Refresh UI when closing the menu
        if (this.currentGame) {
            this.displayGame();
            this.updateUI();
        }
    },

    populateMenuPlayerDropdown() {
        const select = document.getElementById('menu-playing-as-select');
        select.innerHTML = '';

        if (!this.currentGame?.players) return;

        this.currentGame.players.forEach(player => {
            const option = document.createElement('option');
            option.value = player.id;
            option.textContent = `${player.name}${player.isBot ? ' (Bot)' : ''}`;
            option.style.color = this.getPlayerCSSColor(player.color);
            select.appendChild(option);
        });

        // Set the selected player
        if (this.playingAsPlayerId) {
            select.value = this.playingAsPlayerId;
        }
    },

    // ==================== GAME MANAGEMENT ====================

    async createNewGame() {
        const gameType = document.getElementById('menu-game-type-select').value;
        this.log(`Creating new ${gameType} game...`);

        const response = await API.createGame(gameType);
        if (response.success) {
            this.handleGameResponse(response);
            this.saveGameId(response.gameState.id);
            this.populateMenuPlayerDropdown();
            this.updateGameMenuUI();
            this.log(`Game created: ${response.gameState.id}`, 'success');
        } else {
            this.log(`Error: ${response.errorMessage}`, 'error');
        }
    },

    async loadGameById() {
        const gameId = document.getElementById('menu-game-id-input').value.trim();
        if (!gameId) {
            this.log('Please enter a game ID', 'error');
            return;
        }

        this.log(`Loading game ${gameId}...`);
        const response = await API.getGame(gameId);
        if (response.success) {
            this.handleGameResponse(response);
            this.saveGameId(gameId);
            this.populateMenuPlayerDropdown();
            this.updateGameMenuUI();
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
        document.getElementById('menu-game-id-input').value = gameId;
    },

    loadSavedGameId() {
        const savedGameId = localStorage.getItem('catan_current_game');
        if (savedGameId) {
            document.getElementById('menu-game-id-input').value = savedGameId;
        }
    },

    // ==================== PLAYER SELECTION ====================

    onPlayingAsChanged(playerId) {
        this.playingAsPlayerId = playerId;
        this.savePlayingAsPlayer(playerId);
        this.updateHeaderPlayingAs();
        this.renderPlayers();
        this.renderActions();
        this.log(`Now playing as ${this.getPlayerName(playerId)}`);
    },

    updateHeaderPlayingAs() {
        const playingAsDisplay = document.getElementById('playing-as-display');
        if (this.playingAsPlayerId && this.currentGame?.players) {
            const player = this.currentGame.players.find(p => p.id === this.playingAsPlayerId);
            if (player) {
                playingAsDisplay.textContent = player.name;
                playingAsDisplay.style.color = this.getPlayerCSSColor(player.color);
                return;
            }
        }
        playingAsDisplay.textContent = 'No player selected';
        playingAsDisplay.style.color = '#aaa';
    },

    savePlayingAsPlayer(playerId) {
        if (this.currentGameId && playerId) {
            // Use sessionStorage so each browser tab can be a different player
            sessionStorage.setItem(`catan_playing_as_${this.currentGameId}`, playerId);
        }
    },

    loadPlayingAsPlayer() {
        if (this.currentGameId) {
            // Use sessionStorage so each browser tab can be a different player
            const savedPlayerId = sessionStorage.getItem(`catan_playing_as_${this.currentGameId}`);
            if (savedPlayerId && this.currentGame?.players?.some(p => p.id === savedPlayerId)) {
                return savedPlayerId;
            }
        }
        // Default to first player if no saved selection
        return this.currentGame?.players?.[0]?.id || null;
    },

    populatePlayerDropdown() {
        // Load the saved player selection
        this.playingAsPlayerId = this.loadPlayingAsPlayer();
    },

    getPlayerName(playerId) {
        const player = this.currentGame?.players?.find(p => p.id === playerId);
        return player?.name || playerId;
    },

    isMyTurn() {
        if (!this.playingAsPlayerId || !this.currentGame?.phase?.currentPlayerId) {
            return false;
        }
        return this.playingAsPlayerId === this.currentGame.phase.currentPlayerId;
    },

    // ==================== AUTO-REFRESH ====================

    startAutoRefresh() {
        this.stopAutoRefresh(); // Clear any existing interval
        if (this.currentGameId) {
            this.autoRefreshInterval = setInterval(() => {
                this.autoRefresh();
            }, this.autoRefreshDelay);
        }
    },

    stopAutoRefresh() {
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
            this.autoRefreshInterval = null;
        }
    },

    async autoRefresh() {
        if (!this.currentGameId) return;

        // Stop auto-refresh if disabled or game is over
        if (!this.autoRefreshEnabled || this.currentGame?.phase?.phaseState === 'GameOver') {
            this.stopAutoRefresh();
            return;
        }

        // Don't refresh if user is in the middle of a selection or modal
        if (this.selectionMode) return;
        if (!document.getElementById('trade-modal').classList.contains('hidden')) return;
        if (!document.getElementById('discard-modal').classList.contains('hidden')) return;
        if (!document.getElementById('resource-modal').classList.contains('hidden')) return;
        if (!document.getElementById('player-trade-modal').classList.contains('hidden')) return;
        if (!document.getElementById('respond-trade-modal').classList.contains('hidden')) return;
        if (!document.getElementById('accept-trade-modal').classList.contains('hidden')) return;
        if (!document.getElementById('game-menu-modal').classList.contains('hidden')) return;

        try {
            const response = await API.getGame(this.currentGameId);
            if (response.success) {
                this.handleGameResponse(response);
            }
        } catch (e) {
            // Silently ignore auto-refresh errors
            console.log('Auto-refresh failed:', e);
        }
    },

    handleGameResponse(response) {
        this.currentGame = response.gameState;
        this.currentGameId = response.gameState.id;
        this.possibleActions = response.possibleActions || [];

        this.displayGame();
        this.updateUI();

        // Start auto-refresh if enabled and not already running
        if (this.autoRefreshEnabled && !this.autoRefreshInterval) {
            this.startAutoRefresh();
        }
    },

    displayGame() {
        const game = this.currentGame;

        // Update header
        this.updateHeaderPlayingAs();

        const separators = document.querySelectorAll('.info-separator');
        const currentPlayerEl = document.getElementById('current-player');
        const gamePhaseEl = document.getElementById('game-phase');

        // Update current player (same style as phase - no special color)
        if (game.phase?.currentPlayerId) {
            const currentPlayer = game.players.find(p => p.id === game.phase.currentPlayerId);
            if (currentPlayer) {
                currentPlayerEl.textContent = `Turn: ${currentPlayer.name}`;
            }
        } else {
            currentPlayerEl.textContent = '';
        }

        // Update game phase
        const phaseState = game.phase?.phaseState || '';
        gamePhaseEl.textContent = phaseState;

        // Show/hide separators based on content
        // Order: playing-as | current-player | game-phase
        const hasCurrentPlayer = !!currentPlayerEl.textContent;
        const hasPhase = !!phaseState;
        separators[0].classList.toggle('hidden', !hasCurrentPlayer);
        separators[1].classList.toggle('hidden', !hasCurrentPlayer || !hasPhase);

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

        // Populate player selection dropdown
        this.populatePlayerDropdown();

        // Enable refresh button
        document.getElementById('btn-refresh').disabled = false;
    },

    updateUI() {
        const game = this.currentGame;
        const phase = game?.phase?.phaseState;

        // Show/hide sections based on phase
        const isPlaying = phase && phase !== 'SettingUpBoard' && phase !== 'GameOver';

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

            // Check for special achievements
            const hasLongestRoad = this.currentGame.hasLongestRoadPlayerId === player.id;
            const hasLargestArmy = this.currentGame.hasLargestArmyPlayerId === player.id;
            const badges = [];
            if (hasLongestRoad) badges.push('<span class="player-badge road-badge" title="Longest Road">LR</span>');
            if (hasLargestArmy) badges.push('<span class="player-badge army-badge" title="Largest Army">LA</span>');

            let html = `
                <div class="player-card-header">
                    <div class="player-name">${player.name} ${player.isBot ? '(Bot)' : ''} ${badges.join(' ')}</div>
                    ${isSetup ? `<button class="remove-btn" data-player-id="${player.id}">Remove</button>` : ''}
                </div>
                <div class="player-stats">
                    VP: ${player.victoryPoints} |
                    Cards: ${player.resourceCount} |
                    Dev: ${player.developmentCardCount}
                </div>
            `;

            // Show resources only for the player selected in "Playing as" dropdown
            if (player.id === this.playingAsPlayerId && player.resources) {
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

        const name = document.getElementById('menu-player-name-input').value.trim();
        const color = document.getElementById('menu-player-color-select').value;
        const isBot = document.getElementById('menu-player-is-bot').checked;

        if (!name) {
            this.log('Please enter a player name', 'error');
            return;
        }

        this.log(`Adding player ${name}...`);
        const response = await API.addPlayer(this.currentGameId, name, isBot, color || null);

        if (response.success) {
            this.handleGameResponse(response);
            document.getElementById('menu-player-name-input').value = '';
            this.populateMenuPlayerDropdown();
            this.updateGameMenuUI();
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
            this.populateMenuPlayerDropdown();
            this.updateGameMenuUI();
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
            this.closeModal('game-menu-modal');
            this.log('Game started!', 'success');
        } else {
            this.log(`Error: ${response.errorMessage}`, 'error');
        }
    },

    // ==================== ACTIONS ====================

    renderActions() {
        const container = document.getElementById('actions-list');
        const waitingMessage = document.getElementById('waiting-message');
        container.innerHTML = '';

        // Check if there's a RespondToTrade action (any player can respond)
        const hasRespondToTrade = this.possibleActions?.some(a => a.action === 'RespondToTrade');

        // Check if game is in trading phase and there's an active trade
        // Non-current players should be able to respond to trades
        const isInTradingPhase = this.currentGame?.phase?.phaseState === 'RespondToTrade';

        // Find the original trade to determine who initiated it
        const pendingResponses = this.currentGame?.phase?.pendingTradeResponses || [];
        const originalTrade = pendingResponses.find(r => r.responseType === 'Original');
        const tradeInitiatorId = originalTrade?.playerId;

        // Non-initiators can respond to the trade
        const canRespondToTrade = isInTradingPhase &&
                                   this.playingAsPlayerId &&
                                   this.playingAsPlayerId !== tradeInitiatorId;

        // Check if it's the selected player's turn (or if RespondToTrade is available)
        const isMyTurn = this.isMyTurn();

        if (!isMyTurn && !hasRespondToTrade && !canRespondToTrade) {
            // Show waiting message
            const currentPlayerName = this.getPlayerName(this.currentGame?.phase?.currentPlayerId);
            waitingMessage.textContent = `Waiting on ${currentPlayerName}`;
            waitingMessage.classList.remove('hidden');
            container.innerHTML = '';
            return;
        } else {
            waitingMessage.classList.add('hidden');
        }

        if ((!this.possibleActions || this.possibleActions.length === 0) && !canRespondToTrade) {
            container.innerHTML = '<div class="log-entry">No actions available</div>';
            return;
        }

        // Filter actions - show RespondToTrade for everyone, other actions only for current player
        const actionsToShow = this.possibleActions?.filter(action => {
            if (action.action === 'RespondToTrade') {
                return true; // Anyone can respond to trade
            }
            return isMyTurn; // Other actions only for current player
        }) || [];

        // Render action buttons
        actionsToShow.forEach(action => {
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

                case 'TradeWithPlayers':
                    btn.textContent = 'Trade with Players';
                    btn.onclick = () => this.showPlayerTradeModal();
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

                case 'RespondToTrade':
                    btn.textContent = 'Respond to Trade';
                    btn.classList.add('highlight');
                    btn.onclick = () => this.showRespondToTradeModal(action);
                    break;

                case 'AcceptTrade':
                    // Find players who have accepted the trade
                    const acceptedResponses = pendingResponses.filter(r => r.responseType === 'Accept');
                    btn.textContent = `Accept Trade (${acceptedResponses.length} offers)`;
                    btn.classList.add('highlight');
                    btn.onclick = () => this.showAcceptTradeModal(acceptedResponses);
                    break;

                case 'RejectAllOffers':
                    btn.textContent = 'Cancel Trade';
                    btn.classList.add('secondary');
                    btn.onclick = () => this.doCancelTrade();
                    break;

                default:
                    btn.textContent = action.action;
                    btn.disabled = true;
            }

            container.appendChild(btn);
        });

        // If player can respond to a trade but RespondToTrade wasn't in the actions list,
        // add a respond button based on the game state
        if (canRespondToTrade && !hasRespondToTrade) {
            const btn = document.createElement('button');
            btn.className = 'action-btn highlight';
            btn.textContent = 'Respond to Trade';
            btn.onclick = () => this.showRespondToTradeModal(this.currentGame.activeTrade || {});
            container.appendChild(btn);
        }

        // If no actions to show after filtering and no trade response button
        if (actionsToShow.length === 0 && !canRespondToTrade) {
            container.innerHTML = '<div class="log-entry">No actions available</div>';
        }
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

    // ==================== PLAYER TRADE ====================

    showPlayerTradeModal() {
        const playerId = this.currentGame.phase.currentPlayerId;
        const player = this.currentGame.players.find(p => p.id === playerId);
        if (!player) return;

        this.playerTradeOffer = { Brick: 0, Wood: 0, Ore: 0, Grain: 0, Wool: 0 };
        this.playerTradeRequest = { Brick: 0, Wood: 0, Ore: 0, Grain: 0, Wool: 0 };
        this.playerTradePlayerId = playerId;
        this.playerTradeResources = player.resources;

        this.renderPlayerTradeOffer();
        this.renderPlayerTradeRequest();
        this.updatePlayerTradeSummary();
        document.getElementById('player-trade-modal').classList.remove('hidden');
    },

    renderPlayerTradeOffer() {
        const container = document.getElementById('player-trade-offer');
        container.innerHTML = '';

        const resources = ['Brick', 'Wood', 'Ore', 'Grain', 'Wool'];
        resources.forEach(resource => {
            const available = this.playerTradeResources[resource] || 0;
            const selected = this.playerTradeOffer[resource] || 0;

            const div = document.createElement('div');
            div.className = `trade-resource-row resource-${resource}`;
            div.innerHTML = `
                <span class="resource-name">${resource}</span>
                <span class="resource-available">(${available})</span>
                <button class="trade-btn minus" data-resource="${resource}" ${selected <= 0 ? 'disabled' : ''}>-</button>
                <span class="resource-count">${selected}</span>
                <button class="trade-btn plus" data-resource="${resource}" ${selected >= available ? 'disabled' : ''}>+</button>
            `;

            div.querySelector('.minus').onclick = () => this.adjustPlayerTradeOffer(resource, -1);
            div.querySelector('.plus').onclick = () => this.adjustPlayerTradeOffer(resource, 1);

            container.appendChild(div);
        });
    },

    renderPlayerTradeRequest() {
        const container = document.getElementById('player-trade-request');
        container.innerHTML = '';

        const resources = ['Brick', 'Wood', 'Ore', 'Grain', 'Wool'];
        resources.forEach(resource => {
            const selected = this.playerTradeRequest[resource] || 0;

            const div = document.createElement('div');
            div.className = `trade-resource-row resource-${resource}`;
            div.innerHTML = `
                <span class="resource-name">${resource}</span>
                <button class="trade-btn minus" data-resource="${resource}" ${selected <= 0 ? 'disabled' : ''}>-</button>
                <span class="resource-count">${selected}</span>
                <button class="trade-btn plus" data-resource="${resource}">+</button>
            `;

            div.querySelector('.minus').onclick = () => this.adjustPlayerTradeRequest(resource, -1);
            div.querySelector('.plus').onclick = () => this.adjustPlayerTradeRequest(resource, 1);

            container.appendChild(div);
        });
    },

    adjustPlayerTradeOffer(resource, delta) {
        const available = this.playerTradeResources[resource] || 0;
        const current = this.playerTradeOffer[resource] || 0;
        const newValue = Math.max(0, Math.min(available, current + delta));
        this.playerTradeOffer[resource] = newValue;
        this.renderPlayerTradeOffer();
        this.updatePlayerTradeSummary();
    },

    adjustPlayerTradeRequest(resource, delta) {
        const current = this.playerTradeRequest[resource] || 0;
        const newValue = Math.max(0, current + delta);
        this.playerTradeRequest[resource] = newValue;
        this.renderPlayerTradeRequest();
        this.updatePlayerTradeSummary();
    },

    updatePlayerTradeSummary() {
        const summary = document.getElementById('player-trade-summary');
        const confirmBtn = document.getElementById('btn-confirm-player-trade');

        const offerTotal = Object.values(this.playerTradeOffer).reduce((a, b) => a + b, 0);
        const requestTotal = Object.values(this.playerTradeRequest).reduce((a, b) => a + b, 0);

        if (offerTotal === 0 || requestTotal === 0) {
            summary.textContent = 'Select resources to offer and request';
            confirmBtn.disabled = true;
            return;
        }

        // Build summary text
        const offerText = Object.entries(this.playerTradeOffer)
            .filter(([_, v]) => v > 0)
            .map(([r, v]) => `${v} ${r}`)
            .join(', ');

        const requestText = Object.entries(this.playerTradeRequest)
            .filter(([_, v]) => v > 0)
            .map(([r, v]) => `${v} ${r}`)
            .join(', ');

        summary.textContent = `Offer: ${offerText} | Request: ${requestText}`;
        confirmBtn.disabled = false;
    },

    async confirmPlayerTrade() {
        // Build offer and request objects with non-zero values only
        const offer = {};
        const request = {};

        Object.entries(this.playerTradeOffer).forEach(([resource, count]) => {
            if (count > 0) offer[resource] = count;
        });

        Object.entries(this.playerTradeRequest).forEach(([resource, count]) => {
            if (count > 0) request[resource] = count;
        });

        this.closeModal('player-trade-modal');
        this.log('Opening trade with other players...');

        const response = await API.openTrade(
            this.currentGameId,
            this.playerTradePlayerId,
            offer,
            request
        );

        if (response.success) {
            this.handleGameResponse(response);
            this.log('Trade offer sent to other players', 'success');
        } else {
            this.log(`Error: ${response.errorMessage}`, 'error');
        }
    },

    async doCancelTrade() {
        this.log('Cancelling trade...');

        const response = await API.rejectAllOffers(
            this.currentGameId,
            this.playingAsPlayerId
        );

        if (response.success) {
            this.handleGameResponse(response);
            this.log('Trade cancelled', 'success');
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

    showRespondToTradeModal(action) {
        // Find the original trade offer from pendingTradeResponses
        const pendingResponses = this.currentGame?.phase?.pendingTradeResponses || [];
        const originalTrade = pendingResponses.find(r => r.responseType === 'Original');

        if (!originalTrade) {
            this.log('No trade offer found', 'error');
            return;
        }

        const initiatorId = originalTrade.playerId;
        const initiatorName = this.getPlayerName(initiatorId);

        // Store for later use
        this.pendingTradeResponse = {
            playerId: this.playingAsPlayerId
        };

        // Display who is offering the trade
        document.getElementById('respond-trade-from').textContent = `${initiatorName} offers:`;

        // Display what they're offering (we get, so it's good for us)
        const offerContainer = document.getElementById('respond-trade-offer');
        offerContainer.innerHTML = '';
        const offer = originalTrade.offer || {};
        Object.entries(offer).forEach(([resource, count]) => {
            if (count > 0) {
                const div = document.createElement('div');
                div.className = `trade-resource-item resource-${resource}`;
                div.textContent = `${count} ${resource}`;
                offerContainer.appendChild(div);
            }
        });
        if (Object.keys(offer).length === 0 || Object.values(offer).every(v => v === 0)) {
            offerContainer.innerHTML = '<div class="trade-resource-item">Nothing</div>';
        }

        // Display what they're requesting (we give, so it costs us)
        const requestContainer = document.getElementById('respond-trade-request');
        requestContainer.innerHTML = '';
        const request = originalTrade.request || {};
        Object.entries(request).forEach(([resource, count]) => {
            if (count > 0) {
                const div = document.createElement('div');
                div.className = `trade-resource-item resource-${resource}`;
                div.textContent = `${count} ${resource}`;
                requestContainer.appendChild(div);
            }
        });
        if (Object.keys(request).length === 0 || Object.values(request).every(v => v === 0)) {
            requestContainer.innerHTML = '<div class="trade-resource-item">Nothing</div>';
        }

        document.getElementById('respond-trade-modal').classList.remove('hidden');
    },

    async acceptTradeOffer() {
        this.closeModal('respond-trade-modal');
        this.log('Accepting trade offer...');

        const response = await API.respondToTrade(
            this.currentGameId,
            this.playingAsPlayerId,
            'Accept'
        );

        if (response.success) {
            this.handleGameResponse(response);
            this.log('Trade accepted', 'success');
        } else {
            this.log(`Error: ${response.errorMessage}`, 'error');
        }
    },

    async rejectTradeOffer() {
        this.closeModal('respond-trade-modal');
        this.log('Rejecting trade offer...');

        const response = await API.respondToTrade(
            this.currentGameId,
            this.playingAsPlayerId,
            'Reject'
        );

        if (response.success) {
            this.handleGameResponse(response);
            this.log('Trade rejected', 'success');
        } else {
            this.log(`Error: ${response.errorMessage}`, 'error');
        }
    },

    showAcceptTradeModal(acceptedResponses) {
        // If only one player accepted, accept directly
        if (acceptedResponses.length === 1) {
            this.doAcceptTrade(acceptedResponses[0].playerId);
            return;
        }

        // Show modal to select which player's acceptance to take
        const container = document.getElementById('accept-trade-players');
        container.innerHTML = '';

        acceptedResponses.forEach(response => {
            const playerName = this.getPlayerName(response.playerId);
            const player = this.currentGame?.players?.find(p => p.id === response.playerId);

            const btn = document.createElement('button');
            btn.className = 'action-btn';
            btn.style.borderLeftColor = this.getPlayerCSSColor(player?.color);
            btn.textContent = playerName;
            btn.onclick = () => {
                this.closeModal('accept-trade-modal');
                this.doAcceptTrade(response.playerId);
            };
            container.appendChild(btn);
        });

        document.getElementById('accept-trade-modal').classList.remove('hidden');
    },

    async doAcceptTrade(acceptedPlayerId) {
        this.log(`Accepting trade from ${this.getPlayerName(acceptedPlayerId)}...`);

        const response = await API.acceptTrade(
            this.currentGameId,
            this.playingAsPlayerId,
            acceptedPlayerId
        );

        if (response.success) {
            this.handleGameResponse(response);
            this.log('Trade completed!', 'success');
        } else {
            this.log(`Error: ${response.errorMessage}`, 'error');
        }
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
