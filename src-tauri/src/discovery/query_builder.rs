use crate::discovery::{DigMode, SearchFilters};
use rand::seq::IndexedRandom;
use serde::{Deserialize, Serialize};
use std::collections::{HashSet, VecDeque};
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
            // Europe (balanced share when Region = All; dedicated pool when Region = Europe)
            ("chanson française", "France"),
            ("yé-yé française", "Paris Yé-Yé"),
            ("musique de film française", "Paris Cinema"),
            ("french library groove", "Paris Library"),
            ("french touch house", "Paris House"),
            ("canzone italiana", "Italy"),
            ("colonna sonora italiana", "Cinecittà"),
            ("italo disco synth", "Milan Disco"),
            ("yé-yé español", "Spain"),
            ("rumba flamenca", "Andalucía"),
            ("fado português", "Lisbon"),
            ("german krautrock", "Berlin"),
            ("german library jazz", "Munich Library"),
            ("swedish jazz", "Stockholm"),
            ("polish jazz vinyl", "Warsaw"),
            ("hungarian jazz rock", "Budapest"),
            ("czech jazz funk", "Prague"),
            ("romanian jazz fusion", "Bucharest"),
            ("greek laiko bouzouki", "Athens"),
            ("uk garage 2step", "London UKG"),
            // CIS / Eurasia
            ("soviet VIA", "USSR VIA"),
            ("soviet cinema soundtrack", "Mosfilm"),
            ("soviet estrada jazz", "Moscow Jazz"),
            ("russian post punk", "CIS Wave"),
            // Asia
            ("kayokyoku", "Tokyo Vintage"),
            ("japanese city pop", "Tokyo City Pop"),
            ("japanese jazz fusion", "Tokyo Jazz"),
            ("shibuya kei groove", "Shibuya-Kei"),
            ("korean psych rock", "Seoul Psych"),
            ("korean indie soul", "Seoul Soul"),
            ("thai molam funk", "Bangkok"),
            ("indonesian pop kreatif", "Jakarta"),
            ("vietnamese bolero", "Saigon"),
            ("bollywood disco funk", "Mumbai"),
            ("indian classical sitar", "India Sitar"),
            // Latin America & Caribbean
            ("bossa nova vocal", "Rio Bossa"),
            ("mpb brasileira", "Brazil MPB"),
            ("samba soul groove", "Brazil Soul"),
            ("baile funk groove", "Rio Baile"),
            ("cumbia peruana chicha", "Lima Chicha"),
            ("colombian salsa dura", "Colombia"),
            ("afro cuban son montuno", "Havana"),
            ("bolero mexicano", "Mexico"),
            ("argentine rock nacional", "Buenos Aires"),
            ("jamaican roots reggae", "Kingston"),
            ("jamaican dub instrumental", "Jamaica Dub"),
            ("rocksteady ska", "Jamaica Ska"),
            // Africa
            ("ethio jazz", "Ethiopia"),
            ("nigerian afrobeat", "Lagos"),
            ("alte afro fusion", "Lagos Alté"),
            ("ghana highlife", "Accra"),
            ("zamrock psychedelic", "Zambia"),
            ("mali desert blues", "Mali"),
            ("congo soukous rumba", "Kinshasa"),
            ("south african amapiano", "Johannesburg"),
            ("senegalese mbalax", "Dakar"),
            // Middle East & North Africa
            ("anatolian psych rock", "Istanbul"),
            ("turkish psychedelic funk", "Turkey"),
            ("habibi funk", "Beirut"),
            ("lebanese tarab", "Lebanon"),
            ("egyptian shaabi", "Cairo"),
            ("persian funk", "Tehran"),
            ("moroccan gnawa", "Morocco"),
            ("algerian rai", "Algeria"),
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
            ("cis", "Soviet VIA cinema jazz", "CIS / Russia"),
            ("europe", "chanson française canzone italiana library", "Europe"),
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
                // Era-neutral queries spanning 1950s through 2020s
                "rare groove".into(),
                "obscure soul".into(),
                "private press jazz".into(),
                "library music".into(),
                "psychedelic funk".into(),
                "bossa nova groove".into(),
                "analog synth".into(),
                "underground hip hop instrumental".into(),
                "soul funk groove".into(),
                "classic motown soul".into(),
                "sweet soul ballad".into(),
                "neo soul rhodes".into(),
                "deep funk breakbeat".into(),
                "boogie disco funk".into(),
                "jazz funk fusion".into(),
                "modal jazz quartet".into(),
                "hard bop jazz".into(),
                "cool jazz piano".into(),
                "smooth jazz saxophone".into(),
                "spiritual jazz flute".into(),
                "acid jazz groove".into(),
                "nu jazz broken beat".into(),
                "jazz trio upright bass".into(),
                "rhodes electric piano".into(),
                "hammond organ groove".into(),
                "clavinet funk groove".into(),
                "boom bap jazz beat".into(),
                "hip hop instrumental".into(),
                "trip hop downtempo".into(),
                "gospel soul choir".into(),
                "chicago blues guitar".into(),
                "southern soul horns".into(),
                "philly soul strings".into(),
                "film soundtrack score".into(),
                "noir jazz soundtrack".into(),
                "orchestral cinema strings".into(),
                "spy theme groove".into(),
                "synthwave boogie".into(),
                "french house groove".into(),
                "deep house chords".into(),
                "detroit techno analog".into(),
                "ambient modular synth".into(),
                "warm tape ambient".into(),
                "dream pop shoegaze".into(),
                "indie soul guitar".into(),
                "post punk bassline".into(),
                "disco strings groove".into(),
                "latin boogaloo funk".into(),
                "salsa jazz percussion".into(),
                "dub reggae bassline".into(),
                "roots reggae groove".into(),
                "afrobeat horn section".into(),
                "spanish acoustic guitar".into(),
                "drum break groove".into(),
                "psychedelic rock guitar".into(),
                "rnb slow jam".into(),
                "uk soul groove".into(),
                "chanson française".into(),
                "canzone italiana".into(),
            ],
            crate_modifiers: vec![
                "vinyl".into(),
                "groove".into(),
                "session".into(),
                "classic".into(),
                "vintage".into(),
            ],
            vocal_shorts_queries: vec![
                "sample this vocal".into(),
                "singing acapella raw".into(),
                "vocalist freestyle raw mic".into(),
                "soulful vocal run isolated".into(),
                "gospel vocal solo".into(),
                "choir harmony isolated".into(),
                "opera soprano solo raw".into(),
                "rnb vocal riff acapella".into(),
                "jazz scat vocal solo".into(),
                "reggae vocal chant raw".into(),
                "house diva vocal acapella".into(),
                "blues singer raw acapella".into(),
                "female soul adlib vocal".into(),
                "folk singing solo raw".into(),
            ],
            vocal_full_queries: vec![
                "acapella studio vocals".into(),
                "isolated vocal track".into(),
                "vocal stem only".into(),
                "soul acapella vocal".into(),
                "soul singer ballad".into(),
                "gospel choir harmony".into(),
                "rnb acapella vocals".into(),
                "jazz vocal ballad".into(),
                "female jazz vocalist".into(),
                "house acapella vocals".into(),
                "chanson française vocal".into(),
                "canzone italiana vocal".into(),
                "brazilian bossa vocal".into(),
                "doo wop vocal harmony".into(),
                "traditional folk singing unaccompanied".into(),
                "gregorian chant choir".into(),
                "celtic vocal folk".into(),
                "african vocal choir".into(),
                "blues vocal acoustic".into(),
            ],
            instrumental_suffixes: vec![
                "instrumental".into(),
                "no vocals".into(),
                "drum break".into(),
                "library music".into(),
                "jazz trio".into(),
                "funk groove".into(),
                "piano solo".into(),
                "guitar instrumental".into(),
                "bass groove".into(),
                "horn section".into(),
                "rhodes jam".into(),
                "dub version".into(),
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

fn merge_unique_strings(target: &mut Vec<String>, defaults: Vec<String>) -> bool {
    let mut existing: HashSet<String> = target.iter().map(|s| s.to_lowercase()).collect();
    let mut changed = false;
    for item in defaults {
        if existing.insert(item.to_lowercase()) {
            target.push(item);
            changed = true;
        }
    }
    changed
}

fn merge_unique_world_styles(
    target: &mut Vec<WorldStyleEntry>,
    defaults: Vec<WorldStyleEntry>,
) -> bool {
    let mut existing: HashSet<String> = target.iter().map(|e| e.query.to_lowercase()).collect();
    let mut changed = false;
    for item in defaults {
        if existing.insert(item.query.to_lowercase()) {
            target.push(item);
            changed = true;
        }
    }
    changed
}

/// Loads `queries.json` from app_data_dir, auto-merging new built-in queries while preserving custom edits.
pub fn load_or_init_dictionary(app: &AppHandle) -> QueryDictionary {
    let Ok(path) = resolve_queries_json_path(app) else {
        return QueryDictionary::default();
    };

    let defaults = QueryDictionary::default();
    if path.exists() {
        if let Ok(raw) = fs::read_to_string(&path) {
            if let Ok(mut dict) = serde_json::from_str::<QueryDictionary>(&raw) {
                let mut changed = false;
                changed |= merge_unique_strings(&mut dict.general_queries, defaults.general_queries);
                changed |= merge_unique_world_styles(&mut dict.world_styles, defaults.world_styles);
                changed |=
                    merge_unique_strings(&mut dict.vocal_shorts_queries, defaults.vocal_shorts_queries);
                changed |=
                    merge_unique_strings(&mut dict.vocal_full_queries, defaults.vocal_full_queries);
                changed |= merge_unique_strings(
                    &mut dict.instrumental_suffixes,
                    defaults.instrumental_suffixes,
                );
                if changed {
                    if let Ok(json) = serde_json::to_string_pretty(&dict) {
                        let _ = fs::write(&path, json);
                    }
                }
                return dict;
            }
        }
    }

    if let Ok(json) = serde_json::to_string_pretty(&defaults) {
        let _ = fs::write(&path, json);
    }
    defaults
}

#[tauri::command]
pub fn get_queries_file_path(app: AppHandle) -> Result<String, String> {
    let path = resolve_queries_json_path(&app)?;
    let _ = load_or_init_dictionary(&app);
    Ok(path.to_string_lossy().to_string())
}

fn random_era_year(decade: &str) -> u32 {
    let r = rand::random::<u32>();
    match decade {
        "1950s" => 1950 + (r % 10),
        "1960s" => 1960 + (r % 10),
        "1970s" => 1970 + (r % 10),
        "1980s" => 1980 + (r % 10),
        "1990s" => 1990 + (r % 10),
        "2000s" => 2000 + (r % 10),
        "2010s" => 2010 + (r % 10),
        "2020s" => 2020 + (r % 6),
        _ => 1955 + (r % 71), // All eras: 1955..2025
    }
}

fn pick_region_style(region: &str) -> Option<(&'static str, &'static str)> {
    let mut rng = rand::rng();
    match region {
        "europe" => [
            ("chanson française", "France"),
            ("yé-yé française", "Paris Yé-Yé"),
            ("musique de film française", "Paris Cinema"),
            ("french library groove", "Paris Library"),
            ("canzone italiana", "Italy"),
            ("colonna sonora italiana", "Cinecittà"),
            ("yé-yé español", "Spain"),
            ("polish jazz vinyl", "Warsaw"),
            ("swedish jazz", "Stockholm"),
            ("german krautrock", "Berlin"),
            ("czech jazz funk", "Prague"),
        ]
        .choose(&mut rng)
        .copied(),
        "france" => [
            ("chanson française", "France"),
            ("yé-yé française", "Paris Yé-Yé"),
            ("musique de film française", "Paris Cinema"),
            ("french library groove", "Paris Library"),
        ]
        .choose(&mut rng)
        .copied(),
        "italy" => [
            ("canzone italiana", "Italy"),
            ("colonna sonora italiana", "Cinecittà"),
            ("italo disco synth", "Milan"),
        ]
        .choose(&mut rng)
        .copied(),
        "africa" => Some(("african afrobeat highlife", "Africa")),
        "asia" => Some(("asian japanese korean groove", "Asia")),
        "latin_america" | "latin" => Some(("latin cumbia salsa bossa", "Latin America")),
        "middle_east" | "mena" => Some(("arabic turkish persian groove", "Middle East")),
        "japan" => Some(("japanese jazz city pop", "Japan")),
        "brazil" => Some(("brazilian mpb bossa samba", "Brazil")),
        "turkey" => Some(("anatolian turkish psych", "Turkey")),
        "ethiopia" => Some(("ethio jazz", "Ethiopia")),
        "india" => Some(("bollywood indian groove", "India")),
        "ussr" | "cis" => Some(("soviet VIA cinema jazz", "CIS / USSR")),
        "caribbean" => Some(("jamaican reggae dub", "Caribbean")),
        "usa_uk" => Some(("soul funk jazz groove", "USA / UK")),
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
        "2020s" => Some("2020s"),
        _ => None,
    }
}

fn format_sample_type_clean(sample_type: &str) -> Option<&'static str> {
    match sample_type {
        "drums" => Some("drum break"),
        "melody" => Some("melody instrumental"),
        "bass" => Some("bass groove"),
        "vocals" => Some("acapella vocals"),
        "fx" => Some("ambient texture"),
        "full_track" => Some("groove"),
        _ => None,
    }
}

