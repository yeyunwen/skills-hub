set shell := ["bash", "-cu"]

fmt:
    cargo fmt --all

fmt-check:
    cargo fmt --all -- --check

lint:
    cargo clippy --workspace --all-targets -- -D warnings

test:
    cargo test --workspace

check: fmt-check lint test

build:
    cargo build --workspace

release:
    cargo build -p skh-cli --release

run *args:
    cargo run -p skh-cli -- {{args}}

desktop-dev:
    pnpm desktop:dev

desktop-build:
    pnpm desktop:build

desktop-check:
    pnpm desktop:check
