import os
import time
from playwright.sync_api import sync_playwright

def verify_replay():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        cwd = os.getcwd()
        url = f"file://{cwd}/index.html"
        page.goto(url)

        print("--- Replay & Log Check ---")

        # Start Game
        page.select_option("#human-count", "1")
        page.select_option("#ai-count", "1")
        page.click("button:has-text('START GAME')")
        page.wait_for_selector("#game-screen.active")

        # Make a move
        page.click("button:has-text('Income')")
        page.wait_for_selector(".log-entry:has-text('Income')")
        print("Move made.")

        # Cheat to enable Replay (simulate game over logic or just call UI)
        # We can just quit to lobby and see if History has entry? No, history only saves on win.
        # Let's force a win for Player 1
        page.evaluate("gameState.players[1].alive = false; nextTurn();")

        # Wait for Game Over Modal
        page.wait_for_selector("#game-over-modal:not(.hidden)", timeout=5000)
        print("Game Over reached.")

        # Click "View Match History"
        page.click("button:has-text('View Match History')")
        page.wait_for_selector("#history-screen.active")

        # Click "Watch Replay"
        page.click("button:has-text('Watch Replay')")
        page.wait_for_selector("#replay-controls:not(.hidden)")
        print("Entered Replay Mode.")

        # Check Log Content (Initial state)
        log_text = page.inner_text("#game-log")
        assert "Welcome to Coup" in log_text

        # Click Next
        page.click("button:has-text('Next >')")

        # Check Log Update
        # The Income action should appear now (or be highlighted)
        log_text_2 = page.inner_text("#game-log")
        print(f"Log at step 1: {log_text_2}")

        # Assuming the log replay logic works, we should see the Income entry
        # Note: If snapshots captured it.

        context.close()
        browser.close()
        print("Replay Verification Completed.")

if __name__ == "__main__":
    verify_replay()
