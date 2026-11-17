use crate::discovery::{DigMode, SearchFilters};
use rand::seq::IndexedRandom;
use rand::RngExt;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone)]
pub struct BuiltQuery {
    pub query: String,
    pub query_tag: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldStyleEntry {
    pub query: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegionEntry {
    pub key: String,
    pub keywords: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenreEntry {
    pub key: String,
    pub keywords: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryDictionary {
    pub general_queries: Vec<String>,
    pub crate_modifiers: Vec<String>,
    pub vocal_shorts_queries: Vec<String>,
    pub vocal_full_queries: Vec<String>,
    pub world_styles: Vec<WorldStyleEntry>,
    pub instrumental_suffixes: Vec<String>,
    pub regions: Vec<RegionEntry>,
    pub genres: Vec<GenreEntry>,
}

impl Default for QueryDictionary {
    fn default() -> Self {
        let world_styles = vec![
            ("Ethiopian jazz", "Ethiopia"),
            ("Anatolian rock", "Turkey"),
            ("Soviet funk groove", "USSR"),
            ("Japanese city pop", "Japan"),
            ("Brazilian MPB funk", "Brazil"),
            ("Peruvian chicha cumbia", "Peru"),
            ("French library music", "France"),
            ("Bollywood disco funk", "India"),
            ("Italian cinema soundtrack", "Italy"),
            ("Zamrock psychedelic", "Zambia"),
            ("Nigerian afrobeat", "Nigeria"),
            ("Arabic belly dance groove", "Middle East"),
            ("Korean psych rock", "South Korea"),
            ("Colombian salsa dura", "Colombia"),
            ("Thai molam funk", "Thailand"),
            ("Hungarian jazz rock", "Hungary"),
            ("Polish jazz vinyl", "Poland"),
            ("Egyptian shaabi vintage", "Egypt"),
            ("Lebanese tarab vinyl", "Lebanon"),
            ("Cuban son montuno", "Cuba"),
            ("Jamaican dub instrumental", "Jamaica"),
            ("German krautrock", "Germany"),
            ("Swedish folk psych", "Sweden"),
            ("Indonesian pop kreatif", "Indonesia"),
            ("Iranian funk 70s", "Iran"),
            ("Moroccan gnawa groove", "Morocco"),
            ("Argentine rock nacional", "Argentina"),
            ("Greek laiko bouzouki", "Greece"),
            ("Senegalese mbalax", "Senegal"),
            ("Romanian jazz fusion", "Romania"),
        ]
        .into_iter()
        .map(|(q, l)| WorldStyleEntry {
            query: q.to_string(),
            label: l.to_string(),
        })
        .collect();

        let regions = vec![
            ("all", "rare groove jazz soul", "Global"),
            ("japan", "Japanese jazz soul funk", "Japan"),
            ("brazil", "Brazilian MPB samba bossa", "Brazil"),
            ("cis", "Soviet VIA jazz funk", "CIS / Russia"),
            ("europe", "European library jazz funk", "Europe"),
            ("mena", "Arabic Turkish Persian groove", "Middle East"),
            ("africa", "Afrobeat Highlife Zamrock", "Africa"),
            ("latin", "Latin cumbia salsa boogaloo", "Latin America"),
            ("usa_uk", "soul funk jazz rare groove", "USA / UK"),
        ]
        .into_iter()
        .map(|(k, kw, l)| RegionEntry {
            key: k.to_string(),
            keywords: kw.to_string(),
            label: l.to_string(),
        })
        .collect();

        let genres = vec![
            ("all", "groove fusion", "Any Genre"),
            ("jazz", "jazz", "Jazz"),
            ("funk", "funk soul", "Funk / Soul"),
            ("ambient", "ambient space", "Ambient"),
            ("synth", "synthesizer analog", "Synth"),
            ("classical", "chamber classical strings", "Classical"),
            ("folk", "traditional ethnic folk", "Folk / Ethnic"),
            ("psych", "psychedelic rock", "Psych Rock"),
            ("electronic", "electronic library", "Electronic"),
        ]
        .into_iter()
        .map(|(k, kw, l)| GenreEntry {
            key: k.to_string(),
            keywords: kw.to_string(),
            label: l.to_string(),
        })
        .collect();

        Self {
            world_styles,
            general_queries: vec![
                "rare groove".to_string(),
                "obscure soul".to_string(),
                "private press jazz".to_string(),
                "library music".to_string(),
                "psychedelic funk".to_string(),
                "vintage bossa nova".to_string(),
                "analog synth".to_string(),
                "underground hip hop instrumental".to_string(),
            ],
            crate_modifiers: vec![
                "vinyl rip".into(),
                "rare groove".into(),
                "full album track".into(),
                "obscure record".into(),
                "original pressing".into(),
                "deep cut".into(),
                "studio session".into(),
            ],
            vocal_shorts_queries: vec![
                "sample this vocal".into(),
                "singing acapella raw".into(),
                "vocalist freestyle raw mic".into(),
                "soulful vocal run isolated".into(),
                "gospel vocal solo".into(),
                "choir harmony isolated".into(),
                "opera soprano solo raw".into(),
            ],
            vocal_full_queries: vec![
                "acapella studio vocals".into(),
                "isolated vocal track".into(),
                "vocal stem only".into(),
                "vintage spoken word vinyl".into(),
                "traditional folk singing unaccompanied".into(),
                "gregorian chant choir".into(),
                "soul acapella vocal".into(),
            ],
            instrumental_suffixes: vec![
                "instrumental".into(),
                "no vocals".into(),
                "drum break".into(),
                "synth solo".into(),
                "library music".into(),
            ],
            regions,
            genres,
        }
    }
}

pub fn resolve_queries_json_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app_data_dir: {e}"))?;
    fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create app_data_dir: {e}"))?;
    Ok(data_dir.join("queries.json"))
}

/// Loads `queries.json` from app_data_dir, creating it with defaults if missing or invalid.
pub fn load_or_init_dictionary(app: &AppHandle) -> QueryDictionary {
    let Ok(path) = resolve_queries_json_path(app) else {
        return QueryDictionary::default();
    };

    if path.exists() {
        if let Ok(raw) = fs::read_to_string(&path) {
            if let Ok(dict) = serde_json::from_str::<QueryDictionary>(&raw) {
                return dict;
            }
        }
    }

    let default_dict = QueryDictionary::default();
    if let Ok(json) = serde_json::to_string_pretty(&default_dict) {
        let _ = fs::write(&path, json);
    }
    default_dict
}

#[tauri::command]
pub fn get_queries_file_path(app: AppHandle) -> Result<String, String> {
    let path = resolve_queries_json_path(&app)?;
    let _ = load_or_init_dictionary(&app);
    Ok(path.to_string_lossy().to_string())
}

fn random_year_from_decade(decade: &str) -> Option<(u32, String)> {
    let mut rng = rand::rng();
    let start_year = match decade {
        "1950s" => 1950,
        "1960s" => 1960,
        "1970s" => 1970,
        "1980s" => 1980,
        "1990s" => 1990,
        "2000s" => 2000,
        "2010s" => 2010,
        "2020s" => 2020,
        _ => return None,
    };
    let max_offset = if start_year == 2020 { 6 } else { 9 };
    let year = start_year + rng.random_range(0..=max_offset);
    Some((year, decade.to_string()))
}

fn format_region_clean(region: &str) -> Option<&'static str> {
    match region {
        "africa" => Some("african"),
        "asia" => Some("asian"),
        "europe" => Some("european"),
        "latin_america" => Some("latin"),
        "middle_east" => Some("middle eastern"),
        "japan" => Some("japanese"),
        "brazil" => Some("brazilian"),
        "france" => Some("french"),
        "italy" => Some("italian"),
        "turkey" => Some("turkish"),
        "ethiopia" => Some("ethiopian"),
        "india" => Some("indian"),
        "ussr" => Some("soviet"),
        "caribbean" => Some("caribbean"),
        _ => None,
    }
}

fn format_decade_clean(decade: &str) -> Option<&'static str> {
    match decade {
        "1950s" => Some("1950s"),
        "1960s" => Some("1960s"),
        "1970s" => Some("1970s"),
        "1980s" => Some("1980s"),
        "1990s" => Some("1990s"),
        "2000s" => Some("2000s"),
        "2010s" => Some("2010s"),
        _ => None,
    }
}

fn format_sample_type_clean(sample_type: &str) -> Option<&'static str> {
    match sample_type {
        "drums" => Some("drum break"),
        "melody" => Some("instrumental melody"),
        "bass" => Some("bassline"),
        "vocals" => Some("acapella vocals"),
        "fx" => Some("sound effects"),
        "full_track" => Some("full album"),
        _ => None,
    }
}

