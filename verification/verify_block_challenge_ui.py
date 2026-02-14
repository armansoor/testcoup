from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto("http://localhost:8080/index.html")

        # Wait for scripts to load
        page.wait_for_load_state("networkidle")

        # Mock the gameState and Players, and switch to Game Screen
        page.evaluate("""
            gameState.players = [
                new Player(1, 'Player 1'),
                new Player(2, 'Bot 1', true)
            ];
            gameState.currentPlayerIndex = 0;

            document.getElementById('lobby-screen').classList.remove('active');
            document.getElementById('game-screen').classList.add('active');

            updateUI();
        """)

        # Trigger the challenge UI
        page.evaluate("""() => {
            const p1 = gameState.players[0];
            const bot = gameState.players[1];

            const actionObj = {
                type: 'Block',
                player: bot,
                role: 'Captain'
            };

            askHumanChallenge(p1, actionObj);
        }""")

        # Wait for the modal to appear
        try:
            page.wait_for_selector("#reaction-panel:not(.hidden)", timeout=5000)
        except Exception as e:
            print(f"Timeout waiting for modal: {e}")
            page.screenshot(path="verification/debug_timeout.png")
            return

        # Take screenshot
        page.screenshot(path="verification/block_challenge_ui.png")
        print("Screenshot taken.")

        browser.close()

if __name__ == "__main__":
    run()
