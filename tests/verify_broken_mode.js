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
        this.innerHTML = ''; // Added for completeness
        this.value = ''; // for inputs
        this.onclick = null;
        this.disabled = false;
        this.id = '';
    }
    appendChild(child) {
        if (child.tagName === 'DOCUMENT_FRAGMENT') {
            this.children.push(...child.children);
            child.children = [];
        } else {
            this.children.push(child);
        }
    }
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
    createDocumentFragment() { return new MockElement('DOCUMENT_FRAGMENT'); }
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
    doc.getElementById('difficulty').value = config.difficulty || 'broken';
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
        crypto: {
            getRandomValues: (arr) => {
                for (let i = 0; i < arr.length; i++) {
                    arr[i] = Math.floor(Math.random() * (arr instanceof Uint32Array ? 0xffffffff : 256));
                }
                return arr;
            }
        },
        Uint32Array: Uint32Array,
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
        setupGameOverUI: () => {},
        // Mock async/await sleep
        sleep: (ms) => Promise.resolve()
    };

    sandbox.window = sandbox; // Circular reference
    sandbox.self = sandbox;

    vm.createContext(sandbox);

    loadScripts(sandbox);

    // Override sleep to be instant
    sandbox.sleep = (ms) => Promise.resolve();

    return sandbox;
}

// --- TESTS ---

