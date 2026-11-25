use crate::discovery::archive_api::extract_core_keywords;
use crate::discovery::{DigMode, SampleCandidate, SearchFilters};
use serde_json::Value;
use std::collections::HashSet;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

static SHARED_HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

pub fn shared_http_client() -> &'static reqwest::Client {
    SHARED_HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .pool_max_idle_per_host(8)
            .pool_idle_timeout(Duration::from_secs(90))
            .timeout(Duration::from_secs(9))
            .user_agent("CrateWave/2.0")
            .build()
            .expect("Failed to build shared HTTP client")
    })
}

pub fn normalize_key(input: &str) -> String {
    input
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

/// Strips standalone 4-digit years (e.g. "1966") so iTunes/Deezer match artist/song catalogs cleanly.
fn strip_year_tokens(query: &str) -> String {
    let cleaned: Vec<&str> = query
        .split_whitespace()
        .filter(|w| {
            !(w.len() == 4
                && w.chars().all(|c| c.is_ascii_digit())
                && (w.starts_with("19") || w.starts_with("20")))
        })
        .collect();
    if cleaned.is_empty() {
        query.to_string()
    } else {
        cleaned.join(" ")
    }
}

fn release_year_matches_filters(release_date: &str, filters: &SearchFilters) -> bool {
    if filters.decade == "all" {
        return true;
    }

    let Some(year) = release_date.get(0..4).and_then(|y| y.parse::<u32>().ok()) else {
        return false;
    };

    match filters.decade.as_str() {
        "1950s" => (1950..=1959).contains(&year),
        "1960s" => (1960..=1969).contains(&year),
        "1970s" => (1970..=1979).contains(&year),
        "1980s" => (1980..=1989).contains(&year),
        "1990s" => (1990..=1999).contains(&year),
        "2000s" => (2000..=2009).contains(&year),
        "2010s" => (2010..=2019).contains(&year),
        "2020s" => year >= 2020,
        _ => true,
    }
}

/// Fast Vintage-Filtered CDN: iTunes Search API (max 1 track per album, artist, and title)
pub async fn search_itunes(
    query: &str,
    query_tag: &str,
    filters: &SearchFilters,
    seen_ids: &HashSet<String>,
) -> Result<Vec<SampleCandidate>, String> {
    if (filters.mode == DigMode::OnlyVocal && filters.duration == "shorts")
        || filters.duration == "long"
    {
        return Ok(Vec::new());
    }

    let search_term = strip_year_tokens(query);
    let client = shared_http_client();
    let resp = client
        .get("https://itunes.apple.com/search")
        .timeout(Duration::from_millis(6500))
        .query(&[
            ("term", search_term.as_str()),
            ("media", "music"),
            ("entity", "song"),
            ("limit", "30"),
        ])
        .send()
        .await
        .map_err(|e| format!("iTunes request error: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("iTunes HTTP {}", resp.status()));
    }

    let json: Value = resp
        .json()
        .await
        .map_err(|e| format!("iTunes JSON error: {e}"))?;

    let items = json
        .get("results")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut seen_albums: HashSet<u64> = HashSet::new();
    let mut seen_artists: HashSet<String> = HashSet::new();
    let mut seen_titles: HashSet<String> = HashSet::new();
    let mut strict_era = Vec::new();
    let mut fallback_all = Vec::new();

    for item in items {
        let Some(preview_url) = item.get("previewUrl").and_then(|v| v.as_str()) else {
            continue;
        };
        if preview_url.is_empty() {
            continue;
        }

        let track_id = item.get("trackId").and_then(|v| v.as_u64()).unwrap_or(0);
        if track_id == 0 {
            continue;
        }
        let cid = format!("itn_{track_id}");
        if seen_ids.contains(&cid) {
            continue;
        }

        if let Some(col_id) = item.get("collectionId").and_then(|v| v.as_u64()) {
            if !seen_albums.insert(col_id) {
                continue;
            }
        }

        let title = item
            .get("trackName")
            .and_then(|v| v.as_str())
            .unwrap_or("Untitled Track")
            .trim()
            .to_string();
        let artist = item
            .get("artistName")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown Artist")
            .trim()
            .to_string();

        if !seen_titles.insert(normalize_key(&title))
            || !seen_artists.insert(normalize_key(&artist))
        {
            continue;
        }

        let release_date = item
            .get("releaseDate")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let year = release_date.get(0..4).unwrap_or("");
        let channel = if year.is_empty() {
            artist
        } else {
            format!("{artist} ({year})")
        };

        let thumb = item
            .get("artworkUrl100")
            .and_then(|v| v.as_str())
            .map(|u| u.replace("100x100bb", "600x600bb"))
            .unwrap_or_default();

        let cand = SampleCandidate {
            id: cid,
            source: "itunes".to_string(),
            title,
            channel,
            duration_sec: 30,
            thumbnail_url: thumb,
            source_url: preview_url.to_string(),
            query_tag: format!("{query_tag} • ITN"),
        };

        if release_year_matches_filters(release_date, filters) {
            strict_era.push(cand);
        } else {
            fallback_all.push(cand);
        }
    }

    if !strict_era.is_empty() {
        Ok(strict_era)
    } else {
        Ok(fallback_all)
    }
}

/// Fast Backup CDN: Deezer Public Search API (max 1 track per album, artist, and title)
pub async fn search_deezer(
    query: &str,
    query_tag: &str,
    filters: &SearchFilters,
    seen_ids: &HashSet<String>,
) -> Result<Vec<SampleCandidate>, String> {
    if (filters.mode == DigMode::OnlyVocal && filters.duration == "shorts")
        || filters.duration == "long"
    {
        return Ok(Vec::new());
    }

    let search_term = strip_year_tokens(query);
    let offset = if rand::random::<f32>() < 0.75 { "0" } else { "15" };
    let client = shared_http_client();

    let resp = client
        .get("https://api.deezer.com/search")
        .timeout(Duration::from_millis(6500))
        .query(&[("q", search_term.as_str()), ("limit", "25"), ("index", offset)])
        .send()
        .await
        .map_err(|e| format!("Deezer request error: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Deezer HTTP {}", resp.status()));
    }

    let json: Value = resp
        .json()
        .await
        .map_err(|e| format!("Deezer JSON error: {e}"))?;

    let items = json
        .get("data")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut seen_albums: HashSet<u64> = HashSet::new();
    let mut seen_artists: HashSet<String> = HashSet::new();
    let mut seen_titles: HashSet<String> = HashSet::new();
    let mut results = Vec::new();

    for item in items {
        let Some(preview_url) = item.get("preview").and_then(|v| v.as_str()) else {
            continue;
        };
        if preview_url.is_empty() {
            continue;
        }

        let track_id = item.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
        if track_id == 0 {
            continue;
        }
        let cid = format!("dzr_{track_id}");
        if seen_ids.contains(&cid) {
            continue;
        }

        if let Some(alb_id) = item
            .get("album")
            .and_then(|a| a.get("id"))
            .and_then(|v| v.as_u64())
        {
            if !seen_albums.insert(alb_id) {
                continue;
            }
        }

        let title = item
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("Untitled Track")
            .trim()
            .to_string();
        let artist = item
            .get("artist")
            .and_then(|a| a.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or("Deezer Artist")
            .trim()
            .to_string();

        if !seen_titles.insert(normalize_key(&title))
            || !seen_artists.insert(normalize_key(&artist))
        {
            continue;
        }

        let thumb = item
            .get("album")
            .and_then(|a| {
                a.get("cover_big")
                    .or_else(|| a.get("cover_medium"))
                    .or_else(|| a.get("cover"))
            })
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        results.push(SampleCandidate {
            id: cid,
            source: "deezer".to_string(),
            title,
            channel: artist,
            duration_sec: 30,
            thumbnail_url: thumb,
            source_url: preview_url.to_string(),
            query_tag: format!("{query_tag} • DZR"),
        });
    }

    Ok(results)
}

async fn query_openverse_raw(q: &str, page: &str) -> Result<Vec<Value>, String> {
    let client = shared_http_client();
    let resp = client
        .get("https://api.openverse.org/v1/audio/")
        .timeout(Duration::from_millis(5500))
        .query(&[("q", q), ("page_size", "20"), ("page", page)])
        .send()
        .await
        .map_err(|e| format!("Openverse request error: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Openverse HTTP {}", resp.status()));
    }

    let json: Value = resp
        .json()
        .await
        .map_err(|e| format!("Openverse JSON error: {e}"))?;

    Ok(json
        .get("results")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default())
}

/// Drums & FX only: Openverse API (skips uncompressed .wav/.flac so downloads stay fast)
pub async fn search_openverse(
    query: &str,
    query_tag: &str,
    filters: &SearchFilters,
    seen_ids: &HashSet<String>,
) -> Result<Vec<SampleCandidate>, String> {
    let keywords = extract_core_keywords(query);
    if keywords.is_empty() {
        return Ok(Vec::new());
    }

    let t0 = Instant::now();
    let page = if rand::random::<f32>() < 0.75 { "1" } else { "2" };
    let primary_q = keywords.iter().take(2).cloned().collect::<Vec<_>>().join(" ");
    let mut items = query_openverse_raw(&primary_q, page).await?;

    if items.is_empty() && keywords.len() > 1 && t0.elapsed() < Duration::from_millis(2800) {
        if let Some(core_kw) = keywords.last() {
            if let Ok(fb) = query_openverse_raw(core_kw, "1").await {
                items = fb;
            }
        }
    }

    let mut seen_creators: HashSet<String> = HashSet::new();
    let mut seen_titles: HashSet<String> = HashSet::new();
    let mut results = Vec::new();

    for item in items {
        let Some(raw_id) = item.get("id").and_then(|v| v.as_str()) else {
            continue;
        };
        let cid = format!("opv_{raw_id}");
        if seen_ids.contains(&cid) {
            continue;
        }

        let Some(audio_url) = item.get("url").and_then(|v| v.as_str()) else {
            continue;
        };
        let lower_url = audio_url.split('?').next().unwrap_or(audio_url).to_lowercase();
        if !lower_url.starts_with("http")
            || lower_url.contains("wikimedia.org")
            || lower_url.ends_with(".wav")
            || lower_url.ends_with(".flac")
        {
            continue;
        }

        let duration_sec = item
            .get("duration")
            .and_then(|v| v.as_u64())
            .map(|ms| (ms / 1000) as u32)
            .unwrap_or(30);

        if duration_sec < 3 || duration_sec > 300 {
            continue;
        }
        if filters.duration == "shorts" && duration_sec > 65 {
            continue;
        }

        let title = item
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("Openverse Audio")
            .trim()
            .to_string();
        let creator = item
            .get("creator")
            .and_then(|v| v.as_str())
            .unwrap_or("Openverse")
            .trim()
            .to_string();

        if !seen_titles.insert(normalize_key(&title))
            || !seen_creators.insert(normalize_key(&creator))
        {
            continue;
        }

        let thumb = item
            .get("thumbnail")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        results.push(SampleCandidate {
            id: cid,
            source: "openverse".to_string(),
            title,
            channel: creator,
            duration_sec,
            thumbnail_url: thumb,
            source_url: audio_url.to_string(),
            query_tag: format!("{query_tag} • OPV"),
        });
    }

    Ok(results)
}