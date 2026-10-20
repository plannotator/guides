# Plan: let pastes expire (#41)

1. The new paste form gets an "Expires after" choice: 1 hour, 1 day, 1 week, or never. Never is selected first.
2. The `pastes` table gets an `expires_at` column. It stays empty for a paste that never expires, and for every paste saved before this change.
3. Reading a paste whose `expires_at` has passed answers 410 Gone, on both `/p/:id` and `/p/:id/raw`.
4. A cleanup job runs every 10 minutes and deletes the pastes whose `expires_at` has passed. After that, the link answers 404, like any missing paste.
5. Deleting a paste by hand works as before. No other route changes.

Open: an expired paste answers 410 until the cleanup job runs, then 404. Should it answer 404 from the start, so the answer never changes? The maintainers decide before the release.