fn title_case_label(raw: &str) -> String {
    raw.split_whitespace()
        .take(3)
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                None => String::new(),
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn build_search_query(filters: &SearchFilters, dict: &QueryDictionary) -> BuiltQuery {
    let mut rng = rand::rng();

    let region_choice = pick_region_style(&filters.region);
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
        if let Some((r_kw, _)) = region_choice {
            parts.push(r_kw.to_string());
        }
        if let Some(g) = genre_word {
            parts.push(g.to_string());
        }
        let base = dict
            .vocal_full_queries
            .choose(&mut rng)
            .cloned()
            .unwrap_or_else(|| "soul acapella vocal".to_string());
        parts.push(base.clone());
        if let Some(d) = decade_word {
            parts.push(random_era_year(d).to_string());
        }
        let tag_prefix = region_choice.map(|(_, lbl)| lbl).unwrap_or("");
        let tag = if tag_prefix.is_empty() {
            title_case_label(&base)
        } else {
            format!("{tag_prefix} Vocal")
        };
        return BuiltQuery {
            query: parts.join(" "),
            query_tag: tag,
        };
    }

    // 2. Explicit Filter Mode (user chose Region, Decade, Genre, or Sample Type)
    let has_specific_filter = region_choice.is_some()
        || decade_word.is_some()
        || genre_word.is_some()
        || type_word.is_some();

    if has_specific_filter {
        let mut parts: Vec<String> = Vec::new();

        if let Some((r_kw, _)) = region_choice {
            parts.push(r_kw.to_string());
        }
        if let Some(g) = genre_word {
            parts.push(g.to_string());
        }
        if let Some(t) = type_word {
            parts.push(t.to_string());
        } else if genre_word.is_none() && region_choice.is_none() {
            let anchor = if filters.mode == DigMode::OnlyInstrumental {
                ["instrumental", "jazz", "funk groove", "cinema soundtrack"]
                    .choose(&mut rng)
                    .unwrap_or(&"instrumental")
            } else {
                ["jazz", "soul", "funk", "groove", "vinyl"]
                    .choose(&mut rng)
                    .unwrap_or(&"groove")
            };
            parts.push(anchor.to_string());
        }

        let year_stamp = decade_word.map(random_era_year);
        if let Some(y) = year_stamp {
            parts.push(y.to_string());
        }

        if filters.mode == DigMode::OnlyInstrumental && type_word.is_none() && genre_word.is_some() {
            parts.push("instrumental".to_string());
        }

        let query = parts.join(" ");
        let tag = match (region_choice, year_stamp) {
            (Some((_, lbl)), Some(y)) => format!("{lbl} {y}"),
            (Some((_, lbl)), None) => lbl.to_string(),
            _ => title_case_label(&query),
        };
        return BuiltQuery {
            query,
            query_tag: tag,
        };
    }

    // 3. Open Crate Mode (Region = All, Decade = All, Genre = All, Type = All -> ALL ERAS & REGIONS)
    match filters.mode {
        DigMode::WorldAdventure => {
            let fallback_style = WorldStyleEntry {
                query: "bossa nova vocal".to_string(),
                label: "Rio Bossa".to_string(),
            };
            let entry = dict.world_styles.choose(&mut rng).unwrap_or(&fallback_style);
            let has_digit = entry.query.chars().any(|c| c.is_ascii_digit());
            if has_digit {
                BuiltQuery {
                    query: entry.query.clone(),
                    query_tag: entry.label.clone(),
                }
            } else if rand::random::<f32>() < 0.70 {
                // Stamp a random year across ALL eras (1955..2025)
                let year = random_era_year("all");
                BuiltQuery {
                    query: format!("{} {}", entry.query, year),
                    query_tag: format!("{} {}", entry.label, year),
                }
            } else {
                // 30% timeless query without year so modern/classic standouts surface too
                BuiltQuery {
                    query: entry.query.clone(),
                    query_tag: entry.label.clone(),
                }
            }
        }
        DigMode::OnlyInstrumental => {
            let base = dict
                .general_queries
                .choose(&mut rng)
                .cloned()
                .unwrap_or_else(|| "jazz funk".to_string());
            let suffix = dict
                .instrumental_suffixes
                .choose(&mut rng)
                .cloned()
                .unwrap_or_else(|| "instrumental".to_string());
            let q = if base.to_lowercase().contains("instrumental") {
                base.clone()
            } else {
                format!("{base} {suffix}")
            };
            BuiltQuery {
                query_tag: title_case_label(&base),
                query: q,
            }
        }
        _ => {
            let base = dict
                .general_queries
                .choose(&mut rng)
                .cloned()
                .unwrap_or_else(|| "rare groove".to_string());

            if rand::random::<f32>() < 0.25 {
                let modifier = dict
                    .crate_modifiers
                    .choose(&mut rng)
                    .cloned()
                    .unwrap_or_else(|| "groove".to_string());
                BuiltQuery {
                    query: format!("{base} {modifier}"),
                    query_tag: title_case_label(&base),
                }
            } else {
                BuiltQuery {
                    query_tag: title_case_label(&base),
                    query: base,
                }
            }
        }
    }
}

/// Generates a search query avoiding repeats from recent rolls and back-to-back tags.
pub fn build_search_query_avoiding(
    filters: &SearchFilters,
    dict: &QueryDictionary,
    recent_queries: &VecDeque<String>,
    last_tag: Option<&str>,
) -> BuiltQuery {
    let mut best = build_search_query(filters, dict);
    for _ in 0..12 {
        let candidate = build_search_query(filters, dict);
        let repeated_q = recent_queries.iter().any(|q| q == &candidate.query);
        let repeated_tag = last_tag.map(|t| t == candidate.query_tag).unwrap_or(false);
        if !repeated_q && !repeated_tag {
            return candidate;
        }
        if !repeated_q {
            best = candidate;
        }
    }
    best
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