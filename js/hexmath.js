/**
 * Hex grid mathematics for Catan board rendering.
 * Uses pointy-top hexagons with offset coordinates.
 */

const HexMath = {
    // Hex size (distance from center to corner)
    SIZE: 55,

    // Precomputed values for pointy-top hexagons
    WIDTH: 55 * Math.sqrt(3),  // SIZE * sqrt(3)
    HEIGHT: 55 * 2,            // SIZE * 2

    /**
     * Convert tile x,y coordinates to pixel position.
     * The coordinate system from the JSON uses:
     * - x: horizontal offset (increases right)
     * - y: vertical position (increases down)
     *
     * Looking at the data:
     * - Center tile (Desert) is at x:0, y:0
     * - Tiles form a standard Catan hex pattern
     */
    tileToPixel(x, y) {
        // For pointy-top hexagons in an offset grid:
        // The x coordinate in the JSON seems to be a combined offset
        // Let's interpret it as: actual_col = x, row = y
        // With odd rows shifted

        const px = x * this.WIDTH * 0.5;
        const py = y * this.HEIGHT * 0.75;

        return { x: px, y: py };
    },

    /**
     * Get the 6 corner points of a hexagon centered at (cx, cy).
     * Pointy-top orientation: first point is at top.
     */
    getHexCorners(cx, cy) {
        const corners = [];
        for (let i = 0; i < 6; i++) {
            // Start from top point (-90 degrees), go clockwise
            const angleDeg = 60 * i - 90;
            const angleRad = (Math.PI / 180) * angleDeg;
            corners.push({
                x: cx + this.SIZE * Math.cos(angleRad),
                y: cy + this.SIZE * Math.sin(angleRad)
            });
        }
        return corners;
    },

    /**
     * Get SVG polygon points string for a hexagon.
     */
    getHexPointsString(cx, cy) {
        const corners = this.getHexCorners(cx, cy);
        return corners.map(p => `${p.x},${p.y}`).join(' ');
    },

    /**
     * Get the midpoint of a hex edge.
     * direction: 0=N, 1=NE, 2=SE, 3=S, 4=SW, 5=NW (pointy-top)
     * For roads between two tiles, we calculate based on shared edge.
     */
    getEdgeMidpoint(cx, cy, direction) {
        const corners = this.getHexCorners(cx, cy);
        // Edge i is between corner i and corner (i+1)%6
        const i = direction;
        const c1 = corners[i];
        const c2 = corners[(i + 1) % 6];
        return {
            x: (c1.x + c2.x) / 2,
            y: (c1.y + c2.y) / 2
        };
    },

    /**
     * Get the position of a vertex.
     * direction: 0=N, 1=NE, 2=SE, 3=S, 4=SW, 5=NW
     * Actually for pointy-top: vertices are at corners
     */
    getVertexPosition(cx, cy, direction) {
        const corners = this.getHexCorners(cx, cy);
        return corners[direction];
    },

    /**
     * Direction string to index mapping for pointy-top hexagons.
     * In pointy-top, corners are at: N(top), NE, SE, S(bottom), SW, NW
     * Edges are between corners.
     */
    directionToIndex: {
        // Vertex directions (corners)
        'N': 0,
        'NE': 1,
        'SE': 2,
        'S': 3,
        'SW': 4,
        'NW': 5,
        // Edge directions (between corners)
        // Edge from corner i to i+1
        'E': 1,   // Between NE and SE corners
        'W': 4    // Between SW and NW corners
    },

    /**
     * Get edge direction index.
     * For edges: NE edge is between N and NE corners (index 0)
     *           E edge is between NE and SE corners (index 1)
     *           SE edge is between SE and S corners (index 2)
     *           etc.
     */
    edgeDirectionToIndex: {
        'NE': 0,  // top-right edge
        'E': 1,   // right edge
        'SE': 2,  // bottom-right edge
        'SW': 3,  // bottom-left edge
        'W': 4,   // left edge
        'NW': 5   // top-left edge
    }
};
