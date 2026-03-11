const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public')); // serve static files (HTML, CSS, JS)

const rooms = {};

// Helper: generate a random 4-letter room code
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// ----- Map definitions (simplified) -----
const maps = {
    spaceship: {
        name: 'Spaceship',
        tileSize: 40,
        width: 25,
        height: 25,
        grid: [] // filled below
    },
    maze: {
        name: 'Maze',
        tileSize: 40,
        width: 25,
        height: 25,
        grid: [] // filled below
    }
};

// Generate default spaceship map (walls on border + some obstacles)
function createSpaceshipGrid() {
    const grid = [];
    for (let y = 0; y < 25; y++) {
        const row = [];
        for (let x = 0; x < 25; x++) {
            // border walls
            if (x === 0 || y === 0 || x === 24 || y === 24) {
                row.push(1);
            } else {
                row.push(0);
            }
        }
        grid.push(row);
    }
    // Add some internal walls
    grid[10][10] = 1; grid[10][11] = 1; grid[11][10] = 1; grid[11][11] = 1;
    grid[5][15] = 1; grid[5][16] = 1; grid[6][15] = 1; grid[6][16] = 1;
    grid[18][8] = 1; grid[18][9] = 1; grid[19][8] = 1; grid[19][9] = 1;
    return grid;
}
maps.spaceship.grid = createSpaceshipGrid();

// Generate a simple maze (just for variety)
function createMazeGrid() {
    const grid = [];
    for (let y = 0; y < 25; y++) {
        const row = [];
        for (let x = 0; x < 25; x++) {
            // border walls + alternating columns/rows
            if (x === 0 || y === 0 || x === 24 || y === 24 || (x % 4 === 0 && y % 3 === 0)) {
                row.push(1);
            } else {
                row.push(0);
            }
        }
        grid.push(row);
    }
    return grid;
}
maps.maze.grid = createMazeGrid();

// ----- Helper: collision detection (circle vs tile walls) -----
function collidesWithWalls(x, y, r, grid, tileSize) {
    const minTileX = Math.floor((x - r) / tileSize);
    const maxTileX = Math.floor((x + r) / tileSize);
    const minTileY = Math.floor((y - r) / tileSize);
    const maxTileY = Math.floor((y + r) / tileSize);

    for (let ty = minTileY; ty <= maxTileY; ty++) {
        for (let tx = minTileX; tx <= maxTileX; tx++) {
            if (ty < 0 || ty >= grid.length || tx < 0 || tx >= grid[0].length) continue; // out of bounds = open space
            if (grid[ty][tx] === 1) {
                const tileLeft = tx * tileSize;
                const tileRight = (tx + 1) * tileSize;
                const tileTop = ty * tileSize;
                const tileBottom = (ty + 1) * tileSize;

                const closestX = Math.max(tileLeft, Math.min(x, tileRight));
                const closestY = Math.max(tileTop, Math.min(y, tileBottom));
                const dx = x - closestX;
                const dy = y - closestY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < r) return true;
            }
        }
    }
    return false;
}

