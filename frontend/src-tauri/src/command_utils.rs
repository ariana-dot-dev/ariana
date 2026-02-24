use std::process::Command;

/// Creates a new Command with platform-specific configurations to prevent
/// console windows from appearing on Windows.
///
/// On Windows, this sets the CREATE_NO_WINDOW flag to prevent a terminal
/// window from popping up when the process is spawned.
///
/// # Example
/// ```
/// use command_utils::new_command;
///
/// let output = new_command("git")
///     .arg("status")
///     .output()?;
/// ```
pub fn new_command(program: impl AsRef<str>) -> Command {
    let program = program.as_ref();

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let mut cmd = Command::new(program);
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }

    #[cfg(not(target_os = "windows"))]
    {
        Command::new(program)
    }
}
