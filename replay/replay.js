/**
 * Replay application controller.
 * Loads a game and allows stepping through the event record.
 */

const Replay = {
    gameData: null,
    currentEventIndex: -1, // -1 means "before any events" (empty board)

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
        document.getElementById('btn-save-settings').addEventListener('click', () => this.saveSettings());
        document.getElementById('btn-cancel-settings').addEventListener('click', () => this.closeSettings());

        // Playback controls
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
        document.getElementById('api-url-input').value = API.baseUrl;
        document.getElementById('api-key-input').value = API.apiKey;
        document.getElementById('settings-modal').classList.remove('hidden');
    },

    saveSettings() {
        const url = document.getElementById('api-url-input').value.trim();
        const key = document.getElementById('api-key-input').value.trim();
        API.configure(url, key);
        this.closeSettings();
    },

    closeSettings() {
        document.getElementById('settings-modal').classList.add('hidden');
    },

    updateSettingsUI() {
        document.getElementById('api-url-input').value = API.baseUrl;
    },

    // ==================== GAME LOADING ====================

    async loadGame() {
        const gameId = document.getElementById('game-id-input').value.trim();
        if (!gameId) {
            this.setStatus('Please enter a Game ID', 'error');
            return;
        }

        this.setStatus('Loading...', '');

        try {
            const response = await API.getGame(gameId);
            if (response.success) {
                this.gameData = response.gameState;
                this.currentEventIndex = -1;
                this.setStatus(`Loaded: ${gameId.substring(0, 8)}...`, 'success');
                this.renderInitialState();
                this.enablePlaybackControls();
            } else {
                this.setStatus(`Error: ${response.errorMessage}`, 'error');
            }
        } catch (e) {
            this.setStatus(`Failed to load game`, 'error');
            console.error(e);
        }
    },

    setStatus(message, type) {
        const statusEl = document.getElementById('game-status');
        statusEl.textContent = message;
        statusEl.className = type || '';
    },

    renderInitialState() {
        // Render empty board with just tiles (no pieces yet)
        this.renderBoard();
        this.renderPlayers();
        this.renderEventsList();
        this.updatePlaybackPosition();
    },

    enablePlaybackControls() {
        const hasEvents = this.gameData?.eventRecord?.length > 0;
        document.getElementById('btn-step-forward').disabled = !hasEvents;
        document.getElementById('btn-play-pause').disabled = !hasEvents;
        // Step back disabled at start
        document.getElementById('btn-step-back').disabled = true;
    },

    // ==================== RENDERING ====================

    renderBoard() {
        // For now, just render the base game board
        // TODO: In full implementation, render based on currentEventIndex
        if (this.gameData) {
            Board.render(this.gameData);
        }
    },

    renderPlayers() {
        const container = document.getElementById('players-list');

        if (!this.gameData?.players?.length) {
            container.innerHTML = '<div class="empty-state">Load a game to see players</div>';
            return;
        }

        container.innerHTML = '';

        this.gameData.players.forEach(player => {
            const card = document.createElement('div');
            card.className = 'player-card';
            card.style.borderLeftColor = this.getPlayerCSSColor(player.color);

            // In replay mode, show all info (no hiding)
            const resourcesHtml = this.renderResourceBoxes(player.resources);

            card.innerHTML = `
                <div class="player-card-header">
                    <span class="player-name">${player.name}</span>
                </div>
                <div class="player-stats">
                    <span>VP: <span class="stat-value">${player.victoryPoints}</span></span>
                </div>
                <div class="player-resources-row">
                    <div class="player-resources">${resourcesHtml}</div>
                </div>
            `;

            container.appendChild(card);
        });
    },

    renderResourceBoxes(resources) {
        if (!resources) return '';

        const order = ['Brick', 'Wood', 'Ore', 'Grain', 'Wool'];
        return order.map(resource => {
            const count = resources[resource] || 0;
            return `<span class="resource-box resource-${resource}" title="${resource}">${count}</span>`;
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

            if (index < this.currentEventIndex) {
                item.classList.add('past');
            } else if (index === this.currentEventIndex) {
                item.classList.add('current');
            }

            const description = this.formatEvent(event);
            item.innerHTML = `${description}<span class="event-id">[${event.id || index + 1}]</span>`;

            item.addEventListener('click', () => this.jumpToEvent(index));
            container.appendChild(item);
        });

        // Scroll current event into view
        const currentItem = container.querySelector('.event-item.current');
        if (currentItem) {
            currentItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
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

    getPlayerCSSColor(color) {
        const colors = {
            'Red': '#e74c3c',
            'Blue': '#3498db',
            'Orange': '#e67e22',
            'White': '#ecf0f1'
        };
        return colors[color] || '#888';
    },

    updatePlaybackPosition() {
        const events = this.gameData?.eventRecord || [];
        document.getElementById('current-event').textContent = this.currentEventIndex + 1;
        document.getElementById('total-events').textContent = events.length;
    },

    // ==================== PLAYBACK CONTROLS ====================

    stepForward() {
        const events = this.gameData?.eventRecord || [];
        if (this.currentEventIndex < events.length - 1) {
            this.currentEventIndex++;
            this.applyCurrentState();
        }
    },

    stepBack() {
        if (this.currentEventIndex >= 0) {
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
        this.renderEventsList();
        this.updatePlaybackPosition();
        this.updatePlaybackButtons();

        // TODO: Actually rebuild board state based on events 0..currentEventIndex
    },

    updatePlaybackButtons() {
        const events = this.gameData?.eventRecord || [];
        document.getElementById('btn-step-back').disabled = this.currentEventIndex < 0;
        document.getElementById('btn-step-forward').disabled = this.currentEventIndex >= events.length - 1;
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => Replay.init());