// ----- Socket.io connection handling -----
io.on('connection', (socket) => {
    console.log('New client:', socket.id);

    // --- Host a new game ---
    socket.on('hostGame', (data) => {
        const { playerName, settings } = data;
        let roomCode = generateRoomCode();
        while (rooms[roomCode]) roomCode = generateRoomCode(); // ensure unique

        const room = {
            code: roomCode,
            hostId: socket.id,
            players: {},
            settings: settings || {
                map: 'spaceship',
                maxPlayers: 10,
                hidingTime: 10,
                roundTime: 120,
                visionDistance: 150, // pixels
                obstacles: true,
                speed: 3
            },
            gameState: 'lobby', // lobby, hiding, seeking, ended
            hidingEndTime: null,
            roundEndTime: null,
            seekerId: null
        };

        // Add host player
        room.players[socket.id] = {
            id: socket.id,
            name: playerName,
            color: getRandomColor(),
            ready: true,
            role: 'unassigned',
            position: { x: 200, y: 200 }, // temporary spawn, will be set on game start
            caught: false
        };

        rooms[roomCode] = room;
        socket.join(roomCode);
        socket.emit('roomCreated', { roomCode, roomState: room });
    });

    // --- Join an existing game ---
    socket.on('joinGame', (data) => {
        const { roomCode, playerName } = data;
        const room = rooms[roomCode.toUpperCase()];
        if (!room) {
            socket.emit('error', 'Room not found');
            return;
        }
        if (Object.keys(room.players).length >= room.settings.maxPlayers) {
            socket.emit('error', 'Room full');
            return;
        }

        const player = {
            id: socket.id,
            name: playerName,
            color: getRandomColor(),
            ready: false,
            role: 'unassigned',
            position: { x: 100, y: 100 },
            caught: false
        };
        room.players[socket.id] = player;
        socket.join(roomCode);

        // Notify all players in room
        io.to(roomCode).emit('playerJoined', room.players);
        socket.emit('joinedRoom', { roomCode, roomState: room, yourId: socket.id });
    });

    // --- Toggle ready status (lobby only) ---
    socket.on('toggleReady', (data) => {
        const { roomCode } = data;
        const room = rooms[roomCode];
        if (!room || room.gameState !== 'lobby') return;
        const player = room.players[socket.id];
        if (player) {
            player.ready = !player.ready;
            io.to(roomCode).emit('roomUpdate', room.players);
        }
    });

    // --- Start game (host only) ---
    socket.on('startGame', (data) => {
        const { roomCode } = data;
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id || room.gameState !== 'lobby') return;

        // Assign roles: random seeker
        const playerIds = Object.keys(room.players);
        const seekerIndex = Math.floor(Math.random() * playerIds.length);
        const seekerId = playerIds[seekerIndex];
        room.seekerId = seekerId;

        // Set spawn positions (random free spots)
        const map = maps[room.settings.map];
        const tileSize = map.tileSize;
        playerIds.forEach(id => {
            const player = room.players[id];
            player.role = (id === seekerId) ? 'seeker' : 'hider';
            player.caught = false;
            // Find a random walkable tile
            let attempts = 0;
            let placed = false;
            while (!placed && attempts < 1000) {
                const tx = Math.floor(Math.random() * map.width);
                const ty = Math.floor(Math.random() * map.height);
                if (map.grid[ty][tx] === 0) {
                    player.position = {
                        x: tx * tileSize + tileSize / 2,
                        y: ty * tileSize + tileSize / 2
                    };
                    placed = true;
                }
                attempts++;
            }
            // Fallback
            if (!placed) player.position = { x: 200, y: 200 };
        });

        room.gameState = 'hiding';
        room.hidingEndTime = Date.now() + room.settings.hidingTime * 1000;
        io.to(roomCode).emit('gameStarted', {
            gameState: room.gameState,
            hidingEndTime: room.hidingEndTime,
            seekerId,
            players: room.players,
            settings: room.settings,
            map: room.settings.map
        });
    });

    // --- Player movement (sent frequently from client) ---
    socket.on('playerMove', (data) => {
        const { roomCode, dirX, dirY } = data;
        const room = rooms[roomCode];
        if (!room) return;
        const player = room.players[socket.id];
        if (!player || player.caught) return;

        // Movement allowed only during hiding (for hiders) and seeking (for all non-caught)
        if (room.gameState === 'hiding' && player.role === 'seeker') return; // seeker frozen
        if (room.gameState !== 'hiding' && room.gameState !== 'seeking') return;

        const speed = room.settings.speed;
        let newX = player.position.x + dirX * speed;
        let newY = player.position.y + dirY * speed;

        const map = maps[room.settings.map];
        const tileSize = map.tileSize;
        const radius = 15; // player radius

        if (!collidesWithWalls(newX, newY, radius, map.grid, tileSize)) {
            player.position.x = newX;
            player.position.y = newY;
        } else {
            // Try separate axes
            if (!collidesWithWalls(newX, player.position.y, radius, map.grid, tileSize)) {
                player.position.x = newX;
            } else if (!collidesWithWalls(player.position.x, newY, radius, map.grid, tileSize)) {
                player.position.y = newY;
            }
        }

        // Broadcast new position to all players in room
        io.to(roomCode).emit('playerMoved', { id: socket.id, position: player.position });
    });

    // --- Disconnect ---
    socket.on('disconnect', () => {
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            if (room.players[socket.id]) {
                delete room.players[socket.id];
                io.to(roomCode).emit('playerLeft', socket.id);

                if (Object.keys(room.players).length === 0) {
                    delete rooms[roomCode];
                } else if (room.hostId === socket.id) {
                    // Assign new host (first player in list)
                    const newHostId = Object.keys(room.players)[0];
                    room.hostId = newHostId;
                    io.to(roomCode).emit('newHost', newHostId);
                }
                break;
            }
        }
        console.log('Client disconnected:', socket.id);
    });
});

// ----- Game loop (timers, collisions, win conditions) -----
setInterval(() => {
    for (const roomCode in rooms) {
        const room = rooms[roomCode];
        if (!room) continue;

        // Phase transitions
        if (room.gameState === 'hiding' && Date.now() >= room.hidingEndTime) {
            room.gameState = 'seeking';
            room.roundEndTime = Date.now() + room.settings.roundTime * 1000;
            io.to(roomCode).emit('phaseChange', { gameState: 'seeking', roundEndTime: room.roundEndTime });
        }

        // Collision detection: seeker vs hiders
        if (room.gameState === 'seeking') {
            const seeker = room.players[room.seekerId];
            if (seeker && !seeker.caught) {
                for (const id in room.players) {
                    const player = room.players[id];
                    if (player.role === 'hider' && !player.caught) {
                        const dx = player.position.x - seeker.position.x;
                        const dy = player.position.y - seeker.position.y;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist < 30) { // capture radius
                            player.caught = true;
                            io.to(roomCode).emit('playerCaught', id);
                        }
                    }
                }
            }

            // Check win conditions
            const hidersRemaining = Object.values(room.players).filter(p => p.role === 'hider' && !p.caught).length;
            if (hidersRemaining === 0) {
                room.gameState = 'ended';
                io.to(roomCode).emit('gameOver', { winner: 'seeker' });
            } else if (Date.now() >= room.roundEndTime) {
                room.gameState = 'ended';
                io.to(roomCode).emit('gameOver', { winner: 'hiders' });
            }
        }
    }
}, 100); // check every 100ms

// Helper: random color
function getRandomColor() {
    const colors = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan', 'lime', 'brown'];
    return colors[Math.floor(Math.random() * colors.length)];
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
