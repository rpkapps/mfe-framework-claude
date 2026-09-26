---
'@company/mfe-runtime': patch
'@company/mfe-react': patch
---

A storage key's entry is now dropped once nothing holds it, whichever of the last `release()` and the last unsubscribe comes second. Before, a key released while still subscribed, which is the order React tears a component down in, stayed open for the rest of the page, so the next component to declare it with another schema object or default was refused as a conflicting consumer.

`useStoredState` no longer opens a binding during render. It reads the first snapshot through a binding it releases at once, and holds one only from subscribe to unsubscribe, so a render React discards, a render that throws an unreadable record, and StrictMode's replayed effects all leave nothing open behind them.
