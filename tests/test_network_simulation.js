const fs = require('fs');
const vm = require('vm');
const path = require('path');

// --- MOCK DOM & BROWSER API ---

class MockElement {
    constructor(tagName = 'div') {
        this.tagName = tagName.toUpperCase();
        this.classList = {
            _classes: new Set(),
            add: (c) => this.classList._classes.add(c),
            remove: (c) => this.classList._classes.delete(c),
            toggle: (c) => this.classList._classes.has(c) ? this.classList._classes.delete(c) : this.classList._classes.add(c),
            contains: (c) => this.classList._classes.has(c),
            toString: () => Array.from(this.classList._classes).join(' ')
        };
        this.style = {};
        this.children = [];
        this.innerText = '';
        this.value = ''; // for inputs
        this.onclick = null;
        this.disabled = false;
        this.id = '';
    }

    appendChild(child) { this.children.push(child); }
    removeChild(child) { this.children = this.children.filter(c => c !== child); }

    // Simulate click
    click() { if (this.onclick) this.onclick(); }
}

class MockDocument {
    constructor() {
        this.body = new MockElement('BODY');
        this.elements = {}; // ID -> Element
    }

    getElementById(id) {
        if (!this.elements[id]) {
            this.elements[id] = new MockElement('DIV');
            this.elements[id].id = id;
        }
        return this.elements[id];
    }

    createElement(tag) { return new MockElement(tag); }

    querySelector(sel) { return new MockElement('DIV'); } // Minimal
    querySelectorAll(sel) { return []; } // Minimal
}

// --- MOCK NETWORK ---

class MockDataConnection {
    constructor(peerId, remotePeerId, network) {
        this.peer = remotePeerId;
        this.open = false;
        this.network = network;
        this.handlers = {};
        // Do not auto-open. Wait for network.
    }

    _triggerOpen() {
        if (this.open) return;
        this.open = true;
        setTimeout(() => {
             if(this.handlers['open']) this.handlers['open']();
        }, 1);
    }

    on(event, callback) {
        this.handlers[event] = callback;
    }

    send(data) {
        // Route to other peer via Network
        this.network.deliver(this.peer, data);
    }

    // Internal: Receive data
    _receive(data) {
        if(this.handlers['data']) this.handlers['data'](data);
    }

    close() {
        this.open = false;
        if(this.handlers['close']) this.handlers['close']();
    }
}

class MockPeer {
    constructor(id, options, network) {
        this.id = id || Math.random().toString(36).substr(2, 9);
        this.network = network;
        this.network.register(this);
        this.handlers = {};
        this.connections = []; // Connections initiated or received

        // Simulate Open
        setTimeout(() => {
            if(this.handlers['open']) this.handlers['open'](this.id);
        }, 10);
    }

    on(event, callback) {
        this.handlers[event] = callback;
    }

    connect(remoteId) {
        const conn = new MockDataConnection(this.id, remoteId, this.network);
        this.connections.push(conn);

        // Tell Network to notify remote peer
        this.network.connect(this.id, remoteId, conn);

        return conn;
    }

    // Internal: Receive connection
    _receiveConnection(remoteId, remoteConnCallback) {
        // remoteConnCallback gives us the handle to send back to initiator
        // But in PeerJS, we get a 'connection' event with a DataConnection object
        const conn = new MockDataConnection(this.id, remoteId, this.network);
        this.connections.push(conn);

        // Crucially, we need to map the remote's conn to this local conn
        // handled by Network registry usually.

        if(this.handlers['connection']) this.handlers['connection'](conn);

        return conn;
    }
}

class NetworkHub {
    constructor() {
        this.peers = {}; // id -> MockPeer instance
    }

    register(peer) {
        this.peers[peer.id] = peer;
    }

