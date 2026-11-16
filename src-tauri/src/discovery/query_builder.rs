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

pub fn build_search_query(filters: &SearchFilters, dict: &QueryDictionary) -> BuiltQuery {
    let mut rng = rand::rng();
    let modifier = dict
        .crate_modifiers
        .choose(&mut rng)
        .map(|s| s.as_str())
        .unwrap_or("vinyl rip");

    let year_info = random_year_from_decade(&filters.decade);

    match filters.mode {
        DigMode::WorldAdventure => {
            let fallback = WorldStyleEntry {
                query: "Ethiopian jazz".into(),
                label: "Ethiopia".into(),
            };
            let entry = dict.world_styles.choose(&mut rng).unwrap_or(&fallback);

            match year_info {
                Some((year, dec_label)) => BuiltQuery {
                    query: format!("{} {} {}", entry.query, year, modifier),
                    query_tag: format!("{} • {}", dec_label, entry.label),
                },
                None => BuiltQuery {
                    query: format!("{} {}", entry.query, modifier),
                    query_tag: format!("All Eras • {}", entry.label),
                },
            }
        }

        DigMode::OnlyVocal => {
         let is_shorts = filters.duration == "shorts";
         if is_shorts {
             return BuiltQuery {
                 query: "sample this vocal #shorts".to_string(),
                 query_tag: "Vocal Shorts • YT".to_string(),
             };
         }

         let base = dict
             .vocal_full_queries
             .choose(&mut rng)
             .map(|s| s.as_str())
             .unwrap_or("isolated vocal track");

         match year_info {
             Some((year, dec_label)) => BuiltQuery {
                 query: format!("{} {}", base, year),
                 query_tag: format!("{} • Vocal", dec_label),
             },
             None => BuiltQuery {
                 query: base.to_string(),
                 query_tag: "All Eras • Vocal".to_string(),
             },
         }
     }

        DigMode::OnlyInstrumental => {
            let target_key = filters.genre.to_lowercase();
            let genre_entry = dict
                .genres
                .iter()
                .find(|g| g.key.to_lowercase() == target_key)
                .or_else(|| dict.genres.first());

            let (genre_term, genre_label) = match genre_entry {
                Some(g) => (g.keywords.as_str(), g.label.as_str()),
                None => ("groove fusion", "Any Genre"),
            };

            let inst_word = dict
                .instrumental_suffixes
                .choose(&mut rng)
                .map(|s| s.as_str())
                .unwrap_or("instrumental");

            match year_info {
                Some((year, dec_label)) => BuiltQuery {
                    query: format!("{} {} {} {}", genre_term, inst_word, year, modifier),
                    query_tag: format!("{} • {} Inst", dec_label, genre_label),
                },
                None => BuiltQuery {
                    query: format!("{} {} {}", genre_term, inst_word, modifier),
                    query_tag: format!("{} • Instrumental", genre_label),
                },
            }
        }

        DigMode::General => {
            let target_reg = filters.region.to_lowercase();
            let reg_entry = dict
                .regions
                .iter()
                .find(|r| r.key.to_lowercase() == target_reg)
                .or_else(|| dict.regions.first());

            let (reg_terms, reg_label) = match reg_entry {
                Some(r) => (r.keywords.as_str(), r.label.as_str()),
                None => ("rare groove jazz soul", "Global"),
            };

            let type_term = match filters.sample_type.as_str() {
                "vocal" => "vocal acapella",
                "instrumental" => "instrumental",
                "track" => "full track",
                _ => "",
            };

            let mut parts = vec![reg_terms.to_string()];
            if !type_term.is_empty() {
                parts.push(type_term.to_string());
            }
            if let Some((year, _)) = &year_info {
                parts.push(year.to_string());
            }
            parts.push(modifier.to_string());

            let era_label = year_info
                .map(|(_, d)| d)
                .unwrap_or_else(|| "All Eras".to_string());

            BuiltQuery {
                query: parts.join(" "),
                query_tag: format!("{} • {}", era_label, reg_label),
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

