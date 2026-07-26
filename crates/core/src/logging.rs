use crate::{default_logs_dir, load_config};
use anyhow::Result;
use chrono::Utc;
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;

/// 单条操作日志。
///
/// GUI 运行时用户看不到完整终端输出，因此关键操作需要写入本地日志文件，
/// 方便之后排查 Git clone、SSH、同步和迁移失败原因。
#[derive(Debug, Serialize)]
struct OperationLogEntry<'a> {
    /// ISO 时间戳，统一使用 UTC，避免跨设备同步时出现时区歧义。
    timestamp: String,
    /// 日志级别，例如 info / error。
    level: &'a str,
    /// 操作名称，例如 source.scan / agents.sync。
    operation: &'a str,
    /// 简短的人类可读信息。
    message: &'a str,
}

/// 返回当前应该写入的日志目录。
///
/// 如果配置文件尚未初始化或旧配置缺少 logs_dir，就回退到默认目录，保证日志不会因为配置迁移失败而丢失。
pub fn logs_dir() -> Result<std::path::PathBuf> {
    Ok(load_config()
        .map(|config| config.logs_dir)
        .unwrap_or_else(|_| default_logs_dir()))
}

/// 追加一条 JSON Lines 操作日志到 `desktop.log`。
///
/// 这里使用 append-only 文件，避免 GUI 进程异常退出时破坏已有日志；每行是一条 JSON，后续可以很容易接入日志查看器。
pub fn append_operation_log(level: &str, operation: &str, message: &str) -> Result<()> {
    let dir = logs_dir()?;
    fs::create_dir_all(&dir)?;
    let path = dir.join("desktop.log");
    let entry = OperationLogEntry {
        timestamp: Utc::now().to_rfc3339(),
        level,
        operation,
        message,
    };
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(file, "{}", serde_json::to_string(&entry)?)?;
    Ok(())
}
