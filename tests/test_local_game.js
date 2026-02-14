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
    click() { if (this.onclick) this.onclick(); }
    querySelector() { return new MockElement(); }
    querySelectorAll() { return []; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; }
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

// --- TEST RUNNER ---

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

function createInstance(config = {}) {
    const doc = new MockDocument();

    // Default Config
    doc.getElementById('human-count').value = config.humanCount || '1';
    doc.getElementById('ai-count').value = config.aiCount || '1';
    doc.getElementById('difficulty').value = config.difficulty || 'normal';
    doc.getElementById('lobby-screen').classList.add('active');
    doc.getElementById('game-screen');

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

    sandbox.window = sandbox; // Circular reference
    sandbox.self = sandbox;

    vm.createContext(sandbox);

    loadScripts(sandbox);

    // Inject mocks that were previously done via runInContext string concatenation
    // But since we load scripts dynamically, we must override them AFTER loading.

    // Note: To override functions defined in loaded scripts, we can just assign them in the sandbox.
    // However, if the scripts use `function foo() {}`, redeclaring it might need careful handling if strict mode.
    // In loose mode, `sandbox.askHumanBlock = ...` works if it's global.

    return sandbox;
}

// --- TESTS ---

async function runLocalTests() {
    console.log("=== STARTING LOCAL GAME TESTS ===");

    // TEST 1: Single Player (Human vs Bot)
    console.log("\n--- Test 1: Single Player (1 Human, 1 Bot) ---");
    const sp = createInstance({ humanCount: 1, aiCount: 1 });

    // Manually trigger startGame logic within context
    sp.document.getElementById('human-count').value = '1';
    sp.document.getElementById('ai-count').value = '1';
    sp.startGame();

    const gs1 = sp.gameState; // Direct access thanks to exposure

    console.log(`Players: ${gs1.players.length}`);
    if (gs1.players.length !== 2) throw new Error("Incorrect player count");
    if (gs1.players[0].isAI) throw new Error("Player 1 should be Human");
    if (!gs1.players[1].isAI) throw new Error("Player 2 should be AI");

    // Human Turn (Player 1)
    console.log(`Current Turn: ${gs1.players[gs1.currentPlayerIndex].name}`);
    if (gs1.currentPlayerIndex !== 0) throw new Error("Human should start first");

    // Action: Income
    sp.submitAction('Income');
    console.log(`Human Coins: ${gs1.players[0].coins}`);
    if (gs1.players[0].coins !== 3) throw new Error("Income failed");

    // Bot Turn (Player 2)
    // Since setTimeout is sync, Bot should have acted.
    console.log(`Bot Coins: ${gs1.players[1].coins}`);


    // TEST 2: Pass & Play (2 Humans)
    console.log("\n--- Test 2: Pass & Play (2 Humans) ---");
    const pp = createInstance({ humanCount: 2, aiCount: 0 });

    pp.document.getElementById('human-count').value = '2';
    pp.document.getElementById('ai-count').value = '0';

    // Mock interaction BEFORE starting game to capture any initial logic if needed (unlikely)
    // Actually we need to start first to init gameState
    pp.startGame();

    const gs2 = pp.gameState;

    if (gs2.players.length !== 2) throw new Error("Incorrect player count for P&P");
    if (gs2.players[1].isAI) throw new Error("Player 2 should be Human");

    // Mock askHumanBlock to auto-pass
    // Overwriting the global function in sandbox
    pp.askHumanBlock = (p, action) => {
        console.log("[TEST] Auto-passing Block");
        return Promise.resolve(false);
    };
    pp.askHumanChallenge = () => {
        console.log("[TEST] Auto-passing Challenge");
        return Promise.resolve(false);
    };

    // Player 1 Action
    pp.submitAction('Foreign Aid');

    await new Promise(r => setTimeout(r, 100)); // Wait for promise chains

    console.log(`P1 Coins: ${gs2.players[0].coins}`);

    if (gs2.players[0].coins !== 4) throw new Error("Foreign Aid failed or blocked unexpectedly");


    // TEST 3: Coup Mechanics
    console.log("\n--- Test 3: Coup Mechanics ---");
    const coupGame = createInstance({ humanCount: 2, aiCount: 0 });

    coupGame.document.getElementById('human-count').value = '2';
    coupGame.document.getElementById('ai-count').value = '0';
    coupGame.startGame();

    const coupGS = coupGame.gameState;
    coupGS.players[0].coins = 7;

    // Mock loss
    coupGame.askHumanToLoseCard = (player) => {
        console.log(`[TEST] ${player.name} losing card 0`);
        return Promise.resolve(0);
    };
    // Mock Challenge/Block to be safe
    coupGame.askHumanBlock = () => Promise.resolve(false);
    coupGame.askHumanChallenge = () => Promise.resolve(false);

    // submitAction('Coup') -> P1 on P2 (auto target)
    coupGame.submitAction('Coup');

    await new Promise(r => setTimeout(r, 100));

    const victim = coupGS.players[1];
    console.log(`Victim Cards: ${JSON.stringify(victim.cards)}`);
    if (!victim.cards[0].dead) throw new Error("Coup failed to kill card");

    console.log("=== LOCAL TESTS PASSED ===");
}

runLocalTests().catch(e => {
    console.error("TEST FAILED:", e);
    process.exit(1);
});
