pub mod archive_api;
pub mod query_builder;
pub mod ytdlp_search;

use crate::storage::{load_seen_ids, mark_ids_seen};
use rand::seq::SliceRandom;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DigMode {
    General,
    WorldAdventure,
    OnlyVocal,
    OnlyInstrumental,
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

#[tauri::command]
pub async fn roll_crate(app: AppHandle, filters: SearchFilters) -> Result<RollResponse, String> {
    let dict = query_builder::load_or_init_dictionary(&app);
    let seen = load_seen_ids(&app);
    let target_count = filters.card_count.clamp(2, 4) as usize;

    let is_vocal_shorts = filters.mode == DigMode::OnlyVocal && filters.duration == "shorts";

    let max_attempts = 2;
    let mut last_query = String::new();

    for _attempt in 1..=max_attempts {
        let built = query_builder::build_search_query(&filters, &dict);
        last_query = built.query.clone();

        // Vocal Shorts (<60s) uses YouTube exclusively
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

        // All other modes: stack YouTube + SoundCloud + Internet Archive + Wikimedia in parallel
        let (yt_res, sc_res, ia_res, wc_res) = tokio::join!(
            ytdlp_search::search_youtube_flat(&app, &built.query, &built.query_tag, &filters, &seen),
            ytdlp_search::search_soundcloud_flat(&app, &built.query, &built.query_tag, &filters, &seen),
            archive_api::search_internet_archive(&built.query, &built.query_tag, &filters, &seen),
            archive_api::search_wikimedia_commons(&built.query, &built.query_tag, &filters, &seen)
        );

        let mut yt_pool = yt_res.unwrap_or_default();
        let mut sc_pool = sc_res.unwrap_or_default();
        let mut ia_pool = ia_res.unwrap_or_default();
        let mut wc_pool = wc_res.unwrap_or_default();

        if yt_pool.is_empty() && sc_pool.is_empty() && ia_pool.is_empty() && wc_pool.is_empty() {
            continue;
        }

        {
            let mut rng = rand::rng();
            yt_pool.shuffle(&mut rng);
            sc_pool.shuffle(&mut rng);
            ia_pool.shuffle(&mut rng);
            wc_pool.shuffle(&mut rng);
        }

        // Interleave across all non-empty sources so every roll gets high-relevance multi-source diversity
        let mut selected: Vec<SampleCandidate> = Vec::with_capacity(target_count);
        let mut pools = vec![yt_pool, sc_pool, ia_pool, wc_pool];

        while selected.len() < target_count {
            let mut added_in_pass = false;
            for pool in &mut pools {
                if selected.len() >= target_count {
                    break;
                }
                if let Some(item) = pool.pop() {
                    selected.push(item);
                    added_in_pass = true;
                }
            }
            if !added_in_pass {
                break;
            }
        }

        if !selected.is_empty() {
            {
                let mut rng = rand::rng();
                selected.shuffle(&mut rng);
            }

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