# Empty Extraction Guard V18.1

This is a quiet update for V18.

## Fix

V18 was capturing a valid registry every 1.5 seconds and logging:

```text
[EmptyExtractionGuard V18] Captured good registry {reason: 'interval-good'}
```

This spammed the console.

V18.1 still captures the last good registry, but silently.

## Console output now

Expected normal output:

```text
[EmptyExtractionGuard V18.1] Installed quiet guard
```

Only real restores will warn:

```text
[EmptyExtractionGuard V18.1] Restored last good registry after empty extraction
```

## Debug commands

```js
window.__essamEmptyExtractionGuardV18_1.getSummary()
window.__essamEmptyExtractionGuardV18_1.setDebug(true)
window.__essamEmptyExtractionGuardV18_1.setDebug(false)
```
