pub mod archive_api;
pub mod extra_sources;
pub mod query_builder;
pub mod ytdlp_search;

use crate::discovery::extra_sources::normalize_key;
use crate::logger::SessionLogger;
use crate::storage::{load_quarantined_ids, load_seen_ids, mark_ids_seen};
use rand::seq::SliceRandom;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, State};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DigMode {
    General,
    WorldAdventure,
    OnlyVocal,
    OnlyInstrumental,
}

fn default_card_count() -> u8 {
    4
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

const CIRCUIT_FAILURE_THRESHOLD: u8 = 5;
const CIRCUIT_COOLDOWN: Duration = Duration::from_secs(120);

#[derive(Default)]
struct ProviderHealth {
    consecutive_failures: u8,
    tripped_until: Option<Instant>,
}

#[derive(Default)]
struct DiscoveryBrain {
    health: HashMap<String, ProviderHealth>,
    recent_queries: VecDeque<String>,
    recent_channels: VecDeque<String>,
    recent_sources: VecDeque<String>,
    seen_titles: HashSet<String>,
    last_tag: Option<String>,
}

impl DiscoveryBrain {
    fn is_available(&mut self, provider: &str, logger: &SessionLogger) -> bool {
        let Some(entry) = self.health.get_mut(provider) else {
            return true;
        };
        if let Some(until) = entry.tripped_until {
            if Instant::now() < until {
                return false;
            }
            entry.tripped_until = None;
            entry.consecutive_failures = 0;
            logger.write_line(
                "INFO",
                "RUST",
                "CIRCUIT_RECOVER",
                &format!("Provider '{provider}' cooldown expired; re-enabling"),
                None,
            );
        }
        true
    }

    fn record_outcome(&mut self, provider: &str, ok: bool, logger: &SessionLogger) {
        let entry = self.health.entry(provider.to_string()).or_default();
        if ok {
            entry.consecutive_failures = 0;
            return;
        }
        entry.consecutive_failures = entry.consecutive_failures.saturating_add(1);
        if entry.consecutive_failures >= CIRCUIT_FAILURE_THRESHOLD {
            entry.tripped_until = Some(Instant::now() + CIRCUIT_COOLDOWN);
            logger.write_line(
                "WARN",
                "RUST",
                "CIRCUIT_OPEN",
                &format!("Provider '{provider}' tripped after 5 failures; bypassing for 2m"),
                None,
            );
        }
    }

    fn remember_query(&mut self, query: &str, tag: &str) {
        self.recent_queries.push_back(query.to_string());
        if self.recent_queries.len() > 35 {
            self.recent_queries.pop_front();
        }
        self.last_tag = Some(tag.to_string());
    }

    fn remember_selected(&mut self, items: &[SampleCandidate]) {
        for item in items {
            let chan = normalize_key(&item.channel);
            if !chan.is_empty() {
                self.recent_channels.push_back(chan);
                if self.recent_channels.len() > 24 {
                    self.recent_channels.pop_front();
                }
            }
            let title_key = normalize_key(&item.title);
            if !title_key.is_empty() {
                self.seen_titles.insert(title_key);
            }
            self.recent_sources.push_back(item.source.clone());
            if self.recent_sources.len() > 2 {
                self.recent_sources.pop_front();
            }
        }
    }
}

static BRAIN: OnceLock<Mutex<DiscoveryBrain>> = OnceLock::new();

fn brain() -> &'static Mutex<DiscoveryBrain> {
    BRAIN.get_or_init(|| Mutex::new(DiscoveryBrain::default()))
}

