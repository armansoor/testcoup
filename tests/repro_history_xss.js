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

    // Elements needed
    doc.getElementById('history-screen');
    doc.getElementById('lobby-screen');
    doc.getElementById('game-screen');
    doc.getElementById('history-list');

    const maliciousWinner = '<img src=x onerror=alert("winner")>';
    const maliciousPlayer = '<script>alert("player")</script>';

    const sandbox = {
        document: doc,
        window: {},
        console: console,
        setTimeout: () => {},
        gameState: { players: [], log: [] },
        localStorage: {
            getItem: (key) => {
                if (key === 'coup_match_history') {
                    return JSON.stringify([{
                        winner: maliciousWinner,
                        date: new Date().toISOString(),
                        players: ['Player 1', maliciousPlayer],
                        replayData: [] // minimal
                    }]);
                }
                return null;
            }
        },
        maliciousWinner: maliciousWinner,
        maliciousPlayer: maliciousPlayer,
        loadReplay: () => {}
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

    console.log("Running showHistory with malicious history data...");
    sandbox.showHistory();

    const list = sandbox.document.getElementById('history-list');

    if (list.children.length === 0) {
        console.error("History list empty!");
        process.exit(1);
    }

    const entryDiv = list.children[0];
    // Expected structure: Div -> [Div(Winner), Div(Date), Div(Players), Button(Replay)]

    if (entryDiv.children.length !== 4) {
         console.error(`Expected 4 children, got ${entryDiv.children.length}`);
         // Check for innerHTML usage
         if (entryDiv.children.length === 0 && entryDiv.innerHTML) {
             console.log("innerHTML was likely used. Checking content...");
             if (entryDiv.innerHTML.includes(sandbox.maliciousWinner)) {
                 console.log("FAIL: Winner payload found in innerHTML.");
             }
         }
         process.exit(1);
    }

    const winnerDiv = entryDiv.children[0];
    const playersDiv = entryDiv.children[2];

    console.log("Winner Text:", winnerDiv.innerText);
    console.log("Players Text:", playersDiv.innerText);

    // Winner check
    if (winnerDiv.innerText.includes(sandbox.maliciousWinner)) {
         console.log("SUCCESS: Winner name is treated as text.");
    } else {
         console.log("FAIL: Winner name mismatch or not text.");
    }

    // Players check
    if (playersDiv.innerText.includes(sandbox.maliciousPlayer)) {
         console.log("SUCCESS: Player name is treated as text.");
    } else {
         console.log("FAIL: Player name mismatch or not text.");
    }
}

runTest();
