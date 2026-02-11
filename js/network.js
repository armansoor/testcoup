let isNetworkGame = false;
let myPlayerId = null; // Used for rendering perspective (Host=1, Clients=assigned)

const PEER_CONFIG = {
    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' },
            { urls: 'stun:stun.stunprotocol.org:3478' },
            { urls: 'stun:stun.services.mozilla.com' }
        ],
        iceCandidatePoolSize: 10,
    },
    debug: 1
};

let netState = {
    peer: null,
    hostConn: null, // Client's connection to host
    clients: [], // Host's list of { id, conn, name }
    isHost: false,
    pendingRequests: {} // Map of request ID to resolve function
};

// --- HOST LOGIC ---
function initHost() {
    if (!navigator.onLine) {
        alert("Internet connection required for Online Multiplayer.");
        return;
    }

    const name = document.getElementById('my-player-name').value.trim();
    if (name.length < 3 || name.length > 20) {
        alert("Name must be between 3 and 20 characters!");
        return;
    }
    if (name.includes(' ')) {
        alert("Name cannot contain spaces!");
        return;
    }

    isNetworkGame = true;
    netState.isHost = true;

    document.getElementById('online-actions').classList.add('hidden');
    document.getElementById('lobby-status').classList.remove('hidden');
    document.getElementById('host-room-info').classList.remove('hidden');
    document.getElementById('connection-status').innerText = "Initializing Network...";

    netState.peer = new Peer(null, PEER_CONFIG); // Auto-generate ID

    netState.peer.on('error', (err) => {
        console.error("PeerJS Error:", err);
        const statusEl = document.getElementById('connection-status');
        if (statusEl) {
            let msg = `Error: ${err.type}`;
            if (err.type === 'peer-unavailable') msg += " (Host ID not found or offline)";
            if (err.type === 'network') msg += " (Check your internet connection)";
            if (err.type === 'browser-incompatible') msg += " (Browser not supported)";
            if (err.type === 'disconnected') msg += " (Lost connection to signaling server)";
            if (err.type === 'invalid-id') msg += " (Invalid ID format)";
            if (err.type === 'socket-error') msg += " (Socket connection failed)";
            if (err.type === 'socket-closed') msg += " (Socket closed unexpectedly)";
            if (err.type === 'unavailable-id') msg += " (ID already taken)";
            if (err.type === 'webrtc') msg += " (WebRTC Native Error)";

            statusEl.innerText = msg;
            statusEl.style.color = 'red';
        }
        alert("Network Error: " + err.type + "\n" + (err.message || ""));
    });

    netState.peer.on('open', (id) => {
        document.getElementById('my-room-code').innerText = id;
        document.getElementById('connection-status').innerText = "Waiting for players...";
        document.getElementById('network-start-btn').classList.remove('hidden');
        updateLobbyList(); // Show self immediately
    });

    netState.peer.on('connection', (conn) => {
        conn.on('open', () => {
            console.log("New connection:", conn.peer);
        });
        conn.on('data', (data) => handleNetworkData(data, conn));
        conn.on('close', () => {
            netState.clients = netState.clients.filter(c => c.conn !== conn);
            updateLobbyList();
            broadcastLobbyUpdate();
            markPlayerDisconnected(conn.peer);
        });
    });
}

function copyRoomCode() {
    const code = document.getElementById('my-room-code').innerText;
    navigator.clipboard.writeText(code).then(() => {
        alert("Room Code copied to clipboard!");
    }).catch(err => {
        console.error('Failed to copy: ', err);
        alert("Failed to copy code.");
    });
}

