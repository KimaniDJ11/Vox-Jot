use std::path::Path;

fn main() {
    let bindings_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/bindings.ts");
    match vox_jot_app_lib::export_typescript_bindings(&bindings_path) {
        Ok(_) => println!(
            "Successfully generated/verified {}",
            bindings_path.display()
        ),
        Err(err) => {
            eprintln!("Error generating bindings: {err}");
            std::process::exit(1);
        }
    }
}
