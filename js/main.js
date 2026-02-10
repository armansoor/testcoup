// --- PWA SETUP ---

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        // Register SW with scope ./ to cover all files
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker registered!', reg))
            .catch(err => console.log('Service Worker registration failed:', err));

        // Setup Install Button
        if (typeof setupInstallButton === 'function') {
            setupInstallButton();
        }
    });
}

// Global Click listener for Audio Resume
document.body.addEventListener('click', () => {
    if (window.audio) window.audio.resume();
}, { once: true });

// --- ERROR HANDLING & STABILITY ---

window.onbeforeunload = function() {
    if (isNetworkGame) {
        return "Are you sure you want to leave the game?";
    }
};
