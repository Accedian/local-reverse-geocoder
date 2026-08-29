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

.PHONY: docker push circleci-push helm helm-lint helm-push clean url-file verify-pins

.FORCE:

clean:
	rm -f helm/Chart.yaml helm/values.yaml *.tgz
