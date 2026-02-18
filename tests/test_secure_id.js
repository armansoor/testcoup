const fs = require('fs');
const vm = require('vm');
const path = require('path');

// Mock crypto
const mockCrypto = {
    getRandomValues: (buffer) => {
        // Fill with dummy values for predictable output if needed, or random
        for (let i = 0; i < buffer.length; i++) {
            buffer[i] = Math.floor(Math.random() * 256);
        }
        return buffer;
    }
};

const sandbox = {
    window: {
        crypto: mockCrypto
    },
    Math: Math,
    Uint32Array: Uint32Array,
    Uint8Array: Uint8Array,
    console: console
};
sandbox.self = sandbox.window; // Alias for window

function loadUtils() {
    const utilsCode = fs.readFileSync(path.join(__dirname, '../js/utils.js'), 'utf8');
    vm.createContext(sandbox);
    vm.runInContext(utilsCode, sandbox);
}

function verifyGenerateSecureId() {
    console.log("Verifying generateSecureId...");
    loadUtils();

    if (typeof sandbox.generateSecureId !== 'function') {
        console.error("generateSecureId function not found in js/utils.js");
        process.exit(1);
    }

    const id = sandbox.generateSecureId();
    console.log(`Generated ID: ${id}`);

    if (typeof id !== 'string' || id.length === 0) {
        console.error("generateSecureId did not return a valid string");
        process.exit(1);
    }

    // Check if it looks random/hex (assuming hex output based on plan)
    if (!/^[0-9a-f]+$/i.test(id)) {
        console.warn("Generated ID might not be hex string. Check implementation.");
    }

    console.log("generateSecureId verification passed.");
}

function verifyNetworkUsage() {
    console.log("Verifying js/network.js usage...");
    const networkCode = fs.readFileSync(path.join(__dirname, '../js/network.js'), 'utf8');

    // Check if sendInteractionRequest uses generateSecureId
    const functionRegex = /function\s+sendInteractionRequest\s*\(/;
    const match = networkCode.match(functionRegex);

    if (!match) {
        console.error("sendInteractionRequest function not found in js/network.js");
        process.exit(1);
    }

    // Simple check: does the file contain the call?
    if (!networkCode.includes('generateSecureId()')) {
        console.error("js/network.js does not seem to call generateSecureId()");
        // We might want to be more specific, but this is a start.
        process.exit(1);
    }

    console.log("js/network.js usage verification passed.");
}

try {
    verifyGenerateSecureId();
    verifyNetworkUsage();
    console.log("ALL CHECKS PASSED");
} catch (e) {
    console.error("Test execution failed:", e);
    process.exit(1);
}
