# Build for host architecture (no --platform) to avoid exec format error on ARM
FROM eclipse-temurin:17-jdk-alpine AS builder
WORKDIR /build

# Layer 1: POM only — cached when pom.xml unchanged
COPY backend/pom.xml ./
RUN apk add --no-cache maven && mvn -q dependency:go-offline -B

# Layer 2: source — only this layer rebuilds on code changes
COPY backend/src ./src
RUN mvn -q -DskipTests package

FROM eclipse-temurin:17-jre-alpine
WORKDIR /app
COPY --from=builder /build/target/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
