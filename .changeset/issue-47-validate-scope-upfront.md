---
"@color-sunset/fil-cli": patch
---

`fil init` now resolves `--scope` once, up front, and exits `2` on an unknown
value regardless of whether any adapter install callback is enabled. Previously
an invalid `--scope` was silently accepted (exit `0`) when both adapter install
callbacks were opted out.
