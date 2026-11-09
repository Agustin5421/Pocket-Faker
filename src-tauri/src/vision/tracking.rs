//! Native, time-based ByteTrack-style association plus explicitly marked short predictions.
//! No image generation: every output refers to the real frame processed by the caller.
use crate::inference::Detection;
use serde::Serialize;
use std::time::Duration;

pub const LOW_CONFIDENCE: f32 = 0.1;
pub const PREDICTION_MS: u64 = 300;
const RETENTION_MS: u64 = 1_000;
const MAX_TRACKS: usize = 128;

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TrackState {
    Observed,
    Predicted,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterTrack {
    pub track_id: u64,
    pub class_id: usize,
    pub label: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    // A prediction has no current detector score or detector box ID.
    pub confidence: Option<f32>,
    pub last_observed_confidence: f32,
    pub detector_detection_id: Option<usize>,
    pub state: TrackState,
    pub last_observed_age_ms: u64,
}

// Independent position/velocity Kalman filters for cx, cy, width and height.
#[derive(Clone, Copy)]
struct Axis {
    position: f64,
    velocity: f64,
    pp: f64,
    pv: f64,
    vv: f64,
}

impl Axis {
    fn new(position: f64, scale: f64) -> Self {
        Self {
            position,
            velocity: 0.0,
            pp: (0.15 * scale).powi(2),
            pv: 0.0,
            vv: scale.powi(2),
        }
    }

    fn predict(&mut self, dt: f64, scale: f64) {
        let acceleration = (0.5 * scale).powi(2);
        self.position += self.velocity * dt;
        self.pp += 2.0 * dt * self.pv + dt * dt * self.vv + acceleration * dt.powi(4) / 4.0;
        self.pv += dt * self.vv + acceleration * dt.powi(3) / 2.0;
        self.vv += acceleration * dt * dt;
    }

    fn observe(&mut self, value: f64, scale: f64, confidence: f32) {
        let noise = (0.08 * scale).powi(2) / f64::from(confidence.max(0.1));
        let variance = (self.pp + noise).max(f64::EPSILON);
        let kp = self.pp / variance;
        let kv = self.pv / variance;
        let residual = value - self.position;
        self.position += kp * residual;
        self.velocity += kv * residual;
        self.vv = (self.vv - kv * self.pv).max(0.0);
        self.pv *= 1.0 - kp;
        self.pp *= 1.0 - kp;
    }
}

struct Track {
    id: u64,
    last: Detection,
    axes: [Axis; 4],
    last_seen: Duration,
    hits: u32,
    observed: bool,
}

fn measurement(detection: &Detection) -> [f64; 4] {
    [
        f64::from(detection.x + detection.width / 2.0),
        f64::from(detection.y + detection.height / 2.0),
        f64::from(detection.width),
        f64::from(detection.height),
    ]
}

impl Track {
    fn new(id: u64, detection: &Detection, now: Duration) -> Self {
        let values = measurement(detection);
        let scales = [values[2], values[3], values[2], values[3]];
        Self {
            id,
            last: detection.clone(),
            axes: std::array::from_fn(|index| Axis::new(values[index], scales[index].max(0.001))),
            last_seen: now,
            hits: 1,
            observed: true,
        }
    }

    fn predict(&mut self, dt: f64) {
        let width = f64::from(self.last.width).max(0.001);
        let height = f64::from(self.last.height).max(0.001);
        for (axis, scale) in self.axes.iter_mut().zip([width, height, width, height]) {
            axis.predict(dt, scale);
        }
        self.observed = false;
    }

    fn observe(&mut self, detection: &Detection, now: Duration) {
        let values = measurement(detection);
        let scales = [values[2], values[3], values[2], values[3]];
        for index in 0..4 {
            self.axes[index].observe(
                values[index],
                scales[index].max(0.001),
                detection.confidence,
            );
        }
        self.last = detection.clone();
        self.last_seen = now;
        self.hits = self.hits.saturating_add(1);
        self.observed = true;
    }

    fn bounds(&self) -> Option<[f32; 4]> {
        let [cx, cy, width, height] = self.axes.map(|axis| axis.position as f32);
        let x1 = (cx - width / 2.0).max(0.0);
        let y1 = (cy - height / 2.0).max(0.0);
        let x2 = (cx + width / 2.0).min(1.0);
        let y2 = (cy + height / 2.0).min(1.0);
        (width > 0.0 && height > 0.0 && x2 > x1 && y2 > y1).then_some([x1, y1, x2 - x1, y2 - y1])
    }

    fn output(&self, now: Duration) -> Option<CharacterTrack> {
        let age = now.saturating_sub(self.last_seen).as_millis() as u64;
        let visible = self.observed || (self.hits >= 2 && age <= PREDICTION_MS);
        let result = if visible {
            self.bounds().map(|[x, y, width, height]| CharacterTrack {
                track_id: self.id,
                class_id: self.last.class_id,
                label: self.last.label.clone(),
                x,
                y,
                width,
                height,
                confidence: self.observed.then_some(self.last.confidence),
                last_observed_confidence: self.last.confidence,
                detector_detection_id: self.observed.then_some(self.last.id),
                state: if self.observed {
                    TrackState::Observed
                } else {
                    TrackState::Predicted
                },
                last_observed_age_ms: age,
            })
        } else {
            None
        };
        result
    }
}

fn valid(detection: &Detection) -> bool {
    let values = [
        detection.x,
        detection.y,
        detection.width,
        detection.height,
        detection.confidence,
    ];
    values.iter().all(|value| value.is_finite())
        && detection.width > 0.0
        && detection.height > 0.0
        && detection.x >= 0.0
        && detection.y >= 0.0
        && detection.x + detection.width <= 1.00001
        && detection.y + detection.height <= 1.00001
        && (0.0..=1.0).contains(&detection.confidence)
}

fn overlap(a: [f32; 4], b: &Detection) -> f64 {
    let intersection = ((a[0] + a[2]).min(b.x + b.width) - a[0].max(b.x)).max(0.0)
        * ((a[1] + a[3]).min(b.y + b.height) - a[1].max(b.y)).max(0.0);
    f64::from(intersection / (a[2] * a[3] + b.width * b.height - intersection).max(f32::EPSILON))
}

// Rectangular Hungarian assignment. Each row has its own available dummy column,
// so no invalid edge is forced just because all real detections are already used.
fn assignment(cost: &[Vec<f64>], real_columns: usize) -> Vec<(usize, usize)> {
    let rows = cost.len();
    let columns = real_columns + rows;
    let mut u = vec![0.0; rows + 1];
    let mut v = vec![0.0; columns + 1];
    let mut p = vec![0; columns + 1];
    let mut way = vec![0; columns + 1];
    for row in 1..=rows {
        p[0] = row;
        let mut column = 0;
        let mut minimum = vec![f64::INFINITY; columns + 1];
        let mut used = vec![false; columns + 1];
        loop {
            used[column] = true;
            let current_row = p[column];
            let mut delta = f64::INFINITY;
            let mut next = 0;
            for candidate in 1..=columns {
                if used[candidate] == false {
                    let value = if candidate <= real_columns {
                        cost[current_row - 1][candidate - 1]
                    } else {
                        1.0
                    };
                    let reduced = value - u[current_row] - v[candidate];
                    if reduced < minimum[candidate] {
                        minimum[candidate] = reduced;
                        way[candidate] = column;
                    }
                    if minimum[candidate] < delta {
                        delta = minimum[candidate];
                        next = candidate;
                    }
                }
            }
            for candidate in 0..=columns {
                if used[candidate] {
                    u[p[candidate]] += delta;
                    v[candidate] -= delta;
                } else {
                    minimum[candidate] -= delta;
                }
            }
            column = next;
            if p[column] == 0 {
                break;
            }
        }
        loop {
            let previous = way[column];
            p[column] = p[previous];
            column = previous;
            if column == 0 {
                break;
            }
        }
    }
    (1..=real_columns)
        .filter_map(|column| {
            let row = p[column];
            (row > 0 && cost[row.saturating_sub(1)][column - 1] < 1.0)
                .then_some((row.saturating_sub(1), column - 1))
        })
        .collect()
}

#[derive(Default)]
pub struct CharacterTracker {
    tracks: Vec<Track>,
    next_id: u64,
    previous: Option<Duration>,
    dimensions: Option<(u32, u32)>,
}

impl CharacterTracker {
    fn associate(
        &mut self,
        indices: &[usize],
        detections: &[&Detection],
        now: Duration,
        minimum_iou: f64,
    ) -> Vec<usize> {
        let costs = indices
            .iter()
            .map(|index| {
                let track = &self.tracks[*index];
                detections
                    .iter()
                    .map(|detection| {
                        let iou = track
                            .bounds()
                            .map(|bounds| overlap(bounds, detection))
                            .unwrap_or(0.0);
                        if track.last.class_id == detection.class_id && iou >= minimum_iou {
                            1.0 - iou
                        } else {
                            1_000.0
                        }
                    })
                    .collect()
            })
            .collect::<Vec<Vec<f64>>>();
        let matches = assignment(&costs, detections.len());
        let mut used = Vec::new();
        for (row, column) in matches {
            self.tracks[indices[row]].observe(detections[column], now);
            used.push(column);
        }
        used
    }

    pub fn update(
        &mut self,
        detections: &[Detection],
        threshold: f32,
        now: Duration,
        dimensions: (u32, u32),
    ) -> Vec<CharacterTrack> {
        let discontinuity = self.dimensions.is_some_and(|old| old != dimensions)
            || self.previous.is_some_and(|old| {
                now < old || now.saturating_sub(old).as_millis() > u128::from(RETENTION_MS)
            });
        if discontinuity {
            self.tracks.clear();
        }
        self.tracks.retain(|track| {
            now.saturating_sub(track.last_seen).as_millis() <= u128::from(RETENTION_MS)
        });
        let dt = self
            .previous
            .map(|old| now.saturating_sub(old).as_secs_f64())
            .unwrap_or(0.0);
        for track in &mut self.tracks {
            track.predict(dt);
        }
        let high = detections
            .iter()
            .filter(|d| valid(d) && d.confidence >= threshold)
            .collect::<Vec<_>>();
        let low = detections
            .iter()
            .filter(|d| {
                valid(d)
                    && d.confidence >= LOW_CONFIDENCE.min(threshold)
                    && d.confidence < threshold
            })
            .collect::<Vec<_>>();
        let indices = (0..self.tracks.len()).collect::<Vec<_>>();
        let matched_high = self.associate(&indices, &high, now, 0.15);
        let remaining = self
            .tracks
            .iter()
            .enumerate()
            .filter_map(|(index, track)| {
                (track.observed == false
                    && now.saturating_sub(track.last_seen).as_millis() <= u128::from(PREDICTION_MS))
                .then_some(index)
            })
            .collect::<Vec<_>>();
        self.associate(&remaining, &low, now, 0.1);
        for (index, detection) in high.iter().enumerate() {
            if matched_high.contains(&index) == false && self.tracks.len() < MAX_TRACKS {
                self.next_id += 1;
                self.tracks.push(Track::new(self.next_id, detection, now));
            }
        }
        self.previous = Some(now);
        self.dimensions = Some(dimensions);
        self.tracks
            .iter()
            .filter_map(|track| track.output(now))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn detection(x: f32, confidence: f32) -> Detection {
        Detection {
            id: 7,
            class_id: 0,
            label: "Aatrox".into(),
            confidence,
            x,
            y: 0.4,
            width: 0.1,
            height: 0.15,
        }
    }

    fn update(
        tracker: &mut CharacterTracker,
        values: &[Detection],
        milliseconds: u64,
    ) -> Vec<CharacterTrack> {
        tracker.update(
            values,
            0.5,
            Duration::from_millis(milliseconds),
            (1280, 720),
        )
    }

    #[test]
    fn impact_frame_preserves_id_and_marks_prediction_without_fake_confidence() {
        let mut tracker = CharacterTracker::default();
        let first = update(&mut tracker, &[detection(0.3, 0.9)], 0);
        let second = update(&mut tracker, &[detection(0.32, 0.85)], 100);
        let missing = update(&mut tracker, &[], 200);
        assert_eq!(first[0].track_id, second[0].track_id);
        assert_eq!(missing[0].track_id, first[0].track_id);
        assert_eq!(missing[0].state, TrackState::Predicted);
        assert_eq!(missing[0].confidence, None);
        assert_eq!(missing[0].detector_detection_id, None);
        assert_eq!(missing[0].last_observed_age_ms, 100);
        assert!(
            missing[0].x > second[0].x,
            "prediction should follow observed motion"
        );
        let recovered = update(&mut tracker, &[detection(0.36, 0.15)], 300);
        assert_eq!(recovered[0].track_id, first[0].track_id);
        assert_eq!(recovered[0].state, TrackState::Observed);
        assert_eq!(recovered[0].confidence, Some(0.15));
        assert_eq!(recovered[0].detector_detection_id, Some(7));
    }

    #[test]
    fn predictions_expire_in_milliseconds_independently_of_frame_count() {
        for step in [20, 100] {
            let mut tracker = CharacterTracker::default();
            update(&mut tracker, &[detection(0.3, 0.9)], 0);
            update(&mut tracker, &[detection(0.3, 0.9)], 100);
            for now in (100 + step..=400).step_by(step as usize) {
                assert_eq!(update(&mut tracker, &[], now).len(), 1);
            }
            assert!(update(&mut tracker, &[], 401).is_empty());
        }
    }

    #[test]
    fn weak_boxes_never_start_tracks_and_single_frame_false_positives_do_not_linger() {
        let mut tracker = CharacterTracker::default();
        assert!(update(&mut tracker, &[detection(0.3, 0.15)], 0).is_empty());
        assert_eq!(update(&mut tracker, &[detection(0.3, 0.9)], 100).len(), 1);
        assert!(update(&mut tracker, &[], 200).is_empty());
    }

    #[test]
    fn two_targets_keep_ids_when_detector_order_changes() {
        let mut tracker = CharacterTracker::default();
        let initial = update(&mut tracker, &[detection(0.2, 0.9), detection(0.7, 0.8)], 0);
        let next = update(
            &mut tracker,
            &[detection(0.69, 0.95), detection(0.21, 0.8)],
            100,
        );
        assert_eq!(next[0].track_id, initial[0].track_id);
        assert_eq!(next[1].track_id, initial[1].track_id);
        assert!(next[0].x < next[1].x);
    }

    #[test]
    fn motion_prediction_preserves_identity_when_targets_cross() {
        let mut tracker = CharacterTracker::default();
        let initial = update(&mut tracker, &[detection(0.2, 0.9), detection(0.6, 0.9)], 0);
        let mut latest = initial.clone();
        for step in 1..=8 {
            latest = update(
                &mut tracker,
                &[
                    detection(0.6 - step as f32 * 0.03, 0.9),
                    detection(0.2 + step as f32 * 0.03, 0.9),
                ],
                step * 100,
            );
        }
        let rightbound = latest
            .iter()
            .find(|track| track.track_id == initial[0].track_id)
            .unwrap();
        let leftbound = latest
            .iter()
            .find(|track| track.track_id == initial[1].track_id)
            .unwrap();
        assert!(rightbound.x > leftbound.x);
    }

    #[test]
    #[ignore = "requires POCKET_FAKER_TRACKING_TEST_REPLAY; measures saved detector outputs"]
    fn measures_saved_replay_tracking_overhead() {
        use std::time::Instant;
        let path = std::env::var("POCKET_FAKER_TRACKING_TEST_REPLAY").unwrap();
        let content = std::fs::read_to_string(path).unwrap();
        let mut tracker = CharacterTracker::default();
        let mut elapsed_ms = 0.0;
        let mut frames = 0;
        let mut observed = 0;
        let mut predicted = 0;
        let mut epoch = None;
        for line in content.lines() {
            let value: serde_json::Value = serde_json::from_str(line).unwrap();
            let timestamp =
                chrono::DateTime::parse_from_rfc3339(value["capturedAt"].as_str().unwrap())
                    .unwrap()
                    .timestamp_millis();
            let origin = *epoch.get_or_insert(timestamp);
            let detections = value["gameplayDetections"]
                .as_array()
                .unwrap()
                .iter()
                .map(|d| Detection {
                    id: d["id"].as_u64().unwrap() as usize,
                    class_id: d["classId"].as_u64().unwrap() as usize,
                    label: d["label"].as_str().unwrap().to_owned(),
                    confidence: d["confidence"].as_f64().unwrap() as f32,
                    x: d["x"].as_f64().unwrap() as f32,
                    y: d["y"].as_f64().unwrap() as f32,
                    width: d["width"].as_f64().unwrap() as f32,
                    height: d["height"].as_f64().unwrap() as f32,
                })
                .collect::<Vec<_>>();
            let started = Instant::now();
            let tracks = tracker.update(
                &detections,
                0.5,
                Duration::from_millis((timestamp - origin).max(0) as u64),
                (
                    value["frameWidth"].as_u64().unwrap() as u32,
                    value["frameHeight"].as_u64().unwrap() as u32,
                ),
            );
            elapsed_ms += started.elapsed().as_secs_f64() * 1000.0;
            frames += 1;
            observed += tracks
                .iter()
                .filter(|track| track.state == TrackState::Observed)
                .count();
            predicted += tracks
                .iter()
                .filter(|track| track.state == TrackState::Predicted)
                .count();
        }
        assert!(frames > 0);
        eprintln!(
            "frames={frames} observed={observed} predicted={predicted} mean_tracking_ms={:.4}",
            elapsed_ms / f64::from(frames)
        );
    }

    #[test]
    fn global_assignment_does_not_steal_another_targets_only_match() {
        let pairs = assignment(&[vec![0.1, 0.2], vec![0.11, 1_000.0]], 2);
        assert!(pairs.contains(&(0, 1)));
        assert!(pairs.contains(&(1, 0)));
        assert!(assignment(&[vec![1_000.0]], 1).is_empty());
        assert!(assignment(&[], 2).is_empty());
    }

    #[test]
    fn long_gap_dimensions_change_and_clock_reset_invalidate_old_tracks() {
        let mut tracker = CharacterTracker::default();
        let first = update(&mut tracker, &[detection(0.3, 0.9)], 0)[0].track_id;
        let later = update(&mut tracker, &[detection(0.3, 0.9)], 1_001)[0].track_id;
        assert_ne!(first, later);
        let resized = tracker.update(
            &[detection(0.3, 0.9)],
            0.5,
            Duration::from_millis(1_100),
            (1920, 1080),
        );
        assert_ne!(later, resized[0].track_id);
        let reset = update(&mut tracker, &[detection(0.3, 0.9)], 0);
        assert_ne!(resized[0].track_id, reset[0].track_id);
    }

    #[test]
    fn impossible_jump_does_not_rebind_id_and_expired_track_is_not_reused() {
        let mut tracker = CharacterTracker::default();
        let first = update(&mut tracker, &[detection(0.1, 0.9)], 0)[0].track_id;
        let jumped = update(&mut tracker, &[detection(0.8, 0.9)], 100);
        assert_ne!(first, jumped[0].track_id);
        update(&mut tracker, &[], 2_000);
        let returned = update(&mut tracker, &[detection(0.1, 0.9)], 2_100);
        assert_ne!(first, returned[0].track_id);
    }

    #[test]
    fn invalid_boxes_and_cross_class_matches_are_rejected() {
        let mut tracker = CharacterTracker::default();
        assert!(update(&mut tracker, &[detection(f32::NAN, 0.9)], 0).is_empty());
        assert!(update(&mut tracker, &[detection(0.95, 0.9)], 100).is_empty());
        let original = update(&mut tracker, &[detection(0.3, 0.9)], 200);
        let mut other = detection(0.3, 0.9);
        other.class_id = 1;
        let current = update(&mut tracker, &[other], 300);
        assert_ne!(current[0].track_id, original[0].track_id);
    }

    #[test]
    fn serialized_prediction_is_safe_for_downstream_action_models() {
        let mut tracker = CharacterTracker::default();
        update(&mut tracker, &[detection(0.3, 0.9)], 0);
        update(&mut tracker, &[detection(0.31, 0.9)], 100);
        let predicted = update(&mut tracker, &[], 200);
        let json = serde_json::to_value(&predicted[0]).unwrap();
        assert_eq!(json["state"], "predicted");
        assert!(json["confidence"].is_null());
        assert!(json["detectorDetectionId"].is_null());
        assert_eq!(json["lastObservedAgeMs"], 100);
        assert!(json["trackId"].as_u64().unwrap() > 0);
    }
}
