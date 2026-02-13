// --- PWA SETUP ---

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        // Register SW with scope ./ to cover all files
        navigator.serviceWorker.register('./sw.js')
            .then(reg => {
                console.log('Service Worker registered!', reg);
                reg.onupdatefound = () => {
                    const installingWorker = reg.installing;
                    installingWorker.onstatechange = () => {
                        if (installingWorker.state === 'installed') {
                            if (navigator.serviceWorker.controller) {
                                console.log('New content is available; please refresh.');
                                // Optional: Show a toast to user "Update available, reload?"
                                // For now, we rely on the next visit or manual reload,
                                // but the SW skipWaiting() should handle it.
                            } else {
                                console.log('Content is cached for offline use.');
                            }
                        }
                    };
                };
            })
            .catch(err => console.log('Service Worker registration failed:', err));

        // Setup Install Button
        if (typeof setupInstallButton === 'function') {
            setupInstallButton();
        }
    });

    // Refresh page if controller changes (new SW activated)
    let refreshing;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        window.location.reload();
        refreshing = true;
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

function handleQuit() {
    if (isNetworkGame) {
        if (confirm("Disconnect from the game? This will return you to the main menu.")) {
            location.reload();
        }
    } else {
        location.reload();
    }
}
