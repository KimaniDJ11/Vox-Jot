pub fn normalize_locale(locale: Option<&str>) -> Option<String> {
    locale
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.replace('_', "-"))
}

pub fn locale_language(locale: &str) -> String {
    locale
        .split(['-', '_'])
        .next()
        .unwrap_or(locale)
        .to_ascii_lowercase()
}

pub fn locale_matches(lhs: Option<&str>, rhs: Option<&str>) -> bool {
    match (lhs, rhs) {
        (Some(lhs), Some(rhs)) => lhs.eq_ignore_ascii_case(rhs),
        _ => false,
    }
}

pub fn chunk_text(text: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();

    for paragraph in text.split("\n\n") {
        let trimmed = paragraph.trim();
        if trimmed.is_empty() {
            continue;
        }

        if trimmed.chars().count() > 1200 {
            for sentence in split_sentences(trimmed) {
                push_chunk(&mut chunks, &mut current, &sentence, 1200);
            }
        } else {
            push_chunk(&mut chunks, &mut current, trimmed, 1200);
        }
    }

    if !current.trim().is_empty() {
        chunks.push(current.trim().to_string());
    }

    if chunks.is_empty() && !text.trim().is_empty() {
        chunks.push(text.trim().to_string());
    }

    chunks
}

fn split_sentences(text: &str) -> Vec<String> {
    let mut segments = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        current.push(ch);
        if matches!(ch, '.' | '!' | '?' | '\n') {
            if !current.trim().is_empty() {
                segments.push(current.trim().to_string());
            }
            current.clear();
        }
    }

    if !current.trim().is_empty() {
        segments.push(current.trim().to_string());
    }

    segments
}

fn push_chunk(chunks: &mut Vec<String>, current: &mut String, candidate: &str, max_len: usize) {
    let candidate = candidate.trim();
    if candidate.is_empty() {
        return;
    }

    if current.is_empty() {
        if candidate.chars().count() <= max_len {
            current.push_str(candidate);
            return;
        }

        for hard_chunk in hard_split(candidate, max_len) {
            chunks.push(hard_chunk);
        }
        return;
    }

    let proposed = format!("{current}\n\n{candidate}");
    if proposed.chars().count() <= max_len {
        *current = proposed;
        return;
    }

    chunks.push(current.trim().to_string());
    current.clear();

    if candidate.chars().count() <= max_len {
        current.push_str(candidate);
    } else {
        for hard_chunk in hard_split(candidate, max_len) {
            chunks.push(hard_chunk);
        }
    }
}

fn hard_split(text: &str, max_len: usize) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();

    for word in text.split_whitespace() {
        let proposed = if current.is_empty() {
            word.to_string()
        } else {
            format!("{current} {word}")
        };

        if proposed.chars().count() <= max_len {
            current = proposed;
        } else {
            if !current.is_empty() {
                chunks.push(current.trim().to_string());
            }
            current = word.to_string();
        }
    }

    if !current.trim().is_empty() {
        chunks.push(current.trim().to_string());
    }

    chunks
}
