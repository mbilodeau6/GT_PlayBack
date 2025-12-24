/**
 * Board rendering using SVG.
 */

const Board = {
    svg: null,
    gameState: null,

    // Layers for proper z-ordering
    layers: {
        tiles: null,
        roads: null,
        portLines: null,
        edgePlaceholders: null,
        vertexPlaceholders: null,
        buildings: null,
        robber: null,
        labels: null,
        portLabels: null
    },

    // Map tile IDs to their pixel positions
    tilePositions: new Map(),

    // Map vertex/edge IDs to their positions (for click handling)
    vertexPositions: new Map(),
    edgePositions: new Map(),

    // Click handlers (set by App)
    onVertexClick: null,
    onEdgeClick: null,
    onTileClick: null,

    init(svgElement) {
        this.svg = svgElement;
        this.createLayers();
    },

    createLayers() {
        // Create groups for layered rendering (bottom to top)
        const layerNames = [
            'tiles',
            'roads',
            'portLines',
            'edgePlaceholders',
            'vertexPlaceholders',
            'buildings',
            'robber',
            'labels',
            'portLabels'
        ];
        layerNames.forEach(name => {
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.id = `layer-${name}`;
            this.svg.appendChild(g);
            this.layers[name] = g;
        });
    },

    clear() {
        Object.values(this.layers).forEach(layer => {
            layer.innerHTML = '';
        });
        this.tilePositions.clear();
        this.vertexPositions.clear();
        this.edgePositions.clear();
    },

    render(gameState) {
        this.gameState = gameState;
        this.clear();

        // Calculate and store tile positions
        this.calculateTilePositions();

        // Render in order (bottom to top)
        this.renderTiles();
        this.renderRoads();
        this.renderPorts();
        this.renderEdgePlaceholders();
        this.renderVertexPlaceholders();
        this.renderBuildings();
        this.renderRobber();
    },

    calculateTilePositions() {
        this.gameState.tiles.forEach(tile => {
            const pos = HexMath.tileToPixel(tile.x, tile.y);
            this.tilePositions.set(tile.id, pos);
        });
    },

    // ==================== TILES ====================

    renderTiles() {
        this.gameState.tiles.forEach(tile => {
            this.renderTile(tile);
        });
    },

    renderTile(tile) {
        const pos = this.tilePositions.get(tile.id);

        // Create hex polygon
        const hex = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        hex.setAttribute('points', HexMath.getHexPointsString(pos.x, pos.y));
        hex.setAttribute('class', `tile-hex resource-${tile.resource}`);
        hex.setAttribute('data-tile-id', tile.id);

        // Click handler for tile selection
        hex.addEventListener('click', () => {
            if (this.onTileClick && hex.classList.contains('selectable')) {
                this.onTileClick(tile.id);
            }
        });

        this.layers.tiles.appendChild(hex);

        // Add number token (except for desert)
        if (tile.resource !== 'Desert') {
            this.renderNumberToken(pos.x, pos.y, tile.diceNumber);
        }

        // Add tile ID label (for debugging)
        const idLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        idLabel.setAttribute('x', pos.x);
        idLabel.setAttribute('y', pos.y + 35);
        idLabel.setAttribute('class', 'tile-id');
        idLabel.textContent = tile.id;
        this.layers.labels.appendChild(idLabel);
    },

    renderNumberToken(cx, cy, number) {
        // Background circle
        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bg.setAttribute('cx', cx);
        bg.setAttribute('cy', cy);
        bg.setAttribute('r', 18);
        bg.setAttribute('class', 'tile-number-bg');
        this.layers.labels.appendChild(bg);

        // Number text (shifted up slightly to make room for dots)
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', cx);
        text.setAttribute('y', cy - 2);
        text.setAttribute('class', `tile-number${(number === 6 || number === 8) ? ' red' : ''}`);
        text.textContent = number;
        this.layers.labels.appendChild(text);

        // Add probability dots
        const dotCount = this.getProbabilityDots(number);
        const isRed = (number === 6 || number === 8);
        this.renderProbabilityDots(cx, cy + 10, dotCount, isRed);
    },

    getProbabilityDots(number) {
        // Number of ways to roll each number with 2 dice
        const dotMap = {
            2: 1, 12: 1,
            3: 2, 11: 2,
            4: 3, 10: 3,
            5: 4, 9: 4,
            6: 5, 8: 5
        };
        return dotMap[number] || 0;
    },

    renderProbabilityDots(cx, cy, count, isRed) {
        if (count === 0) return;

        const dotRadius = 2;
        const dotSpacing = 5;
        const totalWidth = (count - 1) * dotSpacing;
        const startX = cx - totalWidth / 2;

        for (let i = 0; i < count; i++) {
            const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            dot.setAttribute('cx', startX + i * dotSpacing);
            dot.setAttribute('cy', cy);
            dot.setAttribute('r', dotRadius);
            dot.setAttribute('class', isRed ? 'probability-dot red' : 'probability-dot');
            this.layers.labels.appendChild(dot);
        }
    },

    // ==================== ROBBER ====================

    renderRobber() {
        const robberTileId = this.gameState.robberTileId;
        if (!robberTileId) return;

        const pos = this.tilePositions.get(robberTileId);
        if (!pos) return;

        // Robber shape (simple pawn/figure)
        // Offset to bottom-right of tile center to avoid number token
        const robber = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const x = pos.x + 25;
        const y = pos.y + 20;

        // Simple robber shape
        robber.setAttribute('d', `
            M ${x} ${y - 20}
            a 8 8 0 1 0 0.01 0
            M ${x - 8} ${y + 15}
            L ${x - 5} ${y - 8}
            Q ${x} ${y - 12} ${x + 5} ${y - 8}
            L ${x + 8} ${y + 15}
            Z
        `);
        robber.setAttribute('class', 'robber');
        this.layers.robber.appendChild(robber);
    },

    // ==================== ROADS & EDGE PLACEHOLDERS ====================

    renderEdgePlaceholders() {
        // Render invisible placeholders for all edges (for click detection)
        this.gameState.edges.forEach(edge => {
            const endpoints = this.getEdgeEndpoints(edge);
            if (!endpoints) return;

            // Store position for later use
            this.edgePositions.set(edge.id, endpoints);

            // Only create placeholder if no road exists
            if (!edge.playerId) {
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', endpoints.x1);
                line.setAttribute('y1', endpoints.y1);
                line.setAttribute('x2', endpoints.x2);
                line.setAttribute('y2', endpoints.y2);
                line.setAttribute('class', 'edge-placeholder');
                line.setAttribute('data-edge-id', edge.id);

                line.addEventListener('click', () => {
                    if (this.onEdgeClick && line.classList.contains('selectable')) {
                        this.onEdgeClick(edge.id);
                    }
                });

                this.layers.edgePlaceholders.appendChild(line);
            }
        });
    },

    renderRoads() {
        const playerColors = this.getPlayerColors();

        this.gameState.edges.forEach(edge => {
            if (edge.playerId) {
                this.renderRoad(edge, playerColors.get(edge.playerId));
            }
        });
    },

    renderRoad(edge, playerColor) {
        const endpoints = this.getEdgeEndpoints(edge);
        if (!endpoints) return;

        const road = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        road.setAttribute('x1', endpoints.x1);
        road.setAttribute('y1', endpoints.y1);
        road.setAttribute('x2', endpoints.x2);
        road.setAttribute('y2', endpoints.y2);
        road.setAttribute('class', `road player-${playerColor}`);
        this.layers.roads.appendChild(road);
    },

    getEdgeEndpoints(edge) {
        // Edge can be between two tiles or on the border (single tile with direction)
        if (edge.tileIds.length === 2) {
            // Edge between two tiles - find the shared edge
            const pos1 = this.tilePositions.get(edge.tileIds[0]);
            const pos2 = this.tilePositions.get(edge.tileIds[1]);
            if (!pos1 || !pos2) return null;

            // Midpoint between the two hex centers
            const midX = (pos1.x + pos2.x) / 2;
            const midY = (pos1.y + pos2.y) / 2;

            // Calculate edge direction based on tile positions
            const dx = pos2.x - pos1.x;
            const dy = pos2.y - pos1.y;

            // Perpendicular to the line between centers, scaled to edge length
            const len = Math.sqrt(dx * dx + dy * dy);
            const edgeHalfLen = HexMath.SIZE * 0.5;
            const perpX = (-dy / len) * edgeHalfLen;
            const perpY = (dx / len) * edgeHalfLen;

            return {
                x1: midX - perpX,
                y1: midY - perpY,
                x2: midX + perpX,
                y2: midY + perpY
            };
        } else if (edge.tileIds.length === 1 && edge.direction) {
            // Border edge - use direction
            const pos = this.tilePositions.get(edge.tileIds[0]);
            if (!pos) return null;

            const dirIndex = HexMath.edgeDirectionToIndex[edge.direction];
            if (dirIndex === undefined) return null;

            const corners = HexMath.getHexCorners(pos.x, pos.y);
            const c1 = corners[dirIndex];
            const c2 = corners[(dirIndex + 1) % 6];

            return { x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y };
        }

        return null;
    },

    // ==================== BUILDINGS & VERTEX PLACEHOLDERS ====================

    renderVertexPlaceholders() {
        // Render invisible placeholders for all vertices (for click detection)
        this.gameState.vertices.forEach(vertex => {
            const pos = this.getVertexPosition(vertex);
            if (!pos) return;

            // Store position for later use
            this.vertexPositions.set(vertex.id, pos);

            // Only create placeholder if no building exists
            if (!vertex.building || vertex.building === 'Blocked') {
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', pos.x);
                circle.setAttribute('cy', pos.y);
                circle.setAttribute('r', 12);
                circle.setAttribute('class', 'vertex-placeholder');
                circle.setAttribute('data-vertex-id', vertex.id);

                circle.addEventListener('click', () => {
                    if (this.onVertexClick && circle.classList.contains('selectable')) {
                        this.onVertexClick(vertex.id);
                    }
                });

                this.layers.vertexPlaceholders.appendChild(circle);
            }
        });
    },

    renderBuildings() {
        const playerColors = this.getPlayerColors();

        this.gameState.vertices.forEach(vertex => {
            if (vertex.building === 'Settlement') {
                this.renderSettlement(vertex, playerColors.get(vertex.playerId));
            } else if (vertex.building === 'City') {
                this.renderCity(vertex, playerColors.get(vertex.playerId));
            }
        });
    },

    getVertexPosition(vertex) {
        if (vertex.tileIds.length >= 2) {
            // Vertex at intersection of multiple tiles
            // Find corners shared by ALL tiles in the vertex
            const firstTilePos = this.tilePositions.get(vertex.tileIds[0]);
            if (!firstTilePos) return null;

            const firstCorners = HexMath.getHexCorners(firstTilePos.x, firstTilePos.y);
            const tolerance = 1; // pixels

            // Collect all corners shared by all tiles in this vertex
            const sharedCorners = [];

            for (const corner of firstCorners) {
                let sharedByAll = true;

                for (let i = 1; i < vertex.tileIds.length; i++) {
                    const otherTilePos = this.tilePositions.get(vertex.tileIds[i]);
                    if (!otherTilePos) {
                        sharedByAll = false;
                        break;
                    }

                    const otherCorners = HexMath.getHexCorners(otherTilePos.x, otherTilePos.y);
                    const hasMatch = otherCorners.some(oc =>
                        Math.abs(oc.x - corner.x) < tolerance &&
                        Math.abs(oc.y - corner.y) < tolerance
                    );

                    if (!hasMatch) {
                        sharedByAll = false;
                        break;
                    }
                }

                if (sharedByAll) {
                    sharedCorners.push(corner);
                }
            }

            // For 3-tile vertices, there's exactly 1 shared corner
            if (vertex.tileIds.length === 3 || sharedCorners.length === 1) {
                return sharedCorners[0];
            }

            // For 2-tile vertices, there are 2 shared corners (endpoints of shared edge)
            // Pick the one NOT shared by any other tile on the board
            if (vertex.tileIds.length === 2 && sharedCorners.length === 2) {
                for (const corner of sharedCorners) {
                    let isExclusive = true;

                    // Check all other tiles on the board
                    for (const tile of this.gameState.tiles) {
                        if (vertex.tileIds.includes(tile.id)) continue;

                        const tilePos = this.tilePositions.get(tile.id);
                        if (!tilePos) continue;

                        const tileCorners = HexMath.getHexCorners(tilePos.x, tilePos.y);
                        const touchesCorner = tileCorners.some(tc =>
                            Math.abs(tc.x - corner.x) < tolerance &&
                            Math.abs(tc.y - corner.y) < tolerance
                        );

                        if (touchesCorner) {
                            isExclusive = false;
                            break;
                        }
                    }

                    if (isExclusive) {
                        return corner;
                    }
                }
            }

            // Fallback: return first shared corner
            return sharedCorners[0] || null;
        } else if (vertex.tileIds.length === 1 && vertex.direction) {
            // Border vertex
            const pos = this.tilePositions.get(vertex.tileIds[0]);
            if (!pos) return null;

            const dirIndex = HexMath.directionToIndex[vertex.direction];
            if (dirIndex === undefined) return null;

            const corners = HexMath.getHexCorners(pos.x, pos.y);
            return corners[dirIndex];
        }

        return null;
    },

    renderSettlement(vertex, playerColor) {
        const pos = this.getVertexPosition(vertex);
        if (!pos) return;

        // Settlement shape (house)
        const settlement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const x = pos.x;
        const y = pos.y;
        const size = 10;

        settlement.setAttribute('d', `
            M ${x} ${y - size}
            L ${x + size} ${y}
            L ${x + size} ${y + size}
            L ${x - size} ${y + size}
            L ${x - size} ${y}
            Z
        `);
        settlement.setAttribute('class', `settlement player-${playerColor}`);
        settlement.setAttribute('data-vertex-id', vertex.id);

        // Allow clicking on settlements for upgrade
        settlement.addEventListener('click', (e) => {
            console.log('Settlement clicked:', vertex.id, 'onVertexClick:', !!this.onVertexClick);
            e.stopPropagation();
            if (this.onVertexClick) {
                this.onVertexClick(vertex.id);
            }
        });

        this.layers.buildings.appendChild(settlement);
    },

    renderCity(vertex, playerColor) {
        const pos = this.getVertexPosition(vertex);
        if (!pos) return;

        // City shape (larger building)
        const city = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const x = pos.x;
        const y = pos.y;
        const size = 12;

        city.setAttribute('d', `
            M ${x - size} ${y - size/2}
            L ${x - size/3} ${y - size}
            L ${x + size/3} ${y - size}
            L ${x + size} ${y - size/2}
            L ${x + size} ${y + size}
            L ${x - size} ${y + size}
            Z
        `);
        city.setAttribute('class', `city player-${playerColor}`);
        this.layers.buildings.appendChild(city);
    },

    // ==================== PORTS ====================

    renderPorts() {
        this.gameState.ports.forEach(port => {
            this.renderPort(port);
        });
    },

    renderPort(port) {
        // Get positions of the two port vertices
        const v1 = this.gameState.vertices.find(v => v.id === port.vertices[0]);
        const v2 = this.gameState.vertices.find(v => v.id === port.vertices[1]);

        if (!v1 || !v2) return;

        const pos1 = this.getVertexPosition(v1);
        const pos2 = this.getVertexPosition(v2);

        if (!pos1 || !pos2) return;

        // Draw line to indicate port (in bottom layer)
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', pos1.x);
        line.setAttribute('y1', pos1.y);
        line.setAttribute('x2', pos2.x);
        line.setAttribute('y2', pos2.y);
        line.setAttribute('class', 'port-line');
        this.layers.portLines.appendChild(line);

        // Port label (in top layer so it's always visible)
        const midX = (pos1.x + pos2.x) / 2;
        const midY = (pos1.y + pos2.y) / 2;

        // Offset label outward from board center
        const offsetX = midX * 0.25;
        const offsetY = midY * 0.25;

        // Background for label
        const labelText = this.getPortLabel(port.type);
        const tooltipText = this.getPortTooltip(port.type);

        // Create a group for the port label elements (for tooltip)
        const portGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        portGroup.setAttribute('class', 'port-group');

        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bg.setAttribute('x', midX + offsetX - 18);
        bg.setAttribute('y', midY + offsetY - 10);
        bg.setAttribute('width', 36);
        bg.setAttribute('height', 20);
        bg.setAttribute('rx', 4);

        // Apply resource-specific class for 2:1 ports
        const bgClass = port.type === 'ThreeToOne' ? 'port-bg' : `port-bg port-bg-${port.type}`;
        bg.setAttribute('class', bgClass);
        portGroup.appendChild(bg);

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', midX + offsetX);
        label.setAttribute('y', midY + offsetY);
        label.setAttribute('class', 'port-label');
        label.textContent = labelText;
        portGroup.appendChild(label);

        // Add tooltip
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = tooltipText;
        portGroup.appendChild(title);

        this.layers.portLabels.appendChild(portGroup);
    },

    getPortLabel(type) {
        return type === 'ThreeToOne' ? '3:1' : '2:1';
    },

    getPortTooltip(type) {
        const tooltips = {
            'ThreeToOne': '3:1 Port',
            'Brick': '2:1 Brick Port',
            'Wood': '2:1 Wood Port',
            'Ore': '2:1 Ore Port',
            'Grain': '2:1 Grain Port',
            'Wool': '2:1 Wool Port'
        };
        return tooltips[type] || type;
    },

    // ==================== SELECTION HIGHLIGHTING ====================

    setSelectableElements(mode, ids) {
        this.clearSelectableElements();

        if (mode === 'vertex') {
            ids.forEach(id => {
                // Use querySelectorAll to find all elements (placeholders and buildings)
                this.svg.querySelectorAll(`[data-vertex-id="${id}"]`).forEach(el => {
                    el.classList.add('selectable');
                });
            });
        } else if (mode === 'edge') {
            ids.forEach(id => {
                this.svg.querySelectorAll(`[data-edge-id="${id}"]`).forEach(el => {
                    el.classList.add('selectable');
                });
            });
        } else if (mode === 'tile') {
            ids.forEach(id => {
                this.svg.querySelectorAll(`[data-tile-id="${id}"]`).forEach(el => {
                    el.classList.add('selectable');
                });
            });
        }
    },

    clearSelectableElements() {
        this.svg.querySelectorAll('.selectable').forEach(el => {
            el.classList.remove('selectable');
        });
    },

    // ==================== UTILITIES ====================

    getPlayerColors() {
        const colors = new Map();
        if (this.gameState.players) {
            this.gameState.players.forEach(player => {
                colors.set(player.id, player.color);
            });
        }
        return colors;
    }
};
