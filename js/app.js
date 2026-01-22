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

    // Pan state
    panX: 0,
    panY: 0,
    panStep: 50,

    // Auto-refresh with tiered timing
    autoRefreshInterval: null,
    autoRefreshEnabled: true, // Enabled by default
    autoRefreshPhase: 1, // 1 = fast (2s), 2 = slow (4s)
    autoRefreshCount: 0, // Count within current phase
    autoRefreshMaxFast: 20, // 20 refreshes at 2s = 40s
    autoRefreshMaxSlow: 20, // 20 refreshes at 4s = 80s (total 2 min)
    autoRefreshFastDelay: 2000, // 2 seconds
    autoRefreshSlowDelay: 4000, // 4 seconds
    lastEventRecordId: null, // Track last seen event ID for activity detection

    // Turn tracking for sound notifications
    previousCurrentPlayerId: null,
    gameOverSoundPlayed: false,

    // Notification tracking for resource/dev card gains
    lastNotificationEventId: null,
    activeNotifications: new Map(), // playerId -> { timeoutId, gains, expiresAt }

    // Action button state tracking (to avoid unnecessary DOM rebuilds)
    lastActionSignature: null,

    // Event log tracking (to avoid unnecessary DOM rebuilds that disrupt scrolling)
    lastRenderedEventId: null,

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

        // Load auto-refresh setting from session (defaults to false)
        this.autoRefreshEnabled = this.loadAutoRefreshSetting();

        // Load saved sound volume
        Sounds.loadVolume();

        // Check for URL parameters (game invite link)
        this.handleUrlParameters();
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

        // Pan controls
        document.getElementById('btn-pan-up').addEventListener('click', () => this.pan(0, -this.panStep));
        document.getElementById('btn-pan-down').addEventListener('click', () => this.pan(0, this.panStep));
        document.getElementById('btn-pan-left').addEventListener('click', () => this.pan(-this.panStep, 0));
        document.getElementById('btn-pan-right').addEventListener('click', () => this.pan(this.panStep, 0));
        document.getElementById('btn-pan-reset').addEventListener('click', () => this.resetPan());

        // Settings modal
        document.getElementById('btn-settings').addEventListener('click', () => this.openSettings());
        document.getElementById('btn-save-settings').addEventListener('click', () => this.saveSettings());
        document.getElementById('btn-cancel-settings').addEventListener('click', () => this.closeSettings());

        // Volume control
        document.getElementById('volume-slider').addEventListener('input', (e) => this.onVolumeChange(e.target.value));
        document.getElementById('btn-test-sound').addEventListener('click', () => Sounds.playYourTurn());

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
        document.getElementById('btn-close-trade-rejected').addEventListener('click', () => this.closeTradeRejectedModal());
        document.getElementById('btn-continue-activity').addEventListener('click', () => this.closeNoActivityModal());
        document.getElementById('btn-close-error').addEventListener('click', () => this.closeModal('error-modal'));

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboardShortcut(e));
    },

    // ==================== KEYBOARD SHORTCUTS ====================

    handleKeyboardShortcut(e) {
        // Ignore if any modal is open
        if (this.isAnyModalOpen()) return;

        // Ignore if focus is on an input element
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

        // Ignore if modifier keys are pressed (except shift for uppercase)
        if (e.ctrlKey || e.altKey || e.metaKey) return;

        const key = e.key.toLowerCase();

        switch (key) {
            case 'r':
                if (this.isActionAvailable('RollDice')) {
                    e.preventDefault();
                    this.doRollDice(this.currentGame.phase.currentPlayerId);
                }
                break;

            case 'e':
                if (this.isActionAvailable('EndTurn')) {
                    e.preventDefault();
                    this.doEndTurn(this.currentGame.phase.currentPlayerId);
                }
                break;

            case 'd':
                if (this.isActionAvailable('BuyDevelopmentCard')) {
                    e.preventDefault();
                    this.doBuyDevCard(this.currentGame.phase.currentPlayerId);
                }
                break;

            case 't':
                if (this.isActionAvailable('TradeWithBank')) {
                    e.preventDefault();
                    const tradeAction = this.possibleActions.find(a => a.action === 'TradeWithBank');
                    this.showTradeModal(tradeAction);
                }
                break;

            case 'p':
                if (this.isActionAvailable('TradeWithPlayers')) {
                    e.preventDefault();
                    this.showPlayerTradeModal();
                }
                break;

            case 'u':
                if (this.isActionAvailable('Undo')) {
                    e.preventDefault();
                    this.doUndo();
                }
                break;

            case 'k':
                if (this.isActionAvailable('PlayKnight')) {
                    e.preventDefault();
                    const knightAction = this.possibleActions.find(a => a.action === 'PlayKnight');
                    this.startSelection('tile', knightAction?.tileIds, this.currentGame.phase.currentPlayerId, 'PlayKnight');
                }
                break;

            case 'b':
                if (this.isActionAvailable('PlayRoadBuilding')) {
                    e.preventDefault();
                    this.doPlayRoadBuilding(this.currentGame.phase.currentPlayerId);
                }
                break;

            case 'y':
                if (this.isActionAvailable('PlayYearOfPlenty')) {
                    e.preventDefault();
                    this.showYearOfPlentyModal(this.currentGame.phase.currentPlayerId);
                }
                break;

            case 'm':
                if (this.isActionAvailable('PlayMonopoly')) {
                    e.preventDefault();
                    this.showMonopolyModal(this.currentGame.phase.currentPlayerId);
                }
                break;

            case 'escape':
                if (this.selectionMode) {
                    e.preventDefault();
                    this.cancelSelection();
                }
                break;
        }
    },

    isAnyModalOpen() {
        const modalIds = [
            'settings-modal',
            'trade-modal',
            'discard-modal',
            'resource-modal',
            'player-trade-modal',
            'respond-trade-modal',
            'accept-trade-modal',
            'select-target-modal',
            'trade-rejected-modal',
            'game-over-modal',
            'no-activity-modal',
            'game-menu-modal',
            'error-modal'
        ];

        return modalIds.some(id => {
            const modal = document.getElementById(id);
            return modal && !modal.classList.contains('hidden');
        });
    },

    isActionAvailable(actionName) {
        // Undo is allowed even when it's not your turn (if server says it's available)
        if (actionName !== 'Undo' && !this.isMyTurn()) return false;
        return this.possibleActions?.some(a => a.action === actionName) ?? false;
    },

    // ==================== ZOOM ====================

    zoom(delta) {
        this.zoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoomLevel + delta));
        this.applyTransform();
    },

    resetZoom() {
        this.zoomLevel = 1.0;
        this.applyTransform();
    },

    applyZoom() {
        this.applyTransform();
    },

    // ==================== PAN ====================

    pan(deltaX, deltaY) {
        this.panX += deltaX;
        this.panY += deltaY;
        this.applyTransform();
    },

    resetPan() {
        this.panX = 0;
        this.panY = 0;
        this.applyTransform();
    },

    applyTransform() {
        document.getElementById('board').style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoomLevel})`;
        document.getElementById('zoom-level').textContent = `${Math.round(this.zoomLevel * 100)}%`;
    },

    // ==================== SETTINGS ====================

    openSettings() {
        // Load volume setting
        const volume = Math.round(Sounds.getVolume() * 100);
        document.getElementById('volume-slider').value = volume;
        document.getElementById('volume-value').textContent = `${volume}%`;

        // Load player token
        const playerToken = localStorage.getItem('catan_player_token') || '';
        document.getElementById('player-token-input').value = playerToken;

        document.getElementById('settings-modal').classList.remove('hidden');
    },

    saveSettings() {
        // Save player token
        const playerToken = document.getElementById('player-token-input').value.trim();
        if (playerToken) {
            localStorage.setItem('catan_player_token', playerToken);
        } else {
            localStorage.removeItem('catan_player_token');
        }

        this.closeSettings();
    },

    getPlayerToken() {
        return localStorage.getItem('catan_player_token') || null;
    },

    onVolumeChange(value) {
        const volume = parseInt(value) / 100;
        Sounds.setVolume(volume);
        document.getElementById('volume-value').textContent = `${value}%`;
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
        // Default to true if not set
        return saved === null ? true : saved === 'true';
    },

    closeSettings() {
        document.getElementById('settings-modal').classList.add('hidden');
    },

    // ==================== GAME MENU ====================

    openGameMenu() {
        // Update the playing-as dropdown in the menu
        this.populateMenuPlayerDropdown();
        // Update auto-refresh checkbox
        document.getElementById('auto-refresh-toggle').checked = this.autoRefreshEnabled;
        // Show/hide player management section based on game phase
        this.updateGameMenuUI();
        // Populate invite links
        this.populateInviteLinks();
        document.getElementById('game-menu-modal').classList.remove('hidden');
    },

    updateGameMenuUI() {
        const isSetup = this.currentGame?.phase?.phaseState === 'SettingUpBoard';
        const hasGame = !!this.currentGame;

        // Show player management only during setup
        document.getElementById('menu-player-management').classList.toggle('hidden', !isSetup);

        // Show playing as dropdown whenever a game is loaded (even during setup)
        document.getElementById('menu-playing-as-container').classList.toggle('hidden', !hasGame);

        // Show invite links when a game is loaded
        document.getElementById('menu-invite-links-container').classList.toggle('hidden', !hasGame);
        if (hasGame) {
            this.populateInviteLinks();
        }

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

    populateInviteLinks() {
        const container = document.getElementById('menu-invite-links-list');
        container.innerHTML = '';

        if (!this.currentGame?.players || !this.currentGameId) return;

        // Filter to non-bot players only
        const humanPlayers = this.currentGame.players.filter(p => !p.isBot);

        if (humanPlayers.length === 0) {
            container.innerHTML = '<span style="color: #666; font-size: 0.85rem;">No human players</span>';
            return;
        }

        humanPlayers.forEach(player => {
            const row = document.createElement('div');
            row.className = 'invite-link-row';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'player-name';
            nameSpan.textContent = player.name;
            nameSpan.style.color = this.getPlayerCSSColor(player.color);

            const copyBtn = document.createElement('button');
            copyBtn.className = 'copy-link-btn';
            copyBtn.innerHTML = '<i class="fa-solid fa-link"></i>';
            copyBtn.title = `Copy invite link for ${player.name}`;
            copyBtn.addEventListener('click', () => this.copyInviteLink(player.id, player.name, copyBtn));

            row.appendChild(nameSpan);
            row.appendChild(copyBtn);
            container.appendChild(row);
        });
    },

    copyInviteLink(playerId, playerName, button) {
        const baseUrl = window.location.origin;
        const inviteUrl = `${baseUrl}/?game=${this.currentGameId}&player=${playerId}`;

        navigator.clipboard.writeText(inviteUrl).then(() => {
            // Show success feedback
            button.classList.add('copied');
            button.innerHTML = '<i class="fa-solid fa-check"></i>';

            // Reset after 2 seconds
            setTimeout(() => {
                button.classList.remove('copied');
                button.innerHTML = '<i class="fa-solid fa-link"></i>';
            }, 2000);

            this.log(`Copied invite link for ${playerName}`);
        }).catch(err => {
            console.error('Failed to copy:', err);
            this.showError('Failed to copy link to clipboard');
        });
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
        const playerToken = this.getPlayerToken();
        if (!playerToken) {
            this.showError('You must have a Player Token (in Settings) to create a game.');
            return;
        }

        const gameType = document.getElementById('menu-game-type-select').value;

        const response = await API.createGame(gameType, playerToken);
        if (response.success) {
            this.resetGameStateFlags(response.gameState);
            this.handleGameResponse(response);
            this.saveGameId(response.gameState.id);
            this.populateMenuPlayerDropdown();
            this.updateGameMenuUI();
        } else {
            this.showError(response.errorMessage);
        }
    },

    async loadGameById() {
        const gameId = document.getElementById('menu-game-id-input').value.trim();
        if (!gameId) {
            this.showError('Please enter a game ID');
            return;
        }

        const response = await API.getGame(gameId, this.playingAsPlayerId);
        if (response.success) {
            this.resetGameStateFlags(response.gameState);
            this.handleGameResponse(response);
            this.saveGameId(gameId);
            this.populateMenuPlayerDropdown();
            this.updateGameMenuUI();
        } else {
            this.showError(response.errorMessage);
        }
    },

    // Reset flags when loading a new game
    resetGameStateFlags(gameState) {
        this.previousCurrentPlayerId = null;
        this.gameOverSoundPlayed = false;
        // Set notification tracking to current state so we don't show historical gains
        this.lastNotificationEventId = this.getLatestEventId(gameState);
        this.clearActiveNotifications();
        // Reset action signature to force button rebuild on new game
        this.lastActionSignature = null;
        // Reset event log tracking to force rebuild on new game
        this.lastRenderedEventId = null;
        // Clear debug log for fresh start
        this.clearDebugLog();
    },

    // Clear all active notifications and their timeouts
    clearActiveNotifications() {
        for (const data of this.activeNotifications.values()) {
            clearTimeout(data.timeoutId);
        }
        this.activeNotifications.clear();
    },

    async refreshGameState() {
        if (!this.currentGameId) {
            this.log('No game loaded', 'error');
            return;
        }

        // User-initiated refresh resets auto-refresh counters
        this.onUserActivity();

        const response = await API.getGame(this.currentGameId, this.playingAsPlayerId);
        if (response.success) {
            this.handleGameResponse(response);
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

    // ==================== URL PARAMETERS (INVITE LINKS) ====================

    handleUrlParameters() {
        const params = new URLSearchParams(window.location.search);
        const gameId = params.get('game');
        const playerId = params.get('player');

        // Ignore if no game parameter
        if (!gameId) return;

        // Clear URL parameters (so refresh doesn't re-trigger)
        this.clearUrlParameters();

        // Populate the game ID input immediately
        document.getElementById('menu-game-id-input').value = gameId;

        // Load the game with the specified player
        this.loadGameFromInviteLink(gameId, playerId);
    },

    clearUrlParameters() {
        const url = new URL(window.location.href);
        url.search = '';
        window.history.replaceState({}, document.title, url.pathname);
    },

    async loadGameFromInviteLink(gameId, playerId) {
        this.log(`Loading game from invite link: ${gameId}, player: ${playerId || 'not specified'}`);

        // If a player was specified, set it before loading so the API call uses it
        if (playerId) {
            this.playingAsPlayerId = playerId;
            this.savePlayingAsPlayer(playerId);
        }

        // Load the game using the standard flow
        const response = await API.getGame(gameId, this.playingAsPlayerId);

        if (!response.success) {
            this.showError(`Could not load game: ${response.errorMessage || 'Game not found'}`);
            return;
        }

        // Validate player is in the game
        if (playerId) {
            const player = response.gameState?.players?.find(p => p.id === playerId);
            if (!player) {
                this.showError(`Player "${playerId}" is not in this game. Please select a player from the menu.`);
                // Clear the invalid player selection
                this.playingAsPlayerId = null;
                this.savePlayingAsPlayer(null);
            }
        }

        // Use the standard game loading flow
        this.resetGameStateFlags(response.gameState);
        this.handleGameResponse(response);
        this.saveGameId(gameId);
        this.populateMenuPlayerDropdown();
        this.updateGameMenuUI();

        this.log(`Game loaded from invite link`);
    },

    // ==================== PLAYER SELECTION ====================

    onPlayingAsChanged(playerId) {
        // Cancel any active selection when switching players
        this.cancelSelection();

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
        // Only load saved player if not already set (e.g., from URL parameters)
        if (!this.playingAsPlayerId) {
            this.playingAsPlayerId = this.loadPlayingAsPlayer();
        } else {
            // Validate that the current playingAsPlayerId is still valid for this game
            const isValid = this.currentGame?.players?.some(p => p.id === this.playingAsPlayerId);
            if (!isValid) {
                this.playingAsPlayerId = this.loadPlayingAsPlayer();
            }
        }
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
        if (this.currentGameId && this.autoRefreshEnabled) {
            this.scheduleNextRefresh();
        }
    },

    stopAutoRefresh() {
        if (this.autoRefreshInterval) {
            clearTimeout(this.autoRefreshInterval);
            this.autoRefreshInterval = null;
        }
    },

    // Reset auto-refresh counters (called when activity is detected)
    resetAutoRefreshCounters() {
        this.autoRefreshPhase = 1;
        this.autoRefreshCount = 0;
    },

    // Schedule the next auto-refresh based on current phase
    scheduleNextRefresh() {
        if (!this.autoRefreshEnabled || !this.currentGameId) return;

        const delay = this.autoRefreshPhase === 1
            ? this.autoRefreshFastDelay
            : this.autoRefreshSlowDelay;

        this.autoRefreshInterval = setTimeout(() => {
            this.autoRefresh();
        }, delay);
    },

    async autoRefresh() {
        if (!this.currentGameId) return;

        // Stop auto-refresh if disabled or game is over
        if (!this.autoRefreshEnabled || this.currentGame?.phase?.phaseState === 'GameOver') {
            this.stopAutoRefresh();
            return;
        }

        // Don't refresh if user is in the middle of a selection or modal
        if (this.selectionMode) {
            this.scheduleNextRefresh();
            return;
        }
        if (!document.getElementById('trade-modal').classList.contains('hidden')) {
            this.scheduleNextRefresh();
            return;
        }
        if (!document.getElementById('discard-modal').classList.contains('hidden')) {
            this.scheduleNextRefresh();
            return;
        }
        if (!document.getElementById('resource-modal').classList.contains('hidden')) {
            this.scheduleNextRefresh();
            return;
        }
        if (!document.getElementById('player-trade-modal').classList.contains('hidden')) {
            this.scheduleNextRefresh();
            return;
        }
        if (!document.getElementById('respond-trade-modal').classList.contains('hidden')) {
            this.scheduleNextRefresh();
            return;
        }
        if (!document.getElementById('accept-trade-modal').classList.contains('hidden')) {
            this.scheduleNextRefresh();
            return;
        }
        if (!document.getElementById('game-menu-modal').classList.contains('hidden')) {
            this.scheduleNextRefresh();
            return;
        }
        if (!document.getElementById('no-activity-modal').classList.contains('hidden')) {
            // Paused while no-activity modal is open
            return;
        }

        try {
            const response = await API.getGame(this.currentGameId, this.playingAsPlayerId);
            if (response.success) {
                // Check for new activity by comparing event record
                const newEventId = this.getLatestEventId(response.gameState);
                if (newEventId !== null && newEventId !== this.lastEventRecordId) {
                    // New activity detected - reset counters
                    this.resetAutoRefreshCounters();
                    this.lastEventRecordId = newEventId;
                }

                this.handleGameResponse(response);

                // Increment counter and check for phase transition
                this.autoRefreshCount++;

                if (this.autoRefreshPhase === 1 && this.autoRefreshCount >= this.autoRefreshMaxFast) {
                    // Transition to slow phase
                    this.autoRefreshPhase = 2;
                    this.autoRefreshCount = 0;
                } else if (this.autoRefreshPhase === 2 && this.autoRefreshCount >= this.autoRefreshMaxSlow) {
                    // No activity for 2 minutes - show modal
                    this.showNoActivityModal();
                    return; // Don't schedule next refresh
                }

                // Schedule next refresh
                this.scheduleNextRefresh();
            } else {
                // On error, still schedule next refresh
                this.scheduleNextRefresh();
            }
        } catch (e) {
            // Silently ignore auto-refresh errors, but schedule next
            console.log('Auto-refresh failed:', e);
            this.scheduleNextRefresh();
        }
    },

    // Get the latest event ID from the game state's event record
    getLatestEventId(gameState) {
        const eventRecord = gameState?.eventRecord;
        if (!eventRecord || eventRecord.length === 0) return null;
        // Return the ID of the last event (highest ID = most recent)
        const lastEvent = eventRecord[eventRecord.length - 1];
        return lastEvent?.id ?? eventRecord.length; // Fall back to length if no ID
    },

    // Show the no-activity modal
    showNoActivityModal() {
        document.getElementById('no-activity-modal').classList.remove('hidden');
    },

    // Close the no-activity modal and resume auto-refresh
    closeNoActivityModal() {
        document.getElementById('no-activity-modal').classList.add('hidden');
        // Reset counters and restart auto-refresh
        this.resetAutoRefreshCounters();
        // Reset notification tracking so we don't show gains that happened while away
        this.lastNotificationEventId = this.getLatestEventId(this.currentGame);
        this.clearActiveNotifications();
        this.startAutoRefresh();
    },

    // Called when user performs an action that indicates activity
    onUserActivity() {
        this.resetAutoRefreshCounters();
        // Update last event ID to current state
        this.lastEventRecordId = this.getLatestEventId(this.currentGame);
    },

    // ==================== GAIN NOTIFICATIONS ====================

    // Process new events and show notifications for resource/dev card gains
    processGainNotifications(gameState) {
        const eventRecord = gameState?.eventRecord;
        if (!eventRecord || eventRecord.length === 0) return;

        // Find new events since last notification check
        const newEvents = [];
        let foundLastProcessed = this.lastNotificationEventId === null;

        for (const event of eventRecord) {
            if (foundLastProcessed) {
                newEvents.push(event);
            } else if (event.id === this.lastNotificationEventId) {
                foundLastProcessed = true;
            }
        }

        // Update last processed ID
        const lastEvent = eventRecord[eventRecord.length - 1];
        this.lastNotificationEventId = lastEvent?.id ?? null;

        // If this is the first load, don't show notifications
        if (!foundLastProcessed && this.lastNotificationEventId === null) {
            return;
        }

        // Collect gains per player from new events
        const playerGains = new Map(); // playerId -> { resources: {}, devCard: boolean }

        for (const event of newEvents) {
            const playerId = event.playerId;
            if (!playerId) continue;

            if (!playerGains.has(playerId)) {
                playerGains.set(playerId, { resources: {}, devCard: false });
            }
            const gains = playerGains.get(playerId);

            // Check for resource gains
            if (event.resourcesReceived) {
                for (const [resource, count] of Object.entries(event.resourcesReceived)) {
                    if (count > 0) {
                        gains.resources[resource] = (gains.resources[resource] || 0) + count;
                    }
                }
            }

            // Check for dev card purchase
            if (event.action === 'BuyDevelopmentCard') {
                gains.devCard = true;
            }
        }

        // Show notifications for players with gains
        for (const [playerId, gains] of playerGains) {
            const hasResources = Object.values(gains.resources).some(c => c > 0);
            if (hasResources || gains.devCard) {
                this.showGainNotification(playerId, gains);
            }
        }
    },

    // Show a gain notification on a player's card
    showGainNotification(playerId, gains) {
        const notificationEl = document.querySelector(`.player-card[data-player-id="${playerId}"] .gain-notification`);
        if (!notificationEl) return;

        // Clear any existing notification timeout for this player
        if (this.activeNotifications.has(playerId)) {
            clearTimeout(this.activeNotifications.get(playerId).timeoutId);
        }

        // Build notification content
        const html = this.buildGainNotificationHtml(gains);
        notificationEl.innerHTML = html;

        // Trigger fade in
        requestAnimationFrame(() => {
            notificationEl.classList.add('visible');
        });

        const expiresAt = Date.now() + 3000;

        // Set timeout to fade out and clear
        const timeoutId = setTimeout(() => {
            notificationEl.classList.remove('visible');
            this.activeNotifications.delete(playerId);
        }, 3000);

        this.activeNotifications.set(playerId, { timeoutId, gains, expiresAt });
    },

    // Build the HTML for a gain notification
    buildGainNotificationHtml(gains) {
        let html = '';

        // Add resource boxes with counts
        const resourceOrder = ['Wood', 'Brick', 'Wool', 'Grain', 'Ore'];
        for (const resource of resourceOrder) {
            const count = gains.resources[resource];
            if (count && count > 0) {
                html += `<span class="resource-box resource-${resource}" title="${resource}">+${count}</span>`;
            }
        }

        // Add dev card indicator (purple box)
        if (gains.devCard) {
            html += `<span class="resource-box dev-card-box" title="Development Card"></span>`;
        }

        return html;
    },

    // Re-apply active notifications after DOM rebuild (called after renderPlayers)
    reapplyActiveNotifications() {
        const now = Date.now();

        for (const [playerId, data] of this.activeNotifications) {
            // Skip if already expired
            if (now >= data.expiresAt) {
                clearTimeout(data.timeoutId);
                this.activeNotifications.delete(playerId);
                continue;
            }

            const notificationEl = document.querySelector(`.player-card[data-player-id="${playerId}"] .gain-notification`);
            if (!notificationEl) continue;

            // Rebuild and show the notification without triggering transition
            notificationEl.innerHTML = this.buildGainNotificationHtml(data.gains);
            // Temporarily disable transition, set visible, then re-enable
            notificationEl.style.transition = 'none';
            notificationEl.classList.add('visible');
            // Force reflow to apply the change immediately
            notificationEl.offsetHeight;
            notificationEl.style.transition = '';
        }
    },

    handleGameResponse(response) {
        const previousPlayerId = this.previousCurrentPlayerId;
        const newPlayerId = response.gameState?.phase?.currentPlayerId;

        this.currentGame = response.gameState;
        this.currentGameId = response.gameState.id;
        this.possibleActions = response.possibleActions || [];

        this.displayGame();
        this.updateUI();

        // Re-apply any active notifications that were cleared by DOM rebuild
        this.reapplyActiveNotifications();

        // Process gain notifications after displayGame (so player cards exist)
        this.processGainNotifications(response.gameState);

        // Check for turn change and play sound if it's now "Playing as" player's turn
        if (newPlayerId && newPlayerId !== previousPlayerId && newPlayerId === this.playingAsPlayerId) {
            Sounds.playYourTurn();
        }
        this.previousCurrentPlayerId = newPlayerId;

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

        // Re-apply selectable elements if in manual selection mode (board render clears them)
        // Auto-show indicators are re-applied in renderActions() via showBoardIndicators()
        if (this.selectionMode && this.selectableIds?.length > 0) {
            Board.setSelectableElements(this.selectionMode, this.selectableIds, this.pendingAction);
        }

        // Render bank resources
        this.renderBankResources();

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

    // ==================== BANK RESOURCES ====================

    renderBankResources() {
        const bankDisplay = document.getElementById('bank-display');
        const bankResourcesContainer = document.getElementById('bank-resources');

        // Check if bank data exists
        if (!this.currentGame?.bank?.resources) {
            bankDisplay.classList.add('hidden');
            return;
        }

        const resources = this.currentGame.bank.resources;
        const resourceOrder = ['Wood', 'Brick', 'Wool', 'Grain', 'Ore'];

        bankResourcesContainer.innerHTML = '';

        resourceOrder.forEach(resource => {
            const count = resources[resource] ?? 0;
            const box = document.createElement('span');
            box.className = `resource-box resource-${resource}`;
            box.title = `${resource}: ${count}`;
            box.textContent = count;
            bankResourcesContainer.appendChild(box);
        });

        bankDisplay.classList.remove('hidden');
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
            card.dataset.playerId = player.id; // For notification targeting
            card.style.borderLeftColor = this.getPlayerCSSColor(player.color);

            if (this.currentGame.phase?.currentPlayerId === player.id) {
                card.classList.add('current');
            }

            // Check for special achievements
            const hasLongestRoad = this.currentGame.hasLongestRoadPlayerId === player.id;
            const hasLargestArmy = this.currentGame.hasLargestArmyPlayerId === player.id;
            const badges = [];
            if (hasLongestRoad) badges.push('<span class="player-badge road-badge" title="Longest Road"><i class="fa-solid fa-road"></i></span>');
            if (hasLargestArmy) badges.push('<span class="player-badge army-badge" title="Largest Army"><i class="fa-solid fa-shield-halved"></i></span>');

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
                <div class="gain-notification"></div>
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
                        <span class="resource-box resource-Wood" title="Wood: ${res.Wood}">${res.Wood}</span>
                        <span class="resource-box resource-Brick" title="Brick: ${res.Brick}">${res.Brick}</span>
                        <span class="resource-box resource-Wool" title="Wool: ${res.Wool}">${res.Wool}</span>
                        <span class="resource-box resource-Grain" title="Grain: ${res.Grain}">${res.Grain}</span>
                        <span class="resource-box resource-Ore" title="Ore: ${res.Ore}">${res.Ore}</span>
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
            this.showError('No game loaded');
            return;
        }

        const name = document.getElementById('menu-player-name-input').value.trim();
        const color = document.getElementById('menu-player-color-select').value;
        const isBot = document.getElementById('menu-player-is-bot').checked;

        if (!name) {
            this.showError('Please enter a player name');
            return;
        }

        const response = await API.addPlayer(this.currentGameId, name, isBot, color || null);

        if (response.success) {
            this.handleGameResponse(response);
            document.getElementById('menu-player-name-input').value = '';
            this.populateMenuPlayerDropdown();
            this.updateGameMenuUI();
        } else {
            this.showError(response.errorMessage);
        }
    },

    async removePlayer(playerId) {
        if (!this.currentGameId) return;

        const response = await API.removePlayer(this.currentGameId, playerId);

        if (response.success) {
            this.handleGameResponse(response);
            this.populateMenuPlayerDropdown();
            this.updateGameMenuUI();
        } else {
            this.showError(response.errorMessage);
        }
    },

    async startGame() {
        if (!this.currentGameId) return;

        const response = await API.startGame(this.currentGameId);

        if (response.success) {
            this.handleGameResponse(response);
            this.closeModal('game-menu-modal');
        } else {
            this.showError(response.errorMessage);
        }
    },

    // ==================== ACTIONS ====================

    renderActions() {
        const row1 = document.getElementById('action-row-1');
        const row2 = document.getElementById('action-row-2');
        const situationalContainer = document.getElementById('situational-actions');
        // Status box elements (shows "Waiting on..." or action guidance)
        const statusBar = document.getElementById('action-status-bar');
        const statusText = document.getElementById('action-status-text');
        const cancelBtn = document.getElementById('btn-cancel-selection');

        // Check if there's a RespondToTrade action (any player can respond)
        const hasRespondToTrade = this.possibleActions?.some(a => a.action === 'RespondToTrade');

        // Check if game is in trading phase and there's an active trade
        const isInTradingPhase = this.currentGame?.phase?.phaseState === 'RespondToTrade';

        // Find the original trade to determine who initiated it
        const pendingResponses = this.currentGame?.phase?.pendingTradeResponses || [];
        const originalTrade = pendingResponses.find(r => r.responseType === 'Original');
        const tradeInitiatorId = originalTrade?.playerId;

        // Non-initiators can respond to the trade
        const canRespondToTrade = isInTradingPhase &&
                                   this.playingAsPlayerId &&
                                   this.playingAsPlayerId !== tradeInitiatorId;

        // Auto-cancel trade if all opponents have rejected
        if (isInTradingPhase && tradeInitiatorId === this.playingAsPlayerId) {
            const otherPlayers = this.currentGame?.players?.filter(p => p.id !== tradeInitiatorId) || [];
            const rejectResponses = pendingResponses.filter(r => r.responseType === 'Reject');
            const rejectingPlayerIds = new Set(rejectResponses.map(r => r.playerId));
            const allRejected = otherPlayers.length > 0 &&
                                otherPlayers.every(p => rejectingPlayerIds.has(p.id));

            if (allRejected) {
                // Show modal to inform user, then cancel on close
                const modal = document.getElementById('trade-rejected-modal');
                if (modal.classList.contains('hidden')) {
                    modal.classList.remove('hidden');
                }
                return; // Exit early, closeTradeRejectedModal will handle the cancel
            }
        }

        // Check if it's the selected player's turn
        const isMyTurn = this.isMyTurn();
        const phaseState = this.currentGame?.phase?.phaseState;

        // Build map of available actions for quick lookup
        const availableActions = {};
        (this.possibleActions || []).forEach(action => {
            availableActions[action.action] = action;
        });

        // Handle placement actions (auto-shown on board)
        const placementActionTypes = ['PlaceSettlement', 'PlaceRoad', 'UpgradeSettlement', 'PlaceRobber'];
        const placementActions = (this.possibleActions || []).filter(a => placementActionTypes.includes(a.action));
        this.availablePlacementActions = placementActions;

        // Show board indicators if there are placement actions
        if (isMyTurn && placementActions.length > 0) {
            this.showBoardIndicators(placementActions);
        } else {
            this.availablePlacementActions = null;
            Board.clearSelectableElements();
        }

        // Check if "Playing As" player has any playable dev cards (for row2 visibility)
        const playableDevCardTypes = ['Knight', 'RoadBuilding', 'YearOfPlenty', 'Monopoly'];
        const playingAsPlayer = this.currentGame?.players?.find(p => p.id === this.playingAsPlayerId);
        const hasPlayableDevCards = playingAsPlayer?.devCardsReadyToPlay?.some(card => playableDevCardTypes.includes(card)) || false;

        // Check for situational actions
        const situationalActionTypes = ['DiscardCards', 'StealResource', 'RespondToTrade', 'AcceptTrade', 'RejectAllOffers'];
        const activeSituationalActions = situationalActionTypes.filter(actionName => {
            if (actionName === 'RespondToTrade') {
                return !!availableActions[actionName] || canRespondToTrade;
            }
            return !!availableActions[actionName];
        });

        // Compute a signature for the current button state to avoid unnecessary DOM rebuilds
        const actionSignature = JSON.stringify({
            isMyTurn,
            phaseState,
            hasPlayableDevCards,
            playingAsPlayerId: this.playingAsPlayerId,
            currentPlayerId: this.currentGame?.phase?.currentPlayerId,
            availableActionKeys: Object.keys(availableActions).sort(),
            activeSituationalActions,
            canRespondToTrade,
            pendingResponseCount: pendingResponses.filter(r => r.responseType === 'Accept').length,
            discardCount: isMyTurn && availableActions['DiscardCards']
                ? Math.floor((this.currentGame?.players?.find(p => p.id === this.currentGame?.phase?.currentPlayerId)?.resourceCount || 0) / 2)
                : 0
        });

        // Skip DOM rebuild if signature hasn't changed (prevents click interruption during auto-refresh)
        if (actionSignature === this.lastActionSignature) {
            // Still need to update status message (it may reference player names that don't affect signature)
            this.updateStatusMessage(
                statusBar, statusText, cancelBtn,
                isMyTurn, hasRespondToTrade, canRespondToTrade,
                phaseState, placementActions, availableActions,
                this._lastRow1Buttons || [], this._lastRow2Buttons || [], hasPlayableDevCards
            );
            return;
        }
        this.lastActionSignature = actionSignature;

        // Clear existing buttons only when we need to rebuild
        row1.innerHTML = '';
        row2.innerHTML = '';
        situationalContainer.innerHTML = '';

        // Define fixed buttons for Row 1: Roll, Buy Dev Card, Trade w Bank, Trade w Players, Undo, End Turn
        const row1Buttons = [
            {
                action: 'RollDice',
                icon: 'fa-solid fa-dice',
                title: 'Roll Dice (R)',
                highlightWhenEnabled: true,
                handler: () => this.doRollDice(this.currentGame.phase.currentPlayerId)
            },
            {
                action: 'BuyDevelopmentCard',
                icon: 'fa-solid fa-scroll',
                title: 'Buy Dev Card (D)',
                handler: () => this.doBuyDevCard(this.currentGame.phase.currentPlayerId)
            },
            {
                action: 'TradeWithBank',
                icon: 'fa-solid fa-building-columns',
                title: 'Trade with Bank (T)',
                handler: () => this.showTradeModal(availableActions['TradeWithBank'])
            },
            {
                action: 'TradeWithPlayers',
                icon: 'fa-solid fa-handshake',
                title: 'Trade with Players (P)',
                handler: () => this.showPlayerTradeModal()
            },
            {
                action: 'Undo',
                icon: 'fa-solid fa-rotate-left',
                title: 'Undo (U)',
                secondary: true,
                handler: () => this.doUndo()
            },
            {
                action: 'EndTurn',
                icon: 'fa-solid fa-forward-step',
                title: 'End Turn (E)',
                secondary: true,
                handler: () => this.doEndTurn(this.currentGame.phase.currentPlayerId)
            }
        ];

        // Define fixed buttons for Row 2: Knight, Road Building, Year of Plenty, Monopoly
        const row2Buttons = [
            {
                action: 'PlayKnight',
                icon: 'fa-solid fa-chess-knight',
                title: 'Play Knight (K)',
                handler: () => this.startSelection('tile', availableActions['PlayKnight']?.tileIds, this.currentGame.phase.currentPlayerId, 'PlayKnight')
            },
            {
                action: 'PlayRoadBuilding',
                icon: 'fa-solid fa-road',
                title: 'Play Road Building (B)',
                handler: () => this.doPlayRoadBuilding(this.currentGame.phase.currentPlayerId)
            },
            {
                action: 'PlayYearOfPlenty',
                icon: 'fa-solid fa-gift',
                title: 'Play Year of Plenty (Y)',
                handler: () => this.showYearOfPlentyModal(this.currentGame.phase.currentPlayerId)
            },
            {
                action: 'PlayMonopoly',
                icon: 'fa-solid fa-hand-holding-dollar',
                title: 'Play Monopoly (M)',
                handler: () => this.showMonopolyModal(this.currentGame.phase.currentPlayerId)
            }
        ];

        // Helper to create an icon button
        const createIconButton = (config, isEnabled) => {
            const btn = document.createElement('button');
            btn.className = 'action-btn icon-btn';
            btn.innerHTML = `<i class="${config.icon}"></i>`;
            btn.title = config.title;

            if (isEnabled) {
                if (config.highlightWhenEnabled) {
                    btn.classList.add('highlight');
                } else if (config.secondary) {
                    btn.classList.add('secondary');
                }
                btn.onclick = config.handler;
            } else {
                btn.disabled = true;
            }

            return btn;
        };

        // Render Row 1 buttons
        row1Buttons.forEach(config => {
            // Undo is allowed even when it's not your turn (if server says it's available)
            const isEnabled = config.action === 'Undo'
                ? !!availableActions[config.action]
                : isMyTurn && !!availableActions[config.action];
            const btn = createIconButton(config, isEnabled);
            row1.appendChild(btn);
        });

        // Store button configs for status message updates when signature doesn't change
        this._lastRow1Buttons = row1Buttons;
        this._lastRow2Buttons = row2Buttons;

        // Show/hide Row 2 based on whether player has playable dev cards
        if (hasPlayableDevCards) {
            row2.classList.remove('hidden');
            // Render Row 2 buttons
            row2Buttons.forEach(config => {
                const isEnabled = isMyTurn && !!availableActions[config.action];
                const btn = createIconButton(config, isEnabled);
                row2.appendChild(btn);
            });
        } else {
            row2.classList.add('hidden');
        }

        // Render situational text buttons
        const situationalActions = [
            'DiscardCards', 'StealResource', 'RespondToTrade',
            'AcceptTrade', 'RejectAllOffers'
        ];

        situationalActions.forEach(actionName => {
            const action = availableActions[actionName];
            if (!action && actionName !== 'RespondToTrade') return;

            // Special case: RespondToTrade can come from canRespondToTrade
            if (actionName === 'RespondToTrade' && !action && !canRespondToTrade) return;

            const btn = document.createElement('button');
            btn.className = 'action-btn';

            switch (actionName) {
                case 'DiscardCards':
                    if (!isMyTurn) return;
                    const discardPlayer = this.currentGame.players.find(p => p.id === this.currentGame.phase.currentPlayerId);
                    const discardCount = discardPlayer ? Math.floor(discardPlayer.resourceCount / 2) : 0;
                    btn.textContent = `Discard ${discardCount} Cards`;
                    btn.classList.add('highlight');
                    btn.onclick = () => this.showDiscardModal({ ...action, count: discardCount });
                    break;

                case 'StealResource':
                    if (!isMyTurn) return;
                    btn.textContent = `Steal from: ${action.targetPlayerIds?.join(', ')}`;
                    btn.onclick = () => this.showStealOptions(action);
                    break;

                case 'RespondToTrade':
                    btn.textContent = 'Respond to Trade';
                    btn.classList.add('highlight');
                    btn.onclick = () => this.showRespondToTradeModal(action || this.currentGame.activeTrade || {});
                    break;

                case 'AcceptTrade':
                    if (!isMyTurn) return;
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
                    if (!isMyTurn) return;
                    btn.textContent = 'Cancel Trade';
                    btn.classList.add('secondary');
                    btn.onclick = () => this.doCancelTrade();
                    break;

                default:
                    return;
            }

            situationalContainer.appendChild(btn);
        });

        // Compute and update status message
        this.updateStatusMessage(
            statusBar, statusText, cancelBtn,
            isMyTurn, hasRespondToTrade, canRespondToTrade,
            phaseState, placementActions, availableActions,
            row1Buttons, row2Buttons, hasPlayableDevCards
        );

        // Auto-trigger DiscardCards modal when needed
        const discardModalOpen = !document.getElementById('discard-modal').classList.contains('hidden');
        if (isMyTurn && !discardModalOpen && availableActions['DiscardCards']) {
            const playerId = this.currentGame.phase.currentPlayerId;
            const player = this.currentGame.players.find(p => p.id === playerId);
            const discardCount = player ? Math.floor(player.resourceCount / 2) : 0;
            this.showDiscardModal({ ...availableActions['DiscardCards'], count: discardCount });
        }

        // Auto-trigger SelectTarget modal when needed
        const selectTargetModalOpen = !document.getElementById('select-target-modal').classList.contains('hidden');
        if (isMyTurn && !selectTargetModalOpen && availableActions['SelectTarget']) {
            this.showSelectTargetModal(availableActions['SelectTarget'].playerIds);
        }
    },

    // Update the status box with appropriate message based on game state
    updateStatusMessage(statusBar, statusText, cancelBtn, isMyTurn, hasRespondToTrade, canRespondToTrade, phaseState, placementActions, availableActions, row1Buttons, row2Buttons, hasPlayableDevCards) {
        cancelBtn.classList.add('hidden');

        // Not my turn - show waiting message (neutral color)
        if (!isMyTurn && !hasRespondToTrade && !canRespondToTrade) {
            const currentPlayerName = this.getPlayerName(this.currentGame?.phase?.currentPlayerId);
            statusText.textContent = `Waiting on ${currentPlayerName}`;
            statusBar.classList.remove('selection');
            return;
        }

        // It's my turn or I can respond - show highlighted status
        statusBar.classList.add('selection');

        // Special case: RollOrUseDevCard phase
        if (isMyTurn && phaseState === 'RollOrUseDevCard') {
            statusText.textContent = "It's your turn!";
            return;
        }

        // Determine what actions are available
        const hasBoardActions = placementActions.length > 0;

        // Count ALL enabled button actions (including Undo and EndTurn)
        // Only include row2 buttons if the dev card row is visible
        const visibleButtonConfigs = hasPlayableDevCards ? [...row1Buttons, ...row2Buttons] : [...row1Buttons];
        const enabledButtons = visibleButtonConfigs.filter(config => !!availableActions[config.action]);

        // Check for situational actions (treated as buttons)
        const situationalActionTypes = ['DiscardCards', 'StealResource', 'RespondToTrade', 'AcceptTrade', 'RejectAllOffers', 'SelectTarget'];
        const enabledSituational = situationalActionTypes.filter(action => {
            if (action === 'RespondToTrade') {
                return !!availableActions[action] || canRespondToTrade;
            }
            return !!availableActions[action];
        });

        // For determining if there are "main" actions (excluding auxiliary Undo/EndTurn)
        const auxiliaryActions = ['Undo', 'EndTurn'];
        const enabledMainButtons = enabledButtons.filter(config => !auxiliaryActions.includes(config.action));

        const hasButtonActions = enabledMainButtons.length > 0 || enabledSituational.length > 0;
        // Total count includes ALL enabled buttons for determining single-action specificity
        const totalButtonCount = enabledButtons.length + enabledSituational.length;

        // Determine message based on available actions
        if (hasBoardActions && hasButtonActions) {
            // Both board and button actions available
            statusText.textContent = 'Make your move on the board or with action buttons.';
        } else if (hasBoardActions && !hasButtonActions) {
            // Only board actions
            if (placementActions.length === 1) {
                // Single board action type - be specific
                const action = placementActions[0].action;
                switch (action) {
                    case 'PlaceSettlement':
                        statusText.textContent = 'Place a settlement on the board.';
                        break;
                    case 'PlaceRoad':
                        statusText.textContent = 'Place a road on the board.';
                        break;
                    case 'UpgradeSettlement':
                        statusText.textContent = 'Upgrade a settlement to a city.';
                        break;
                    case 'PlaceRobber':
                        statusText.textContent = 'Move the robber to a new tile.';
                        break;
                    default:
                        statusText.textContent = 'Make your move on the board.';
                }
            } else {
                statusText.textContent = 'Make your move on the board.';
            }
        } else if (!hasBoardActions && hasButtonActions) {
            // Only button actions
            if (totalButtonCount === 1) {
                // Single button action - be specific
                const singleAction = enabledMainButtons[0]?.action || enabledSituational[0];
                statusText.textContent = this.getSpecificActionMessage(singleAction);
            } else {
                statusText.textContent = 'Choose an action from the buttons above.';
            }
        } else {
            // No main actions available (only Undo/EndTurn)
            if (availableActions['EndTurn']) {
                statusText.textContent = 'Click End Turn to finish your turn.';
            } else {
                statusText.textContent = '';
                statusBar.classList.remove('selection');
            }
        }
    },

    // Get a specific message for a single available action
    getSpecificActionMessage(action) {
        switch (action) {
            case 'RollDice':
                return 'Roll the dice to continue.';
            case 'BuyDevelopmentCard':
                return 'Buy a development card.';
            case 'TradeWithBank':
                return 'Trade resources with the bank.';
            case 'TradeWithPlayers':
                return 'Propose a trade with other players.';
            case 'PlayKnight':
                return 'Play your Knight card.';
            case 'PlayRoadBuilding':
                return 'Play Road Building to place roads.';
            case 'PlayYearOfPlenty':
                return 'Play Year of Plenty to gain resources.';
            case 'PlayMonopoly':
                return 'Play Monopoly to take a resource.';
            case 'DiscardCards':
                return 'Discard cards to continue.';
            case 'StealResource':
                return 'Choose a player to steal from.';
            case 'RespondToTrade':
                return 'Respond to the trade offer.';
            case 'AcceptTrade':
                return 'Accept or reject the trade responses.';
            case 'RejectAllOffers':
                return 'Cancel or accept the trade.';
            case 'SelectTarget':
                return 'Select a target player.';
            default:
                return 'Choose an action from the buttons above.';
        }
    },

    // ==================== PLACEMENT INDICATORS ====================

    // Show board indicators for placement actions (without status message)
    showBoardIndicators(placementActions) {
        const playerId = this.currentGame.phase.currentPlayerId;

        // Collect all selectable IDs for each type
        const vertexIds = [];
        const edgeIds = [];
        const tileIds = [];
        const upgradeVertexIds = [];

        placementActions.forEach(action => {
            switch (action.action) {
                case 'PlaceSettlement':
                    if (action.vertexIds) vertexIds.push(...action.vertexIds);
                    break;
                case 'PlaceRoad':
                    if (action.edgeIds) edgeIds.push(...action.edgeIds);
                    break;
                case 'UpgradeSettlement':
                    if (action.vertexIds) upgradeVertexIds.push(...action.vertexIds);
                    break;
                case 'PlaceRobber':
                    if (action.tileIds) tileIds.push(...action.tileIds);
                    break;
            }
        });

        // Show all indicators on the board
        Board.setSelectableElementsMultiple({
            vertices: vertexIds,
            edges: edgeIds,
            tiles: tileIds,
            upgradeVertices: upgradeVertexIds
        });

        // Store the player ID for when clicks happen
        this.selectedPlayerId = playerId;
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

        // Update status box with cancel button (for manual button-triggered selections)
        const statusBar = document.getElementById('action-status-bar');
        const statusText = document.getElementById('action-status-text');
        const cancelBtn = document.getElementById('btn-cancel-selection');

        statusText.textContent = `${actionType} - click a ${mode}`;
        statusBar.classList.add('selection');
        cancelBtn.classList.remove('hidden');

        // Update board to show selectable elements
        Board.setSelectableElements(mode, ids, actionType);
    },

    cancelSelection() {
        this.selectionMode = null;
        this.selectableIds = [];
        this.selectedPlayerId = null;
        this.pendingAction = null;
        this.availablePlacementActions = null;

        // Clear status box
        const statusBar = document.getElementById('action-status-bar');
        const statusText = document.getElementById('action-status-text');
        const cancelBtn = document.getElementById('btn-cancel-selection');

        statusText.textContent = '';
        statusBar.classList.remove('selection');
        cancelBtn.classList.add('hidden');
        Board.clearSelectableElements();
    },

    async handleBoardClick(type, id) {
        console.log('handleBoardClick:', type, id, 'selectionMode:', this.selectionMode, 'pendingAction:', this.pendingAction);

        let action = null;
        let playerId = this.selectedPlayerId;

        // Check if we're in manual selection mode (for PlayKnight button)
        if (this.selectionMode) {
            if (this.selectionMode !== type) return;
            if (!this.selectableIds.includes(id)) return;
            action = this.pendingAction;
            this.cancelSelection();
        } else {
            // Auto-show mode: determine action from what was clicked
            action = this.findPlacementActionForClick(type, id);
            if (!action) return;

            // Clear indicators after click
            Board.clearSelectableElements();
            document.getElementById('action-status-text').textContent = '';
            document.getElementById('action-status-bar').classList.remove('selection');
        }

        // User clicked on board - this is activity
        this.onUserActivity();

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

    // Find which placement action corresponds to a click on a specific element
    findPlacementActionForClick(type, id) {
        if (!this.availablePlacementActions) return null;

        for (const action of this.availablePlacementActions) {
            switch (action.action) {
                case 'PlaceSettlement':
                    if (type === 'vertex' && action.vertexIds?.includes(id)) {
                        return 'PlaceSettlement';
                    }
                    break;
                case 'PlaceRoad':
                    if (type === 'edge' && action.edgeIds?.includes(id)) {
                        return 'PlaceRoad';
                    }
                    break;
                case 'UpgradeSettlement':
                    if (type === 'vertex' && action.vertexIds?.includes(id)) {
                        return 'UpgradeSettlement';
                    }
                    break;
                case 'PlaceRobber':
                    if (type === 'tile' && action.tileIds?.includes(id)) {
                        return 'PlaceRobber';
                    }
                    break;
            }
        }
        return null;
    },

    // ==================== GAME ACTIONS ====================

    async doRollDice(playerId) {
        this.onUserActivity();
        const response = await API.rollDice(this.currentGameId);

        if (response.success) {
            this.handleGameResponse(response);
        } else {
            this.log(`Error: ${response.errorMessage}`, 'error');
        }
    },

    async doEndTurn(playerId) {
        this.onUserActivity();
        const response = await API.endTurn(this.currentGameId);

        if (response.success) {
            this.handleGameResponse(response);
        } else {
            this.log(`Error: ${response.errorMessage}`, 'error');
        }
    },

    async doBuyDevCard(playerId) {
        this.onUserActivity();
        const response = await API.buyDevCard(this.currentGameId, playerId);

        if (response.success) {
            this.handleGameResponse(response);
        } else {
            this.log(`Error: ${response.errorMessage}`, 'error');
        }
    },

    async doPlayRoadBuilding(playerId) {
        this.onUserActivity();
        const response = await API.playRoadBuilding(this.currentGameId, playerId);

        if (response.success) {
            this.handleGameResponse(response);
        } else {
            this.log(`Error: ${response.errorMessage}`, 'error');
        }
    },

    async doUndo() {
        this.onUserActivity();
        const response = await API.undo(this.currentGameId, this.playingAsPlayerId);

        if (response.success) {
            // Clear any pending selection so the new game state can auto-trigger the correct action
            this.cancelSelection();
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

        ['Wood', 'Brick', 'Wool', 'Grain', 'Ore'].forEach(resource => {
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
        this.onUserActivity();
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

        const resources = ['Wood', 'Brick', 'Wool', 'Grain', 'Ore'];
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
        this.onUserActivity();
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
        this.onUserActivity();
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

        // Create cards for each resource the player has (in consistent order)
        const resourceOrder = ['Wood', 'Brick', 'Wool', 'Grain', 'Ore'];
        const playerResources = player.resources;
        resourceOrder.forEach(resource => {
            const count = playerResources[resource] || 0;
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
        this.onUserActivity();
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
        this.onUserActivity();
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
        this.onUserActivity();
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
        this.onUserActivity();
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
        this.onUserActivity();
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

        const resources = ['Wood', 'Brick', 'Wool', 'Grain', 'Ore'];
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
        const resources = ['Wood', 'Brick', 'Wool', 'Grain', 'Ore'];
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
        this.onUserActivity();
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

    // Close the trade rejected modal and auto-cancel the trade
    closeTradeRejectedModal() {
        document.getElementById('trade-rejected-modal').classList.add('hidden');
        this.doCancelTrade();
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

        // Play game over sound (only once per game)
        if (!this.gameOverSoundPlayed) {
            this.gameOverSoundPlayed = true;
            if (isWinner) {
                Sounds.playVictory();
            } else {
                Sounds.playDefeat();
            }
        }

        // Show the modal
        modal.classList.remove('hidden');
    },

    // ==================== UTILITIES ====================

    getPlayerCSSColor(colorName) {
        // Read color from CSS custom property (defined in :root in style.css)
        const varName = `--player-${colorName?.toLowerCase()}`;
        const color = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
        return color || '#888';
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
            case 'RollDice': {
                const total = (event.die1 ?? 0) + (event.die2 ?? 0);
                return `${playerName} rolled ${event.die1} + ${event.die2} = ${total}. [${id}]`;
            }

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
                const resourcesText = this.formatResources(event.resourcesReceived);
                if (resourcesText) {
                    msg += ` and took ${resourcesText}`;
                } else {
                    msg += ` and gained no cards`;
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

            case 'Undo':
                return `${playerName} undid action ${event.eventReversed}. [${id}]`;

            default:
                return `${playerName} performed ${event.action}. [${id}]`;
        }
    },

    // Render game event history to the history log
    renderEventLog() {
        const container = document.getElementById('history-log');

        const eventRecord = this.currentGame?.eventRecord;
        if (!eventRecord || eventRecord.length === 0) return;

        // Check if we need to re-render (only if new events have been added)
        const latestEventId = eventRecord.length;
        if (latestEventId === this.lastRenderedEventId) {
            return; // No new events, preserve scroll position
        }
        this.lastRenderedEventId = latestEventId;

        container.innerHTML = '';

        // Get last 30 events in chronological order (oldest first, newest last)
        const recentEvents = eventRecord.slice(-30);

        recentEvents.forEach(event => {
            const entry = document.createElement('div');
            entry.className = 'log-entry';
            entry.textContent = this.formatEventRecord(event);
            container.appendChild(entry);
        });

        // Scroll to bottom to show newest event
        container.scrollTop = container.scrollHeight;
    },

    // Log a message to the history log (errors go to debug log instead)
    log(message, type = '') {
        // Redirect errors to debug log
        if (type === 'error') {
            this.debugLog(message, 'error');
            return;
        }

        const container = document.getElementById('history-log');
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.textContent = `${new Date().toLocaleTimeString()}: ${message}`;
        container.appendChild(entry);

        // Keep only last 50 entries (remove oldest from top)
        while (container.children.length > 50) {
            container.removeChild(container.firstChild);
        }

        // Scroll to bottom to show newest message
        container.scrollTop = container.scrollHeight;

        console.log(`[${type || 'info'}] ${message}`);
    },

    // Log a message to the debug log (persists across refreshes, cleared on game load)
    debugLog(message, type = '') {
        const container = document.getElementById('debug-log');
        if (!container) return;

        const entry = document.createElement('div');
        entry.className = `debug-entry ${type}`;
        entry.textContent = `${new Date().toLocaleTimeString()}: ${message}`;
        container.appendChild(entry);

        // Keep only last 100 entries
        while (container.children.length > 100) {
            container.removeChild(container.firstChild);
        }

        // Scroll to bottom to show newest message
        container.scrollTop = container.scrollHeight;

        console.log(`[debug-${type || 'info'}] ${message}`);
    },

    // Clear the debug log
    clearDebugLog() {
        const container = document.getElementById('debug-log');
        if (container) {
            container.innerHTML = '';
        }
    },

    // Show error in a modal dialog (for errors that occur when another modal is open)
    showError(message) {
        document.getElementById('error-message').textContent = message;
        document.getElementById('error-modal').classList.remove('hidden');
        // Also log to debug log for record keeping
        this.debugLog(message, 'error');
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
