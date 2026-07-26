//! skills-hub 的 Rust 核心库。
//!
//! 这里不包含 CLI/UI 逻辑，未来 Tauri GUI 也应该直接复用这些 API。
//! 代码里保留关键中文注释，方便不熟悉 Rust 的 Node.js 全栈开发者维护。

mod agent;
mod config;
mod fs_utils;
mod git;
mod logging;
mod remote;
mod skill;
mod source;

pub use agent::*;
pub use config::*;
pub use fs_utils::*;
pub use git::*;
pub use logging::*;
pub use remote::*;
pub use skill::*;
pub use source::*;