/// Filters out video essays, vinyl vloggers, documentaries, podcasts, recitals, and mode violations.
fn passes_quality_and_mode(c: &SampleCandidate, filters: &SearchFilters) -> bool {
    let t = c.title.to_lowercase();
    let bad_keywords = [
        "podcast",
        "interview",
        "audiobook",
        "lecture",
        "sermon",
        "tutorial",
        "lesson",
        "how to",
        "episode",
        "radio show",
        " fm ",
        "brief history",
        "history of",
        "summarization",
        "documentary",
        "explained",
        "review",
        "reaction",
        "video essay",
        "tier list",
        "top 10",
        "top 5",
        "unboxing",
        "recommends",
        "vinyls",
        "releases!",
        "records to",
        "vinyl haul",
        "my collection",
        "full album mix",
        "1 hour",
        "2 hour",
        "compilation mix",
        "karaoke",
        "ringtone",
        "lullaby",
        "sleep music",
        "white noise",
    ];
    if bad_keywords.iter().any(|kw| t.contains(kw)) {
        return false;
    }

    if filters.genre != "classical" {
        let recital_keywords = [
            " op. ",
            " op.",
            "adagio",
            "allegro",
            "andante",
            "sonata",
            "symphony",
            "concerto",
            "polska",
            "långdans",
            "minuet",
            "nocturne",
            "etude",
            "prelude in ",
        ];
        if recital_keywords.iter().any(|kw| t.contains(kw)) {
            return false;
        }
    }

    if filters.duration != "long" && c.duration_sec > 600 {
        return false;
    }

    match filters.mode {
        DigMode::OnlyInstrumental => {
            let vocal_reject = [
                "acapella",
                "a cappella",
                "lyrics",
                "feat.",
                "vocal stem",
                "vocals only",
            ];
            if vocal_reject.iter().any(|kw| t.contains(kw)) {
                return false;
            }
        }
        DigMode::OnlyVocal => {
            let inst_reject = [
                "instrumental",
                "backing track",
                "type beat",
                "no vocals",
            ];
            if inst_reject.iter().any(|kw| t.contains(kw)) {
                return false;
            }
        }
        _ => {}
    }
    true
}

fn base_vibe_tag(c: &SampleCandidate) -> &str {
    c.query_tag.split(" • ").next().unwrap_or(&c.query_tag)
}

/// Interleaves fast vintage CDN tracks (iTunes/Deezer) with full-length vinyl rips (YouTube/SC):
/// - Slot #1 favors fast vintage CDN (~0.8s download) so cold starts drop immediately
/// - Slots #2-#4 pull full-length YouTube/SC rips (pre-warmed concurrently in the background)
/// - Enforces zero duplicate song titles, fresh vibes, and artist cooldowns
fn select_with_variety(
    mut full_pools: Vec<Vec<SampleCandidate>>,
    mut preview_pools: Vec<Vec<SampleCandidate>>,
    target_count: usize,
    recent_channels: &VecDeque<String>,
    recent_sources: &VecDeque<String>,
    session_titles: &HashSet<String>,
) -> Vec<SampleCandidate> {
    let mut selected: Vec<SampleCandidate> = Vec::with_capacity(target_count);
    let mut source_streak: Vec<String> = recent_sources.iter().cloned().collect();
    let mut used_channels: HashSet<String> = recent_channels.iter().cloned().collect();
    let mut used_titles: HashSet<String> = session_titles.clone();
    let mut used_vibes: HashSet<String> = HashSet::new();

    let total_full: usize = full_pools.iter().map(|p| p.len()).sum();
    let preview_cap: usize = if total_full >= target_count {
        2
    } else if total_full > 0 {
        target_count.saturating_sub(total_full).max(2)
    } else {
        target_count
    };
    let mut preview_picked = 0usize;

    let can_pick = |c: &SampleCandidate,
                    streak: &[String],
                    chans: &HashSet<String>,
                    titles: &HashSet<String>,
                    vibes: &HashSet<String>,
                    pass: u8|
     -> bool {
        let title_k = normalize_key(&c.title);
        if !title_k.is_empty() && titles.contains(&title_k) {
            return false;
        }
        let chan_k = normalize_key(&c.channel);
        let vibe_k = base_vibe_tag(c).to_lowercase();
        let two_same_src = streak.len() >= 2
            && streak[streak.len() - 1] == c.source
            && streak[streak.len() - 2] == c.source;

        match pass {
            0 => {
                !vibes.contains(&vibe_k)
                    && !chans.contains(&chan_k)
                    && streak.last().map(|s| s != &c.source).unwrap_or(true)
            }
            1 => !vibes.contains(&vibe_k) && !chans.contains(&chan_k) && !two_same_src,
            2 => !chans.contains(&chan_k) && !two_same_src,
            _ => true,
        }
    };

    let try_take_from = |pools: &mut [Vec<SampleCandidate>],
                         pass: u8,
                         streak: &mut Vec<String>,
                         chans: &mut HashSet<String>,
                         titles: &mut HashSet<String>,
                         vibes: &mut HashSet<String>|
     -> Option<SampleCandidate> {
        for pool in pools.iter_mut() {
            if let Some(pos) = pool
                .iter()
                .position(|c| can_pick(c, streak, chans, titles, vibes, pass))
            {
                let item = pool.remove(pos);
                vibes.insert(base_vibe_tag(&item).to_lowercase());
                titles.insert(normalize_key(&item.title));
                chans.insert(normalize_key(&item.channel));
                streak.push(item.source.clone());
                return Some(item);
            }
        }
        None
    };

    // Interleave: fast vintage CDN first (instant cold-start), then full-length YT/SC, alternating
    for pass in 0..=3u8 {
        while selected.len() < target_count {
            let mut added = false;

            if selected.len() < target_count && preview_picked < preview_cap {
                if let Some(item) = try_take_from(
                    &mut preview_pools,
                    pass,
                    &mut source_streak,
                    &mut used_channels,
                    &mut used_titles,
                    &mut used_vibes,
                ) {
                    selected.push(item);
                    preview_picked += 1;
                    added = true;
                }
            }

            if selected.len() < target_count {
                if let Some(item) = try_take_from(
                    &mut full_pools,
                    pass,
                    &mut source_streak,
                    &mut used_channels,
                    &mut used_titles,
                    &mut used_vibes,
                ) {
                    selected.push(item);
                    added = true;
                }
            }

            if !added {
                break;
            }
        }
    }

    selected
}

