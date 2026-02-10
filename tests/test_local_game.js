const fs = require('fs');
const vm = require('vm');
const path = require('path');

// --- MOCK DOM & BROWSER API (Simplified for local testing) ---

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

const scriptCode = fs.readFileSync(path.join(__dirname, '../script.js'), 'utf8');

function createInstance(config = {}) {
    const doc = new MockDocument();

    // Default Config
    doc.getElementById('human-count').value = config.humanCount || '1';
    doc.getElementById('ai-count').value = config.aiCount || '1';
    doc.getElementById('difficulty').value = config.difficulty || 'normal';

    const sandbox = {
        document: doc,
        window: { onbeforeunload: null },
        location: { reload: () => console.log(`[RELOAD]`) },
        console: console,
        alert: (msg) => console.log(`[ALERT] ${msg}`),
        prompt: (msg) => { console.log(`[PROMPT] ${msg}`); return null; },
        setTimeout: (fn, delay) => fn(), // Instant timeout
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
        Peer: class { on() {} connect() {} }, // Mock Peer
        ROLES: ['Duke', 'Assassin', 'Captain', 'Ambassador', 'Contessa'], // For verification
        // Minimal Mock Element needed for askHumanChallenge (DOM interaction)
        // script.js does: const panel = document.getElementById('reaction-panel');
        // panel.classList.remove('hidden');
    };

    sandbox.self = sandbox;

    vm.createContext(sandbox);

    const modifiedScript = scriptCode + "\n\n" +
        "try { window.gameState = gameState; } catch(e) {}\n" +
        "try { window.startGame = startGame; } catch(e) {}\n" +
        "try { window.submitAction = submitAction; } catch(e) {}\n" +
        "try { window.askHumanChallenge = askHumanChallenge; } catch(e) {}\n" +
        "try { window.askHumanBlock = askHumanBlock; } catch(e) {}\n" +
        "try { window.askHumanToLoseCard = askHumanToLoseCard; } catch(e) {}\n";

    vm.runInContext(modifiedScript, sandbox);

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
    vm.runInContext("startGame()", sp); // Run directly

    // In script.js, 'gameState' is a 'let' variable at the top level.
    // When runInContext runs, it executes script.js.
    // However, unless we explicitly attach gameState to window, it might not be accessible on 'sp' directly
    // if it wasn't global. But we added "try { window.gameState = gameState }" to script string.

    // Debug: check keys
    // console.log("Sandbox keys:", Object.keys(sp));

    const gs1 = sp.window.gameState; // Access via window alias
    if (!gs1) throw new Error("GameState not initialized");

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

    // Bot Turn (Player 2) - Instant due to mock setTimeout
    // Bot logic runs automatically.
    // Verify turn advanced back to Human or is in progress
    console.log(`Turn passed to: ${gs1.players[gs1.currentPlayerIndex].name}`);
    // Since mock timeout is instant, Bot might have already played.
    // Let's check if Bot has > 2 coins or took an action
    console.log(`Bot Coins: ${gs1.players[1].coins}`);

    // TEST 2: Pass & Play (2 Humans)
    console.log("\n--- Test 2: Pass & Play (2 Humans) ---");
    const pp = createInstance({ humanCount: 2, aiCount: 0 });

    pp.document.getElementById('human-count').value = '2';
    pp.document.getElementById('ai-count').value = '0';
    vm.runInContext("startGame()", pp);

    const gs2 = pp.window.gameState;

    if (gs2.players.length !== 2) throw new Error("Incorrect player count for P&P");
    if (gs2.players[1].isAI) throw new Error("Player 2 should be Human");

    // Player 1 Action
    // Note: submitAction calls getCurrentPlayer() which uses global gameState.
    vm.runInContext("submitAction('Foreign Aid')", pp);
    console.log(`P1 Coins: ${gs2.players[0].coins}`);

    // Check Blockability Logic (Mocking interaction)
    // Foreign Aid is blockable by Duke.
    // In local game, `processReactions` iterates players.
    // Since we mocked timeouts, it might hang waiting for Promise if we don't mock the `askHumanBlock`.
    // But `askHumanBlock` returns a Promise. The script awaits it.
    // The MOCK DOM doesn't user interact. So the promise will PENDING forever unless we mock the function.

    // We need to inject a mock for `askHumanBlock` to auto-pass.

    // Re-create instance with mocks
    const ppMock = createInstance({ humanCount: 2, aiCount: 0 });

    // Mock Interactions to auto-pass
    ppMock.window.requestChallenge = () => Promise.resolve(false); // Override internal if possible, but it uses local functions
    // We need to override the function in the sandbox scope directly if possible, or monkey patch
    // `askHumanBlock` is defined in script scope.
    // We can't easily overwrite it from outside without `window` exposure or `eval`.
    // The script exposes `askHumanBlock` to window in our modified script.

    ppMock.window.askHumanBlock = () => {
        console.log("[TEST] Auto-passing Block");
        return Promise.resolve(false);
    };
    ppMock.window.askHumanChallenge = () => {
        console.log("[TEST] Auto-passing Challenge");
        return Promise.resolve(false);
    };

    // Also need to mock requestBlock/Challenge in case logic routes there (shouldn't for local humans but check)
    // Actually, processReactions calls `requestBlock(p, action)`
    // In local game, `requestBlock` calls `askHumanBlock` directly.
    // BUT `gameState.currentAction` must be set correctly.

    // START GAME
    ppMock.document.getElementById('human-count').value = '2';
    ppMock.document.getElementById('ai-count').value = '0';
    vm.runInContext("startGame()", ppMock);

    // Player 1: Foreign Aid
    // The issue might be that requestBlock/Challenge calls askHumanXXX which are asynchronous.
    // If we overwrite them on the sandbox window, the script might still be using the locally scoped functions defined inside script.js IIFE/block scope?
    // script.js is not an IIFE, but `function askHumanBlock` is defined at top level.
    // However, `requestBlock` calls `askHumanBlock`.
    // If `askHumanBlock` is defined in the script, it uses THAT one, not `window.askHumanBlock`.

    // To mock internal functions of script.js, we must overwrite them in the context BEFORE they are called.
    // Since they are function declarations, they are hoisted.
    // We can overwrite them by re-assigning them in the context if they were declared as vars/functions.
    // But function declarations are read-only in some strict modes? No.

    // Let's try to overwrite them in the runInContext string.
    vm.runInContext("askHumanBlock = () => { console.log('MOCKED BLOCK'); return Promise.resolve(false); }", ppMock);
    vm.runInContext("askHumanChallenge = () => { console.log('MOCKED CHALLENGE'); return Promise.resolve(false); }", ppMock);

    vm.runInContext("submitAction('Foreign Aid')", ppMock);

    // Wait for async resolution of all promises (Reaction Phase)
    await new Promise(r => setTimeout(r, 500));

    console.log(`P1 Coins: ${ppMock.window.gameState.players[0].coins}`);
    // Should be 2 (start) + 2 (aid) = 4
    // If it's 2, it means it didn't resolve.
    // If it's 2 and next turn, it means it was blocked.
    // Debug
    console.log("Phase:", ppMock.window.gameState.turnPhase);
    console.log("Current Player Index:", ppMock.window.gameState.currentPlayerIndex);

    if (ppMock.window.gameState.players[0].coins !== 4) throw new Error("Foreign Aid failed or blocked unexpectedly");

    // Turn should be Player 2
    console.log(`Current Player: ${ppMock.window.gameState.players[ppMock.window.gameState.currentPlayerIndex].name}`);
    if (ppMock.window.gameState.currentPlayerIndex !== 1) throw new Error("Turn did not advance to P2");

    // TEST 3: Coup Mechanics
    console.log("\n--- Test 3: Coup Mechanics ---");
    const coupGame = createInstance({ humanCount: 2, aiCount: 0 });

    // Give P1 7 coins
    // Start manually
    coupGame.document.getElementById('human-count').value = '2';
    coupGame.document.getElementById('ai-count').value = '0';
    vm.runInContext("startGame()", coupGame);

    const coupGS = coupGame.window.gameState;
    if (!coupGS) throw new Error("Coup GameState not initialized");

    coupGS.players[0].coins = 7;

    // Mock loss (overwrite in context)
    vm.runInContext("askHumanToLoseCard = (player) => { console.log(`[TEST] ${player.name} losing card 0`); return Promise.resolve(0); }", coupGame);

    // submitAction usually prompts for target if > 1 enemy. Here only 1 enemy (P2).
    vm.runInContext("submitAction('Coup')", coupGame);
    // submitAction usually prompts for target if > 1 enemy. Here only 1 enemy (P2).

    await new Promise(r => setTimeout(r, 500));

    const victim = coupGS.players[1];
    console.log(`Victim Cards: ${JSON.stringify(victim.cards)}`);
    if (!victim.cards[0].dead) throw new Error("Coup failed to kill card");

    console.log("=== LOCAL TESTS PASSED ===");
}

runLocalTests().catch(e => {
    console.error("TEST FAILED:", e);
    process.exit(1);
});
