const fs = require('fs');
const vm = require('vm');
const path = require('path');

// --- MOCK ENVIRONMENT ---

class MockLocalStorage {
    constructor() {
        this.store = {};
    }
    getItem(key) {
        return this.store[key] || null;
    }
    setItem(key, value) {
        this.store[key] = String(value);
    }
}

function createSandbox() {
    const localStorage = new MockLocalStorage();
    const sandbox = {
        localStorage: localStorage,
        console: console,
        alert: (msg) => console.log("ALERT:", msg),
        document: {
            getElementById: (id) => ({
                classList: {
                    add: () => {},
                    remove: () => {}
                },
                innerText: ''
            })
        },
        location: {
            reload: () => console.log("RELOAD")
        },
        isReplayMode: false,
        activeReplayData: [],
        currentReplayIndex: 0,
        syncClientState: () => {},
        renderReplayFrame: () => {}, // To be defined or mocked
        gameState: { players: [], log: [], replayData: [] }
    };
    // Mock renderReplayFrame to avoid it failing if it's not yet in the script
    sandbox.renderReplayFrame = () => {
        // console.log("Rendering replay frame...");
    };
    return sandbox;
}

function loadReplayManager(sandbox) {
    const code = fs.readFileSync(path.join(__dirname, '../js/core/ReplayManager.js'), 'utf8');
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
}

// --- TESTS ---

function runTests() {
    console.log("=== STARTING REPLAY MANAGER SECURITY TESTS ===");
    let failures = 0;

    // Test 1: Handle non-array history
    try {
        console.log("\n--- Test 1: Handle non-array history ---");
        const sandbox = createSandbox();
        sandbox.localStorage.setItem('coup_match_history', JSON.stringify({ not: "an array" }));
        loadReplayManager(sandbox);

        // This should not throw
        sandbox.loadReplay(0);
        console.log("Passed: Handled non-array history without crashing.");
    } catch (e) {
        console.error("FAILED Test 1:", e);
        failures++;
    }

    // Test 2: Handle malformed entry (missing replayData)
    try {
        console.log("\n--- Test 2: Handle malformed entry (missing replayData) ---");
        const sandbox = createSandbox();
        sandbox.localStorage.setItem('coup_match_history', JSON.stringify([{ id: 123 }]));
        loadReplayManager(sandbox);

        // This should trigger the "Replay data missing or empty" alert
        sandbox.loadReplay(0);
        console.log("Passed: Handled malformed entry (missing replayData).");
    } catch (e) {
        console.error("FAILED Test 2:", e);
        failures++;
    }

    // Test 3: Handle malformed replayData (not an array)
    try {
        console.log("\n--- Test 3: Handle malformed replayData (not an array) ---");
        const sandbox = createSandbox();
        sandbox.localStorage.setItem('coup_match_history', JSON.stringify([{ replayData: "not an array" }]));
        loadReplayManager(sandbox);

        sandbox.loadReplay(0);
        console.log("Passed: Handled malformed replayData (not an array).");
    } catch (e) {
        console.error("FAILED Test 3:", e);
        failures++;
    }

    if (failures > 0) {
        process.exit(1);
    }
}

runTests();
