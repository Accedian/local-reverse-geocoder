DOCKER_REPO_NAME := gcr.io/npav-172917/
CONTAINER_REGISTRY := weld-reverse-geocoder
HELM_APPLICATION_NAME := weld-reverse-geocoder
HELM_REPO := oci://us-docker.pkg.dev/npav-172917/helm-package

BUILD_PLATFORMS ?= linux/amd64

%.yaml: %.yaml.in .FORCE
	@echo "# /!\ This file is generated, do not edit!" > $@
	sed -e "s/@HELM_VER@/$(DOCKER_VER)/" -e "s/@HELM_NAME@/$(HELM_APPLICATION_NAME)/" $< >> $@

docker: verify-pins
	docker buildx build --platform $(BUILD_PLATFORMS) -t $(DOCKER_REPO_NAME)$(CONTAINER_REGISTRY):$(DOCKER_VER) --load .

push: verify-pins
	docker buildx build --platform $(BUILD_PLATFORMS) -t $(DOCKER_REPO_NAME)$(CONTAINER_REGISTRY):$(DOCKER_VER) --push .

circleci-push: verify-pins
	docker buildx build --platform $(BUILD_PLATFORMS) -t $(DOCKER_REPO_NAME)$(CONTAINER_REGISTRY):$(DOCKER_VER) --push .

helm-lint: helm/Chart.yaml helm/values.yaml
	helm lint helm

helm $(HELM_APPLICATION_NAME)-$(DOCKER_VER).tgz: .FORCE helm-lint helm/Chart.yaml helm/values.yaml
	helm package helm

helm-push: $(HELM_APPLICATION_NAME)-$(DOCKER_VER).tgz verify-pins
	helm push $< $(HELM_REPO)

# POSIX shell, no Node dependency: the CircleCI release job is a Docker-only
# machine executor that provisions helm but not Node.
verify-pins:
	sh scripts/verify-pins.sh

url-file:
	echo $(DOCKER_REPO_NAME)$(CONTAINER_REGISTRY):$(shell cat service-tag.txt) > urlname.txt

.PHONY: docker push circleci-push helm helm-lint helm-push clean url-file verify-pins kotsflow-publish-image kotsflow-prepare-chart

# kotsflow-publish-image preserves the pinned package-manager verification and
# publishes only to the development repository and tag selected by kotsflow.
kotsflow-publish-image: verify-pins
	@set -eu; \
	test "$${KOTSFLOW_DEVELOPMENT_RELEASE:-}" = "true"; \
	test -x "$${KOTSFLOW_DOCKER:-}"; \
	test -n "$${KOTSFLOW_SOURCE_COMMIT:-}"; \
	test "$$(git rev-parse --verify HEAD)" = "$$KOTSFLOW_SOURCE_COMMIT"; \
	case "$${KOTSFLOW_IMAGE_REPOSITORY:-}" in gcr.io/npav-172917/dev/*) ;; *) echo "invalid kotsflow development repository" >&2; exit 1;; esac; \
	case "$${KOTSFLOW_IMAGE_TAG:-}" in ""|*[!0-9A-Za-z_.-]*) echo "invalid kotsflow image tag" >&2; exit 1;; esac; \
	case "$${KOTSFLOW_PLATFORMS:-}" in linux/amd64|linux/arm64) ;; *) echo "invalid kotsflow platform" >&2; exit 1;; esac; \
	"$$KOTSFLOW_DOCKER" buildx build --platform "$$KOTSFLOW_PLATFORMS" \
		--tag "$$KOTSFLOW_IMAGE_REPOSITORY:$$KOTSFLOW_IMAGE_TAG" \
		--provenance=false --sbom=false --push .

# kotsflow-prepare-chart renders ignored chart inputs atomically so a failed
# preparation cannot leave a partially written chart behind.
kotsflow-prepare-chart:
	@set -eu; \
	case "$${KOTSFLOW_VERSION:-}" in ""|*[!0-9A-Za-z_.-]*) echo "invalid kotsflow chart version" >&2; exit 1;; esac; \
	chart_tmp="$$(mktemp helm/.Chart.yaml.kotsflow.XXXXXX)"; \
	values_tmp="$$(mktemp helm/.values.yaml.kotsflow.XXXXXX)"; \
	trap 'rm -f "$$chart_tmp" "$$values_tmp"' EXIT HUP INT TERM; \
	{ printf '%s\n' '# /!\ This file is generated, do not edit!'; sed -e "s/@HELM_VER@/$$KOTSFLOW_VERSION/g" -e 's/@HELM_NAME@/weld-reverse-geocoder/g' helm/Chart.yaml.in; } > "$$chart_tmp"; \
	{ printf '%s\n' '# /!\ This file is generated, do not edit!'; sed -e "s/@HELM_VER@/$$KOTSFLOW_VERSION/g" helm/values.yaml.in; } > "$$values_tmp"; \
	mv "$$chart_tmp" helm/Chart.yaml; \
	mv "$$values_tmp" helm/values.yaml; \
	trap - EXIT HUP INT TERM

.FORCE:

clean:
	rm -f helm/Chart.yaml helm/values.yaml *.tgz
