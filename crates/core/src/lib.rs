//! skills-hub 的 Rust 核心库。
//!
//! 这里不包含 CLI/UI 逻辑，CLI 和 Tauri GUI 都通过这些 API 复用业务能力。
//! 代码里保留关键中文注释，方便不熟悉 Rust 的 Node.js 全栈开发者维护。

mod agent;
mod config;
mod environment;
mod fs_utils;
mod git;
mod logging;
mod remote;
mod skill;
mod source;

pub use agent::*;
pub use config::*;
pub use environment::*;
pub use fs_utils::*;
pub use git::*;
pub use logging::*;
pub use remote::*;
pub use skill::*;
pub use source::*;
