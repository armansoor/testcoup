import os
import time
from playwright.sync_api import sync_playwright

def verify_mobile():
    with sync_playwright() as p:
        # iPhone 6/7/8 dimensions (375x667)
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 375, 'height': 667})
        page = context.new_page()

        cwd = os.getcwd()
        url = f"file://{cwd}/index.html"
        page.goto(url)

        print("--- Mobile Viewport Test ---")
        # Check Stats Button Visibility
        stats_btn = page.locator("button:has-text('STATS & ACHIEVEMENTS')")

        # Scroll to it if needed
        stats_btn.scroll_into_view_if_needed()

        assert stats_btn.is_visible()
        print("Stats Button is Visible on Mobile.")

        # Open it
        stats_btn.click()
        page.wait_for_selector("#stats-modal")
        print("Stats Modal Opened on Mobile.")

        # Close it
        page.click("#stats-modal button:has-text('Close')")

        context.close()
        browser.close()
        print("Mobile Verification Completed.")

if __name__ == "__main__":
    verify_mobile()
