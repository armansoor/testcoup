## 2025-05-23 - Synchronous Testing Constraints
**Learning:** The project uses Node.js `vm` with a custom mock DOM for testing. The mock environment relies on synchronous execution of `setTimeout`. When introducing async browser APIs like `requestAnimationFrame`, a synchronous fallback is essential to prevent breaking tests.
**Action:** Always check for `typeof requestAnimationFrame` and provide a `setTimeout(..., 0)` fallback that behaves synchronously in the test mock.
