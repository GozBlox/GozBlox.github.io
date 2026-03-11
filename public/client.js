const socket = io();

// ----- Device detection -----
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 'ontouchstart' in window;
if (isMobile) {
    document.body.classList.add('mobile');
} else {
    document.body.classList.add('desktop');
}

// ----- DOM elements -----
const screens = {
    mainMenu: document.getElementById('mainMenu'),
    hostMenu: document.getElementById('hostMenu'),
    joinMenu: document.getElementById('joinMenu'),
    lobby: document.getElementById('lobby'),
    howToPlay: document.getElementById('howToPlay'),
    gameContainer: document.getElementById('gameContainer')
};

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// UI elements
const roomCodeDisplay = document.getElementById('roomCodeDisplay');
const playerListDiv = document.getElementById('playerList');
const readyBtn = document.getElementById('readyBtn');
const startGameBtn = document.getElementById('startGameBtn');
const leaveLobbyBtn = document.getElementById('leaveLobbyBtn');
const timerDiv = document.getElementById('timer');
const playersLeftDiv = document.getElementById('playersLeft');
const roleDisplayDiv = document.getElementById('roleDisplay');

// Inputs
const playerNameHost = document.getElementById('playerNameHost');
const playerNameJoin = document.getElementById('playerNameJoin');
const roomCodeInput = document.getElementById('roomCode');
const mapSelect = document.getElementById('mapSelect');
const maxPlayers = document.getElementById('maxPlayers');
const hidingTime = document.getElementById('hidingTime');
const roundTime = document.getElementById('roundTime');
const visionDistance = document.getElementById('visionDistance');
const speed = document.getElementById('speed');

// Buttons
document.getElementById('hostBtn').addEventListener('click', () => showScreen('hostMenu'));
document.getElementById('joinBtn').addEventListener('click', () => showScreen('joinMenu'));
document.getElementById('howToBtn').addEventListener('click', () => showScreen('howToPlay'));
document.getElementById('settingsBtn').addEventListener('click', () => alert('Settings not implemented in demo'));
document.getElementById('backFromHost').addEventListener('click', () => showScreen('mainMenu'));
document.getElementById('backFromJoin').addEventListener('click', () => showScreen('mainMenu'));
document.getElementById('backFromHowTo').addEventListener('click', () => showScreen('mainMenu'));
document.getElementById('hostConfirm').addEventListener('click', hostGame);
document.getElementById('joinConfirm').addEventListener('click', joinGame);
readyBtn.addEventListener('click', toggleReady);
startGameBtn.addEventListener('click', startGame);
leaveLobbyBtn.addEventListener('click', leaveLobby);

// Joystick (mobile)
const joystickZone = document.getElementById('joystickZone');
const joystick = document.getElementById('joystick');
let joystickActive = false;
let joystickDir = { x: 0, y: 0 };

if (isMobile) {
    joystickZone.addEventListener('touchstart', handleJoystickStart);
    joystickZone.addEventListener('touchmove', handleJoystickMove);
    joystickZone.addEventListener('touchend', handleJoystickEnd);
}

function handleJoystickStart(e) {
    e.preventDefault();
    joystickActive = true;
    updateJoystick(e.touches[0]);
}

function handleJoystickMove(e) {
    e.preventDefault();
    if (!joystickActive) return;
    updateJoystick(e.touches[0]);
}

function handleJoystickEnd(e) {
    e.preventDefault();
    joystickActive = false;
    joystick.style.transform = 'translate(0, 0)';
    joystickDir = { x: 0, y: 0 };
}

function updateJoystick(touch) {
    const rect = joystickZone.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const maxDist = rect.width / 2 - 25; // joystick radius

    let dx = touch.clientX - centerX;
    let dy = touch.clientY - centerY;
    const dist = Math.min(Math.sqrt(dx*dx + dy*dy), maxDist);
    const angle = Math.atan2(dy, dx);

    const limitedX = Math.cos(angle) * dist;
    const limitedY = Math.sin(angle) * dist;

    joystick.style.transform = `translate(${limitedX}px, ${limitedY}px)`;
    joystickDir = {
        x: limitedX / maxDist,
        y: limitedY / maxDist
    };
}

