const fs = require('fs');
const vm = require('vm');
const path = require('path');

// --- MOCK ENVIRONMENT ---

function createSandbox() {
    const sandbox = {
        gameState: {
            players: [{ name: 'Player 1' }, { name: 'Player 2' }],
            log: ['Game started'],
            replayData: []
        },
        localStorage: {
            storage: {},
            getItem: function(key) { return this.storage[key] || null; },
            setItem: function(key, val) { this.storage[key] = val; }
        },
        console: {
            log: function(...args) { /* console.log(...args); */ },
            error: function(...args) { this.errors.push(args); },
            errors: []
        },
        Date: Date,
        alert: function(msg) { this.alerts.push(msg); },
        alerts: [],
        document: {
            getElementById: function(id) {
                return {
                    classList: {
                        add: () => {},
                        remove: () => {},
                        contains: () => false
                    },
                    innerText: '',
                    style: {}
                };
            }
        },
        syncClientState: () => {},
        location: { reload: () => {} }
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    return sandbox;
}

function loadReplayManager(sandbox) {
    const code = fs.readFileSync(path.join(__dirname, '../js/core/ReplayManager.js'), 'utf8');
    vm.runInContext(code, sandbox);
}

// --- TESTS ---

function runTests() {
    console.log("=== STARTING REPLAY MANAGER TESTS ===");
    let failures = 0;

    // Test 1: saveMatchHistory handles malformed JSON in localStorage
    try {
        console.log("\n--- Test 1: saveMatchHistory handles malformed JSON ---");
        const sandbox = createSandbox();
        loadReplayManager(sandbox);

        // Inject malformed JSON
        sandbox.localStorage.storage['coup_match_history'] = "{invalid json";

        const winner = { name: 'Player 1' };
        sandbox.saveMatchHistory(winner);

        // Verify console.error was called for the JSON parse error
        if (sandbox.console.errors.length === 0) {
            throw new Error("Expected console.error to be called for malformed JSON");
        }
        console.log("Caught expected error:", sandbox.console.errors[0][0].message || sandbox.console.errors[0][0]);

        // Verify it still saved the new match
        const stored = sandbox.localStorage.getItem('coup_match_history');
        const history = JSON.parse(stored);
        if (history.length !== 1) {
            throw new Error(`Expected history length 1, got ${history.length}`);
        }
        if (history[0].winner !== 'Player 1') {
            throw new Error(`Expected winner 'Player 1', got ${history[0].winner}`);
        }

        console.log("Passed: saveMatchHistory recovered from malformed JSON and saved the new match.");
    } catch (e) {
        console.error("FAILED Test 1:", e);
        failures++;
    }

    // Test 2: saveMatchHistory handles localStorage quota exceeded
    try {
        console.log("\n--- Test 2: saveMatchHistory handles quota exceeded ---");
        const sandbox = createSandbox();
        loadReplayManager(sandbox);

        // Mock setItem to throw
        sandbox.localStorage.setItem = function() {
            throw new Error("QuotaExceededError");
        };

        const winner = { name: 'Player 2' };
        sandbox.saveMatchHistory(winner);

        // Verify console.error was called with the specific message
        const quotaError = sandbox.console.errors.find(args =>
            args[0] === "Failed to save history (quota exceeded?)"
        );

        if (!quotaError) {
            throw new Error("Expected console.error with 'Failed to save history' message");
        }

        console.log("Passed: saveMatchHistory handled quota exceeded error gracefully.");
    } catch (e) {
        console.error("FAILED Test 2:", e);
        failures++;
    }

    if (failures > 0) {
        console.error(`\n=== ${failures} TESTS FAILED ===`);
        process.exit(1);
    } else {
        console.log("\n=== ALL REPLAY MANAGER TESTS PASSED ===");
    }
}

runTests();
