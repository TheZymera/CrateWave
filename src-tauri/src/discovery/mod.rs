pub mod archive_api;
pub mod query_builder;
pub mod ytdlp_search;

use crate::storage::{load_seen_ids, mark_ids_seen};
use rand::seq::SliceRandom;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::time::Duration;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DigMode {
    General,
    WorldAdventure,
    OnlyVocal,
    OnlyInstrumental,
}

fn default_card_count() -> u8 {
    6
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFilters {
    pub mode: DigMode,
    pub sample_type: String,
    pub region: String,
    pub decade: String,
    pub duration: String,
    pub genre: String,
    #[serde(default = "default_card_count")]
    pub card_count: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SampleCandidate {
    pub id: String,
    pub source: String,
    pub title: String,
    pub channel: String,
    pub duration_sec: u32,
    pub thumbnail_url: String,
    pub source_url: String,
    pub query_tag: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RollResponse {
    pub query_used: String,
    pub query_tag: String,
    pub candidates: Vec<SampleCandidate>,
}

fn url_encode_param(input: &str) -> String {
    let mut out = String::with_capacity(input.len() * 2);
    for b in input.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b',' => {
                out.push(b as char);
            }
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// Fast zero-auth JSON search on ccMixter (studio acapellas, vocal stems, instrumentals, world)
async fn search_ccmixter(
    query_tag: &str,
    filters: &SearchFilters,
    seen: &HashSet<String>,
) -> Vec<SampleCandidate> {
    let mut tags: Vec<&str> = match filters.mode {
        DigMode::OnlyVocal => vec!["acapella", "vocal"],
        DigMode::OnlyInstrumental => vec!["instrumental"],
        DigMode::WorldAdventure => vec!["world"],
        DigMode::General => vec!["sample"],
    };

    match filters.genre.as_str() {
        "jazz" => tags.push("jazz"),
        "funk" => tags.push("funk"),
        "soul" => tags.push("soul"),
        "rock" => tags.push("rock"),
        "electronic" => tags.push("electronic"),
        "hip_hop" => tags.push("hip_hop"),
        "latin" => tags.push("latin"),
        "ambient" => tags.push("ambient"),
        "classical" => tags.push("classical"),
        "folk" => tags.push("folk"),
        _ => {}
    }

    if filters.mode != DigMode::OnlyVocal && filters.mode != DigMode::WorldAdventure {
        match filters.sample_type.as_str() {
            "drums" => tags.push("drums"),
            "bass" => tags.push("bass"),
            "vocals" => tags.push("acapella"),
            "melody" => tags.push("piano"),
            _ => {}
        }
    }

    let offset = (rand::random::<u32>() % 120) as usize;
    let url = format!(
        "http://ccmixter.org/api/query?f=json&limit=14&offset={}&tags={}",
        offset,
        url_encode_param(&tags.join(","))
    );

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_millis(2400))
        .user_agent("CrateWave/2.0")
        .build()
    {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let resp = match client.get(&url).send().await {
        Ok(r) if r.status().is_success() => r,
        _ => return Vec::new(),
    };

    let items: Vec<Value> = match resp.json().await {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    let mut results = Vec::new();
    for item in items {
        let upload_id = item
            .get("upload_id")
            .and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
            .unwrap_or(0);
        if upload_id == 0 {
            continue;
        }

        let id = format!("ccm_{}", upload_id);
        if seen.contains(&id) {
            continue;
        }

        let title = item
            .get("upload_name")
            .and_then(|v| v.as_str())
            .unwrap_or("ccMixter Stem")
            .trim()
            .to_string();
        let channel = item
            .get("user_name")
            .and_then(|v| v.as_str())
            .unwrap_or("ccMixter")
            .trim()
            .to_string();

        let files = match item.get("files").and_then(|v| v.as_array()) {
            Some(f) => f,
            None => continue,
        };

        let audio_file = files.iter().find(|f| {
            let dl = f.get("download_url").and_then(|v| v.as_str()).unwrap_or("");
            let lower = dl.to_lowercase();
            lower.ends_with(".mp3") || lower.ends_with(".ogg") || lower.ends_with(".flac")
        });

        let Some(f) = audio_file else { continue };
        let Some(download_url) = f.get("download_url").and_then(|v| v.as_str()) else {
            continue;
        };

        let raw_bytes = f
            .get("file_rawsize")
            .and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
            .unwrap_or(1_200_000);
        let est_duration = ((raw_bytes / 16_000) as u32).clamp(15, 420);

        results.push(SampleCandidate {
            id,
            source: "ccmixter".to_string(),
            title,
            channel,
            duration_sec: est_duration,
            thumbnail_url: String::new(),
            source_url: download_url.to_string(),
            query_tag: query_tag.to_string(),
        });
    }

    results
}

#[tauri::command]
pub async fn roll_crate(app: AppHandle, filters: SearchFilters) -> Result<RollResponse, String> {
    let dict = query_builder::load_or_init_dictionary(&app);
    let seen = load_seen_ids(&app);
    let target_count = filters.card_count.clamp(1, 8) as usize;

    let is_vocal_shorts = filters.mode == DigMode::OnlyVocal && filters.duration == "shorts";

    let max_attempts = 2;
    let mut last_query = String::new();

    for _attempt in 1..=max_attempts {
        let built = query_builder::build_search_query(&filters, &dict);
        last_query = built.query.clone();

        if is_vocal_shorts {
            let mut yt_pool = ytdlp_search::search_youtube_flat(
                &app,
                &built.query,
                &built.query_tag,
                &filters,
                &seen,
            )
            .await
            .unwrap_or_default();

            if yt_pool.is_empty() {
                continue;
            }

            {
                let mut rng = rand::rng();
                yt_pool.shuffle(&mut rng);
            }

            let selected: Vec<SampleCandidate> = yt_pool.into_iter().take(target_count).collect();
            let new_ids: Vec<String> = selected.iter().map(|c| c.id.clone()).collect();
            let _ = mark_ids_seen(&app, &new_ids);

            return Ok(RollResponse {
                query_used: built.query,
                query_tag: built.query_tag,
                candidates: selected,
            });
        }

        // Fast HTTP APIs run unthrottled (~300ms); yt-dlp subprocesses are capped at 2.8s so rolls never stall
        let (ia_res, wc_res, ccm_pool, yt_res, sc_res) = tokio::join!(
            archive_api::search_internet_archive(&built.query, &built.query_tag, &filters, &seen),
            archive_api::search_wikimedia_commons(&built.query, &built.query_tag, &filters, &seen),
            search_ccmixter(&built.query_tag, &filters, &seen),
            tokio::time::timeout(
                Duration::from_millis(2800),
                ytdlp_search::search_youtube_flat(&app, &built.query, &built.query_tag, &filters, &seen)
            ),
            tokio::time::timeout(
                Duration::from_millis(2400),
                ytdlp_search::search_soundcloud_flat(&app, &built.query, &built.query_tag, &filters, &seen)
            )
        );

        let mut ia_pool = ia_res.unwrap_or_default();
        let mut wc_pool = wc_res.unwrap_or_default();
        let mut ccm_pool = ccm_pool;
        let mut yt_pool = yt_res.ok().and_then(|r| r.ok()).unwrap_or_default();
        let mut sc_pool = sc_res.ok().and_then(|r| r.ok()).unwrap_or_default();

        if ia_pool.is_empty()
            && wc_pool.is_empty()
            && ccm_pool.is_empty()
            && yt_pool.is_empty()
            && sc_pool.is_empty()
        {
            continue;
        }

        {
            let mut rng = rand::rng();
            ia_pool.shuffle(&mut rng);
            wc_pool.shuffle(&mut rng);
            ccm_pool.shuffle(&mut rng);
            yt_pool.shuffle(&mut rng);
            sc_pool.shuffle(&mut rng);
        }

        // Put instant-CDN sources first so track #1 loads in <1s, with YouTube/SoundCloud right behind
        let mut fast_pools = vec![ia_pool, ccm_pool, wc_pool];
        let mut slow_pools = vec![yt_pool, sc_pool];
        let mut selected: Vec<SampleCandidate> = Vec::with_capacity(target_count);

        while selected.len() < target_count {
            let mut added = false;
            for pool in &mut fast_pools {
                if selected.len() >= target_count {
                    break;
                }
                if let Some(item) = pool.pop() {
                    selected.push(item);
                    added = true;
                }
            }
            if !added {
                break;
            }
        }

        while selected.len() < target_count {
            let mut added = false;
            for pool in &mut slow_pools {
                if selected.len() >= target_count {
                    break;
                }
                if let Some(item) = pool.pop() {
                    selected.push(item);
                    added = true;
                }
            }
            if !added {
                break;
            }
        }

        if !selected.is_empty() {
            let new_ids: Vec<String> = selected.iter().map(|c| c.id.clone()).collect();
            let _ = mark_ids_seen(&app, &new_ids);

            return Ok(RollResponse {
                query_used: built.query,
                query_tag: built.query_tag,
                candidates: selected,
            });
        }
    }

    Err(format!(
        "No unseen samples found after {} auto-rerolls (last query: '{}').",
        max_attempts, last_query
    ))
}