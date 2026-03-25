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
        this.value = '';
        this.onclick = null;
        this.disabled = false;
        this.id = '';
        this.addEventListener = () => {};
        this.removeEventListener = () => {};
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
        this.elements = {};
        this.body = new MockElement('body');
    }
    getElementById(id) {
        if (!this.elements[id]) {
            this.elements[id] = new MockElement();
            this.elements[id].id = id;
        }
        return this.elements[id];
    }
    createElement(tag) { return new MockElement(tag); }
    createDocumentFragment() { return new MockElement('DOCUMENT_FRAGMENT'); }
    querySelector() { return new MockElement(); }
    querySelectorAll() { return []; }
}

function loadScripts(sandbox) {
    const scripts = ['constants.js', 'utils.js', 'state.js', 'core/ActionResolver.js', 'core/GameEngine.js', 'core/ReplayManager.js', 'ui.js', 'network.js', 'stats.js', 'audio.js', 'main.js'];
    scripts.forEach(script => {
        const code = fs.readFileSync(path.join(__dirname, '..', 'js', script), 'utf8');
        vm.runInContext(code, sandbox);
    });
}

function createInstance(config = {}) {
    const doc = new MockDocument();

    doc.getElementById('human-count').value = config.humanCount || 1;
    doc.getElementById('ai-count').value = config.aiCount || 1;
    doc.getElementById('difficulty').value = config.difficulty || 'normal';
    doc.getElementById('lobby-screen').classList.add('active');
    doc.getElementById('game-screen');

    const sandbox = {
        document: doc,
        location: { reload: () => {} },
        console: console,
        alert: () => {},
        prompt: () => null,
        setTimeout: (fn, delay) => { fn(); },
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
        sleep: (ms) => Promise.resolve(),
        requestAnimationFrame: (cb) => cb()
    };

    sandbox.window = sandbox;
    sandbox.self = sandbox;
    sandbox.navigator = { userAgent: 'node' };

    vm.createContext(sandbox);
    loadScripts(sandbox);

    // Mock Human interactions
    sandbox.askHumanToLoseCard = (player) => {
        return Promise.resolve(0); // Lose first card
    };
    sandbox.askHumanBlock = (player, actionObj) => {
        if (player.shouldBlockMock) return Promise.resolve(player.shouldBlockMock());
        return Promise.resolve(false);
    };
    sandbox.askHumanChallenge = (player, actionObj) => {
        if (player.shouldChallengeMock) return Promise.resolve(player.shouldChallengeMock());
        return Promise.resolve(false);
    };
    sandbox.askHumanExchange = (p, cards, count) => Promise.resolve(cards.slice(0, count).map(c => c.id));
    sandbox.askContinue = () => Promise.resolve();

    return sandbox;
}

// --- TESTS ---