async function verifyBrokenMode() {
    console.log("=== VERIFYING BROKEN DIFFICULTY MODE ===");

    // TEST 1: Broken AI Challenges Bluff
    console.log("\n--- Test 1: Broken AI Challenges Bluff ---");
    const test1 = createInstance({ humanCount: 1, aiCount: 1, difficulty: 'broken' });
    test1.document.getElementById('human-count').value = '1';
    test1.document.getElementById('ai-count').value = '1';
    test1.document.getElementById('difficulty').value = 'broken';
    test1.startGame();

    const gs1 = test1.gameState;
    const human = gs1.players[0];
    const ai = gs1.players[1];

    // Ensure AI is Broken
    if (ai.difficulty !== 'broken') throw new Error("AI is not Broken difficulty");

    // Force Human Hand: No Duke
    human.cards = [{ id: 'c1', role: 'Contessa', dead: false }, { id: 'c2', role: 'Contessa', dead: false }];

    // Human Bluffs Tax (Claims Duke)
    // We simulate the action and check AI response via shouldChallenge
    const actionObj = { type: 'Tax', player: human, role: 'Duke' };

    // AI should challenge because it sees Human has no Duke
    const willChallenge = ai.shouldChallenge(actionObj);
    console.log(`Human (No Duke) claims Tax. AI Challenged? ${willChallenge}`);
    if (!willChallenge) throw new Error("Broken AI failed to challenge a bluff!");


    // TEST 2: Broken AI Ignores Truth
    console.log("\n--- Test 2: Broken AI Ignores Truth ---");
    const test2 = createInstance({ humanCount: 1, aiCount: 1, difficulty: 'broken' });
    test2.startGame();
    const gs2 = test2.gameState;
    const human2 = gs2.players[0];
    const ai2 = gs2.players[1];

    // Force Human Hand: Has Duke
    human2.cards = [{ id: 'c3', role: 'Duke', dead: false }, { id: 'c4', role: 'Contessa', dead: false }];

    // Human Claims Tax (Truth)
    const actionObj2 = { type: 'Tax', player: human2, role: 'Duke' };

    const willChallenge2 = ai2.shouldChallenge(actionObj2);
    console.log(`Human (Has Duke) claims Tax. AI Challenged? ${willChallenge2}`);
    if (willChallenge2) throw new Error("Broken AI challenged a truthful claim!");


    // TEST 3: Broken AI Exchange Priority
    console.log("\n--- Test 3: Broken AI Exchange Logic ---");
    const test3 = createInstance({ humanCount: 1, aiCount: 1, difficulty: 'broken' });
    test3.startGame();
    const gs3 = test3.gameState;
    const ai3 = gs3.players[1];

    // Setup:
    // AI Hand: Ambassador, Contessa
    // Deck Top 2: Assassin, Duke
    // Goal: AI should pick Duke (score 5) and Assassin (score 3) over Ambassador (1) and Contessa (2).
    // Note: AI Coins = 2. Context modifier: Coins < 3 -> Duke +5 (Score 10). Assassin +0.
    // Scores: Duke=10, Captain=4, Assassin=3, Contessa=2, Ambassador=1.
    // Expected Keep: Duke, Captain? No, deck has Assassin, Duke.
    // Cards to choose: Ambassador, Contessa, Assassin, Duke.
    // Sorted: Duke (10), Assassin (3), Contessa (2), Ambassador (1).
    // Kept: Duke, Assassin.

    ai3.cards = [
        { id: 'h1', role: 'Ambassador', dead: false },
        { id: 'h2', role: 'Contessa', dead: false }
    ];
    gs3.deck.push({ id: 'd1', role: 'Assassin', dead: false }); // Bottom (irrelevant)
    gs3.deck.push({ id: 'd2', role: 'Duke', dead: false });     // Top? pop() takes from end.
    // Deck needs to be popped.
    // In code: const drawnCards = []; for(i=0; i<2; i++) deck.pop();
    // So last 2 in deck array are drawn.

    // Clear deck and set it up
    gs3.deck = [
        { id: 'd1', role: 'Assassin', dead: false },
        { id: 'd2', role: 'Duke', dead: false }
    ];

    // Force AI to perform Exchange
    // We need to trigger resolveActionEffect('Exchange') for AI.
    gs3.currentAction = { type: 'Exchange', player: ai3, target: null };

    // We need to invoke the logic inside resolveActionEffect.
    // We can't easily call internal logic without running full flow.
    // But we can call handleActionSubmit -> processReactions -> resolveActionEffect.
    // We'll simulate it by calling resolveActionEffect directly if possible, or mocking the flow.
    // Since resolveActionEffect is not global, we might have trouble calling it directly from here?
    // Wait, loadScripts exposed `submitAction` but not `resolveActionEffect`.
    // I need to expose `resolveActionEffect` in `loadScripts` inside `createInstance` or just use `vm` to run a snippet.

    // Let's modify the instance creation to expose resolveActionEffect for testing
    // Or simpler: Just run the Exchange logic snippet in the sandbox?
    // No, better to test the actual function.
    // I'll assume resolveActionEffect is not exposed. I'll rely on `processReactions` which calls it.
    // But processReactions is async and complex.

    // Plan B: Expose `resolveActionEffect` in the test runner.
    // I'll modify `loadScripts` in this file to expose it.
    // Note: resolveActionEffect is defined in ActionResolver.js

    // Update: I will just use `vm.runInContext` to execute a small wrapper that calls resolveActionEffect?
    // No, I can just modify loadScripts in this file.

    // Actually, let's verify if `submitAction` can trigger it.
    // submitAction -> handleActionSubmit -> processReactions -> resolveActionEffect.
    // Yes.

    // Mock sleep to be instant (already done).
    // Mock interactions.

    // AI Action: Exchange
    // Mock Human Challenge to pass immediately
    test3.askHumanChallenge = () => Promise.resolve(false);

    // We need to bypass `decideAction` (which chooses the action) and force Exchange.
    // We can just call `handleActionSubmit('Exchange', ai3, null)`?
    // handleActionSubmit is global? Yes.

    test3.handleActionSubmit('Exchange', ai3, null);

    // Wait for async processing
    await new Promise(r => setTimeout(r, 50));

    console.log("AI Cards after Exchange:", ai3.cards.map(c => c.role));

    const hasDuke = ai3.cards.some(c => c.role === 'Duke');
    const hasAssassin = ai3.cards.some(c => c.role === 'Assassin');

    if (!hasDuke) throw new Error("Broken AI failed to keep Duke (Priority 1)");
    if (!hasAssassin) throw new Error("Broken AI failed to keep Assassin (Priority 2)");

    // TEST 4: Broken AI Peeking Deck (Decide Action)
    console.log("\n--- Test 4: Broken AI Peeking Deck ---");
    const test4 = createInstance({ humanCount: 1, aiCount: 1, difficulty: 'broken' });
    test4.startGame();
    const gs4 = test4.gameState;
    const ai4 = gs4.players[1];

    // Setup:
    // AI has bad hand: Ambassador, Contessa
    // Deck has good cards: Duke, Captain
    // AI coins = 2.
    // AI should choose 'Exchange' to get the good cards.

    ai4.cards = [
        { id: 'h3', role: 'Ambassador', dead: false },
        { id: 'h4', role: 'Contessa', dead: false } // Contessa is "good" but maybe we force bad cards?
        // In my logic: goodCards = ['Duke', 'Captain', 'Assassin', 'Contessa'];
        // So Contessa is "good". AI might not Exchange if it has Contessa.
        // Let's give AI weak cards: Ambassador, Ambassador.
    ];
     ai4.cards = [
        { id: 'h3', role: 'Ambassador', dead: false },
        { id: 'h4', role: 'Ambassador', dead: false }
    ];

    gs4.deck = [
        { id: 'd3', role: 'Duke', dead: false },
        { id: 'd4', role: 'Captain', dead: false }
    ];

    // Force decideAction
    await ai4.decideAction();

    console.log(`AI chose action: ${gs4.currentAction ? gs4.currentAction.type : 'None'}`);

    if (gs4.currentAction.type !== 'Exchange') {
        throw new Error(`Broken AI did not choose Exchange despite seeing good cards in deck. Chose: ${gs4.currentAction.type}`);
    }

    console.log("=== BROKEN MODE VERIFICATION PASSED ===");
}

verifyBrokenMode().catch(e => {
    console.error("VERIFICATION FAILED:", e);
    process.exit(1);
});