// --- CLIENT LOGIC ---
function joinGame() {
    if (!navigator.onLine) {
        alert("Internet connection required for Online Multiplayer.");
        return;
    }

    const name = document.getElementById('my-player-name').value.trim();
    if (name.length < 3 || name.length > 20) {
        alert("Name must be between 3 and 20 characters!");
        return;
    }
    if (name.includes(' ')) {
        alert("Name cannot contain spaces!");
        return;
    }
    const hostId = document.getElementById('host-id-input').value.trim();
    if (!hostId) { alert("Please enter a Room Code"); return; }

    isNetworkGame = true;
    netState.isHost = false;

    document.getElementById('online-actions').classList.add('hidden');
    document.getElementById('lobby-status').classList.remove('hidden');
    document.getElementById('connection-status').innerText = "Connecting to Host...";
    document.getElementById('connected-players-list').innerHTML = ''; // Clear stale list

    netState.peer = new Peer(null, PEER_CONFIG);

    netState.peer.on('error', (err) => {
        console.error("PeerJS Error:", err);
        const statusEl = document.getElementById('connection-status');
        if (statusEl) {
            let msg = `Error: ${err.type}`;
            if (err.type === 'peer-unavailable') msg += " (Host ID not found or offline)";
            if (err.type === 'network') msg += " (Check your internet connection)";
            if (err.type === 'browser-incompatible') msg += " (Browser not supported)";
            if (err.type === 'disconnected') msg += " (Lost connection to signaling server)";

            statusEl.innerText = msg;
            statusEl.style.color = 'red';
        }
        alert("Network Error: " + err.type + "\n" + (err.message || ""));
        // location.reload(); // Don't reload immediately so user can read error
    });

    netState.peer.on('open', (id) => {
        // Prevent self-connection
        if (id === hostId) {
            alert("You cannot join yourself! Share the code with another device.");
            location.reload();
            return;
        }

        document.getElementById('connection-status').innerText = "Looking for Host...";

        const conn = netState.peer.connect(hostId, {
            reliable: true // Improve reliability for data channel
        });
        netState.hostConn = conn;

        // Connection Timeout Safety (Extended for mobile networks)
        const timeout = setTimeout(() => {
            if (!conn.open) {
                document.getElementById('connection-status').innerText = "Connection Failed: Timeout";
                alert("Connection timed out. Ensure Host is online and check firewalls.");
                // Do not auto-reload immediately so user can read error
            }
        }, 15000);

        conn.on('open', () => {
            clearTimeout(timeout);
            document.getElementById('connection-status').innerText = "Connected! Waiting for Host...";
            conn.send({ type: 'JOIN', name: name });
        });

        conn.on('data', (data) => handleNetworkData(data, conn));

        conn.on('close', () => {
            alert("Disconnected from Host");
            location.reload();
        });

        conn.on('error', (err) => {
            clearTimeout(timeout);
            console.error("Connection Error:", err);
            document.getElementById('connection-status').innerText = "Error: " + err;
        });
    });
}

function handleNetworkData(data, conn) {
    // console.log("Received:", data);

    if (netState.isHost) {
        // HOST HANDLING
        switch(data.type) {
            case 'JOIN':
                netState.clients.push({
                    id: conn.peer,
                    conn: conn,
                    name: data.name
                });
                updateLobbyList();
                broadcastLobbyUpdate();
                break;
            case 'ACTION':
                // Client submitting an action
                // Find player
                const p = gameState.players.find(pl => pl.peerId === conn.peer);
                if (p && gameState.players[gameState.currentPlayerIndex].id === p.id) {
                    // Inject target by Name look up (since ID matches)
                    let target = null;
                    if (data.targetId) {
                        target = gameState.players.find(pl => pl.id === data.targetId);
                    }
                    handleActionSubmit(data.action, p, target);
                }
                break;
            case 'INTERACTION_RESPONSE':
                // Client responding to Challenge/Block query
                // Resolve the pending promise
                if (netState.pendingRequests[data.reqId]) {
                    netState.pendingRequests[data.reqId](data.response);
                    delete netState.pendingRequests[data.reqId];
                }
                break;
        }
    } else {
        // CLIENT HANDLING
        switch(data.type) {
            case 'LOBBY_UPDATE':
                updateClientLobby(data.players);
                break;
            case 'GAME_START':
                myPlayerId = data.playerId;
                setupClientGame(data.state);
                break;
            case 'STATE_UPDATE':
                syncClientState(data.state);
                break;
            case 'INTERACTION_REQUEST':
                handleInteractionRequest(data);
                break;
            case 'GAME_OVER':
                handleGameOver(data);
                break;
        }
    }
}

function handleGameOver(data) {
    // Ensure log is up to date (usually State Update comes before this, but safe to assume log is sync)
    document.getElementById('winner-name').innerText = `${data.winnerName} WINS!`;
    document.getElementById('game-end-message').innerText = `${data.isAI ? 'The Bot' : 'The Player'} has won.`;
    document.getElementById('game-over-modal').classList.remove('hidden');

    saveMatchHistory({ name: data.winnerName });
}

// --- LOBBY HELPERS ---
function updateLobbyList() {
    const list = document.getElementById('connected-players-list');
    list.innerHTML = ''; // Clear

    // 1. Host (Self)
    if (netState.isHost) {
        const myName = document.getElementById('my-player-name').value.trim() || 'Host';
        const li = document.createElement('li');
        li.innerText = `${myName} (Host)`;
        li.style.color = '#4caf50';
        list.appendChild(li);
    } else {
        // Client view handled by updateClientLobby
    }

    // 2. Connected Clients
    netState.clients.forEach(c => {
        const li = document.createElement('li');
        li.innerText = c.name;
        list.appendChild(li);
    });

    // 3. AI Bots (Placeholder)
    if (netState.isHost) {
        const aiCount = parseInt(document.getElementById('network-ai-count').value);
        for(let i=1; i<=aiCount; i++) {
            const li = document.createElement('li');
            li.innerText = `Bot ${i} (AI)`;
            li.style.color = '#aaa';
            li.style.fontStyle = 'italic';
            list.appendChild(li);
        }
    }
}

