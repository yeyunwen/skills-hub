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
    # macOS dev mode renders raw ICNS data larger than the bundled app; use the padded PNG.
    pnpm --dir apps/desktop tauri dev --config '{"bundle":{"icon":["icons/icon.png"]}}'

desktop-build:
    # Local packages do not need updater artifacts; signed updater packages are built by release.yml.
    pnpm --dir apps/desktop tauri build --config '{"bundle":{"createUpdaterArtifacts":false}}'
    @echo "Built app: target/release/bundle/macos/Skills Hub.app"
    @echo "This does not replace /Applications/skills-hub.app; use 'just desktop-open' to run this build."

desktop-open: desktop-build
    open -n "target/release/bundle/macos/Skills Hub.app"

desktop-check:
    pnpm desktop:check
