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
    }
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
}

function createSandbox() {
    const doc = new MockDocument();
    const sandbox = {
        document: doc,
        console: console,
        setTimeout: (fn) => fn(),
        requestAnimationFrame: (fn) => fn(),
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
    console.log("=== STARTING UI TOGGLE TESTS ===");
    let failures = 0;

    // Test 1: toggleRules toggles 'hidden' class
    try {
        console.log("\n--- Test 1: toggleRules toggles 'hidden' class ---");
        const sandbox = createSandbox();
        loadUI(sandbox);

        const modal = sandbox.document.getElementById('rules-modal');

        // Initial state
        if (modal.classList.contains('hidden')) {
            throw new Error("Modal should not have 'hidden' class by default in mock");
        }

        // First toggle
        sandbox.toggleRules();
        if (!modal.classList.contains('hidden')) {
            throw new Error("toggleRules() failed to add 'hidden' class");
        }
        console.log("Passed: Successfully added 'hidden' class.");

        // Second toggle
        sandbox.toggleRules();
        if (modal.classList.contains('hidden')) {
            throw new Error("toggleRules() failed to remove 'hidden' class");
        }
        console.log("Passed: Successfully removed 'hidden' class.");

    } catch (e) {
        console.error("FAILED Test 1:", e);
        failures++;
    }

    if (failures > 0) {
        console.error(`\n=== ${failures} TESTS FAILED ===`);
        process.exit(1);
    } else {
        console.log("\n=== ALL UI TOGGLE TESTS PASSED ===");
    }
}

runTests();
