const fs = require('fs');
const vm = require('vm');

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
        this.value = '';
        this.style = {};
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
        for(let i=0; i<100; i++) x += i;

        if (!this.elements[id]) {
            this.elements[id] = new MockElement(id);
        }
        return this.elements[id];
    }
}

const doc = new MockDocument();

const netUI = {
    cache: {},
    getCached(id) {
        if (!this.cache[id]) {
            this.cache[id] = doc.getElementById(id);
        }
        return this.cache[id];
    },
    get onlineActions() { return this.getCached('online-actions'); },
    get lobbyStatus() { return this.getCached('lobby-status'); },
    get connectionStatus() { return this.getCached('connection-status'); }
};

function benchmark(fn, iterations = 1000000) {
    const start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) {
        fn();
    }
    const end = process.hrtime.bigint();
    return Number(end - start) / 1000000; // ms
}

const iterations = 100000;

console.log(`Running benchmark with ${iterations} iterations (Simulating repeated function calls)...`);

const unoptimized = () => {
    // Simulating what happens when functions like initHost, startHostPeer etc are called repeatedly
    doc.getElementById('online-actions').classList.add('hidden');
    doc.getElementById('lobby-status').classList.remove('hidden');
    doc.getElementById('connection-status').innerText = "Status...";
};

const optimized = () => {
    // Using the new netUI cache
    netUI.onlineActions.classList.add('hidden');
    netUI.lobbyStatus.classList.remove('hidden');
    netUI.connectionStatus.innerText = "Status...";
};

// Warm up
benchmark(unoptimized, 1000);
benchmark(optimized, 1000);
doc.lookupCount = 0;

const timeUnoptimized = benchmark(unoptimized, iterations);
const lookupsUnoptimized = doc.lookupCount;
console.log(`Unoptimized: ${timeUnoptimized.toFixed(4)} ms (${lookupsUnoptimized} DOM lookups)`);

doc.lookupCount = 0;
const timeOptimized = benchmark(optimized, iterations);
const lookupsOptimized = doc.lookupCount;
console.log(`Optimized: ${timeOptimized.toFixed(4)} ms (${lookupsOptimized} DOM lookups)`);

const diff = timeUnoptimized - timeOptimized;
const percent = (diff / timeUnoptimized) * 100;

console.log(`Improvement: ${diff.toFixed(4)} ms (${percent.toFixed(2)}%)`);
console.log(`Lookups saved: ${lookupsUnoptimized - lookupsOptimized}`);
