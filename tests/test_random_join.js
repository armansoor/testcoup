const fs = require('fs');
const vm = require('vm');
const path = require('path');

// --- MOCK SERVER ---
const MOCK_SERVER = {
    peers: new Set(),
    register: (id) => MOCK_SERVER.peers.add(id),
    unregister: (id) => MOCK_SERVER.peers.delete(id),
    exists: (id) => MOCK_SERVER.peers.has(id)
};

// --- MOCK PEER JS ---
class MockConnection {
    constructor(peerId, remoteId) {
        this.peer = remoteId; // The remote peer ID
        this.open = false;
        this.handlers = {};
    }
    on(event, cb) { this.handlers[event] = cb; }
    emit(event, data) { if(this.handlers[event]) this.handlers[event](data); }
    send(data) {
        // console.log(`[CONN ${this.peer}] Sending:`, data);
        // In a real test we might route this to the other peer's connection handler
    }
    close() { this.open = false; this.emit('close'); }
}

class MockPeer {
    constructor(id) {
        this.id = id; // Requested ID
        this.handlers = {};
        this.destroyed = false;

        // Simulate async open/error
        setTimeout(() => {
            if (this.destroyed) return;
            if (this.id && MOCK_SERVER.exists(this.id)) {
                this.emit('error', { type: 'unavailable-id' });
            } else {
                if (this.id) MOCK_SERVER.register(this.id);
                this.emit('open', this.id || 'random_id_' + Math.floor(Math.random()*1000));
            }
        }, 10);
    }
    on(event, cb) { this.handlers[event] = cb; }
    emit(event, data) { if(this.handlers[event]) this.handlers[event](data); }
    destroy() { this.destroyed = true; }

    connect(remoteId) {
        const conn = new MockConnection(this.id, remoteId);

        setTimeout(() => {
            // Mock connection success/fail
            // Here we assume if it starts with coup_public_, it "exists" for connection attempt
            // unless we want to simulate failure.
            // Let's assume connection always opens if we try,
            // but the data flow determines logic.
            conn.open = true;
            conn.emit('open');
        }, 20);
        return conn;
    }
}

// --- MOCK DOM ---
class MockElement {
    constructor(tagName) {
        this.tagName = tagName;
        this._classes = new Set();
        this.classList = {
            add: (c) => this._classes.add(c),
            remove: (c) => this._classes.delete(c),
            contains: (c) => this._classes.has(c)
        };
        this.innerText = '';
        this.value = '';
        this.checked = false;
        this.style = {};
        this.children = [];
    }
    appendChild(c) { this.children.push(c); }
}

const doc = {
    elements: {},
    getElementById: (id) => {
        if (!doc.elements[id]) doc.elements[id] = new MockElement('DIV');
        return doc.elements[id];
    },
    createElement: (tag) => new MockElement(tag)
};

// --- SANDBOX SETUP ---
const sandbox = {
    window: {},
    document: doc,
    navigator: { onLine: true },
    alert: (msg) => console.log(`[ALERT] ${msg}`),
    prompt: () => null,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    console: console,
    Peer: MockPeer,
    location: { reload: () => console.log('[RELOAD]') },
    PUBLIC_ROOM_LIMIT: 5, // Override for faster test
    gameState: { players: [] }, // Mock gameState
    log: () => {},
    updateUI: () => {}
};
sandbox.window = sandbox;

// Load Network Script
const netScript = fs.readFileSync(path.join(__dirname, '../js/network.js'), 'utf8');
// Mock game state logic that network.js depends on
const mockDeps = `
    const ROLES = ['Duke'];
    const gameState = { players: [] };
    function log() {};
    function updateUI() {};
    function Player() {};
    function shuffle() {};
    function saveMatchHistory() {};
    function generateSecureId() { return '123'; }
`;

vm.createContext(sandbox);
vm.runInContext(mockDeps + netScript + "\nwindow.netState = netState; window.findPublicGame = findPublicGame; window.handleNetworkData = handleNetworkData; window.initHost = initHost;", sandbox);

// --- TESTS ---

async function runTests() {
    console.log("=== HOST TEST: Reserve Public Slot ===");

    // Setup: Slot 1 is taken
    MOCK_SERVER.register('coup_public_1');

    // Setup UI
    doc.getElementById('allow-random-join').checked = true;
    doc.getElementById('my-player-name').value = 'HostUser';

    // Run initHost
    console.log("-> calling initHost()");
    sandbox.initHost();

    // Wait for async peer logic
    await new Promise(r => setTimeout(r, 200));

    const ns = sandbox.window.netState;
    console.log(`Host ID: ${ns.peer ? ns.peer.id : 'null'}`);

    if (ns.peer && ns.peer.id === 'coup_public_2') {
        console.log("PASS: Host skipped taken slot 1 and reserved slot 2.");
    } else {
        console.error("FAIL: Host did not reserve slot 2. Got: " + (ns.peer ? ns.peer.id : 'null'));
    }

    // Check approval flag
    if (ns.requiresApproval === true) {
         console.log("PASS: Approval flag set.");
    } else {
         console.error("FAIL: Approval flag missing.");
    }


    console.log("\n=== CLIENT TEST: Scan Slots ===");

    // Reset necessary state
    ns.isScanning = false;
    ns.peer = null;
    ns.clients = [];
    ns.isHost = false;

    doc.getElementById('my-player-name').value = 'ClientUser';

    console.log("-> calling findPublicGame()");
    sandbox.findPublicGame();

    // Wait for scan to start (10ms open delay)
    await new Promise(r => setTimeout(r, 100));

    console.log(`Scanning Index: ${ns.currentScanIndex}`);

    // Should be 1 initially
    if (ns.currentScanIndex === 1) {
        console.log("PASS: Started scan at 1.");
    }

    // The client "connected" to 1 (MockConnection open).
    // Now simulate data received: REJECTED
    // We need to access the connection object created inside the closure.
    // Wait, we can't access it directly.
    // But `netState.hostConn` is set on 'open'.

    await new Promise(r => setTimeout(r, 100)); // wait for open

    if (ns.hostConn) {
        console.log("PASS: Connected to host.");

        // Simulate REJECT
        console.log("-> Simulating REJECT");
        sandbox.handleNetworkData({ type: 'JOIN_REJECTED', message: 'Full' }, ns.hostConn);

        // Wait for retry
        await new Promise(r => setTimeout(r, 100));

        console.log(`Scanning Index: ${ns.currentScanIndex}`);

        if (ns.currentScanIndex === 2) {
            console.log("PASS: Incremented scan index to 2.");
        } else {
            console.error("FAIL: Did not increment index.");
        }

    } else {
        console.error("FAIL: hostConn not set.");
    }
}

runTests();
