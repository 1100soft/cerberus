fn main() {
    if let Some(code) = gitcerberus_lib::tracked_git_main() {
        std::process::exit(code);
    }
    gitcerberus_lib::run();
}
