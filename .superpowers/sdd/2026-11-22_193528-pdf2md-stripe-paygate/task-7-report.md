# Task 7 Report: Multipart Body Deadline Implementation

- **Defect:** Unbounded multipart uploads could stall the conversion admission slots indefinitely, causing resource exhaustion for the entire process.
- **Fix:** Implemented a finite 60-second total upload body deadline in `upload.cjs`.
- **Changes:**
  - `upload.cjs`: Added `UPLOAD_BODY_TIMEOUT_MS` (60s), integrated `setTimeout` into `parsePdf` to track total body stream duration, and ensured cleanup (clearing timeout, removing listeners) on all exit paths (success, error, abort). Parser is explicitly destroyed on timeout to release system resources.
  - `server.cjs`: Updated `createServer` to accept an optional `uploadBodyTimeoutMs` (defaulting to 60s), validated it at startup, and propagated it to `parsePdf`. Added handling for `408` (Upload timeout) response.
  - `server.test.cjs`: Added two regression tests:
    1. Eight concurrent incomplete uploads verify that they are timed out after the deadline, freeing up admission slots for the next request.
    2. A successful upload verifies that the body timer is cleared while the upstream process continues.
- **Verification:** All 23 tests in `server.test.cjs` passed, confirming both the new deadline behavior and existing conversion safety invariants.
