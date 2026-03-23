# AGENTS.md

This repository ships a local reverse geocoder library and a small Express service around it. The core runtime is still plain JavaScript in [index.js](./index.js) and [app.js](./app.js); TypeScript support is maintained manually through [index.d.ts](./index.d.ts) and [app.ts](./app.ts).

## Review guidelines

- Treat [index.js](./index.js) as the runtime source of truth. If you change public options, response shape, or endpoint behavior, update [index.d.ts](./index.d.ts) and [app.ts](./app.ts) in the same PR because there is no TypeScript build step keeping them in sync.
- Preserve the repo's error-first callback style. New async code in [index.js](./index.js), [app.js](./app.js), and [postinstall.js](./postinstall.js) should surface errors exactly once and avoid swallowing stream, parse, or request failures.
- Keep startup fail-fast behavior intact. `init()` currently aborts on GeoNames load failures rather than continuing with partial state, and the web service gates `/geocode` behind the initialization flag in [app.js](./app.js).
- Be careful with the GeoNames download/cache pipeline in [index.js](./index.js). It uses timestamped cache files, stream-based zip extraction, and synchronous cache cleanup; changes here should not introduce double-callbacks, partial writes, or races between unzip `finish` events and file write completion.
- Preserve the current concurrency model. Initialization intentionally uses `async.parallel(...)` for data loading, while lookups use `async.series(...)` to return results in input order. Avoid mutating shared lookup state in ways that make results order-dependent.
- Security and container hardening matter in this repo. Keep certificate validation enabled by default, preserve the explicit opt-out via `SHOULD_REJECT_UNAUTHORIZED`, and do not weaken the hardened non-root runtime setup in [Dockerfile](./Dockerfile).
- When changing runtime or container dependencies, update the generated lockfiles and verify the image/runtime versions that actually ship. Most recent merged work in this repo has been dependency, Node, Alpine, and Docker hardening.
- There is no checked-in automated test suite or CI workflow. Reviewers will need manual verification notes for `npm run lint`, `npm start`, `/healthcheck`, `/deep-healthcheck`, at least one `/geocode` request, and any Docker or Helm path you changed.

### Common Mistakes

GitHub review history here is sparse, but the repeated flags and follow-up fixes are:

- Fixing one undefined/null-safe access path while leaving sibling call sites unchanged. Reviewers explicitly caught this around the HTTPS options/logging path, so search for duplicate patterns before opening a PR.
- Making Docker image changes that ignore this repo's hardened-image and tag constraints. Review discussion focused on whether a supported runtime tag existed and matched the deployment flow, not just whether the Dockerfile built once.
- Forgetting that [app.ts](./app.ts) and [index.d.ts](./index.d.ts) do not update themselves. If the JavaScript implementation changes, update the typed mirrors in the same change.
- Shipping security/version bumps without the generated artifacts that go with them, especially [package-lock.json](./package-lock.json) and, when touched, [yarn.lock](./yarn.lock).

## Project Structure

- [README.md](./README.md): project overview, library usage, Docker usage, and API examples.
- [index.js](./index.js): main geocoder implementation, GeoNames download/parsing, k-d tree build, and lookup logic.
- [app.js](./app.js): Express wrapper that exposes `/healthcheck`, `/deep-healthcheck`, and `/geocode`.
- [app.ts](./app.ts): typed mirror of the service entrypoint; keep it aligned manually with [app.js](./app.js).
- [index.d.ts](./index.d.ts): public TypeScript declarations for consumers of the package.
- [postinstall.js](./postinstall.js): optional cache preloading driven by `GEOCODER_POSTINSTALL_*` environment variables.
- [docs/index.html](./docs/index.html): generated JSDoc output; browse the rest of [docs/](./docs/) for generated API pages and assets.
- [helm/Chart.yaml](./helm/Chart.yaml) and [helm/values.yaml](./helm/values.yaml): Helm metadata and default deployment values.
- [.github/FUNDING.yml](./.github/FUNDING.yml): repo metadata; there is no checked-in workflow under `.github/workflows/` and no `.circleci/config.yml`.

## Key Files

- Build and packaging: [package.json](./package.json), [package-lock.json](./package-lock.json), [Makefile](./Makefile), [Dockerfile](./Dockerfile), [Procfile](./Procfile)
- Runtime entrypoints: [index.js](./index.js), [app.js](./app.js), [app.ts](./app.ts), [index.d.ts](./index.d.ts), [postinstall.js](./postinstall.js)
- Deployment config: [helm/Chart.yaml](./helm/Chart.yaml), [helm/values.yaml](./helm/values.yaml)
- Docs: [README.md](./README.md), [docs/index.html](./docs/index.html)
- Repo metadata: [.github/FUNDING.yml](./.github/FUNDING.yml) and [LICENSE](./LICENSE)

## Development

- No `CONTRIBUTING.md` is present in this repository.
- Install dependencies with `npm install`. Note that [postinstall.js](./postinstall.js) only performs GeoNames initialization when `GEOCODER_POSTINSTALL_*` environment variables are set.
- Lint with `npm run lint`.
- Run the web service with `npm start`.
- Rebuild generated docs with `npm run build`.
- Format root-level JS/Markdown/JSON files with `npm run prettier`.
- The README's local Docker flow is `docker build -t local-reverse-geocoder .` followed by `docker run -it -e PORT=3000 --rm local-reverse-geocoder`.
- [Makefile](./Makefile) supports `make docker`, `make push`, `make circleci-docker`, `make circleci-push`, and `make circleci-push-latest`; these require `DOCKERFILE_TARGET`, `CONTAINER_REGISTRY`, and usually `DOCKER_VER`.
- Because there is no automated test suite, include a short manual smoke-test note in PRs when behavior changes. The lowest-friction check is the sample `curl` request from [README.md](./README.md) against `/geocode` after startup.

## Dependencies

- Dependency manifests: [package.json](./package.json), [package-lock.json](./package-lock.json), and [yarn.lock](./yarn.lock)
- Runtime libraries: `async`, `csv-parse`, `debug`, `kdt`, `request`, and `unzip-stream`
- Web-service dependencies currently live in `devDependencies`: `express`, `cors`, `@types/*`, `jsdoc`, `jshint`, and `prettier`. If you touch [app.js](./app.js), [app.ts](./app.ts), or [Dockerfile](./Dockerfile), verify install/runtime behavior instead of assuming these stay dev-only.
- Security override: [package.json](./package.json) pins `tough-cookie` through `overrides`; preserve that kind of explicit mitigation when dependency scans require it.
- Runtime baseline: [package.json](./package.json) requires Node `>=22`, and [Dockerfile](./Dockerfile) uses a multi-stage Node 22 build plus a hardened Alpine runner.
- External services/data: GeoNames dumps from `https://download.geonames.org/export/dump/`; there is no database, message queue, or remote geocoding API in the application path.
- Deployment targets: Google Container Registry naming is wired through [Makefile](./Makefile) and [helm/values.yaml](./helm/values.yaml), with Kubernetes packaging in [helm/](./helm/).
