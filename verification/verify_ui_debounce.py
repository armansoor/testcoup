import sys
import subprocess
import time
from playwright.sync_api import sync_playwright

def run_test():
    print("Starting server...")
    server = subprocess.Popen(["python3", "-m", "http.server", "8000"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2)

    try:
        with sync_playwright() as p:
            print("Launching browser...")
            browser = p.chromium.launch()
            page = browser.new_page()

            print("Navigating to game...")
            page.goto("http://localhost:8000")

            # Click Local Play
            print("Clicking Local Play...")
            page.click("#mode-local")

            # Start Game (default 1 human, 1 AI)
            print("Starting Game...")
            page.click("button:text('START GAME')")

            # Wait for game screen
            page.wait_for_selector("#game-screen.active")

            # Wait for button to be ENABLED (it might be AI turn first)
            print("Waiting for my turn (Income button enabled)...")
            income_btn = page.locator("button:text('Income (1)')")
            income_btn.wait_for(state="visible")

            # Timeout 30s for AI to finish turn if it started
            try:
                # Wait until enabled
                page.wait_for_function("!document.querySelector(\"button[onclick*='Income']\").disabled", timeout=30000)
            except Exception as e:
                print("Timed out waiting for turn. AI stuck?")
                sys.exit(1)

            # Check coins before action
            time.sleep(1) # Stabilize
            old_coins = int(page.inner_text("#player-coins"))
            print(f"My Coins: {old_coins}")

            # Take Income Action
            print("Taking Income action...")
            income_btn.click()

            # Wait for coins to update
            try:
                page.wait_for_function(f"parseInt(document.getElementById('player-coins').innerText) === {old_coins + 1}", timeout=5000)
                print(f"PASS: Coins updated to {old_coins + 1}")
            except Exception as e:
                print(f"FAIL: Coins did not update. Error: {e}")
                sys.exit(1)

            page.screenshot(path="verification/ui_check.png")
            print("Screenshot saved to verification/ui_check.png")

    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
    finally:
        server.terminate()

if __name__ == "__main__":
    run_test()
