let isNetworkGame = false;
window.myPlayerId = null; // Used for rendering perspective (Host=1, Clients=assigned)

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
    clients: [], // Host's list of { id, conn, name, status, isSpectator }
    isHost: false,
    pendingRequests: {}, // Map of request ID to resolve function
    reconnectTimers: {}, // Map of peerId -> timeoutId
    pendingClients: [], // For approval queue
    requiresApproval: false,
    isScanning: false,
    currentScanIndex: 1
};

const PUBLIC_ROOM_LIMIT = 20;

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

    const allowRandom = document.getElementById('allow-random-join').checked;
    let roomId = null;

    if (!allowRandom) {
        // CUSTOM ROOM NAME
        roomId = prompt("Enter a Custom Room Name (Optional, leave blank for auto-generated):");
        if (roomId) {
            roomId = roomId.trim().replace(/[^a-zA-Z0-9_-]/g, ''); // Sanitize
            if (roomId.length < 3) {
                alert("Custom Room Name too short. Using auto-generated ID.");
                roomId = null;
            }
        }
        startHostPeer(roomId, false);
    } else {
        // Try to grab a public slot
        document.getElementById('online-actions').classList.add('hidden');
        document.getElementById('lobby-status').classList.remove('hidden');
        document.getElementById('connection-status').innerText = "Reserving Public Slot...";

        tryReservePublicSlot(1);
    }
}

function tryReservePublicSlot(index) {
    if (index > PUBLIC_ROOM_LIMIT) {
        alert("All Public Slots are full! Creating a private room instead.");
        startHostPeer(null, true); // Fallback to random ID, but still require approval?
                                   // Actually if it's private ID, random join won't find it.
                                   // So disable approval.
        netState.requiresApproval = false;
        return;
    }

    const id = `coup_public_${index}`;
    const tempPeer = new Peer(id, PEER_CONFIG);

    tempPeer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
            tempPeer.destroy();
            tryReservePublicSlot(index + 1);
        } else {
            console.error("Public Slot Error:", err);
            alert("Network Error: " + err.type);
            tempPeer.destroy();
        }
    });

    tempPeer.on('open', (id) => {
        // Success! We have this slot.
        // We can't easily transfer this socket, but we can just use this peer instance.
        // But my architecture expects `startHostPeer` to create the peer usually.
        // Let's refactor slightly to accept an existing peer or create one.
        // Or simpler: destroy temp and immediately recreate? No, race condition.
        // Use this peer.
        setupHostPeerEvents(tempPeer, true);
    });
}

function startHostPeer(customId, requireApproval) {
    isNetworkGame = true;
    netState.isHost = true;
    netState.requiresApproval = requireApproval;

    document.getElementById('online-actions').classList.add('hidden');
    document.getElementById('lobby-status').classList.remove('hidden');
    document.getElementById('host-room-info').classList.remove('hidden');
    document.getElementById('connection-status').innerText = "Initializing Network...";

    const peer = new Peer(customId, PEER_CONFIG);
    setupHostPeerEvents(peer, requireApproval);
}

function handleHostOpen(id, requireApproval) {
    document.getElementById('my-room-code').innerText = id;
    document.getElementById('connection-status').innerText = "Waiting for players...";
    document.getElementById('network-start-btn').classList.remove('hidden');
    if (requireApproval) {
        document.getElementById('pending-players-section').classList.remove('hidden');
    }
    updateLobbyList();
}

function setupHostPeerEvents(peer, requireApproval) {
    netState.peer = peer;
    netState.isHost = true;
    netState.requiresApproval = requireApproval;
    isNetworkGame = true;

    // Ensure UI is ready
    document.getElementById('online-actions').classList.add('hidden');
    document.getElementById('lobby-status').classList.remove('hidden');
    document.getElementById('host-room-info').classList.remove('hidden');

    // If Peer is already open (e.g. from tryReservePublicSlot), trigger open logic immediately
    if (peer.open) {
        handleHostOpen(peer.id, requireApproval);
    }

    netState.peer.on('error', (err) => {
        console.error("PeerJS Error:", err);
        const statusEl = document.getElementById('connection-status');
        if (statusEl) {
            let msg = `Error: ${err.type}`;
            if (err.type === 'peer-unavailable') msg += " (Host ID not found or offline)";
            if (err.type === 'unavailable-id') msg += " (ID already taken)";

            statusEl.innerText = msg;
            statusEl.style.color = 'red';
        }
        alert("Network Error: " + err.type + "\n" + (err.message || ""));
    });

    netState.peer.on('open', (id) => {
        handleHostOpen(id, requireApproval);
    });

    netState.peer.on('connection', (conn) => {
        conn.on('open', () => {
            console.log("New connection:", conn.peer);
        });
        conn.on('data', (data) => handleNetworkData(data, conn));
        conn.on('close', () => {
            handleClientDisconnect(conn.peer);
        });
    });
}

