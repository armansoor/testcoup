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

// --- ERROR HANDLING & STABILITY ---

window.onbeforeunload = function() {
    if (isNetworkGame) {
        return "Are you sure you want to leave the game?";
    }
};