pub fn build_search_query(filters: &SearchFilters, dict: &QueryDictionary) -> BuiltQuery {
    let mut rng = rand::rng();

    let region_word = format_region_clean(&filters.region);
    let decade_word = format_decade_clean(&filters.decade);
    let genre_word = if filters.genre != "all" {
        Some(filters.genre.as_str())
    } else {
        None
    };
    let type_word = format_sample_type_clean(&filters.sample_type);

    // 1. Vocal Mode
    if filters.mode == DigMode::OnlyVocal {
        if filters.duration == "shorts" {
            let base = dict
                .vocal_shorts_queries
                .choose(&mut rng)
                .cloned()
                .unwrap_or_else(|| "acapella vocal hook #shorts".to_string());
            return BuiltQuery {
                query: base,
                query_tag: "Vocal Shorts".to_string(),
            };
        }
        let mut parts: Vec<String> = Vec::new();
        if let Some(r) = region_word {
            parts.push(r.to_string());
        }
        if let Some(g) = genre_word {
            parts.push(g.to_string());
        }
        if let Some(d) = decade_word {
            parts.push(d.to_string());
        }
        let base = dict
            .vocal_full_queries
            .choose(&mut rng)
            .cloned()
            .unwrap_or_else(|| "acapella vocals".to_string());
        parts.push(base);
        return BuiltQuery {
            query: parts.join(" "),
            query_tag: "Vocal Dig".to_string(),
        };
    }

    // 2. Explicit Filter Mode (e.g., Region: France + Decade: 1970s -> "french music 1970s")
    let has_specific_filter =
        region_word.is_some() || decade_word.is_some() || genre_word.is_some() || type_word.is_some();

    if has_specific_filter {
        let mut parts: Vec<String> = Vec::new();

        if let Some(r) = region_word {
            parts.push(r.to_string());
        }
        if let Some(g) = genre_word {
            parts.push(g.to_string());
        }
        if let Some(t) = type_word {
            parts.push(t.to_string());
        } else if genre_word.is_none() {
            let anchor = if filters.mode == DigMode::OnlyInstrumental {
                "instrumental music"
            } else {
                ["music", "vinyl", "records"].choose(&mut rng).unwrap_or(&"music")
            };
            parts.push(anchor.to_string());
        }
        if let Some(d) = decade_word {
            parts.push(d.to_string());
        }

        if filters.mode == DigMode::OnlyInstrumental && type_word.is_none() && genre_word.is_some() {
            parts.push("instrumental".to_string());
        }

        let tag = match filters.mode {
            DigMode::WorldAdventure => "World Clean",
            DigMode::OnlyInstrumental => "Instrumental",
            _ => "Filtered Dig",
        };

        return BuiltQuery {
            query: parts.join(" "),
            query_tag: tag.to_string(),
        };
    }

    // 3. Pure Random Mode (all filters set to "all")
    match filters.mode {
        DigMode::WorldAdventure => {
            let fallback_style = WorldStyleEntry {
                query: "french music 1970s".to_string(),
                label: "World".to_string(),
            };
            let entry = dict.world_styles.choose(&mut rng).unwrap_or(&fallback_style);
            BuiltQuery {
                query: entry.query.clone(),
                query_tag: entry.label.clone(),
            }
        }
        DigMode::OnlyInstrumental => {
            let base = dict
                .general_queries
                .choose(&mut rng)
                .cloned()
                .unwrap_or_else(|| "library music".to_string());
            BuiltQuery {
                query: format!("{base} instrumental"),
                query_tag: "Instrumental".to_string(),
            }
        }
        _ => {
            let base = dict
                .general_queries
                .choose(&mut rng)
                .cloned()
                .unwrap_or_else(|| "rare groove".to_string());

            if rand::random::<f32>() < 0.3 {
                let modifier = dict
                    .crate_modifiers
                    .choose(&mut rng)
                    .cloned()
                    .unwrap_or_else(|| "vinyl".to_string());
                BuiltQuery {
                    query: format!("{base} {modifier}"),
                    query_tag: "Deep Crate".to_string(),
                }
            } else {
                BuiltQuery {
                    query: base,
                    query_tag: "Crate Dig".to_string(),
                }
            }
        }
    }
}


#[tauri::command]
pub fn get_query_dictionary(app: AppHandle) -> QueryDictionary {
    load_or_init_dictionary(&app)
}

#[tauri::command]
pub fn save_query_dictionary(app: AppHandle, dict: QueryDictionary) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app_data_dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create app_data_dir: {e}"))?;

    let path = dir.join("queries.json");
    let json = serde_json::to_string_pretty(&dict)
        .map_err(|e| format!("Failed to serialize queries.json: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("Failed to write queries.json: {e}"))?;
    Ok(())
}