    connect(fromId, toId, senderConn) {
        const target = this.peers[toId];
        if (target) {
            setTimeout(() => {
                // The target receives a connection object
                // We need to pair them so sending on one calls _receive on other
                const receiverConn = target._receiveConnection(fromId);

                // Monkey-patch send/receive pairing
                const originalSenderSend = senderConn.send.bind(senderConn);
                senderConn.send = (data) => {
                    // console.log(`[NET] ${fromId} -> ${toId}:`, data.type);
                    setTimeout(() => receiverConn._receive(data), 5);
                };

                const originalReceiverSend = receiverConn.send.bind(receiverConn);
                receiverConn.send = (data) => {
                    // console.log(`[NET] ${toId} -> ${fromId}:`, data.type);
                    setTimeout(() => senderConn._receive(data), 5);
                };

                // Open connections
                senderConn._triggerOpen();
                receiverConn._triggerOpen();

            }, 20);
        } else {
            console.error(`Peer ${toId} not found!`);
        }
    }

    deliver(toId, data) {
        // Handled by patched connections
    }
}

// --- TEST RUNNER ---

const scriptCode = fs.readFileSync(path.join(__dirname, '../script.js'), 'utf8');
const networkHub = new NetworkHub();

function createInstance(name) {
    const doc = new MockDocument();

    // Pre-populate specific inputs used in script.js
    doc.getElementById('human-count').value = '1';
    doc.getElementById('ai-count').value = '1';
    doc.getElementById('difficulty').value = 'normal';
    doc.getElementById('my-player-name').value = name;
    doc.getElementById('network-ai-count').value = '0';

    const sandbox = {
        document: doc,
        // window: circular ref added below
        onbeforeunload: null,
        location: { reload: () => console.log(`${name} reloads`) },
        console: console,
        alert: (msg) => console.log(`[ALERT ${name}] ${msg}`),
        prompt: (msg) => { console.log(`[PROMPT ${name}] ${msg}`); return null; },
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        setInterval: setInterval,
        clearInterval: clearInterval,
        JSON: JSON,
        Math: Math,
        Date: Date,
        parseInt: parseInt,
        localStorage: {
            getItem: () => null,
            setItem: () => {}
        },
        Blob: class {},
        URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
        Peer: class extends MockPeer {
            constructor(id, options) {
                super(id, options, networkHub);
            }
        },
        // Helper to expose internal state for assertions
        getGameState: () => sandbox.gameState
    };

    sandbox.window = sandbox; // Circular reference mimicking browser
    sandbox.self = sandbox; // window.self

    vm.createContext(sandbox);

    // Append code to expose internals to window/sandbox for testing
    // Since 'let' variables are not attached to global object automatically
    const modifiedScript = scriptCode + "\n\n" +
        "console.log('Script executed. Exposing internals...');\n" +
        "try { window.netState = netState; console.log('netState exposed'); } catch(e) { console.log('netState fail', e); }\n" +
        "try { window.gameState = gameState; } catch(e) {}\n" +
        "try { window.initHost = initHost; } catch(e) {}\n" +
        "try { window.joinGame = joinGame; } catch(e) {}\n" +
        "try { window.startNetworkGame = startNetworkGame; } catch(e) {}\n" +
        "try { window.submitAction = submitAction; } catch(e) {}\n" +
        "try { window.askHumanExchange = askHumanExchange; } catch(e) {}\n";

    vm.runInContext(modifiedScript, sandbox);

    return sandbox;
}

// --- TESTS ---

