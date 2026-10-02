use std::{env, fs, path::PathBuf};

fn main() {
    let build_env = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("../build.env");
    println!("cargo:rerun-if-changed={}", build_env.display());

    let contents = fs::read_to_string(&build_env)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", build_env.display()));

    for (index, line) in contents.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let (name, value) = line.split_once('=').unwrap_or_else(|| {
            panic!(
                "invalid entry in {} at line {}: expected NAME=VALUE",
                build_env.display(),
                index + 1
            )
        });
        let name = name.trim();
        let value = value.trim();
        assert!(
            !name.is_empty() && !value.is_empty(),
            "invalid empty name or value in {} at line {}",
            build_env.display(),
            index + 1
        );
        println!("cargo:rustc-env={name}={value}");
    }

    tauri_build::build()
}
