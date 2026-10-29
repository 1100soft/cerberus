fn main() {
    if let Some(code) = gitcerberus_lib::tracked_git_main() {
        std::process::exit(code);
    }
    if let Some(code) = gitcerberus_lib::feedback_cli_main() {
        std::process::exit(code);
    }
    gitcerberus_lib::run();
}
