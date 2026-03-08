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
        this._innerText = '';
        this._innerHTML = '';
        this.value = ''; // for inputs
        this.onclick = null;
        this.disabled = false;
        this.id = '';
    }
    get innerHTML() { return this._innerHTML; }
    set innerHTML(val) {
        this._innerHTML = val;
        // Basic simulation: if it contains a script tag, we "detect" it
        if (val.includes('<script') || val.includes('onerror=')) {
            this.xssDetected = true;
        }
    }
    get textContent() { return this._innerText; }
    set textContent(val) { this._innerText = val; }
    get innerText() { return this._innerText; }
    set innerText(val) { this._innerText = val; }
    appendChild(child) { this.children.push(child); }
    removeChild(child) { this.children = this.children.filter(c => c !== child); }
    click() { if (this.onclick) this.onclick(); }
    querySelector(sel) { return null; }
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
    querySelector(sel) { return null; }
    querySelectorAll(sel) { return []; }
}

// --- SETUP SANDBOX ---
function createSandbox() {
    const doc = new MockDocument();

    const sandbox = {
        document: doc,
        window: {},
        console: console,
        setTimeout: (fn, delay) => { fn(); },
        localStorage: {
            getItem: (key) => {
                if (key === 'coup_stats') {
                    return JSON.stringify({
                        gamesPlayed: 1,
                        gamesWon: 1,
                        streak: 1,
                        achievements: ['first_win'],
                        history: []
                    });
                }
                return null;
            },
            setItem: () => {}
        },
        JSON: JSON,
        Math: Math,
        gameState: { players: [] },
        myPlayerId: 1
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    return sandbox;
}

function loadScripts(sandbox) {
    const files = [
        'js/utils.js',
        'js/stats.js'
    ];

    files.forEach(file => {
        let code = fs.readFileSync(path.join(__dirname, '../', file), 'utf8');
        vm.runInContext(code, sandbox);
    });
}

// --- TEST CASE ---
async function verifyXSS() {
    console.log("=== VERIFYING XSS IN STATS MODAL ===");
    const sb = createSandbox();

    // Inject malicious achievement before loading scripts or after
    // Actually ACHIEVEMENTS is a const in stats.js, so I need to load it and then modify if possible,
    // or mock it before loading.

    // Since ACHIEVEMENTS is at the top of stats.js, I'll read the file, modify the content in memory, and then run it.
    let statsCode = fs.readFileSync(path.join(__dirname, '../js/stats.js'), 'utf8');
    statsCode = statsCode.replace(
        "{ id: 'first_win', name: 'First Victory', desc: 'Win your first game' }",
        "{ id: 'first_win', name: 'First Victory <img src=x onerror=alert(1)>', desc: 'Win your first game <img src=x onerror=alert(1)>' }"
    );

    const utilsCode = fs.readFileSync(path.join(__dirname, '../js/utils.js'), 'utf8');
    vm.runInContext(utilsCode, sb);
    vm.runInContext(statsCode, sb);

    console.log("Showing Stats Modal...");
    sb.showStatsModal();

    const list = sb.document.getElementById('achievements-list');
    let detected = false;
    list.children.forEach(child => {
        if (child.xssDetected) detected = true;
        // Check if the payload is rendered as text
        child.children.forEach(grandChild => {
            if (grandChild.innerText.includes('<script') || grandChild.innerText.includes('onerror=')) {
                console.log(`Payload correctly rendered as text: ${grandChild.innerText}`);
            }
        });
    });

    if (detected) {
        console.error("FAILED: XSS detected in achievements list.");
        process.exit(1);
    } else {
        console.log("SUCCESS: No XSS detected. Payloads are treated as text.");
    }
}

verifyXSS().catch(e => {
    console.error("TEST ERROR:", e);
    process.exit(1);
});
