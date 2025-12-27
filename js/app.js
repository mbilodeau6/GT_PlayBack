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
        document.getElementById('auto-refresh-toggle').addEventListener('change', (e) => this.setAutoRefreshEnabled(e.target.checked));

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
        document.getElementById('btn-close-game-over').addEventListener('click', () => this.closeModal('game-over-modal'));
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
        // Update auto-refresh checkbox
        document.getElementById('auto-refresh-toggle').checked = this.autoRefreshEnabled;
        // Show/hide player management section based on game phase
        this.updateGameMenuUI();
        document.getElementById('game-menu-modal').classList.remove('hidden');
    },

    updateGameMenuUI() {
        const isSetup = this.currentGame?.phase?.phaseState === 'SettingUpBoard';
        const hasGame = !!this.currentGame;

        // Show player management only during setup
        document.getElementById('menu-player-management').classList.toggle('hidden', !isSetup);

        // Show playing as dropdown whenever a game is loaded (even during setup)
        document.getElementById('menu-playing-as-container').classList.toggle('hidden', !hasGame);

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

        // Re-apply selectable elements if in selection mode (board render clears them)
        if (this.selectionMode && this.selectableIds?.length > 0) {
            Board.setSelectableElements(this.selectionMode, this.selectableIds);
        }

        // Render players
        this.renderPlayers();

        // Populate player selection dropdown
        this.populatePlayerDropdown();

        // Render event log
        this.renderEventLog();

        // Enable refresh button
        document.getElementById('btn-refresh').disabled = false;

        // Check for game over
        this.checkAndShowGameOver();
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

            // Count played knights
            const knightCount = (player.devCardsPlayed || []).filter(c => c === 'Knight').length;

            // Build VP display - show full VP in brackets if different (only for "Playing as" player)
            let vpDisplay = `<span class="stat-value">${player.victoryPoints}</span>`;
            if (player.id === this.playingAsPlayerId &&
                player.fullVictoryPoints !== undefined &&
                player.fullVictoryPoints !== player.victoryPoints) {
                vpDisplay += ` <span class="stat-value">(${player.fullVictoryPoints})</span>`;
            }

            let html = `
                <div class="player-card-header">
                    <div class="player-name">${player.name} ${player.isBot ? '(Bot)' : ''} ${badges.join(' ')}</div>
                    ${isSetup ? `<button class="remove-btn" data-player-id="${player.id}">Remove</button>` : ''}
                </div>
                <div class="player-stats">
                    VP: ${vpDisplay} |
                    Cards: <span class="stat-value">${player.resourceCount}</span> |
                    Dev: <span class="stat-value">${player.developmentCardCount}</span> |
                    Knights: <span class="stat-value">${knightCount}</span>
                </div>
            `;

            // Show resources only for the player selected in "Playing as" dropdown
            if (player.id === this.playingAsPlayerId && player.resources) {
                const res = player.resources;

                // Build dev cards display for the "Playing as" player
                const devCardsHtml = this.renderDevCardsDisplay(player);

                html += `<div class="player-resources-row">
                    <div class="player-resources">
                        <span class="resource-box resource-Brick" title="Brick: ${res.Brick}">${res.Brick}</span>
                        <span class="resource-box resource-Wood" title="Wood: ${res.Wood}">${res.Wood}</span>
                        <span class="resource-box resource-Ore" title="Ore: ${res.Ore}">${res.Ore}</span>
                        <span class="resource-box resource-Grain" title="Grain: ${res.Grain}">${res.Grain}</span>
                        <span class="resource-box resource-Wool" title="Wool: ${res.Wool}">${res.Wool}</span>
                    </div>
                    ${devCardsHtml}
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
                    if (acceptedResponses.length === 1) {
                        const acceptingPlayerName = this.getPlayerName(acceptedResponses[0].playerId);
                        btn.textContent = `Accept Trade (${acceptingPlayerName})`;
                    } else {
                        btn.textContent = `Accept Trade (${acceptedResponses.length} offers)`;
                    }
                    btn.classList.add('highlight');
                    btn.onclick = () => this.showAcceptTradeModal(acceptedResponses);
                    break;

                case 'RejectAllOffers':
                    btn.textContent = 'Cancel Trade';
                    btn.classList.add('secondary');
                    btn.onclick = () => this.doCancelTrade();
                    break;

                case 'SelectTarget':
                    btn.textContent = 'Select Target';
                    btn.classList.add('highlight');
                    btn.onclick = () => this.showSelectTargetModal(action.playerIds);
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

        // Auto-trigger actions when there's only one mandatory action available
        // This skips the button click for actions the player must perform
        const discardModalOpen = !document.getElementById('discard-modal').classList.contains('hidden');
        if (isMyTurn && actionsToShow.length === 1 && !this.selectionMode && !discardModalOpen) {
            const action = actionsToShow[0];
            const playerId = this.currentGame.phase.currentPlayerId;

            if (action.action === 'PlaceSettlement' && action.vertexIds?.length > 0) {
                this.startSelection('vertex', action.vertexIds, playerId, 'PlaceSettlement');
            } else if (action.action === 'PlaceRoad' && action.edgeIds?.length > 0) {
                this.startSelection('edge', action.edgeIds, playerId, 'PlaceRoad');
            } else if (action.action === 'PlaceRobber' && action.tileIds?.length > 0) {
                this.startSelection('tile', action.tileIds, playerId, 'PlaceRobber');
            } else if (action.action === 'DiscardCards') {
                const player = this.currentGame.players.find(p => p.id === playerId);
                const discardCount = player ? Math.floor(player.resourceCount / 2) : 0;
                this.showDiscardModal({ ...action, count: discardCount });
            }
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
        } else {
            this.log(`Error: ${response?.errorMessage}`, 'error');
        }
    },

    // ==================== GAME ACTIONS ====================

    async doRollDice(playerId) {
        const response = await API.rollDice(this.currentGameId);

        if (response.success) {
            this.handleGameResponse(response);
        } else {
            this.log(`Error: ${response.errorMessage}`, 'error');
        }
    },

    async doEndTurn(playerId) {
        const response = await API.endTurn(this.currentGameId);

        if (response.success) {
            this.handleGameResponse(response);
        } else {
            this.log(`Error: ${response.errorMessage}`, 'error');
        }
    },

    async doBuyDevCard(playerId) {
        const response = await API.buyDevCard(this.currentGameId, playerId);

        if (response.success) {
            this.handleGameResponse(response);
        } else {
            this.log(`Error: ${response.errorMessage}`, 'error');
        }
    },

    async doPlayRoadBuilding(playerId) {
        const response = await API.playRoadBuilding(this.currentGameId, playerId);

        if (response.success) {
            this.handleGameResponse(response);
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

        const resources = player.resources;

        Object.entries(resources).forEach(([resource, count]) => {
            for (let i = 0; i < count; i++) {
                const card = document.createElement('div');
                card.className = `trade-card resource-box resource-${resource}`;
                card.title = resource;
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
            option.className = `trade-card resource-box resource-${resource}`;
            option.title = resource;
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
        // Toggle off if clicking the same one
        if (this.selectedTradeRequest === resource) {
            option.classList.remove('selected');
            this.selectedTradeRequest = null;
        } else {
            // Deselect previous
            document.querySelectorAll('#trade-request-options .trade-card').forEach(el => {
                el.classList.remove('selected');
            });
            option.classList.add('selected');
            this.selectedTradeRequest = resource;
        }
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

        const response = await API.tradeWithBank(this.currentGameId, playerId, offer, request);

        if (response.success) {
            this.handleGameResponse(response);
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

        this.renderPlayerTradeResources();
        this.updatePlayerTradeSummary();
        document.getElementById('player-trade-modal').classList.remove('hidden');
    },

    renderPlayerTradeResources() {
        const container = document.getElementById('player-trade-resources');
        container.innerHTML = '';

        const resources = ['Brick', 'Wood', 'Ore', 'Grain', 'Wool'];
        resources.forEach(resource => {
            const available = this.playerTradeResources[resource] || 0;
            const offerCount = this.playerTradeOffer[resource] || 0;
            const requestCount = this.playerTradeRequest[resource] || 0;

            const row = document.createElement('div');
            row.className = 'trade-unified-row';
            row.innerHTML = `
                <span class="resource-box resource-${resource}" title="${resource}"></span>
                <span class="trade-available">${available}</span>
                <div class="trade-controls offer-controls">
                    <button class="trade-btn minus offer-minus" ${offerCount <= 0 ? 'disabled' : ''}>-</button>
                    <span class="trade-count offer-count">${offerCount}</span>
                    <button class="trade-btn plus offer-plus" ${offerCount >= available ? 'disabled' : ''}>+</button>
                </div>
                <div class="trade-controls request-controls">
                    <button class="trade-btn minus request-minus" ${requestCount <= 0 ? 'disabled' : ''}>-</button>
                    <span class="trade-count request-count">${requestCount}</span>
                    <button class="trade-btn plus request-plus">+</button>
                </div>
            `;

            row.querySelector('.offer-minus').onclick = () => this.adjustPlayerTradeOffer(resource, -1);
            row.querySelector('.offer-plus').onclick = () => this.adjustPlayerTradeOffer(resource, 1);
            row.querySelector('.request-minus').onclick = () => this.adjustPlayerTradeRequest(resource, -1);
            row.querySelector('.request-plus').onclick = () => this.adjustPlayerTradeRequest(resource, 1);

            container.appendChild(row);
        });
    },

    adjustPlayerTradeOffer(resource, delta) {
        const available = this.playerTradeResources[resource] || 0;
        const current = this.playerTradeOffer[resource] || 0;
        const newValue = Math.max(0, Math.min(available, current + delta));
        this.playerTradeOffer[resource] = newValue;
        this.renderPlayerTradeResources();
        this.updatePlayerTradeSummary();
    },

    adjustPlayerTradeRequest(resource, delta) {
        const current = this.playerTradeRequest[resource] || 0;
        const newValue = Math.max(0, current + delta);
        this.playerTradeRequest[resource] = newValue;
        this.renderPlayerTradeResources();
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

        const response = await API.openTrade(
            this.currentGameId,
            this.playerTradePlayerId,
            offer,
            request
        );

        if (response.success) {
            this.handleGameResponse(response);
        } else {
            this.log(`Error: ${response.errorMessage}`, 'error');
        }
    },

    async doCancelTrade() {
        const response = await API.rejectAllOffers(
            this.currentGameId,
            this.playingAsPlayerId
        );

        if (response.success) {
            this.handleGameResponse(response);
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
        const resources = player.resources;
        Object.entries(resources).forEach(([resource, count]) => {
            for (let i = 0; i < count; i++) {
                const card = document.createElement('div');
                card.className = `discard-card resource-box resource-${resource}`;
                card.title = resource;
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

        const response = await API.discardCards(
            this.currentGameId,
            this.discardPlayerId,
            this.selectedDiscards
        );

        if (response.success) {
            this.handleGameResponse(response);
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
            this.doSteal(playerId, action.targetPlayerIds[0]);
        }
    },

    async doSteal(playerId, targetPlayerId) {
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
        const offerEntries = Object.entries(offer).filter(([_, count]) => count > 0);
        if (offerEntries.length > 0) {
            const boxContainer = document.createElement('div');
            boxContainer.className = 'trade-resource-boxes';
            offerEntries.forEach(([resource, count]) => {
                const span = document.createElement('span');
                span.className = `resource-box resource-${resource}`;
                span.title = `${count} ${resource}`;
                span.textContent = count;
                boxContainer.appendChild(span);
            });
            offerContainer.appendChild(boxContainer);
        } else {
            offerContainer.innerHTML = '<div class="trade-resource-item">Nothing</div>';
        }

        // Display what they're requesting (we give, so it costs us)
        const requestContainer = document.getElementById('respond-trade-request');
        requestContainer.innerHTML = '';
        const request = originalTrade.request || {};
        const requestEntries = Object.entries(request).filter(([_, count]) => count > 0);
        if (requestEntries.length > 0) {
            const boxContainer = document.createElement('div');
            boxContainer.className = 'trade-resource-boxes';
            requestEntries.forEach(([resource, count]) => {
                const span = document.createElement('span');
                span.className = `resource-box resource-${resource}`;
                span.title = `${count} ${resource}`;
                span.textContent = count;
                boxContainer.appendChild(span);
            });
            requestContainer.appendChild(boxContainer);
        } else {
            requestContainer.innerHTML = '<div class="trade-resource-item">Nothing</div>';
        }

        document.getElementById('respond-trade-modal').classList.remove('hidden');
    },

    async acceptTradeOffer() {
        this.closeModal('respond-trade-modal');

        const response = await API.respondToTrade(
            this.currentGameId,
            this.playingAsPlayerId,
            'Accept'
        );

        if (response.success) {
            this.handleGameResponse(response);
        } else {
            this.log(`Error: ${response.errorMessage}`, 'error');
        }
    },

    async rejectTradeOffer() {
        this.closeModal('respond-trade-modal');

        const response = await API.respondToTrade(
            this.currentGameId,
            this.playingAsPlayerId,
            'Reject'
        );

        if (response.success) {
            this.handleGameResponse(response);
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
            btn.className = 'accept-trade-player-btn';
            btn.style.borderLeft = `4px solid ${this.getPlayerCSSColor(player?.color)}`;
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
        const response = await API.acceptTrade(
            this.currentGameId,
            this.playingAsPlayerId,
            acceptedPlayerId
        );

        if (response.success) {
            this.handleGameResponse(response);
        } else {
            this.log(`Error: ${response.errorMessage}`, 'error');
        }
    },

    // ==================== SELECT TARGET ====================

    showSelectTargetModal(playerIds) {
        const container = document.getElementById('select-target-players');
        container.innerHTML = '';

        playerIds.forEach(playerId => {
            const playerName = this.getPlayerName(playerId);
            const player = this.currentGame?.players?.find(p => p.id === playerId);

            const btn = document.createElement('button');
            btn.className = 'select-target-player-btn';
            btn.style.borderLeft = `4px solid ${this.getPlayerCSSColor(player?.color)}`;
            btn.textContent = playerName;
            btn.onclick = () => {
                this.closeModal('select-target-modal');
                this.doSelectTarget(playerId);
            };
            container.appendChild(btn);
        });

        document.getElementById('select-target-modal').classList.remove('hidden');
    },

    async doSelectTarget(targetPlayerId) {
        const response = await API.selectTarget(
            this.currentGameId,
            this.playingAsPlayerId,
            targetPlayerId
        );

        if (response.success) {
            this.handleGameResponse(response);
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
            div.className = `resource-option resource-box resource-${resource}`;
            div.dataset.resource = resource;
            div.title = resource;

            // For maxSelect > 1, show count
            if (maxSelect > 1) {
                div.innerHTML = `<span class="resource-count" data-resource="${resource}">0</span>`;
                div.onclick = () => this.incrementResourceOption(resource);
            } else {
                // For single-select (Monopoly), no count needed
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
            response = await API.playYearOfPlenty(
                this.currentGameId,
                this.resourceModalPlayerId,
                this.selectedResources[0],
                this.selectedResources[1]
            );
        } else if (this.resourceModalType === 'Monopoly') {
            response = await API.playMonopoly(
                this.currentGameId,
                this.resourceModalPlayerId,
                this.selectedResources[0]
            );
        }

        if (response?.success) {
            this.handleGameResponse(response);
        } else {
            this.log(`Error: ${response?.errorMessage}`, 'error');
        }
    },

    closeModal(modalId) {
        document.getElementById(modalId).classList.add('hidden');
    },

    // ==================== GAME OVER ====================

    checkAndShowGameOver() {
        const game = this.currentGame;
        if (!game || game.phase?.phaseState !== 'GameOver') return;

        // Don't show if already showing
        const modal = document.getElementById('game-over-modal');
        if (!modal.classList.contains('hidden')) return;

        // Find the winner (player with most victory points, or who reached victoryPointsToWin)
        const victoryPointsToWin = game.settings?.victoryPointsToWin || 10;
        let winner = null;

        // First check if any player has reached victory points to win
        for (const player of game.players) {
            if (player.victoryPoints >= victoryPointsToWin) {
                winner = player;
                break;
            }
        }

        // If no one reached the threshold, find player with most VP
        if (!winner) {
            winner = game.players.reduce((prev, current) =>
                (prev.victoryPoints > current.victoryPoints) ? prev : current
            );
        }

        // Determine the message based on who is playing as
        const messageEl = document.getElementById('game-over-message');
        const isWinner = this.playingAsPlayerId === winner.id;

        if (isWinner) {
            messageEl.textContent = "You've Won!";
            messageEl.className = 'winner';
        } else {
            messageEl.textContent = `${winner.name} has won.`;
            messageEl.className = '';
        }

        // Show final standings
        const statsEl = document.getElementById('game-over-stats');
        const sortedPlayers = [...game.players].sort((a, b) => b.victoryPoints - a.victoryPoints);

        statsEl.innerHTML = sortedPlayers.map(player => {
            const isPlayerWinner = player.id === winner.id;
            return `
                <div class="player-score ${isPlayerWinner ? 'winner' : ''}" style="border-left: 3px solid ${this.getPlayerCSSColor(player.color)}">
                    <span class="player-name">${player.name}</span>
                    <span class="player-vp">${player.victoryPoints} VP</span>
                </div>
            `;
        }).join('');

        // Show the modal
        modal.classList.remove('hidden');
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

    renderDevCardsDisplay(player) {
        const cardLetters = {
            'Knight': 'K',
            'YearOfPlenty': 'Y',
            'Monopoly': 'M',
            'RoadBuilding': 'R'
        };

        const cardNames = {
            'Knight': 'Knight',
            'YearOfPlenty': 'Year of Plenty',
            'Monopoly': 'Monopoly',
            'RoadBuilding': 'Road Building'
        };

        // Get cards ready to play (white) - exclude VictoryPoint
        const readyCards = (player.devCardsReadyToPlay || [])
            .filter(c => c !== 'VictoryPoint')
            .map(c => ({ type: c, available: true }));

        // Get cards purchased this round (grey) - exclude VictoryPoint
        const purchasedCards = (player.devCardsPurchasedThisRound || [])
            .filter(c => c !== 'VictoryPoint')
            .map(c => ({ type: c, available: false }));

        const allCards = [...readyCards, ...purchasedCards];

        if (allCards.length === 0) {
            return '';
        }

        const cardSpans = allCards.map(card => {
            const letter = cardLetters[card.type] || '?';
            const name = cardNames[card.type] || card.type;
            const colorClass = card.available ? 'dev-card-ready' : 'dev-card-purchased';
            const statusText = card.available ? '(Ready)' : '(Purchased this turn)';
            return `<span class="dev-card-letter ${colorClass}" title="${name} ${statusText}">${letter}</span>`;
        }).join('');

        return `<div class="player-dev-cards">(${cardSpans})</div>`;
    },

    // ==================== EVENT RECORD DISPLAY ====================

    formatResources(resources) {
        if (!resources) return '';
        const entries = Object.entries(resources).filter(([_, count]) => count > 0);
        if (entries.length === 0) return '';

        const parts = entries.map(([resource, count]) => `${count} ${resource}`);
        if (parts.length === 1) return parts[0];
        if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
        return parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1];
    },

    formatEventRecord(event) {
        const playerName = this.getPlayerName(event.playerId);
        const targetName = event.targetPlayerId ? this.getPlayerName(event.targetPlayerId) : '';
        const id = event.id;

        switch (event.action) {
            case 'RollDice':
                return `${playerName} rolled ${event.diceRoll}. [${id}]`;

            case 'PlaceFirstSettlement':
                return `${playerName} placed first settlement at ${event.vertexId}. [${id}]`;

            case 'PlaceSecondSettlement': {
                let msg = `${playerName} placed second settlement at ${event.vertexId}`;
                if (event.resourcesReceived) {
                    msg += ` and received ${this.formatResources(event.resourcesReceived)}`;
                }
                return `${msg}. [${id}]`;
            }

            case 'PlaceSettlement':
                return `${playerName} built a settlement at ${event.vertexId}. [${id}]`;

            case 'UpgradeSettlement':
                return `${playerName} upgraded to city at ${event.vertexId}. [${id}]`;

            case 'PlaceRoad':
                return `${playerName} built a road at ${event.edgeId}. [${id}]`;

            case 'PlaceRobber':
                return `${playerName} moved the robber to ${event.tileId}. [${id}]`;

            case 'SelectTarget':
                return `${playerName} selected ${targetName} as target. [${id}]`;

            case 'StealResource': {
                let msg = `${playerName} stole`;
                if (event.resourcesReceived) {
                    msg += ` ${this.formatResources(event.resourcesReceived)}`;
                }
                msg += ` from ${targetName}`;
                return `${msg}. [${id}]`;
            }

            case 'DiscardCards': {
                let msg = `${playerName} discarded`;
                if (event.resourcesUsed) {
                    msg += ` ${this.formatResources(event.resourcesUsed)}`;
                }
                return `${msg}. [${id}]`;
            }

            case 'BuyDevelopmentCard': {
                let msg = `${playerName} bought a development card`;
                if (event.developmentCard) {
                    msg += ` (${event.developmentCard})`;
                }
                return `${msg}. [${id}]`;
            }

            case 'PlayKnight':
                return `${playerName} played a Knight card on ${event.tileId}. [${id}]`;

            case 'PlayMonopoly':
            case 'PlayMonoploy': {  // Handle backend typo
                let msg = `${playerName} played a Monopoly card`;
                if (event.resourcesReceived) {
                    msg += ` and took ${this.formatResources(event.resourcesReceived)}`;
                }
                return `${msg}. [${id}]`;
            }

            case 'PlayYearOfPlenty': {
                let msg = `${playerName} played a Year of Plenty card`;
                if (event.resourcesReceived) {
                    msg += ` for ${this.formatResources(event.resourcesReceived)}`;
                }
                return `${msg}. [${id}]`;
            }

            case 'PlayRoadBuilding':
                return `${playerName} played a Road Building card. [${id}]`;

            case 'TradeWithBank': {
                const gave = this.formatResources(event.resourcesUsed);
                const got = this.formatResources(event.resourcesReceived);
                return `${playerName} traded ${gave} for ${got} with bank. [${id}]`;
            }

            case 'OfferToTrade': {
                const offering = this.formatResources(event.resourcesUsed);
                const requesting = this.formatResources(event.resourcesReceived);
                return `${playerName} offered ${offering} for ${requesting}. [${id}]`;
            }

            case 'AcceptTrade':
                return `${playerName} accepted the trade. [${id}]`;

            case 'RejectTrade':
                return `${playerName} rejected all offers. [${id}]`;

            case 'CounterOffer': {
                const offering = this.formatResources(event.resourcesUsed);
                const requesting = this.formatResources(event.resourcesReceived);
                return `${playerName} countered with ${offering} for ${requesting}. [${id}]`;
            }

            case 'TradeWithPlayer': {
                let msg = `${playerName} traded`;
                if (event.resourcesUsed && event.resourcesReceived) {
                    msg += ` ${this.formatResources(event.resourcesUsed)} for ${this.formatResources(event.resourcesReceived)}`;
                }
                if (targetName) {
                    msg += ` with ${targetName}`;
                }
                return `${msg}. [${id}]`;
            }

            case 'ReceivedResources': {
                const resources = this.formatResources(event.resourcesReceived);
                return `${playerName} received ${resources}. [${id}]`;
            }

            default:
                return `${playerName} performed ${event.action}. [${id}]`;
        }
    },

    renderEventLog() {
        const container = document.getElementById('status-log');
        container.innerHTML = '';

        const eventRecord = this.currentGame?.eventRecord;
        if (!eventRecord || eventRecord.length === 0) return;

        // Get last 20 events in chronological order (oldest first, newest last)
        const recentEvents = eventRecord.slice(-20);

        recentEvents.forEach(event => {
            const entry = document.createElement('div');
            entry.className = 'log-entry';
            entry.textContent = this.formatEventRecord(event);
            container.appendChild(entry);
        });

        // Scroll to bottom to show newest event
        container.scrollTop = container.scrollHeight;
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