function handleClientDisconnect(peerId) {
    const clientIndex = netState.clients.findIndex(c => c.id === peerId);
    if (clientIndex === -1) return;

    const client = netState.clients[clientIndex];
    client.status = 'disconnected';

    console.log(`Client ${client.name} disconnected. Starting grace period.`);

    // In Lobby: Remove immediately
    if (document.getElementById('lobby-screen').classList.contains('active')) {
         netState.clients.splice(clientIndex, 1);
         updateLobbyList();
         broadcastLobbyUpdate();
         return;
    }

    // Spectator Disconnect - Just remove
    if (client.isSpectator) {
         netState.clients.splice(clientIndex, 1);
         return;
    }

    // In Game: Start Grace Period (30s)
    log(`${client.name} disconnected. Waiting 30s for reconnect...`, 'important');
    updateUI(); // Show disconnected status visually if supported

    netState.reconnectTimers[peerId] = setTimeout(() => {
        markPlayerDisconnected(peerId);
        delete netState.reconnectTimers[peerId];
    }, 30000); // 30 seconds
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
function joinGame(isSpectator = false) {
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
            // Send RECONNECT flag if we suspect we were dropped?
            // Ideally, we just send JOIN and Host handles the rest.
            conn.send({ type: 'JOIN', name: name, isSpectator: isSpectator });
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

function findPublicGame() {
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
    netState.isHost = false;
    netState.isScanning = true;

    document.getElementById('online-actions').classList.add('hidden');
    document.getElementById('lobby-status').classList.remove('hidden');
    document.getElementById('connection-status').innerText = "Initializing Scanner...";
    document.getElementById('connected-players-list').innerHTML = '';

    netState.peer = new Peer(null, PEER_CONFIG);

    netState.peer.on('error', (err) => {
        // Handle scanning errors gracefully
        console.error("PeerJS Error:", err);
    });

    netState.peer.on('open', (id) => {
        scanPublicSlots(1);
    });
}

function scanPublicSlots(index) {
    if (!netState.isScanning) return;
    netState.currentScanIndex = index;

    if (index > PUBLIC_ROOM_LIMIT) {
        alert("No public games found. Try creating one!");
        location.reload();
        return;
    }

    document.getElementById('connection-status').innerText = `Scanning Room ${index}/${PUBLIC_ROOM_LIMIT}...`;
    const hostId = `coup_public_${index}`;

    // Attempt Connect
    const conn = netState.peer.connect(hostId, {
        reliable: true
    });

    let connected = false;

    // Timeout for this slot
    const timer = setTimeout(() => {
        if (!connected) {
            conn.close(); // Cancel this attempt
            // Move next
            scanPublicSlots(index + 1);
        }
    }, 800); // 0.8s timeout

    conn.on('open', () => {
        connected = true;
        clearTimeout(timer);

        // Success! We found a host.
        // Proceed to join logic
        netState.hostConn = conn;
        document.getElementById('connection-status').innerText = "Found Room! Joining...";

        const name = document.getElementById('my-player-name').value.trim();
        conn.send({ type: 'JOIN', name: name, isSpectator: false });
    });

    conn.on('data', (data) => handleNetworkData(data, conn));

    conn.on('close', () => {
        // If connection closes while we are scanning (e.g. host rejected immediately via close?)
        if (netState.isScanning && netState.hostConn === conn) {
            // Check if we were actually rejected via message first
            // If not, it might be a network drop or host full close
            // We can try next?
            // Safer to just let user know or retry?
            // For now, let's rely on explicit REJECT message handling.
        }
    });

    conn.on('error', (err) => {
        // Usually handled by timeout
    });
}

function handleNetworkData(data, conn) {
    // console.log("Received:", data);

    if (netState.isHost) {
        // HOST HANDLING
        switch(data.type) {
            case 'JOIN':
                handleJoinRequest(data, conn);
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
            case 'JOIN_ERROR':
                if (netState.isScanning) {
                     // Try next slot
                     scanPublicSlots(netState.currentScanIndex + 1);
                } else {
                    alert(data.message);
                    location.reload();
                }
                break;
            case 'JOIN_PENDING':
                document.getElementById('connection-status').innerText = "Waiting for Host Approval...";
                break;
            case 'JOIN_ACCEPTED':
                netState.isScanning = false;
                document.getElementById('connection-status').innerText = "Joined! Waiting for game start...";
                break;
            case 'JOIN_REJECTED':
                if (netState.isScanning) {
                     // Host rejected (maybe full or explicit decline)
                     // Try next slot
                     scanPublicSlots(netState.currentScanIndex + 1);
                } else {
                    netState.isScanning = false;
                    alert(data.message);
                    location.reload();
                }
                break;
        }
    }
}

function handleJoinRequest(data, conn) {
    // RECONNECTION LOGIC
    // Check if a client with this Name was recently disconnected
    const disconnectedClient = netState.clients.find(c => c.name === data.name && c.status === 'disconnected');

    if (disconnectedClient) {
        // Reconnect them!
        clearTimeout(netState.reconnectTimers[disconnectedClient.id]);
        delete netState.reconnectTimers[disconnectedClient.id];

        // Update Connection
        disconnectedClient.id = conn.peer;
        disconnectedClient.conn = conn;
        disconnectedClient.status = 'connected';

        console.log(`Client ${data.name} reconnected!`);
        log(`${data.name} reconnected!`, 'system');

        // Update Game State Peer ID
        const p = gameState.players.find(pl => pl.name === data.name);
        if (p) p.peerId = conn.peer;

        // Send current state immediately
        conn.send({
            type: 'GAME_START', // Reuse start to force state sync
            playerId: p ? p.id : 0,
            state: serializeState()
        });

        return;
    }

    // GAME STARTED CHECK
    const gameInProgress = !document.getElementById('lobby-screen').classList.contains('active');
    if (gameInProgress && !data.isSpectator) {
        conn.send({
            type: 'JOIN_ERROR',
            message: 'Game already started!'
        });
        setTimeout(() => conn.close(), 500);
        return;
    }

    // SPECTATOR LOGIC
    if (data.isSpectator) {
         netState.clients.push({
            id: conn.peer,
            conn: conn,
            name: `${data.name} (Spectator)`,
            status: 'connected',
            isSpectator: true
        });

        // Send them current state if game is running
        if (gameState.players.length > 0) {
            conn.send({
                type: 'GAME_START',
                playerId: -1, // Spectator ID
                state: serializeState()
            });
        }

        updateLobbyList();
        // Don't broadcast spectator join to lobby to avoid clutter? Or yes?
        // Let's broadcast it so people know who is watching.
        broadcastLobbyUpdate();
        return;
    }

    // ROOM FULL CHECK
    // Count current human players (Host=1 + Clients)
    const currentPlayers = 1 + netState.clients.filter(c => !c.isSpectator).length;
    if (currentPlayers >= 6) {
        conn.send({
            type: 'JOIN_ERROR',
            message: 'Room is full (Max 6 players)!'
        });
        setTimeout(() => conn.close(), 500);
        return;
    }

    // NEW JOIN
    const hostName = document.getElementById('my-player-name').value.trim() || 'Host';
    const existingNames = netState.clients.map(c => c.name);
    existingNames.push(hostName);

    // Check Pending names too
    const pendingNames = netState.pendingClients.map(c => c.name);
    if (existingNames.includes(data.name) || pendingNames.includes(data.name)) {
        // Name Taken - REJECT
        conn.send({
            type: 'JOIN_ERROR',
            message: 'Name already taken! Please choose another.'
        });
        setTimeout(() => conn.close(), 500);
        return;
    }

    if (netState.requiresApproval) {
        // Add to Pending
        netState.pendingClients.push({
            id: conn.peer,
            conn: conn,
            name: data.name,
            isSpectator: false
        });

        conn.send({ type: 'JOIN_PENDING' }); // Tell client to wait
        updateLobbyList(); // Refresh to show pending
    } else {
        // Auto-Accept
        netState.clients.push({
            id: conn.peer,
            conn: conn,
            name: data.name,
            status: 'connected',
            isSpectator: false
        });
        updateLobbyList();
        broadcastLobbyUpdate();
    }
}

function approvePlayer(peerId) {
    const idx = netState.pendingClients.findIndex(c => c.id === peerId);
    if (idx === -1) return;

    const p = netState.pendingClients[idx];
    netState.pendingClients.splice(idx, 1);

    // Add to real clients
    p.status = 'connected';
    netState.clients.push(p);

    // Notify
    p.conn.send({ type: 'JOIN_ACCEPTED' });

    updateLobbyList();
    broadcastLobbyUpdate();
}

function rejectPlayer(peerId) {
    const idx = netState.pendingClients.findIndex(c => c.id === peerId);
    if (idx === -1) return;

    const p = netState.pendingClients[idx];
    netState.pendingClients.splice(idx, 1);

    p.conn.send({ type: 'JOIN_REJECTED', message: 'Host declined your request.' });
    setTimeout(() => p.conn.close(), 500);

    updateLobbyList();
}


function handleGameOver(data) {
    // Ensure log is up to date (usually State Update comes before this, but safe to assume log is sync)
    setupGameOverUI(data.winnerName, data.isAI);

    // Spectators don't save match history yet (or maybe they should?)
    if (myPlayerId !== -1) {
        saveMatchHistory({ name: data.winnerName });
    }
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
        if (c.status === 'disconnected') {
            li.style.color = 'red';
            li.innerText += " (Offline)";
        }
        if (c.isSpectator) {
            li.style.color = '#aaa';
            li.style.fontStyle = 'italic';
        }
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

        // 4. Pending Requests
        const pendingList = document.getElementById('pending-players-list');
        pendingList.innerHTML = '';
        if (netState.pendingClients.length > 0) {
            document.getElementById('pending-players-section').classList.remove('hidden');
            netState.pendingClients.forEach(c => {
                const li = document.createElement('li');
                li.style.display = 'flex';
                li.style.justifyContent = 'space-between';
                li.style.alignItems = 'center';
                li.style.marginBottom = '5px';

                const span = document.createElement('span');
                span.innerText = c.name;

                const btnGroup = document.createElement('div');

                const btnApprove = document.createElement('button');
                btnApprove.innerText = '✔';
                btnApprove.style.background = 'green';
                btnApprove.style.marginRight = '5px';
                btnApprove.style.padding = '2px 8px';
                btnApprove.onclick = () => approvePlayer(c.id);

                const btnReject = document.createElement('button');
                btnReject.innerText = '✖';
                btnReject.style.background = 'red';
                btnReject.style.padding = '2px 8px';
                btnReject.onclick = () => rejectPlayer(c.id);

                btnGroup.appendChild(btnApprove);
                btnGroup.appendChild(btnReject);
                li.appendChild(span);
                li.appendChild(btnGroup);
                pendingList.appendChild(li);
            });
        } else {
             // Keep hidden if empty, or just empty list?
             // Logic in handleJoinRequest unhides it.
             // If empty, we can hide it again to be clean.
             if (netState.requiresApproval) {
                 // Keep section visible if we are in approval mode?
                 // Maybe just hide if empty is cleaner.
                 if (netState.pendingClients.length === 0) document.getElementById('pending-players-section').classList.add('hidden');
             }
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

    // Reset UI for restart
    document.getElementById('game-over-modal').classList.add('hidden');

    const aiCount = parseInt(document.getElementById('network-ai-count').value);

    // Filter active PLAYERS (not spectators)
    const activePlayers = netState.clients.filter(c => c.status === 'connected' && !c.isSpectator);

    // Check Minimum Players (Host + at least 1 other)
    if (activePlayers.length + aiCount < 1) {
        alert("You need at least 1 other player (Human or AI) to start!");
        return;
    }

    // 1. Setup Players
    gameState.players = [];
    gameState.deck = [];
    gameState.log = [];
    gameState.replayData = [];

    // Deck
    let cardIdCounter = 1;
    ROLES.forEach(role => {
        for(let i=0; i<3; i++) {
            gameState.deck.push({
                id: `net_card_${cardIdCounter++}`,
                role: role,
                dead: false
            });
        }
    });
    shuffle(gameState.deck);

    // Host is Player 1
    const hostName = document.getElementById('my-player-name').value.trim();
    const hostP = new Player(1, hostName, false);
    gameState.players.push(hostP);
    myPlayerId = 1;

    // Clients (Active Players Only)
    activePlayers.forEach((c, idx) => {
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

    // Broadcast Start to ALL (Players + Spectators)
    const initialState = serializeState();
    netState.clients.forEach(c => {
        if (c.status !== 'connected') return;

        let targetPid = -1; // Default Spectator
        if (!c.isSpectator) {
            const p = gameState.players.find(pl => pl.peerId === c.id);
            if (p) targetPid = p.id;
        }

        c.conn.send({
            type: 'GAME_START',
            playerId: targetPid,
            state: initialState
        });
    });

    updateUI();
    playTurn();
}

function setupClientGame(initialState) {
    document.getElementById('lobby-screen').classList.remove('active');
    document.getElementById('game-screen').classList.add('active');
    document.getElementById('game-over-modal').classList.add('hidden');

    if (myPlayerId === -1) {
        // Spectator specific UI tweaks?
        document.getElementById('action-panel').classList.add('hidden'); // Hide controls
        document.getElementById('active-player-name').innerText = "Spectating Mode";
    }

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

function sendInteractionRequest(player, type, args) {
    return new Promise(resolve => {
        const reqId = generateSecureId();
        netState.pendingRequests[reqId] = resolve;

        const client = netState.clients.find(c => c.id === player.peerId);
        if (client && client.conn && client.status === 'connected') {
            client.conn.send({
                type: 'INTERACTION_REQUEST',
                reqId: reqId,
                requestType: type,
                args: args
            });
        } else {
            console.error("Client not found or offline for interaction:", player.name);
            resolve(null); // Fallback: Auto-pass if offline
        }
    });
}

function markPlayerDisconnected(peerId) {
    if (!netState.isHost) return;

    const p = gameState.players.find(pl => pl.peerId === peerId);
    if (p) {
        log(`${p.name} timed out.`, 'important');
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
