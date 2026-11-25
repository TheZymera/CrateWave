use crate::discovery::extra_sources::shared_http_client;
use crate::discovery::{DigMode, SampleCandidate, SearchFilters};
use serde::Deserialize;
use std::collections::HashSet;
use std::time::Duration;

#[derive(Debug, Deserialize)]
struct IaSearchResponse {
    response: IaResponseBody,
}

#[derive(Debug, Deserialize)]
struct IaResponseBody {
    docs: Vec<IaDoc>,
}

#[derive(Debug, Deserialize)]
struct IaDoc {
    identifier: String,
    title: Option<String>,
    creator: Option<serde_json::Value>,
    date: Option<String>,
    runtime: Option<serde_json::Value>,
}

fn extract_creator(val: Option<serde_json::Value>) -> String {
    match val {
        Some(serde_json::Value::String(s)) => s,
        Some(serde_json::Value::Array(arr)) => arr
            .first()
            .and_then(|v| v.as_str())
            .unwrap_or("Internet Archive")
            .to_string(),
        _ => "Internet Archive".to_string(),
    }
}

fn parse_ia_runtime(val: Option<serde_json::Value>) -> Option<u32> {
    let raw = match val {
        Some(serde_json::Value::String(s)) => s,
        Some(serde_json::Value::Number(n)) => return n.as_u64().map(|v| v as u32),
        Some(serde_json::Value::Array(arr)) => arr.first()?.as_str()?.to_string(),
        _ => return None,
    };

    let parts: Vec<&str> = raw.split(':').collect();
    match parts.len() {
        1 => parts[0].parse::<f64>().ok().map(|s| s.round() as u32),
        2 => {
            let m = parts[0].parse::<u32>().ok()?;
            let s = parts[1].parse::<u32>().ok()?;
            Some(m * 60 + s)
        }
        3 => {
            let h = parts[0].parse::<u32>().ok()?;
            let m = parts[1].parse::<u32>().ok()?;
            let s = parts[2].parse::<u32>().ok()?;
            Some(h * 3600 + m * 60 + s)
        }
        _ => None,
    }
}

/// Extracts clean, high-signal search keywords (keeps exact topic words, drops filler/years).
pub fn extract_core_keywords(query: &str) -> Vec<String> {
    let stop_words = [
        "vinyl", "rip", "rare", "groove", "full", "album", "track", "obscure",
        "record", "original", "pressing", "deep", "cut", "studio", "session",
        "sample", "this", "raw", "only", "no", "vocals", "music", "shorts",
    ];

    query
        .replace("#shorts", "")
        .split_whitespace()
        .map(|w| w.trim_matches(|c: char| !c.is_alphabetic()).to_lowercase())
        .filter(|w| w.len() >= 3 && !stop_words.contains(&w.as_str()))
        .take(3)
        .collect()
}

