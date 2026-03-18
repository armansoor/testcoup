import os
import time
from playwright.sync_api import sync_playwright

def verify_ui():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(record_video_dir="verification/video")
        page = context.new_page()

        cwd = os.getcwd()
        url = "http://localhost:8000/index.html"

        print(f"Navigating to {url}")
        page.goto(url, wait_until="commit")
        page.wait_for_timeout(1000)

        # Start a game
        page.select_option("#human-count", "1")
        page.select_option("#ai-count", "1")
        page.click("button:has-text('START GAME')")
        page.wait_for_timeout(1000)

        # Force trigger the reaction panel via evaluate
        page.evaluate("""
            const p = gameState.players[0];
            const action = { type: 'Tax', player: p, role: 'Duke' };
            askHumanChallenge(p, action);
        """)

        page.wait_for_timeout(500)
        # The reaction panel should be visible now
        page.screenshot(path="verification/reaction_panel_check.png")
        print("Screenshot saved to verification/reaction_panel_check.png")

        page.wait_for_timeout(1000)
        context.close()
        browser.close()

if __name__ == "__main__":
    verify_ui()
