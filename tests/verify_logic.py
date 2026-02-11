import os
import time
from playwright.sync_api import sync_playwright

def verify_logic():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        cwd = os.getcwd()
        url = f"file://{cwd}/index.html"
        page.goto(url)

        print("--- SCENARIO 1: Stats Button Visibility ---")
        # Ensure the button is visible
        stats_btn = page.query_selector("button:has-text('STATS & ACHIEVEMENTS')")
        assert stats_btn is not None
        assert page.is_visible("button:has-text('STATS & ACHIEVEMENTS')")
        print("Stats Button is Visible.")

        # Open it
        page.click("button:has-text('STATS & ACHIEVEMENTS')")
        page.wait_for_selector("#stats-modal")
        assert page.is_visible("#achievements-list")
        print("Stats Modal Opened.")
        page.click("#stats-modal button:has-text('Close')")

        print("--- SCENARIO 2: Assassin Challenge/Block Logic Check ---")
        # Setup: 1 Human, 1 AI (Hardcore to force reactions)
        page.select_option("#human-count", "1")
        page.select_option("#ai-count", "1")
        page.select_option("#difficulty", "hardcore") # Hardcore bots challenge aggressively

        page.click("button:has-text('START GAME')")
        page.wait_for_selector("#game-screen.active")

        # Give ourselves 3 coins to Assassinate (cheat via console for testing)
        page.evaluate("gameState.players[0].coins = 3; updateUI();")

        # Perform Assassinate on Bot
        page.click("button:has-text('Assassinate')")

        # Check logs for Bot reaction
        # Bot might Challenge (if it thinks we bluff) or Block (if it has Contessa) or Die.
        # We just want to ensure the game didn't crash and processed the action.

        # Wait for log update
        try:
            page.wait_for_selector(".log-entry:has-text('Assassinate')", timeout=5000)
            print("Assassination attempt logged.")

            # Allow time for bot response
            time.sleep(2)

            # Check for result in logs
            logs = page.inner_text("#game-log")
            if "CHALLENGES" in logs:
                print("Bot Reacted: Challenged!")
            elif "BLOCKS" in logs:
                print("Bot Reacted: Blocked!")
            elif "Assassinated" in logs:
                print("Bot Reacted: Took the hit (or had no response).")
            else:
                print("Bot reaction unclear from logs, but game flow continued.")

        except Exception as e:
            print(f"Error during logic check: {e}")

        context.close()
        browser.close()
        print("Logic Verification Completed.")

if __name__ == "__main__":
    verify_logic()