// Keyboard controls (desktop)
const keys = {};
window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') keys.up = true;
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') keys.down = true;
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = true;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = true;
    e.preventDefault();
});
window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') keys.up = false;
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') keys.down = false;
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = false;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = false;
    e.preventDefault();
});

// Game state
let currentRoom = null;
let myId = null;
let gameActive = false;
let mapData = null;
let players = {};
let settings = {};
let gamePhase = 'lobby'; // lobby, hiding, seeking, ended
let hidingEndTime = 0;
let roundEndTime = 0;
let seekerId = null;

// ----- Helper functions -----
function showScreen(screenName) {
    for (let key in screens) {
        screens[key].style.display = 'none';
    }
    if (screenName === 'game') {
        screens.gameContainer.style.display = 'block';
        resizeCanvas();
    } else {
        screens[screenName].style.display = 'flex';
        screens.gameContainer.style.display = 'none';
    }
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

window.addEventListener('resize', resizeCanvas);

// ----- Socket event handlers -----
socket.on('roomCreated', (data) => {
    currentRoom = data.roomCode;
    myId = socket.id;
    updateLobby(data.roomState.players);
    roomCodeDisplay.textContent = currentRoom;
    showScreen('lobby');
    // Host can start game
    startGameBtn.style.display = 'block';
});

socket.on('joinedRoom', (data) => {
    currentRoom = data.roomCode;
    myId = data.yourId;
    updateLobby(data.roomState.players);
    roomCodeDisplay.textContent = currentRoom;
    showScreen('lobby');
    startGameBtn.style.display = 'none'; // only host sees start
});

socket.on('roomUpdate', (playersData) => {
    updateLobby(playersData);
});

socket.on('playerJoined', (playersData) => {
    updateLobby(playersData);
});

socket.on('playerLeft', (playerId) => {
    // handled by next roomUpdate
});

socket.on('newHost', (hostId) => {
    if (hostId === myId) {
        startGameBtn.style.display = 'block';
    }
});

socket.on('gameStarted', (data) => {
    players = data.players;
    settings = data.settings;
    gamePhase = data.gameState;
    hidingEndTime = data.hidingEndTime;
    seekerId = data.seekerId;
    mapData = maps[data.map]; // we'll define maps below
    gameActive = true;
    showScreen('game');
    startGameLoop();
});

socket.on('phaseChange', (data) => {
    gamePhase = data.gameState;
    if (data.roundEndTime) roundEndTime = data.roundEndTime;
});

socket.on('playerMoved', (data) => {
    if (players[data.id]) {
        players[data.id].position = data.position;
    }
});

socket.on('playerCaught', (playerId) => {
    if (players[playerId]) {
        players[playerId].caught = true;
    }
});

socket.on('gameOver', (data) => {
    gamePhase = 'ended';
    alert(`Game Over! ${data.winner} wins!`);
    // Return to main menu after a moment
    setTimeout(() => {
        gameActive = false;
        showScreen('mainMenu');
    }, 2000);
});

socket.on('error', (msg) => {
    alert(msg);
});

// ----- Lobby functions -----
function updateLobby(playersData) {
    players = playersData;
    let html = '';
    for (let id in players) {
        const p = players[id];
        html += `<div class="player-item">
            <div class="player-color" style="background-color:${p.color};"></div>
            <span class="player-name">${p.name}</span>
            <span class="player-ready">${p.ready ? 'Ready' : 'Not Ready'}</span>
        </div>`;
    }
    playerListDiv.innerHTML = html;
}

function toggleReady() {
    if (currentRoom) {
        socket.emit('toggleReady', { roomCode: currentRoom });
    }
}

function startGame() {
    if (currentRoom) {
        socket.emit('startGame', { roomCode: currentRoom });
    }
}

function leaveLobby() {
    // Disconnect and reload? For simplicity, reload page.
    window.location.reload();
}

// ----- Host game: collect settings -----
function hostGame() {
    const name = playerNameHost.value.trim() || 'Host';
    const settings = {
        map: mapSelect.value,
        maxPlayers: parseInt(maxPlayers.value),
        hidingTime: parseInt(hidingTime.value),
        roundTime: parseInt(roundTime.value),
        visionDistance: parseInt(visionDistance.value),
        speed: parseInt(speed.value)
    };
    socket.emit('hostGame', { playerName: name, settings });
}

function joinGame() {
    const name = playerNameJoin.value.trim() || 'Player';
    const code = roomCodeInput.value.trim().toUpperCase();
    if (code.length !== 4) {
        alert('Enter a 4-letter room code');
        return;
    }
    socket.emit('joinGame', { roomCode: code, playerName: name });
}

// ----- Game loop (render & movement) -----
let lastMoveEmit = 0;
function gameLoop() {
    if (!gameActive) return;

    // Handle movement input
    let dirX = 0, dirY = 0;
    if (isMobile) {
        dirX = joystickDir.x;
        dirY = joystickDir.y;
    } else {
        if (keys.up) dirY = -1;
        if (keys.down) dirY = 1;
        if (keys.left) dirX = -1;
        if (keys.right) dirX = 1;
        // Normalize diagonal
        if (dirX !== 0 && dirY !== 0) {
            const len = Math.sqrt(dirX*dirX + dirY*dirY);
            dirX /= len;
            dirY /= len;
        }
    }

    // Send movement to server (throttled to ~30 times/sec)
    const now = Date.now();
    if ((dirX !== 0 || dirY !== 0) && now - lastMoveEmit > 30) {
        socket.emit('playerMove', { roomCode: currentRoom, dirX, dirY });
        lastMoveEmit = now;
    }

    // Update UI timers
    if (gamePhase === 'hiding') {
        const remaining = Math.max(0, Math.ceil((hidingEndTime - Date.now()) / 1000));
        timerDiv.textContent = `Hide: ${remaining}s`;
    } else if (gamePhase === 'seeking') {
        const remaining = Math.max(0, Math.ceil((roundEndTime - Date.now()) / 1000));
        timerDiv.textContent = `Seek: ${remaining}s`;
    } else {
        timerDiv.textContent = '--:--';
    }

    const hidersLeft = Object.values(players).filter(p => p.role === 'hider' && !p.caught).length;
    playersLeftDiv.textContent = `Hiders: ${hidersLeft}`;

    const myPlayer = players[myId];
    if (myPlayer) {
        roleDisplayDiv.textContent = myPlayer.role === 'seeker' ? 'SEEKER' : 'HIDER';
    }

    renderCanvas();
    requestAnimationFrame(gameLoop);
}

function startGameLoop() {
    requestAnimationFrame(gameLoop);
}

// ----- Rendering -----
const maps = {
    spaceship: { grid: [], tileSize: 40 }, // will be replaced by server data
    maze: { grid: [], tileSize: 40 }
};

function renderCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!mapData || !players) return;

    const tileSize = mapData.tileSize;
    const grid = mapData.grid;

    // Draw map tiles
    for (let y = 0; y < grid.length; y++) {
        for (let x = 0; x < grid[0].length; x++) {
            if (grid[y][x] === 1) {
                ctx.fillStyle = '#555';
                ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
            } else {
                ctx.fillStyle = '#888';
                ctx.fillRect(x * tileSize, y * tileSize, tileSize-1, tileSize-1);
            }
        }
    }

    // Draw players
    for (let id in players) {
        const p = players[id];
        if (p.caught) continue; // don't draw caught players (or draw ghost?)
        ctx.beginPath();
        ctx.arc(p.position.x, p.position.y, 15, 0, 2 * Math.PI);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = 'white';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(p.name, p.position.x, p.position.y - 25);
        if (p.role === 'seeker') {
            ctx.fillStyle = 'yellow';
            ctx.font = 'bold 14px Arial';
            ctx.fillText('🔍', p.position.x + 20, p.position.y - 20);
        }
    }

    // Vision (fog of war)
    // Draw semi-transparent black overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // For each player, cut a hole in the fog
    ctx.globalCompositeOperation = 'destination-out';
    for (let id in players) {
        const p = players[id];
        if (p.caught) continue;
        let radius = settings.visionDistance;
        // Seeker sees further
        if (p.role === 'seeker') radius *= 1.5;
        const gradient = ctx.createRadialGradient(p.position.x, p.position.y, 0, p.position.x, p.position.y, radius);
        gradient.addColorStop(0, 'rgba(255,255,255,1)');
        gradient.addColorStop(0.7, 'rgba(255,255,255,0.8)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(p.position.x, p.position.y, radius, 0, 2*Math.PI);
        ctx.fill();
    }
    // Reset composite operation
    ctx.globalCompositeOperation = 'source-over';
  }
