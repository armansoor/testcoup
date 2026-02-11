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

        # Win Game
        page.evaluate("gameState.players[1].alive = false; nextTurn();")

        # Wait for Game Over
        page.wait_for_selector("#game-over-modal:not(.hidden)", timeout=5000)
        print("Game Over reached.")

        # View History
        page.click("button:has-text('View Match History')")
        page.wait_for_selector("#history-screen.active")

        # Watch Replay
        page.click("button:has-text('Watch Replay')")
        page.wait_for_selector("#replay-controls:not(.hidden)")
        print("Entered Replay Mode.")

        # Step 0 Check
        # Should contain "Welcome to Coup" but NOT "WINS THE GAME" yet
        log_text = page.inner_text("#game-log")
        assert "Welcome to Coup" in log_text
        if "WINS THE GAME" in log_text:
            print(f"FAILURE: Log at Step 0 contains future events: {log_text}")
            raise AssertionError("Log pollution detected!")
        else:
            print("Step 0 Log Clean.")

        # Go to End
        while True:
            # Check if Next is enabled? Logic doesn't disable button, just stops index.
            # We can check Step Counter text
            step_text = page.inner_text("#replay-step")
            current, total = map(int, step_text.split(' / '))

            if current == total:
                break

            page.click("button:has-text('Next >')")
            time.sleep(0.1)

        # Last Step Check
        log_text_end = page.inner_text("#game-log")
        assert "WINS THE GAME" in log_text_end
        print("Final Log contains Win message.")

        context.close()
        browser.close()
        print("Replay Verification Completed.")

if __name__ == "__main__":
    verify_replay()
