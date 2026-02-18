const fs = require('fs');
const vm = require('vm');
const path = require('path');

// --- MOCK ENVIRONMENT ---

class MockCrypto {
    constructor() {
        this.randomValuesSequence = [];
        this.callCount = 0;
    }

    getRandomValues(array) {
        if (this.randomValuesSequence.length > 0) {
            // Fill array with pre-determined values
            for (let i = 0; i < array.length; i++) {
                 if (this.callCount < this.randomValuesSequence.length) {
                    array[i] = this.randomValuesSequence[this.callCount++];
                 } else {
                    array[i] = 0; // Default fallback if sequence runs out
                 }
            }
        } else {
             // Fallback to basic pseudo-random for non-deterministic tests
             for (let i = 0; i < array.length; i++) {
                array[i] = Math.floor(Math.random() * 256);
             }
        }
        return array;
    }

    setRandomSequence(seq) {
        this.randomValuesSequence = seq;
        this.callCount = 0;
    }
}

function createSandbox() {
    const mockCrypto = new MockCrypto();
    const sandbox = {
        window: {
            crypto: mockCrypto,
        },
        console: console,
        Math: Math,
        Uint32Array: Uint32Array,
        gameState: {}, // Mock gameState to prevent ReferenceError
    };
    sandbox.self = sandbox;
    return { sandbox, mockCrypto };
}

function loadUtils(sandbox) {
    const utilsCode = fs.readFileSync(path.join(__dirname, '../js/utils.js'), 'utf8');
    vm.createContext(sandbox);
    vm.runInContext(utilsCode, sandbox);
}

// --- TESTS ---

function runTests() {
    console.log("=== STARTING UTILS TESTS ===");
    let failures = 0;

    // Test 1: Shuffle In-Place and Preservation
    try {
        console.log("\n--- Test 1: Shuffle In-Place and Preservation ---");
        const { sandbox } = createSandbox();
        loadUtils(sandbox);

        const original = [1, 2, 3, 4, 5];
        const arr = [...original]; // Copy

        sandbox.shuffle(arr);

        // Check Length
        if (arr.length !== original.length) throw new Error(`Length changed: got ${arr.length}, expected ${original.length}`);

        // Check Elements Preserved (sort and compare)
        const sortedArr = [...arr].sort();
        const sortedOrig = [...original].sort();
        if (JSON.stringify(sortedArr) !== JSON.stringify(sortedOrig)) {
            throw new Error(`Elements not preserved: ${JSON.stringify(arr)}`);
        }

        console.log("Passed: Elements preserved and length correct.");
    } catch (e) {
        console.error("FAILED Test 1:", e);
        failures++;
    }

    // Test 2: Deterministic Shuffle
    try {
        console.log("\n--- Test 2: Deterministic Shuffle ---");
        const { sandbox, mockCrypto } = createSandbox();
        loadUtils(sandbox);

        // Deterministic sequence: always return 0.
        // This ensures getSecureRandomIndex always returns 0 (since 0 < range).
        // Trace for [0, 1, 2]:
        // Pass 1:
        // i=2, j=0 -> Swap(2,0) -> [2, 1, 0]
        // i=1, j=0 -> Swap(1,0) -> [1, 2, 0]
        // Pass 2:
        // i=2, j=0 -> Swap(2,0) -> [0, 2, 1]
        // i=1, j=0 -> Swap(1,0) -> [2, 0, 1]

        mockCrypto.setRandomSequence([0, 0, 0, 0, 0, 0, 0, 0]);

        const arr = [0, 1, 2];
        sandbox.shuffle(arr);

        console.log(`Deterministic Result: ${JSON.stringify(arr)}`);
        if (JSON.stringify(arr) !== JSON.stringify([2, 0, 1])) {
             throw new Error(`Deterministic test failed. Expected [2, 0, 1], got ${JSON.stringify(arr)}`);
        }

        console.log("Passed: Deterministic shuffle worked as expected.");

    } catch (e) {
        console.error("FAILED Test 2:", e);
        failures++;
    }

    // Test 3: Edge Cases (Empty/Single)
    try {
        console.log("\n--- Test 3: Edge Cases (Empty/Single) ---");
        const { sandbox } = createSandbox();
        loadUtils(sandbox);

        const empty = [];
        sandbox.shuffle(empty);
        if (empty.length !== 0) throw new Error("Empty array modified");

        const single = [1];
        sandbox.shuffle(single);
        if (single.length !== 1 || single[0] !== 1) throw new Error("Single element array modified");

        console.log("Passed: Edge cases handled.");
    } catch (e) {
        console.error("FAILED Test 3:", e);
        failures++;
    }

    if (failures > 0) {
        console.error(`\n=== ${failures} TESTS FAILED ===`);
        process.exit(1);
    } else {
        console.log("\n=== ALL UTILS TESTS PASSED ===");
    }
}

runTests();
