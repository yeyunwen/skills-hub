use anyhow::{Context, Result};
use pathdiff::diff_paths;
use std::fs;
use std::path::{Path, PathBuf};

/// 展开用户输入路径中的 `~`，并把相对路径转换成当前工作目录下的绝对路径。
pub fn expand_path(input: impl AsRef<str>) -> PathBuf {
    let input = input.as_ref();
    if input == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from(input));
    }
    if let Some(rest) = input.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    let path = PathBuf::from(input);
    if path.is_absolute() {
        path
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    }
}

/// 判断路径是否存在；封装成函数是为了让业务逻辑更容易读。
pub fn path_exists(path: impl AsRef<Path>) -> bool {
    path.as_ref().symlink_metadata().is_ok()
}

/// 递归复制目录。
///
/// 注意：这是安装/迁移时会写入用户目录的操作，因此调用方必须先完成冲突检查。
pub fn copy_dir(source: impl AsRef<Path>, target: impl AsRef<Path>, force: bool) -> Result<()> {
    let source = source.as_ref();
    let target = target.as_ref();
    if force && target.exists() {
        fs::remove_dir_all(target).with_context(|| format!("remove {}", target.display()))?;
    }
    fs::create_dir_all(
        target
            .parent()
            .with_context(|| format!("missing parent for {}", target.display()))?,
    )?;
    copy_dir_inner(source, target)?;
    let git_dir = target.join(".git");
    if git_dir.exists() {
        fs::remove_dir_all(git_dir)?;
    }
    Ok(())
}

fn copy_dir_inner(source: &Path, target: &Path) -> Result<()> {
    fs::create_dir_all(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        let meta = fs::symlink_metadata(&source_path)?;
        if meta.is_dir() && !meta.file_type().is_symlink() {
            copy_dir_inner(&source_path, &target_path)?;
        } else if meta.file_type().is_symlink() {
            let link_target = fs::read_link(&source_path)?;
            create_symlink(&link_target, &target_path)?;
        } else {
            fs::copy(&source_path, &target_path)?;
        }
    }
    Ok(())
}

/// 创建目录 symlink，优先使用相对路径，避免用户移动 home 目录或机器名变化后失效。
pub fn create_relative_symlink(
    target: impl AsRef<Path>,
    link_path: impl AsRef<Path>,
) -> Result<()> {
    let target = target.as_ref();
    let link_path = link_path.as_ref();
    fs::create_dir_all(
        link_path
            .parent()
            .with_context(|| format!("missing parent for {}", link_path.display()))?,
    )?;
    let parent = link_path.parent().unwrap_or_else(|| Path::new("."));
    let relative = diff_paths(target, parent).unwrap_or_else(|| target.to_path_buf());
    create_symlink(relative, link_path)
}

#[cfg(unix)]
fn create_symlink(target: impl AsRef<Path>, link_path: impl AsRef<Path>) -> Result<()> {
    std::os::unix::fs::symlink(target, link_path)?;
    Ok(())
}

#[cfg(windows)]
fn create_symlink(target: impl AsRef<Path>, link_path: impl AsRef<Path>) -> Result<()> {
    std::os::windows::fs::symlink_dir(target, link_path)?;
    Ok(())
}

/// 判断某个路径是否是指向目标目录的 symlink。
pub fn is_symlink_to(path: impl AsRef<Path>, target: impl AsRef<Path>) -> Result<bool> {
    let path = path.as_ref();
    let target = target.as_ref();
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(err) => return Err(err.into()),
    };
    if !meta.file_type().is_symlink() {
        return Ok(false);
    }
    Ok(fs::canonicalize(path)? == fs::canonicalize(target)?)
}

/// 把真实路径显示成带 `~` 的短路径，仅用于人类可读输出。
pub fn display_path(path: impl AsRef<Path>) -> String {
    let path = path.as_ref();
    if let Some(home) = dirs::home_dir() {
        if path == home {
            return "~".to_string();
        }
        if let Ok(rest) = path.strip_prefix(&home) {
            return format!("~/{}", rest.display());
        }
    }
    path.display().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_home_path() {
        let expanded = expand_path("~/.agents/skills");
        assert!(expanded.is_absolute());
        assert!(expanded.ends_with(".agents/skills"));
    }
}
