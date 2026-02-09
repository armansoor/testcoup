// --- UTILS ---

/**
 * Shuffles an array in place using Fisher-Yates algorithm.
 * Executed 7 times for maximum randomness perception.
 * @param {Array} array
 */
function shuffle(array) {
    for (let k = 0; k < 7; k++) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }
}

/**
 * Async sleep function to create delays.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
