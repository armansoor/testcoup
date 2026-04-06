import os
import time
from playwright.sync_api import sync_playwright
import subprocess

def verify_replay():
    # Start a local server
    server_proc = subprocess.Popen(["python3", "-m", "http.server", "8000"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2)

    url = "http://localhost:8000/index.html"

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context()
            page = context.new_page()

            # Block external requests
            page.route("**/*", lambda route: route.abort() if "unpkg.com" in route.request.url or "googleapis.com" in route.request.url or "gstatic.com" in route.request.url else route.continue_())

            page.goto(url)

            print("--- Replay & Log Check ---")

            # Start Game
            page.select_option("#human-count", "1")
            page.select_option("#ai-count", "1")
            page.click("button:has-text('START GAME')")
            page.wait_for_selector("#game-screen.active")

            # Make a move
            page.click("button:has-text('Income')")
            page.wait_for_selector(".log-entry:has-text('Income')", timeout=5000)
            print("Move made.")

            # Win Game
            page.evaluate("gameState.players[1].alive = false; nextTurn();")

            # Wait for Game Over
            page.wait_for_selector("#game-over-modal:not(.hidden)", timeout=5000)
            print("Game Over reached.")

            # View History
            page.click("button:has-text('View Match History')")
            page.wait_for_selector("#history-screen.active")

            # Verify History Item Rendering
            winner_text = page.inner_text(".history-winner")
            print(f"Winner in history: {winner_text}")
            assert "Winner:" in winner_text

            # Watch Replay
            page.click("button:has-text('Watch Replay')")
            page.wait_for_selector("#replay-controls:not(.hidden)")
            print("Entered Replay Mode.")

            # Step 0 Check
            log_text = page.inner_text("#game-log")
            assert "Welcome to Coup" in log_text
            print("Step 0 Log Clean.")

            # Go to End
            while True:
                step_text = page.inner_text("#replay-step")
                current, total = map(int, step_text.split(' / '))
                if current == total: break
                page.click("button:has-text('Next >')")
                time.sleep(0.1)

            # Last Step Check
            log_text_end = page.inner_text("#game-log")
            assert "WINS THE GAME" in log_text_end
            print("Final Log contains Win message.")

            context.close()
            browser.close()
            print("Replay Verification Completed.")
    finally:
        server_proc.terminate()

if __name__ == "__main__":
    verify_replay()
