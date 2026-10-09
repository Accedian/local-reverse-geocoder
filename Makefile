DOCKER_REPO_NAME := gcr.io/npav-172917/
CONTAINER_REGISTRY := weld-reverse-geocoder
HELM_APPLICATION_NAME := weld-reverse-geocoder
HELM_REPO := oci://us-docker.pkg.dev/npav-172917/helm-package

BUILD_PLATFORMS ?= linux/amd64

%.yaml: %.yaml.in .FORCE
	@echo "# /!\ This file is generated, do not edit!" > $@
	sed -e "s/@HELM_VER@/$(DOCKER_VER)/" -e "s/@HELM_NAME@/$(HELM_APPLICATION_NAME)/" $< >> $@

docker:
	docker buildx build --platform $(BUILD_PLATFORMS) -t $(DOCKER_REPO_NAME)$(CONTAINER_REGISTRY):$(DOCKER_VER) --load .

push:
	docker buildx build --platform $(BUILD_PLATFORMS) -t $(DOCKER_REPO_NAME)$(CONTAINER_REGISTRY):$(DOCKER_VER) --push .

circleci-push:
	docker buildx build --platform $(BUILD_PLATFORMS) -t $(DOCKER_REPO_NAME)$(CONTAINER_REGISTRY):$(DOCKER_VER) --push .

helm-lint: helm/Chart.yaml helm/values.yaml
	helm lint helm

helm $(HELM_APPLICATION_NAME)-$(DOCKER_VER).tgz: .FORCE helm-lint helm/Chart.yaml helm/values.yaml
	helm package helm

helm-push: $(HELM_APPLICATION_NAME)-$(DOCKER_VER).tgz
	helm push $< $(HELM_REPO)

url-file:
	@tag=$$(cat service-tag.txt); \
	printf '%s\n' "$$tag" | grep -Eq '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$$' || { \
		echo "Invalid Docker tag in service-tag.txt" >&2; exit 1; \
	}; \
	printf '%s:%s\n' "$(DOCKER_REPO_NAME)$(CONTAINER_REGISTRY)" "$$tag" > urlname.txt

.PHONY: docker push circleci-push helm helm-lint helm-push clean url-file

.FORCE:

clean:
	rm -f helm/Chart.yaml helm/values.yaml *.tgz