# Built by OSL once; yours to change. Two stages: build static binaries, run them on a minimal image.
FROM golang:1.26-alpine AS build
WORKDIR /app
COPY . .
RUN go mod tidy
RUN CGO_ENABLED=0 go build -o /out/server ./cmd/server
RUN CGO_ENABLED=0 go build -o /out/worker ./cmd/worker
RUN CGO_ENABLED=0 go build -o /out/seed ./cmd/seed

FROM gcr.io/distroless/static-debian12
WORKDIR /app
ENV PORT=8080
COPY --from=build /out/ /app/
EXPOSE 8080
CMD ["/app/server"]
