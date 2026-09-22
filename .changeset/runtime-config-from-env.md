---
'@company/mfe-rspack': minor
---

The build now writes the pieces a deployment needs to fill in `runtime-config.json` from the environment.

- `.mfe/runtime-config.sh` is a POSIX `sh` and `awk` script, generated from the `env()` declarations. At start it writes each set variable over `runtime-config.json`, typed by the field's schema, and keeps what is already in the file for any variable that is unset. It stops the container when a required value is missing or a value has the wrong shape. In the nginx image, copy it into `/docker-entrypoint.d/`.
- `dist/runtime-config.json` holds the declared `.default(…)` values, generated as `.mfe/runtime-config.defaults.json`.
- A build no longer copies `public/runtime-config.json`, the developer's local values, into `dist/`.
- `mfe-generate` creates `public/runtime-config.json` with the declared defaults when it is missing, and adds any default the file lacks. It never changes or removes a value already there, and it names each required field that still needs a local value.