/// Searches Internet Archive music collections with page 1-2 weighting so niche queries always hit.
pub async fn search_internet_archive(
    query: &str,
    query_tag: &str,
    filters: &SearchFilters,
    seen_ids: &HashSet<String>,
) -> Result<Vec<SampleCandidate>, String> {
    if filters.mode == DigMode::OnlyVocal && filters.duration == "shorts" {
        return Ok(Vec::new());
    }

    let keywords = extract_core_keywords(query);
    if keywords.is_empty() {
        return Ok(Vec::new());
    }

    let page_str = if rand::random::<f32>() < 0.75 { "1" } else { "2" };
    let client = shared_http_client();

    let terms_clause = keywords.join(" OR ");
    let q_string = format!(
        "({}) AND mediatype:(audio) AND collection:(78rpm OR audio_music OR netlabels OR etree OR opensource_audio) AND -title:(FM) AND -title:(Radio) AND -title:(Podcast) AND -title:(Show) AND -title:(Interview) AND -title:(Audiobook)",
        terms_clause
    );

    let resp = client
        .get("https://archive.org/advancedsearch.php")
        .timeout(Duration::from_millis(8000))
        .query(&[
            ("q", q_string.as_str()),
            ("fl[]", "identifier"),
            ("fl[]", "title"),
            ("fl[]", "creator"),
            ("fl[]", "date"),
            ("fl[]", "runtime"),
            ("rows", "25"),
            ("page", page_str),
            ("output", "json"),
        ])
        .send()
        .await
        .map_err(|e| format!("IA request error: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("IA HTTP {}", resp.status()));
    }

    let parsed = resp
        .json::<IaSearchResponse>()
        .await
        .map_err(|e| format!("IA JSON error: {e}"))?;

    let mut results = Vec::new();
    for doc in parsed.response.docs {
        let candidate_id = format!("ia_{}", doc.identifier);
        if seen_ids.contains(&candidate_id) {
            continue;
        }

        let title = doc.title.unwrap_or_else(|| doc.identifier.clone());
        let duration_sec = parse_ia_runtime(doc.runtime).unwrap_or(0);

        if filters.duration != "long" && duration_sec > 720 {
            continue;
        }
        if filters.duration == "shorts" && duration_sec > 65 {
            continue;
        }
        if filters.duration == "medium" && (duration_sec <= 60 || duration_sec > 300) {
            continue;
        }
        if filters.duration == "long" && duration_sec <= 300 {
            continue;
        }

        let creator = extract_creator(doc.creator);
        let year_hint = doc
            .date
            .as_deref()
            .and_then(|d| d.get(0..4))
            .unwrap_or("Archive");

        let source_url = format!("https://archive.org/details/{}", doc.identifier);
        let thumbnail_url = format!("https://archive.org/services/img/{}", doc.identifier);

        results.push(SampleCandidate {
            id: candidate_id,
            source: "internet_archive".to_string(),
            title,
            channel: format!("{} ({})", creator, year_hint),
            duration_sec,
            thumbnail_url,
            source_url,
            query_tag: format!("{} • IA", query_tag),
        });
    }

    Ok(results)
}

#[derive(Debug, Deserialize)]
struct CommonsResponse {
    query: Option<CommonsQueryBody>,
}

#[derive(Debug, Deserialize)]
struct CommonsQueryBody {
    search: Vec<CommonsSearchItem>,
}

#[derive(Debug, Deserialize)]
struct CommonsSearchItem {
    title: String,
    size: Option<u64>,
}

/// Searches Wikimedia Commons (`filetype:audio`) with spoken-word rejection.
pub async fn search_wikimedia_commons(
    query: &str,
    query_tag: &str,
    filters: &SearchFilters,
    seen_ids: &HashSet<String>,
) -> Result<Vec<SampleCandidate>, String> {
    if filters.mode == DigMode::OnlyVocal && filters.duration == "shorts" {
        return Ok(Vec::new());
    }

    let keywords = extract_core_keywords(query);
    if keywords.is_empty() {
        return Ok(Vec::new());
    }

    let offset_str = (rand::random::<u32>() % 12).to_string();
    let client = shared_http_client();
    let srsearch = format!("filetype:audio {}", keywords.join(" "));

    let resp = client
        .get("https://commons.wikimedia.org/w/api.php")
        .timeout(Duration::from_millis(4500))
        .query(&[
            ("action", "query"),
            ("list", "search"),
            ("srsearch", srsearch.as_str()),
            ("srnamespace", "6"),
            ("srlimit", "15"),
            ("sroffset", offset_str.as_str()),
            ("format", "json"),
        ])
        .send()
        .await
        .map_err(|e| format!("WC request error: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("WC HTTP {}", resp.status()));
    }

    let items = resp
        .json::<CommonsResponse>()
        .await
        .ok()
        .and_then(|p| p.query)
        .map(|b| b.search)
        .unwrap_or_default();

    let mut results = Vec::new();
    for item in items {
        if item.size.unwrap_or(0) < 180_000 {
            continue;
        }

        let lower_raw = item.title.to_lowercase();
        if lower_raw.contains("pronunciation")
            || lower_raw.starts_with("file:en-")
            || lower_raw.starts_with("file:de-")
            || lower_raw.starts_with("file:fr-")
            || lower_raw.starts_with("file:ru-")
            || lower_raw.contains("spoken")
            || lower_raw.contains("wikipedia")
            || lower_raw.contains("librivox")
        {
            continue;
        }

        let cid = format!("wc_{}", item.title.replace(' ', "_"));
        if seen_ids.contains(&cid) {
            continue;
        }

        let display_title = item
            .title
            .strip_prefix("File:")
            .unwrap_or(&item.title)
            .rsplit_once('.')
            .map(|(name, _)| name.replace('_', " "))
            .unwrap_or_else(|| item.title.clone());

        let encoded_title = item.title.replace(' ', "_");
        let source_url = format!("https://commons.wikimedia.org/wiki/{}", encoded_title);

        results.push(SampleCandidate {
            id: cid,
            source: "wikimedia".to_string(),
            title: display_title,
            channel: "Wikimedia Commons".to_string(),
            duration_sec: 90,
            thumbnail_url: String::new(),
            source_url,
            query_tag: format!("{} • WC", query_tag),
        });
    }

    Ok(results)
}