async function runTests() {
    console.log("=== STARTING COMPREHENSIVE LOCAL RULES VERIFICATION ===");

    // 1. Income (Take 1 coin)
    console.log("\n--- Rule Test: Income ---");
    let test = createInstance({ humanCount: 2, aiCount: 0 });
    test.startGame();
    let p1 = test.gameState.players[0];
    let startCoins = p1.coins;

    test.gameState.currentAction = { type: 'Income', player: p1, target: null };
    test.resolveActionEffect();

    if (p1.coins !== startCoins + 1) throw new Error(`Income failed. Expected ${startCoins + 1}, got ${p1.coins}`);
    console.log("Income Passed");

    // 2. Foreign Aid (Take 2 coins)
    console.log("\n--- Rule Test: Foreign Aid ---");
    p1.coins = 2; // reset
    test.gameState.currentAction = { type: 'Foreign Aid', player: p1, target: null };
    test.resolveActionEffect();
    if (p1.coins !== 4) throw new Error(`Foreign Aid failed. Expected 4, got ${p1.coins}`);
    console.log("Foreign Aid Passed");

    // 3. Tax (Take 3 coins)
    console.log("\n--- Rule Test: Tax ---");
    p1.coins = 2;
    test.gameState.currentAction = { type: 'Tax', player: p1, target: null };
    test.resolveActionEffect();
    if (p1.coins !== 5) throw new Error(`Tax failed. Expected 5, got ${p1.coins}`);
    console.log("Tax Passed");

    // 4. Coup (Lose card, cost 7)
    console.log("\n--- Rule Test: Coup ---");
    let p2 = test.gameState.players[1];
    p1.coins = 7;
    test.gameState.currentAction = { type: 'Coup', player: p1, target: p2 };

    let originalCardCount = p2.cards.filter(c => !c.dead).length;
    await test.resolveActionEffect();
    let newCardCount = p2.cards.filter(c => !c.dead).length;

    if (newCardCount !== originalCardCount - 1) throw new Error(`Coup failed. Expected ${originalCardCount - 1} alive cards, got ${newCardCount}`);
    console.log("Coup Passed");

    // 5. Assassinate (Lose card)
    console.log("\n--- Rule Test: Assassinate ---");
    p2.cards = [{id: 'c1', role: 'Duke', dead: false}, {id: 'c2', role: 'Captain', dead: false}]; // Ensure alive
    test.gameState.currentAction = { type: 'Assassinate', player: p1, target: p2 };
    await test.resolveActionEffect();
    newCardCount = p2.cards.filter(c => !c.dead).length;
    if (newCardCount !== 1) throw new Error(`Assassinate failed. Expected 1 alive card, got ${newCardCount}`);
    console.log("Assassinate Passed");

    // 6. Steal
    console.log("\n--- Rule Test: Steal ---");
    p1.coins = 2;
    p2.coins = 3;
    test.gameState.currentAction = { type: 'Steal', player: p1, target: p2 };
    test.resolveActionEffect();
    if (p1.coins !== 4 || p2.coins !== 1) throw new Error(`Steal failed. P1 coins: ${p1.coins}, P2 coins: ${p2.coins}`);
    console.log("Steal Passed (Full 2 coins)");

    p1.coins = 2;
    p2.coins = 1;
    test.gameState.currentAction = { type: 'Steal', player: p1, target: p2 };
    test.resolveActionEffect();
    if (p1.coins !== 3 || p2.coins !== 0) throw new Error(`Steal failed. P1 coins: ${p1.coins}, P2 coins: ${p2.coins}`);
    console.log("Steal Passed (Partial 1 coin)");

    // 7. Exchange
    console.log("\n--- Rule Test: Exchange ---");
    p1.cards = [{id: 'e1', role: 'Duke', dead: false}];
    test.gameState.deck = [{id: 'd1', role: 'Assassin', dead: false}, {id: 'd2', role: 'Contessa', dead: false}];
    test.gameState.currentAction = { type: 'Exchange', player: p1, target: null };
    await test.resolveActionEffect();
    if (p1.cards.length !== 1) throw new Error(`Exchange failed length check. Length: ${p1.cards.length}`);
    console.log("Exchange Passed");

    // 8. Challenge Win
    console.log("\n--- Rule Test: Challenge Win (Challenger wins) ---");
    test = createInstance({ humanCount: 2, aiCount: 0 });
    test.startGame();
    p1 = test.gameState.players[0];
    p2 = test.gameState.players[1];
    p1.cards = [{id: 'x1', role: 'Contessa', dead: false}, {id: 'x2', role: 'Captain', dead: false}];

    test.gameState.currentAction = { type: 'Tax', player: p1, target: null };
    await test.resolveChallenge(p1, p2, 'Duke');

    if (p1.cards.filter(c => !c.dead).length !== 1) throw new Error("Challenged player did not lose a card.");
    console.log("Challenge Win Passed");

    // 9. Challenge Lose
    console.log("\n--- Rule Test: Challenge Lose (Challenger loses) ---");
    p1.cards = [{id: 'x1', role: 'Duke', dead: false}, {id: 'x2', role: 'Captain', dead: false}];
    p2.cards = [{id: 'y1', role: 'Assassin', dead: false}, {id: 'y2', role: 'Captain', dead: false}];

    test.gameState.currentAction = { type: 'Tax', player: p1, target: null };
    await test.resolveChallenge(p1, p2, 'Duke');

    if (p2.cards.filter(c => !c.dead).length !== 1) throw new Error("Challenger did not lose a card.");
    if (p1.cards.filter(c => !c.dead).length !== 2) throw new Error("Challenged player did not retain cards.");
    console.log("Challenge Lose Passed");

    // 10. Block rules
    console.log("\n--- Rule Test: Block rules ---");
    test = createInstance({ humanCount: 2, aiCount: 0 });
    test.startGame();
    p1 = test.gameState.players[0];
    p2 = test.gameState.players[1];

    p1.coins = 3;
    test.gameState.currentAction = { type: 'Assassinate', player: p1, target: p2 };

    p2.isAI = false;
    p2.shouldBlockMock = () => 'Contessa';
    p1.isAI = false;
    p1.shouldChallengeMock = () => false;

    await test.processReactions();
    await new Promise(r => setTimeout(r, 100));

    if (p2.cards.filter(c => !c.dead).length !== 2) throw new Error("P2 lost a card despite blocking Assassinate.");
    console.log("Block Passed");

    console.log("\n=== ALL COMPREHENSIVE LOCAL RULES VERIFICATION PASSED ===");
}

runTests().catch(e => {
    console.error("VERIFICATION FAILED:", e);
    process.exit(1);
});