function broadcastLobbyUpdate() {
    const hostName = document.getElementById('my-player-name').value.trim() || 'Host';

    // Include Bots in the broadcast list so clients see them too
    const bots = [];
    const aiCount = parseInt(document.getElementById('network-ai-count').value);
    for(let i=1; i<=aiCount; i++) bots.push(`Bot ${i} (AI)`);

    const names = [`${hostName} (Host)`, ...netState.clients.map(c => c.name), ...bots];
    broadcast({ type: 'LOBBY_UPDATE', players: names });
}

function updateClientLobby(names) {
    const list = document.getElementById('connected-players-list');
    list.innerHTML = '';
    names.forEach(n => {
        const li = document.createElement('li');
        li.innerText = n;
        list.appendChild(li);
    });
}

function broadcast(msg) {
    netState.clients.forEach(c => {
        if(c.conn && c.conn.open) c.conn.send(msg);
    });
}

function startNetworkGame() {
    if (!netState.isHost) return;

    const aiCount = parseInt(document.getElementById('network-ai-count').value);

    // Check Minimum Players (Host + at least 1 other)
    if (netState.clients.length + aiCount < 1) {
        alert("You need at least 1 other player (Human or AI) to start!");
        return;
    }

    // 1. Setup Players
    gameState.players = [];
    gameState.deck = [];
    gameState.log = [];
    gameState.replayData = [];

    // Deck
    ROLES.forEach(role => {
        for(let i=0; i<3; i++) gameState.deck.push({ role: role, dead: false });
    });
    shuffle(gameState.deck);

    // Host is Player 1
    const hostName = document.getElementById('my-player-name').value.trim();
    const hostP = new Player(1, hostName, false);
    gameState.players.push(hostP);
    myPlayerId = 1;

    // Clients
    netState.clients.forEach((c, idx) => {
        const pid = idx + 2;
        const p = new Player(pid, c.name || `Player ${pid}`, false);
        p.isRemote = true; // Flag for logic
        p.peerId = c.id;   // Map back to connection
        gameState.players.push(p);
    });

    // AI
    // aiCount is already defined above
    const difficulty = document.getElementById('network-difficulty').value;
    const startId = gameState.players.length + 1;
    for(let i=0; i<aiCount; i++) {
        // Keep Bot Names as is (Bot 1, Bot 2...)
        gameState.players.push(new Player(startId + i, `Bot ${i+1}`, true, difficulty));
    }

    // Deal
    gameState.players.forEach(p => {
        p.cards = [gameState.deck.pop(), gameState.deck.pop()];
    });

    gameState.currentPlayerIndex = 0;

    // UI Switch for Host
    document.getElementById('lobby-screen').classList.remove('active');
    document.getElementById('game-screen').classList.add('active');

    // Broadcast Start
    netState.clients.forEach(c => {
        const p = gameState.players.find(pl => pl.peerId === c.id);
        c.conn.send({
            type: 'GAME_START',
            playerId: p.id,
            state: serializeState()
        });
    });

    updateUI();
    playTurn();
}

function setupClientGame(initialState) {
    document.getElementById('lobby-screen').classList.remove('active');
    document.getElementById('game-screen').classList.add('active');

    gameState.replayData = [];

    // Load State
    syncClientState(initialState);
}

function serializeState() {
    // Create a copy of gameState safe for JSON
    // We need to handle circular refs (like currentAction.player)
    // and remove hidden info if we wanted to be secure, but for now we trust clients.

    const s = {
        players: gameState.players.map(p => ({
            id: p.id,
            name: p.name,
            coins: p.coins,
            cards: p.cards, // Full cards (client must hide opponent's)
            isAI: p.isAI,
            alive: p.alive,
            lastAction: p.lastAction,
            isRemote: p.isRemote, // preserve flags
            peerId: p.peerId
        })),
        currentPlayerIndex: gameState.currentPlayerIndex,
        turnPhase: gameState.turnPhase,
        log: [...gameState.log], // Clone array to prevent reference issues in replay
        currentAction: null
    };

    if (gameState.currentAction) {
        s.currentAction = {
            type: gameState.currentAction.type,
            playerId: gameState.currentAction.player.id, // Send ID instead of Obj
            targetId: gameState.currentAction.target ? gameState.currentAction.target.id : null,
            role: gameState.currentAction.role
        };
    }

    return s;
}

