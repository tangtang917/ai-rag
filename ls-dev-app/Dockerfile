# Base image (override with --build-arg BASE_IMAGE=...)
ARG BASE_IMAGE=eclipse-temurin:17-jre-jammy
FROM ${BASE_IMAGE}

# Maintainer metadata
LABEL maintainer="tangtang777"

# Runtime params
ENV PARAMS=""

# Timezone
ENV TZ=PRC
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# App artifact
COPY target/ai-rag-knowledge-app.jar /ai-rag-knowledge-app.jar

ENTRYPOINT ["sh","-c","java -jar $JAVA_OPTS /ai-rag-knowledge-app.jar $PARAMS"]
