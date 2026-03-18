const fs = require('fs');
const vm = require('vm');
const path = require('path');

class MockElement {
    constructor(id = '') {
        this.id = id;
        this.classList = {
            add: () => {},
            remove: () => {},
            contains: () => false
        };
        this.innerText = '';
        this.innerHTML = '';
        this.style = {};
        this.appendChild = () => {};
    }
}

class MockDocument {
    constructor() {
        this.elements = {};
        this.lookupCount = 0;
    }
    getElementById(id) {
        this.lookupCount++;
        // Simulate real browser DOM lookup overhead
        let x = 0;
        for(let i=0; i<1000; i++) x += i;

        if (!this.elements[id]) {
            this.elements[id] = new MockElement(id);
        }
        return this.elements[id];
    }
    createElement(tag) {
        return new MockElement();
    }
}

function benchmark(fn, iterations = 10000) {
    const start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) {
        fn();
    }
    const end = process.hrtime.bigint();
    return Number(end - start) / 1000000; // ms
}

const doc = new MockDocument();
const sandbox = {
    document: doc,
    console: console,
    ACTIONS: { 'Test': { role: 'TestRole' } },
    gameState: { players: [], log: [] },
    isNetworkGame: false,
    isReplayMode: false,
    setTimeout: (fn) => fn(),
    clearReactionTimer: () => {},
    startReactionTimer: (fn) => {}
};
vm.createContext(sandbox);

const uiCode = fs.readFileSync(path.join(__dirname, '../js/ui.js'), 'utf8');
vm.runInContext(uiCode, sandbox);

const iterations = 10000;
console.log(`Benchmarking askHumanChallenge with ${iterations} iterations...`);

const runBenchmark = () => {
    sandbox.askHumanChallenge({ name: 'P1' }, { type: 'Test', player: { name: 'P2' } });
};

// Warm up
benchmark(runBenchmark, 100);
doc.lookupCount = 0;

const time = benchmark(runBenchmark, iterations);
const lookups = doc.lookupCount;

console.log(`Time: ${time.toFixed(4)} ms`);
console.log(`DOM Lookups: ${lookups}`);
console.log(`Average time per call: ${(time / iterations).toFixed(6)} ms`);
