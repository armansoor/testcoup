const fs = require('fs');
const vm = require('vm');
const path = require('path');

// --- MOCK DOM ---
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
    click() { if (this.onclick) this.onclick(); }
    querySelector(sel) { return new MockElement('DIV'); }
    querySelectorAll(sel) { return []; }
}

class MockDocument {
    constructor() {
        this.body = new MockElement('BODY');
        this.elements = {};
    }
    getElementById(id) {
        if (!this.elements[id]) {
            this.elements[id] = new MockElement('DIV');
            this.elements[id].id = id;
        }
        return this.elements[id];
    }
    createElement(tag) { return new MockElement(tag); }
    querySelector(sel) { return new MockElement('DIV'); }
    querySelectorAll(sel) { return []; }
}

// --- SETUP SANDBOX ---
function createSandbox() {
    const doc = new MockDocument();

    // Default Inputs
    doc.getElementById('human-count').value = '2';
    doc.getElementById('ai-count').value = '0';
    doc.getElementById('difficulty').value = 'normal';
    doc.getElementById('lobby-screen').classList.add('active'); // active initially
    doc.getElementById('game-screen'); // ensure exists

    const sandbox = {
        document: doc,
        location: { reload: () => console.log(`[RELOAD]`) },
        console: console,
        alert: (msg) => console.log(`[ALERT] ${msg}`),
        prompt: (msg) => { console.log(`[PROMPT] ${msg}`); return null; },
        setTimeout: (fn, delay) => { fn(); }, // Sync execution
        clearTimeout: () => {},
        setInterval: () => {},
        clearInterval: () => {},
        JSON: JSON,
        Math: Math,
        Date: Date,
        parseInt: parseInt,
        localStorage: { getItem: () => null, setItem: () => {} },
        Blob: class {},
        URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
        Peer: class { on() {} connect() {} },
        isNetworkGame: false,
        netState: { isHost: false },
        ROLES: ['Duke', 'Assassin', 'Captain', 'Ambassador', 'Contessa'],
        onbeforeunload: null,
        audio: { playCoin: () => {}, playLose: () => {}, playWin: () => {}, playError: () => {}, playClick: () => {}, toggleMute: () => {} },
        broadcastState: () => {},
        checkGameEndAchievements: () => {},
        saveMatchHistory: () => {},
        setupGameOverUI: () => {}
    };
    sandbox.window = sandbox; // Circular reference: window IS the global scope
    sandbox.self = sandbox;
    vm.createContext(sandbox);
    return sandbox;
}

function loadScripts(sandbox) {
    const files = [
        'js/constants.js',
        'js/state.js',
        'js/utils.js',
        'js/ui.js',
        'js/core/GameEngine.js',
        'js/core/ActionResolver.js'
    ];

    files.forEach(file => {
        let code = fs.readFileSync(path.join(__dirname, '../', file), 'utf8');
        // Manually Expose Globals for Test Access
        if (file.includes('state.js')) code += "\nwindow.gameState = gameState;\n";
        if (file.includes('constants.js')) code += "\nwindow.ACTIONS = ACTIONS; window.ROLES = ROLES;\n";
        if (file.includes('GameEngine.js')) code += "\nwindow.startGame = startGame;\n";
        if (file.includes('ActionResolver.js')) code += "\nwindow.submitAction = submitAction;\n";

        try {
            vm.runInContext(code, sandbox);
        } catch (e) {
            console.error(`Error loading ${file}:`, e);
            throw e;
        }
    });
}

// --- TEST CASE ---
async function verifyBlockFix() {
    console.log("=== VERIFYING BLOCK FIX ===");
    const sb = createSandbox();
    loadScripts(sb);

    // 1. Start Game
    console.log("Starting Game (2 Humans)...");
    sb.window.startGame();

    const gs = sb.window.gameState;
    if (!gs || gs.players.length !== 2) throw new Error("Setup failed: Need 2 players");

    const p1 = gs.players[0];
    const p2 = gs.players[1];

    console.log(`P1: ${p1.name}, P2: ${p2.name}`);

    // Ensure P1 has coins for Steal (needs 0, but lets give them some anyway)
    p1.coins = 2;
    p2.coins = 2;

    // 2. Mock `askHumanBlock` in the UI namespace
    // In `ui.js`, `askHumanBlock` is defined globally in the script scope.
    // To overwrite it effectively for calls coming from `ActionResolver.js` (which is in same context),
    // we need to overwrite it in the sandbox context.

    sb.askHumanBlock = (player, actionObj) => {
        console.log(`[MOCK UI] ${player.name} asked to block ${actionObj.type}`);
        if (actionObj.type === 'Steal') {
            const roles = sb.window.ACTIONS.Steal.blockedBy;
            if (!roles.includes('Ambassador')) throw new Error("Ambassador missing from blockedBy!");

            console.log(`[MOCK UI] Choosing to block with 'Ambassador'`);
            return Promise.resolve('Ambassador');
        }
        return Promise.resolve(false);
    };

    // Also Mock Challenge to avoid hanging
    sb.askHumanChallenge = () => Promise.resolve(false);

    // 3. Execute Steal Action
    console.log("P1 submitting 'Steal' on P2...");

    // Force turn to P1
    gs.currentPlayerIndex = 0;

    // Since we only have 2 players, target selection logic in submitAction will auto-select P2.
    sb.window.submitAction('Steal');

    // Wait loop (simulating async)
    await new Promise(resolve => setTimeout(resolve, 100));

    // 4. Verification
    const logs = gs.log;

    // Debug output
    // console.log("Game Logs:", logs);

    const blockLog = logs.find(l => l.includes('BLOCKS with Ambassador'));

    if (blockLog) {
        console.log("SUCCESS: Found expected log:", blockLog);
    } else {
        console.error("FAILED: Did not find 'BLOCKS with Ambassador' in logs.");
        console.log("Logs:", logs);
        process.exit(1);
    }

    if (p1.coins === 2 && p2.coins === 2) {
        console.log("SUCCESS: Coins unchanged (Action Blocked).");
    } else {
        console.error(`FAILED: Coin mismatch. P1: ${p1.coins}, P2: ${p2.coins}`);
        process.exit(1);
    }
}

verifyBlockFix().catch(e => {
    console.error("TEST ERROR:", e);
    process.exit(1);
});