async function runTests() {
    console.log("=== STARTING NETWORK SIMULATION TESTS ===");

    const host = createInstance('HostPlayer');
    const client = createInstance('ClientPlayer');

    // 1. Init Host
    console.log("\n--- Step 1: Init Host ---");
    host.initHost();

    // Wait for peer open
    await new Promise(r => setTimeout(r, 100));
    const hostPeerId = host.netState.peer.id;
    console.log(`Host Peer ID: ${hostPeerId}`);

    if (!hostPeerId) throw new Error("Host failed to generate Peer ID");

    // 2. Join Client
    console.log("\n--- Step 2: Client Joins ---");
    client.document.getElementById('host-id-input').value = hostPeerId;
    client.joinGame();

    // Wait for connection
    await new Promise(r => setTimeout(r, 500));

    // Verify Lobby
    const hostLobby = host.netState.clients.map(c => c.name);
    console.log(`Host sees clients: ${hostLobby.join(', ')}`);
    if (!hostLobby.includes('ClientPlayer')) throw new Error("Host did not see Client join");

    // 3. Start Game
    console.log("\n--- Step 3: Start Game ---");
    host.startNetworkGame();

    await new Promise(r => setTimeout(r, 500));

    // Verify Game State
    const hState = host.gameState;
    const cState = client.gameState;

    console.log(`Host Phase: ${hState.turnPhase}, Client Phase: ${cState.turnPhase}`);
    console.log(`Host Players: ${hState.players.length}, Client Players: ${cState.players.length}`);

    if (hState.players.length !== cState.players.length) throw new Error("Player count mismatch!");
    if (cState.players[0].name !== 'HostPlayer') throw new Error("Client has wrong player 1 name");

    // 4. Verify Turn Handling
    // Host is Player 1 (Index 0). Client is Player 2 (Index 1).
    // It should be Host's turn.
    console.log(`Current Player Index: ${hState.currentPlayerIndex}`);
    if (hState.currentPlayerIndex !== 0) throw new Error("Should be Host's turn");

    // Host Action: Income
    console.log("\n--- Step 4: Host Action (Income) ---");
    host.submitAction('Income');

    // Wait for Action Resolve (immediate) + Next Turn Delay (1000ms) + buffer
    await new Promise(r => setTimeout(r, 1500));

    // Verify coins
    console.log(`Host Coins: ${hState.players[0].coins}`);
    console.log(`Client sees Host Coins: ${cState.players[0].coins}`);

    if (hState.players[0].coins !== 3) throw new Error("Host income failed (expected 3 coins)"); // Starts with 2
    if (cState.players[0].coins !== 3) throw new Error("Client sync failed for Host Income");

    // 5. Client Turn
    console.log("\n--- Step 5: Client Action (Income) ---");
    // Verify it is Client's turn now
    if (hState.currentPlayerIndex !== 1) throw new Error("Turn did not advance to Client");

    // Verify Client knows it is their turn
    // (In local logic, `submitAction` checks `myPlayerId`)
    client.myPlayerId = 2; // Usually set by GAME_START
    client.submitAction('Income');

    await new Promise(r => setTimeout(r, 500));

    console.log(`Client Coins: ${cState.players[1].coins}`);
    console.log(`Host sees Client Coins: ${hState.players[1].coins}`);

    if (cState.players[1].coins !== 3) throw new Error("Client income failed");
    if (hState.players[1].coins !== 3) throw new Error("Host sync failed for Client Income");

    // 6. Test Exchange Logic (Client)
    console.log("\n--- Step 6: Client Exchange Logic ---");
    // We need to loop turns back to Client.
    // Host Turn (Player 1)
    host.submitAction('Income');
    await new Promise(r => setTimeout(r, 1500));

    // Client Turn (Player 2)
    // Client wants to Exchange.
    // Client needs to implement the UI selection flow.
    // The `handleInteractionRequest` function in client handles the UI prompt.
    // We need to MOCK the user interaction on the Client side.

    // Mock `askHumanExchange` on the Client instance to auto-select cards
    client.askHumanExchange = (player) => {
        console.log("[TEST] Auto-selecting cards for Exchange...");
        // Logic: Keep indices 0 and 1 (original cards)
        return Promise.resolve([0, 1]);
    };

    // Also Mock Host's reaction (Challenge?)
    // Exchange is challengeable. Host is Human. Host will be asked.
    host.askHumanChallenge = (player, actionObj) => {
        console.log(`[TEST] Host auto-passing challenge on ${actionObj.type}`);
        return Promise.resolve(false);
    };

    client.submitAction('Exchange');

    await new Promise(r => setTimeout(r, 2000)); // Allow time for: Req -> Client -> UI -> Resp -> Host -> Update

    // Verify Deck and Hand
    // Client should still have 2 cards.
    // Deck should have been shuffled (we can't easily check shuffle but can check count if we knew it).
    // Host log should show "ClientPlayer exchanges cards..."

    const log = hState.log;
    const exchangeEntry = log.find(l => l.includes("exchanges cards"));
    console.log("Exchange Entry:", exchangeEntry);

    if (!exchangeEntry) throw new Error("Exchange action did not complete or log");

    console.log("=== TESTS PASSED ===");
}

runTests().catch(e => {
    console.error("TEST FAILED:", e);
    process.exit(1);
});
