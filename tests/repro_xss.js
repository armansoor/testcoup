const fs = require('fs');
const vm = require('vm');
const path = require('path');

// --- MOCK DOM ---

class MockElement {
    constructor(tagName = 'div') {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this._innerText = '';
        this._innerHTML = '';
        this.classList = {
            add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false
        };
        this.style = {};
    }

    get innerText() { return this._innerText; }
    set innerText(val) { this._innerText = val; }

    get textContent() { return this._innerText; }
    set textContent(val) { this._innerText = val; }

    get innerHTML() { return this._innerHTML; }
    set innerHTML(val) { this._innerHTML = val; }

    appendChild(child) { this.children.push(child); }
    createElement(tag) { return new MockElement(tag); }
    getElementById(id) { return new MockElement('DIV'); }
    getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; }
}

class MockDocument {
    constructor() {
        this.elements = {};
        this.body = new MockElement('BODY');
    }
    getElementById(id) {
        if (!this.elements[id]) {
            this.elements[id] = new MockElement('DIV');
            this.elements[id].id = id;
        }
        return this.elements[id];
    }
    createElement(tag) { return new MockElement(tag); }
    querySelector() { return new MockElement('DIV'); }
}

// --- SETUP ---

function createSandbox() {
    const doc = new MockDocument();

    // Elements needed by updateUI
    doc.getElementById('turn-indicator');
    doc.getElementById('opponents-container');
    doc.getElementById('player-area');
    doc.getElementById('active-player-name');
    doc.getElementById('player-coins').innerText = '0';
    doc.getElementById('game-log');
    doc.getElementById('player-cards');

    const sandbox = {
        document: doc,
        window: {},
        console: console,
        setTimeout: () => {},
        gameState: {
            players: [],
            currentPlayerIndex: 0,
            log: []
        },
        myPlayerId: 1,
        isNetworkGame: false,
        isReplayMode: false,
        netState: { isHost: false, clients: [] },
        getCurrentPlayer: () => sandbox.gameState.players[sandbox.gameState.currentPlayerIndex],
        triggerAnimation: () => {},
        spawnFloatingText: () => {},
        ROLES: ['Duke', 'Assassin', 'Captain', 'Ambassador', 'Contessa']
    };
    sandbox.window = sandbox;
    return sandbox;
}

function loadUI(sandbox) {
    const code = fs.readFileSync(path.join(__dirname, '../js/ui.js'), 'utf8');
    vm.runInContext(code, sandbox);
}

// --- TEST ---

function runTest() {
    const sandbox = createSandbox();
    vm.createContext(sandbox);
    loadUI(sandbox);

    const maliciousName = '<img src=x onerror=alert(1)>';

    sandbox.gameState.players.push({
        id: 1,
        name: 'Player 1',
        coins: 2,
        cards: [],
        alive: true,
        isAI: false
    });

    sandbox.gameState.players.push({
        id: 2,
        name: maliciousName,
        coins: 2,
        cards: [],
        alive: true,
        isAI: false
    });

    sandbox.gameState.currentPlayerIndex = 0;
    sandbox.myPlayerId = 1;

    console.log("Running updateUI with malicious player name...");
    sandbox.updateUI();

    const oppContainer = sandbox.document.getElementById('opponents-container');
    const player2Div = oppContainer.children[0];

    if (!player2Div) {
        console.error("No opponent div found!");
        process.exit(1);
    }

    // Inspect Structure
    // Expect: Div -> [Div(Strong(Name)), Div(Coins), Div(Cards)]

    if (player2Div.children.length !== 3) {
        console.error(`Expected 3 children (Name, Coins, Cards), got ${player2Div.children.length}`);
        // If 0, maybe innerHTML was used and my mock doesn't parse it?
        // But if I fixed it to use createElement, it should have children.
        if (player2Div.children.length === 0) {
             console.log("innerHTML was likely used (or empty). Checking innerHTML...");
             console.log(player2Div.innerHTML);
             if (player2Div.innerHTML.includes(maliciousName)) {
                 console.log("FAIL: innerHTML still used with payload.");
             }
        }
        process.exit(1);
    }

    const nameDiv = player2Div.children[0];
    const strong = nameDiv.children[0];

    console.log("Name TextContent:", strong.innerText);

    if (strong.innerText === maliciousName) {
        console.log("SUCCESS: Name is safely in textContent/innerText.");
    } else {
        console.log("FAIL: Name not found in textContent.");
    }
}

runTest();
