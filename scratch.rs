fn main() {
    let s1 = "Straße";
    let s2 = "STRASSE";
    println!("to_lowercase: {} == {}", s1.to_lowercase(), s2.to_lowercase());
    println!("to_uppercase().to_lowercase(): {} == {}", s1.to_uppercase().to_lowercase(), s2.to_uppercase().to_lowercase());
}