#[tauri::command]
pub async fn roll_crate(
    app: AppHandle,
    filters: SearchFilters,
    logger: State<'_, SessionLogger>,
) -> Result<RollResponse, String> {
    let roll_start = Instant::now();
    logger.write_line(
        "INFO",
        "RUST",
        "TASK:ROLL",
        "Rolling vintage multi-vibe crate",
        Some(&format!(
            "mode={:?} type={} region={} decade={} dur={} genre={}",
            filters.mode,
            filters.sample_type,
            filters.region,
            filters.decade,
            filters.duration,
            filters.genre
        )),
    );

    let dict = query_builder::load_or_init_dictionary(&app);
    let mut excluded = load_seen_ids(&app);
    excluded.extend(load_quarantined_ids(&app));
    let target_count = filters.card_count.clamp(1, 8) as usize;

    let is_vocal_shorts = filters.mode == DigMode::OnlyVocal && filters.duration == "shorts";
    let allow_openverse = matches!(filters.sample_type.as_str(), "drums" | "fx");

    let mut active_filters = filters.clone();
    let mut relaxed_note: Option<&'static str> = None;
    let mut last_query = String::new();

    for attempt in 1..=2 {
        if attempt == 2 {
            if active_filters.sample_type != "all" {
                active_filters.sample_type = "all".to_string();
                relaxed_note = Some("Widened Type");
            } else if active_filters.decade != "all" {
                active_filters.decade = "all".to_string();
                relaxed_note = Some("Widened Era");
            } else if active_filters.region != "all" {
                active_filters.region = "all".to_string();
                relaxed_note = Some("Widened Region");
            } else {
                relaxed_note = Some("Broadened");
            }
            logger.write_line(
                "WARN",
                "RUST",
                "FILTER_RELAX",
                "Attempt 1 returned 0 hits; relaxing filters",
                relaxed_note,
            );
        }

        // Generate 4 distinct Radiooooo-style vibes
        let mut built_queries: Vec<query_builder::BuiltQuery> = Vec::with_capacity(4);
        {
            let mut b = brain().lock().unwrap();
            for _ in 0..4 {
                let q = query_builder::build_search_query_avoiding(
                    &active_filters,
                    &dict,
                    &b.recent_queries,
                    b.last_tag.as_deref(),
                );
                b.remember_query(&q.query, &q.query_tag);
                built_queries.push(q);
            }
        }
        last_query = built_queries[0].query.clone();

        let format_tag = |raw: &str| -> String {
            match relaxed_note {
                Some(note) => format!("{raw} ({note})"),
                None => raw.to_string(),
            }
        };

        if is_vocal_shorts {
            let q0 = &built_queries[0];
            let display_tag = format_tag(&q0.query_tag);
            let yt_res = ytdlp_search::search_youtube_flat(
                &app,
                &q0.query,
                &display_tag,
                &active_filters,
                &excluded,
            )
            .await;

            let mut yt_pool: Vec<SampleCandidate> = yt_res
                .unwrap_or_default()
                .into_iter()
                .filter(|c| passes_quality_and_mode(c, &active_filters))
                .collect();

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
            brain().lock().unwrap().remember_selected(&selected);

            return Ok(RollResponse {
                query_used: q0.query.clone(),
                query_tag: display_tag,
                candidates: selected,
            });
        }

        let (use_yt, use_sc, use_opv, use_itn, use_dzr) = {
            let mut b = brain().lock().unwrap();
            (
                b.is_available("youtube", &logger),
                b.is_available("soundcloud", &logger),
                allow_openverse && b.is_available("openverse", &logger),
                b.is_available("itunes", &logger),
                b.is_available("deezer", &logger),
            )
        };

        let mut set: tokio::task::JoinSet<(
            &'static str,
            bool, // is_full_length
            Result<Vec<SampleCandidate>, String>,
        )> = tokio::task::JoinSet::new();

        // Vibe 1 -> YouTube (full vintage rip) + Vintage iTunes
        if use_yt {
            let (app_c, q, tag, f, ex) = (
                app.clone(),
                built_queries[0].query.clone(),
                format_tag(&built_queries[0].query_tag),
                active_filters.clone(),
                excluded.clone(),
            );
            set.spawn(async move {
                let res = tokio::time::timeout(
                    Duration::from_millis(7500),
                    ytdlp_search::search_youtube_flat(&app_c, &q, &tag, &f, &ex),
                )
                .await
                .unwrap_or_else(|_| Err("YouTube search timed out (7.5s)".to_string()));
                ("youtube", true, res)
            });
        }
        if use_itn {
            let (q, tag, f, ex) = (
                built_queries[0].query.clone(),
                format_tag(&built_queries[0].query_tag),
                active_filters.clone(),
                excluded.clone(),
            );
            set.spawn(async move {
                ("itunes", false, extra_sources::search_itunes(&q, &tag, &f, &ex).await)
            });
        }

        // Vibe 2 -> YouTube (second distinct vibe)
        if use_yt {
            let (app_c, q, tag, f, ex) = (
                app.clone(),
                built_queries[1].query.clone(),
                format_tag(&built_queries[1].query_tag),
                active_filters.clone(),
                excluded.clone(),
            );
            set.spawn(async move {
                let res = tokio::time::timeout(
                    Duration::from_millis(7500),
                    ytdlp_search::search_youtube_flat(&app_c, &q, &tag, &f, &ex),
                )
                .await
                .unwrap_or_else(|_| Err("YouTube search timed out (7.5s)".to_string()));
                ("youtube", true, res)
            });
        }

        // Vibe 3 -> Vintage iTunes + SoundCloud (or Openverse for Drums/FX)
        if use_itn {
            let (q, tag, f, ex) = (
                built_queries[2].query.clone(),
                format_tag(&built_queries[2].query_tag),
                active_filters.clone(),
                excluded.clone(),
            );
            set.spawn(async move {
                ("itunes", false, extra_sources::search_itunes(&q, &tag, &f, &ex).await)
            });
        }
        if use_sc {
            let (app_c, q, tag, f, ex) = (
                app.clone(),
                built_queries[2].query.clone(),
                format_tag(&built_queries[2].query_tag),
                active_filters.clone(),
                excluded.clone(),
            );
            set.spawn(async move {
                let res = tokio::time::timeout(
                    Duration::from_millis(7500),
                    ytdlp_search::search_soundcloud_flat(&app_c, &q, &tag, &f, &ex),
                )
                .await
                .unwrap_or_else(|_| Err("SoundCloud search timed out (7.5s)".to_string()));
                ("soundcloud", true, res)
            });
        }

        // Vibe 4 -> Deezer (+ Openverse only when Drums/FX is selected)
        if use_dzr {
            let (q, tag, f, ex) = (
                built_queries[3].query.clone(),
                format_tag(&built_queries[3].query_tag),
                active_filters.clone(),
                excluded.clone(),
            );
            set.spawn(async move {
                ("deezer", false, extra_sources::search_deezer(&q, &tag, &f, &ex).await)
            });
        }
        if use_opv {
            let (q, tag, f, ex) = (
                built_queries[3].query.clone(),
                format_tag(&built_queries[3].query_tag),
                active_filters.clone(),
                excluded.clone(),
            );
            set.spawn(async move {
                (
                    "openverse",
                    true,
                    extra_sources::search_openverse(&q, &tag, &f, &ex).await,
                )
            });
        }

        let mut full_pools: Vec<Vec<SampleCandidate>> = Vec::new();
        let mut preview_pools: Vec<Vec<SampleCandidate>> = Vec::new();
        let mut counts: HashMap<&'static str, usize> = HashMap::new();
        let mut full_valid_total = 0usize;
        let mut preview_valid_total = 0usize;
        let mut mixed_ready_at: Option<Instant> = None;
        let hard_deadline = Instant::now() + Duration::from_millis(7600);

        while !set.is_empty() {
            let now = Instant::now();
            if now >= hard_deadline {
                break;
            }
            // Early-return once we have BOTH full-length rips AND fast vintage previews ready
            let wait_until = match mixed_ready_at {
                Some(t) => (t + Duration::from_millis(900)).min(hard_deadline),
                None => hard_deadline,
            };
            let remaining = wait_until.saturating_duration_since(now);
            if remaining.is_zero() {
                break;
            }

            match tokio::time::timeout(remaining, set.join_next()).await {
                Ok(Some(Ok((provider, is_full, res)))) => {
                    brain().lock().unwrap().record_outcome(provider, res.is_ok(), &logger);
                    match res {
                        Ok(items) => {
                            let mut valid: Vec<SampleCandidate> = items
                                .into_iter()
                                .filter(|c| passes_quality_and_mode(c, &active_filters))
                                .collect();
                            if !valid.is_empty() {
                                {
                                    let mut rng = rand::rng();
                                    valid.shuffle(&mut rng);
                                }
                                *counts.entry(provider).or_insert(0) += valid.len();
                                if is_full {
                                    full_valid_total += valid.len();
                                    full_pools.push(valid);
                                } else {
                                    preview_valid_total += valid.len();
                                    preview_pools.push(valid);
                                }

                                if full_valid_total >= 2
                                    && (full_valid_total + preview_valid_total) >= target_count
                                    && mixed_ready_at.is_none()
                                {
                                    mixed_ready_at = Some(Instant::now());
                                }
                            }
                        }
                        Err(err_msg) => {
                            logger.write_line(
                                "WARN",
                                "RUST",
                                "PROVIDER_ERR",
                                &format!("{provider}: {err_msg}"),
                                None,
                            );
                        }
                    }
                }
                Ok(Some(Err(_))) => {}
                Ok(None) | Err(_) => break,
            }
        }
        set.abort_all();

        let pool_summary = format!(
            "ms={} yt={} sc={} opv={} itn={} dzr={}",
            roll_start.elapsed().as_millis(),
            counts.get("youtube").copied().unwrap_or(0),
            counts.get("soundcloud").copied().unwrap_or(0),
            counts.get("openverse").copied().unwrap_or(0),
            counts.get("itunes").copied().unwrap_or(0),
            counts.get("deezer").copied().unwrap_or(0),
        );

        let selected = {
            let b = brain().lock().unwrap();
            select_with_variety(
                full_pools,
                preview_pools,
                target_count,
                &b.recent_channels,
                &b.recent_sources,
                &b.seen_titles,
            )
        };

        if !selected.is_empty() {
            let new_ids: Vec<String> = selected.iter().map(|c| c.id.clone()).collect();
            let _ = mark_ids_seen(&app, &new_ids);
            brain().lock().unwrap().remember_selected(&selected);

            let combined_queries = built_queries
                .iter()
                .map(|q| q.query.as_str())
                .collect::<Vec<_>>()
                .join(" / ");
            let first_tag = selected[0].query_tag.clone();

            logger.write_line(
                "INFO",
                "RUST",
                "ROLL_OK",
                &format!("Selected {} candidate(s) across 4 vibes", selected.len()),
                Some(&pool_summary),
            );

            return Ok(RollResponse {
                query_used: combined_queries,
                query_tag: first_tag,
                candidates: selected,
            });
        }

        logger.write_line(
            "WARN",
            "RUST",
            "ROLL_EMPTY",
            &format!("Attempt {attempt}: 0 candidates passed quality/mode filter"),
            Some(&pool_summary),
        );
    }

    let err_msg = format!(
        "No unseen samples found after relaxation (last query: '{}').",
        last_query
    );
    logger.write_line("ERROR", "RUST", "ROLL_FAILED", &err_msg, None);
    Err(err_msg)
}