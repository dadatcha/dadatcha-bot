---
name: Python runtime setup
description: Project-specific note about enabling Python alongside the existing workspace runtime.
---

Python availability is controlled by the project module list; adding a Python module makes `python3` available to the Run command. The validated run command belongs at the top level of `.replit`, not under a `[run]` table.

**Why:** The workspace initially had only Node.js, and the first run configuration shape was rejected by the settings validator.

**How to apply:** When adding or restoring Python tooling, use the project module configuration and validate the full `.replit` file before replacing it.