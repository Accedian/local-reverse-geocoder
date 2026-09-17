# AGENTS.md

This repository ships a local reverse geocoder library and a small Express service around it. The core runtime is still plain JavaScript in [index.js](./index.js) and [app.js](./app.js); TypeScript support is maintained manually through [index.d.ts](./index.d.ts) and [app.ts](./app.ts).

## Review guidelines

- Treat [index.js](./index.js) as the runtime source of truth. If you change public options, response shape, or endpoint behavior, update [index.d.ts](./index.d.ts) and [app.ts](./app.ts) in the same PR because there is no TypeScript build step keeping them in sync.
- Preserve the repo's error-first callback style. New async code in [index.js](./index.js) and [app.js](./app.js) should surface errors exactly once and avoid swallowing parse or request failures.
- Keep startup fail-fast behavior intact. `init()` currently aborts on GeoNames load failures rather than continuing with partial state, and the web service gates `/geocode` behind the initialization flag in [app.js](./app.js).
- Be careful with the pre-baked GeoNames data pipeline in [index.js](./index.js). It reads gzip-compressed V8-serialized data and rebuilds the k-d tree; changes here should not introduce partial reads or incompatible pre-baked artifacts.
- Preserve the current concurrency model. Runtime initialization loads the pre-baked artifact once through `_loadPrebaked()`, while the build-time prebake pipeline uses `async.parallel(...)` and lookups use `async.series(...)` to return results in input order. Avoid mutating shared lookup state in ways that make results order-dependent.
- Security and container hardening matter in this repo. Keep Docker-time Corepack and GeoNames downloads on HTTPS with certificate validation enabled, and do not weaken the hardened non-root runtime setup in [Dockerfile](./Dockerfile).
- When changing runtime or container dependencies, update the generated lockfiles and verify the image/runtime versions that actually ship. Most recent merged work in this repo has been dependency, Node, Alpine, and Docker hardening.
- The repository has a checked-in Node test suite under [test/](./test/) and a CircleCI pipeline in [.circleci/config.yml](./.circleci/config.yml). Run `npm test` and `npm run lint`; also include manual verification notes for `npm start`, `/healthcheck`, `/deep-healthcheck`, at least one `/geocode` request, and any Docker or Helm path you changed.

### Common Mistakes

GitHub review history here is sparse, but the repeated flags and follow-up fixes are:

- Fixing one undefined/null-safe access path while leaving sibling call sites unchanged. Reviewers explicitly caught this around the HTTPS options/logging path, so search for duplicate patterns before opening a PR.
- Making Docker image changes that ignore this repo's hardened-image and tag constraints. Review discussion focused on whether a supported runtime tag existed and matched the deployment flow, not just whether the Dockerfile built once.
- Forgetting that [app.ts](./app.ts) and [index.d.ts](./index.d.ts) do not update themselves. If the JavaScript implementation changes, update the typed mirrors in the same change.
- Shipping security/version bumps without the generated artifacts that go with them, especially [pnpm-lock.yaml](./pnpm-lock.yaml).

## Project Structure

- [README.md](./README.md): project overview, library usage, Docker usage, and API examples.
- [index.js](./index.js): main geocoder implementation, GeoNames download/parsing, k-d tree build, and lookup logic.
- [app.js](./app.js): Express wrapper that exposes `/healthcheck`, `/deep-healthcheck`, and `/geocode`.
- [app.ts](./app.ts): typed mirror of the service entrypoint; keep it aligned manually with [app.js](./app.js).
- [index.d.ts](./index.d.ts): public TypeScript declarations for consumers of the package.
- [docs/index.html](./docs/index.html): generated JSDoc output; browse the rest of [docs/](./docs/) for generated API pages and assets.
- [helm/Chart.yaml.in](./helm/Chart.yaml.in) and [helm/values.yaml.in](./helm/values.yaml.in): Helm metadata and default deployment templates.
- [.github/FUNDING.yml](./.github/FUNDING.yml): repo metadata; there is no checked-in workflow under `.github/workflows/`, while [.circleci/config.yml](./.circleci/config.yml) defines the build pipeline.

## Key Files

- Build and packaging: [package.json](./package.json), [pnpm-lock.yaml](./pnpm-lock.yaml), [pnpm-workspace.yaml](./pnpm-workspace.yaml), [Makefile](./Makefile), [Dockerfile](./Dockerfile), [Procfile](./Procfile)
- Runtime entrypoints: [index.js](./index.js), [app.js](./app.js), [app.ts](./app.ts), [index.d.ts](./index.d.ts)
- Deployment config: [helm/Chart.yaml.in](./helm/Chart.yaml.in), [helm/values.yaml.in](./helm/values.yaml.in)
- Docs: [README.md](./README.md), [docs/index.html](./docs/index.html)
- Repo metadata: [.github/FUNDING.yml](./.github/FUNDING.yml) and [LICENSE](./LICENSE)

## Development

- No `CONTRIBUTING.md` is present in this repository.
- Install dependencies with `pnpm install --frozen-lockfile`.
- Lint with `npm run lint`.
- Run the web service with `npm start`.
- Rebuild generated docs with `npm run build`.
- Format root-level JS/Markdown/JSON files with `npm run prettier`.
- The README's local Docker flow is `docker build -t local-reverse-geocoder .` followed by `docker run -it -e PORT=3000 --rm local-reverse-geocoder`.
- [Makefile](./Makefile) supports `make docker`, `make push`, `make circleci-push`, `make helm`, `make helm-lint`, `make helm-push`, `make url-file`, and `make clean`; Docker and Helm targets require the variables documented in [Makefile](./Makefile), usually including `DOCKER_VER`.
- Include `npm test`, `npm run lint`, and a short manual smoke-test note in PRs when behavior changes. The lowest-friction manual check is the sample `curl` request from [README.md](./README.md) against `/geocode` after startup.

## Dependencies

- Dependency manifests: [package.json](./package.json), [pnpm-lock.yaml](./pnpm-lock.yaml), and [pnpm-workspace.yaml](./pnpm-workspace.yaml)
- Runtime libraries: `async`, `csv-parse`, and `kdt`
- Web-service dependencies currently live in `devDependencies`: `express`, `cors`, `@types/*`, `jsdoc`, `jshint`, and `prettier`. If you touch [app.js](./app.js), [app.ts](./app.ts), or [Dockerfile](./Dockerfile), verify install/runtime behavior instead of assuming these stay dev-only.
- Runtime baseline: [package.json](./package.json) requires Node `>=24`, and [Dockerfile](./Dockerfile) uses a multi-stage Node 24 Alpine build plus a hardened Alpine 3.24 FIPS runner.
- External services/data: GeoNames dumps from `https://download.geonames.org/export/dump/`; there is no database, message queue, or remote geocoding API in the application path.
- Deployment targets: Google Container Registry naming is wired through [Makefile](./Makefile) and [helm/values.yaml.in](./helm/values.yaml.in), with Kubernetes packaging in [helm/](./helm/).
