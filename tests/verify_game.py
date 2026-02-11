import os
import time
from playwright.sync_api import sync_playwright

def test_game():
    with sync_playwright() as p:
        # Launch browser
        browser = p.chromium.launch(headless=True)
        cwd = os.getcwd()
        url = f"file://{cwd}/index.html"
        print(f"Loading {url}")

        # Test 1: Single Player (Desktop)
        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()
        page.goto(url)

        # Test Stats Modal
        page.click("button:has-text('STATS & ACHIEVEMENTS')")
        page.wait_for_selector("#stats-modal")
        assert page.is_visible("text=Games Played")
        print("Stats Modal opened")
        # Target the specific close button inside the stats modal
        page.click("#stats-modal button:has-text('Close')")

        page.select_option("#human-count", "1")
        page.select_option("#ai-count", "1")
        page.click("button:has-text('START GAME')")
        page.wait_for_selector("#game-screen.active")
        print("Single Player: Started")

        # Perform Action
        page.click("button:has-text('Income')")
        page.wait_for_selector(".log-entry:has-text('Income')")

        context.close()

        # Test 2: Pass & Play Privacy Screen
        context_pp = browser.new_context()
        page_pp = context_pp.new_page()
        page_pp.goto(url)

        page_pp.select_option("#human-count", "2")
        page_pp.select_option("#ai-count", "0")
        page_pp.click("button:has-text('START GAME')")
        page_pp.wait_for_selector("#game-screen.active")
        print("Pass & Play: Started")

        # P1 Move
        page_pp.click("button:has-text('Income')")

        # Verify Privacy Screen Appears
        # Logic in game.js: setTimeout(..., 1000)
        time.sleep(1.5)
        # Check if overlay is visible
        assert page_pp.is_visible("#pass-device-screen")
        assert page_pp.is_visible("text=Pass Device")
        print("Privacy Screen appeared")

        # Click "I am Player 2"
        page_pp.click("#i-am-ready-btn")

        # Verify Game Screen Resumed and P2 turn
        assert not page_pp.is_visible("#pass-device-screen")
        page_pp.wait_for_function("document.getElementById('turn-indicator').innerText.includes('Player 2')")
        print("Turn passed to Player 2 successfully")

        context_pp.close()

        browser.close()
        print("All Tests Completed.")

if __name__ == "__main__":
    test_game()