function syncClientState(remoteState) {
    // Reconstruct gameState from remoteState
    gameState.log = remoteState.log;
    gameState.currentPlayerIndex = remoteState.currentPlayerIndex;
    gameState.turnPhase = remoteState.turnPhase;

    // Sync Players
    // We overwrite local players array with data
    // Important: UI depends on this data structure
    gameState.players = remoteState.players.map(rp => {
        // We don't need full Player class instance methods on Client
        // Just the properties for updateUI
        return rp;
    });

    // Re-link currentAction
    if (remoteState.currentAction) {
        const p = gameState.players.find(pl => pl.id === remoteState.currentAction.playerId);
        const t = remoteState.currentAction.targetId ? gameState.players.find(pl => pl.id === remoteState.currentAction.targetId) : null;
        gameState.currentAction = {
            type: remoteState.currentAction.type,
            player: p,
            target: t,
            role: remoteState.currentAction.role
        };
    } else {
        gameState.currentAction = null;
    }

    // Refresh Logs
    const logBox = document.getElementById('game-log');
    logBox.innerHTML = '';
    gameState.log.forEach((msg, index) => {
        const div = document.createElement('div');
        // Simple type inference or default
        div.className = 'log-entry';
        if (msg.includes('WINS') || msg.includes('ELIMINATED')) div.className += ' important';
        if (msg.includes('Welcome')) div.className += ' system';

        div.innerText = msg;

        // Highlight last entry if replaying
        if (isReplayMode && index === gameState.log.length - 1) {
            div.style.backgroundColor = '#333';
            div.style.borderLeft = '4px solid #4CAF50';
        }

        logBox.appendChild(div);
    });
    logBox.scrollTop = logBox.scrollHeight;

    updateUI();

    // CAPTURE REPLAY (CLIENT)
    if (!isReplayMode && isNetworkGame && !netState.isHost) {
        captureReplaySnapshot();
    }
}

function broadcastState() {
    // CAPTURE REPLAY (HOST / LOCAL)
    // We capture every broadcast state, which corresponds to every significant UI update.
    if (!isReplayMode) {
        captureReplaySnapshot();
    }

    if (isNetworkGame && netState.isHost) {
        const s = serializeState();
        broadcast({ type: 'STATE_UPDATE', state: s });
    }
}

function captureReplaySnapshot() {
    if (!gameState.replayData) gameState.replayData = [];

    // Create a deep copy snapshot
    const s = serializeState();
    s.timestamp = Date.now();

    // Avoid duplicates if nothing changed (optional optimization, but strict capture is safer)
    gameState.replayData.push(s);
}

// --- NETWORK INTERACTION WRAPPERS ---

function requestChallenge(player, actionObj) {
    if (player.isRemote) {
        return sendInteractionRequest(player, 'CHALLENGE', {
            playerId: player.id,
            actionPlayerId: actionObj.player.id,
            actionType: actionObj.type,
            role: actionObj.role // claimed role
        });
    } else {
        return askHumanChallenge(player, actionObj);
    }
}

function requestBlock(player, actionObj) {
    if (player.isRemote) {
        return sendInteractionRequest(player, 'BLOCK', {
            playerId: player.id,
            actionPlayerId: actionObj.player.id,
            actionType: actionObj.type,
            role: actionObj.role,
            targetId: actionObj.target ? actionObj.target.id : null
        });
    } else {
        return askHumanBlock(player, actionObj);
    }
}

function requestLoseCard(player) {
    if (player.isRemote) {
        return sendInteractionRequest(player, 'LOSE_CARD', {
            playerId: player.id
        });
    } else {
        return askHumanToLoseCard(player);
    }
}

function requestExchange(player) {
    if (player.isRemote) {
        return sendInteractionRequest(player, 'EXCHANGE', {
            playerId: player.id
        });
    } else {
        return askHumanExchange(player);
    }
}

function sendInteractionRequest(player, type, args) {
    return new Promise(resolve => {
        const reqId = Date.now() + Math.random().toString();
        netState.pendingRequests[reqId] = resolve;

        const client = netState.clients.find(c => c.id === player.peerId);
        if (client && client.conn) {
            client.conn.send({
                type: 'INTERACTION_REQUEST',
                reqId: reqId,
                requestType: type,
                args: args
            });
        } else {
            console.error("Client not found for interaction:", player.name);
            resolve(null); // Fallback
        }
    });
}

function markPlayerDisconnected(peerId) {
    if (!netState.isHost) return;

    const p = gameState.players.find(pl => pl.peerId === peerId);
    if (p) {
        log(`${p.name} disconnected.`, 'important');
        p.alive = false; // Kill them to skip turns
        p.cards.forEach(c => c.dead = true); // Mark cards dead

        broadcastState(); // Tell everyone
        updateUI();

        // If it was their turn, move on
        if (getCurrentPlayer().id === p.id) {
            nextTurn();
        }
    }
}
