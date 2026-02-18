from playwright.sync_api import sync_playwright
import json

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        print("Navigating to game...")
        page.goto("http://localhost:8080")

        # Inject malicious history
        print("Injecting malicious history...")
        malicious_entry = [{
            "id": 123456789,
            "winner": "<img src=x onerror=console.error('XSS_WINNER')>",
            "players": ["<script>console.error('XSS_PLAYER')</script>", "P2"],
            "date": "2026-01-01T00:00:00.000Z",
            "log": [],
            "replayData": []
        }]

        # We need to set localStorage. Since goto waits for load, we can just execute script.
        page.evaluate("data => localStorage.setItem('coup_match_history', JSON.stringify(data))", malicious_entry)

        # Reload to ensure the application reads the storage (if it reads on load)
        # But showHistory() reads from localStorage when called, so reload might clear DOM state which is good.
        print("Reloading...")
        page.reload()

        # Click Match History button
        print("Clicking 'MATCH HISTORY'...")
        # Button text is "MATCH HISTORY" (all caps in HTML source: "MATCH HISTORY")
        # Locator: text="MATCH HISTORY"
        try:
            page.get_by_text("MATCH HISTORY").click()
        except Exception as e:
            print(f"Failed to find/click button: {e}")
            page.screenshot(path="verification/error_click.png")
            browser.close()
            return

        # Wait for history screen to be active
        # The history screen has id="history-screen" and class="screen active" when active
        print("Waiting for history screen...")
        try:
            page.wait_for_selector("#history-screen.active", timeout=5000)
            page.wait_for_selector("#history-list div", timeout=5000) # Wait for items
        except Exception as e:
            print(f"History screen did not appear: {e}")
            page.screenshot(path="verification/error_history.png")
            browser.close()
            return

        # Check content
        content = page.inner_html("#history-list")
        print(f"History List Content: {content}")

        failed = False
        if "<img src=x" in content:
            print("FAIL: Raw IMG tag found! XSS possible.")
            failed = True

        if "&lt;img src=x" in content:
            print("PASS: IMG tag is escaped.")
        else:
            print("WARNING: Escaped IMG tag not found (maybe text content is different?)")

        if "<script>" in content:
             print("FAIL: Raw SCRIPT tag found! XSS possible.")
             failed = True

        if "&lt;script&gt;" in content:
             print("PASS: SCRIPT tag is escaped.")

        # Take screenshot
        output_path = "verification/verification.png"
        page.screenshot(path=output_path)
        print(f"Screenshot saved to {output_path}")

        browser.close()

        if failed:
            exit(1)

if __name__ == "__main__":
    run()
