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
        this.id = '';
        this.innerHTML = '';
        this.style = {};
    }
    appendChild(child) {}
}

class MockDocument {
    constructor() {
        this.elements = {};
    }
    getElementById(id) {
        if (!this.elements[id]) {
            this.elements[id] = new MockElement('DIV');
            this.elements[id].id = id;
        }
        return this.elements[id];
    }
    createElement(tag) {
        return new MockElement(tag);
    }
}

function createSandbox() {
    const doc = new MockDocument();
    const sandbox = {
        document: doc,
        console: console,
        setTimeout: (fn) => fn(),
        requestAnimationFrame: (fn) => fn(),
        localStorage: {
            getItem: (key) => null,
            setItem: (key, val) => {}
        },
        sanitize: (str) => str,
        loadReplay: (idx) => {}
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    return sandbox;
}

function loadUI(sandbox) {
    const uiCode = fs.readFileSync(path.join(__dirname, '../js/ui.js'), 'utf8');
    vm.runInContext(uiCode, sandbox);
}

// --- TESTS ---

function runTests() {
    console.log("=== STARTING HISTORY TOGGLE TESTS ===");
    let failures = 0;

    // Test 1: showHistory hides other screens and shows history screen
    try {
        console.log("\n--- Test 1: showHistory hides other screens and shows history screen ---");
        const sandbox = createSandbox();
        loadUI(sandbox);

        const lobby = sandbox.document.getElementById('lobby-screen');
        const game = sandbox.document.getElementById('game-screen');
        const history = sandbox.document.getElementById('history-screen');

        // Set initial state
        lobby.classList.add('active');
        game.classList.add('active');
        history.classList.remove('active');

        sandbox.showHistory();

        if (lobby.classList.contains('active')) {
            throw new Error("showHistory() failed to remove 'active' class from lobby-screen");
        }
        if (game.classList.contains('active')) {
            throw new Error("showHistory() failed to remove 'active' class from game-screen");
        }
        if (!history.classList.contains('active')) {
            throw new Error("showHistory() failed to add 'active' class to history-screen");
        }
        console.log("Passed: Successfully transitioned to history screen and hid other screens.");

    } catch (e) {
        console.error("FAILED Test 1:", e);
        failures++;
    }

    // Test 2: closeHistory returns to lobby screen
    try {
        console.log("\n--- Test 2: closeHistory returns to lobby screen ---");
        const sandbox = createSandbox();
        loadUI(sandbox);

        const lobby = sandbox.document.getElementById('lobby-screen');
        const history = sandbox.document.getElementById('history-screen');

        // Set initial state (in history)
        history.classList.add('active');
        lobby.classList.remove('active');

        sandbox.closeHistory();

        if (history.classList.contains('active')) {
            throw new Error("closeHistory() failed to remove 'active' class from history-screen");
        }
        if (!lobby.classList.contains('active')) {
            throw new Error("closeHistory() failed to add 'active' class to lobby-screen");
        }
        console.log("Passed: Successfully returned to lobby screen.");

    } catch (e) {
        console.error("FAILED Test 2:", e);
        failures++;
    }

    if (failures > 0) {
        console.error(`\n=== ${failures} TESTS FAILED ===`);
        process.exit(1);
    } else {
        console.log("\n=== ALL HISTORY TOGGLE TESTS PASSED ===");
    }
}

runTests();
