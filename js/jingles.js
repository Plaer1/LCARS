// LCARSv2 jingles: a tiny Web Audio sequencer with cheap "chiptune / MIDI"
// voices (square lead, detuned-saw brass, ether lead, triangle pad, noise tick).
// Songs (.json note files or Standard MIDI .mid) live in ../jingles/local/, which
// is git-ignored and never part of a release, and are listed in local/index.json.
//
// Note file: { title, bpm, voices: { name: 'square'|'brass'|'ether'|'pad'|'tick' },
//              notes: [[voice, pitch ('C5' or MIDI number), startBeats, lengthBeats, velocity 0..1], ...] }

const BASE = new URL('../jingles/', import.meta.url);
const MASTER = 0.15;

let ctx = null, out = null, dest = null, playing = null;

function audio() {
	if (ctx) return ctx;
	ctx = new (window.AudioContext || window.webkitAudioContext)();
	out = ctx.createGain();
	out.gain.value = MASTER;
	// A short feedback delay gives the "space" of a bridge without a reverb file.
	const delay = ctx.createDelay(1);
	const fb = ctx.createGain();
	const wet = ctx.createGain();
	delay.delayTime.value = 0.23; fb.gain.value = 0.28; wet.gain.value = 0.22;
	out.connect(ctx.destination);
	out.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(ctx.destination);
	return ctx;
}

const NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function midi(p) {
	if (typeof p === 'number') return p;
	const m = /^([A-G])([#b]?)(-?\d)$/.exec(p);
	if (!m) return 69;
	return 12 * (Number(m[3]) + 1) + NAMES[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
const hz = n => 440 * Math.pow(2, (n - 69) / 12);

let pulse = null;
function pulseWave() {
	// 25% pulse: the classic chip lead timbre (Fourier series of a pulse train).
	if (pulse) return pulse;
	const N = 32, real = new Float32Array(N), imag = new Float32Array(N), duty = 0.25;
	for (let k = 1; k < N; k++) imag[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
	return (pulse = ctx.createPeriodicWave(real, imag));
}

let etherTone = null;
function etherWave() {
	// Nearly a sine, with the few low harmonics that give a theremin its reedy edge.
	if (etherTone) return etherTone;
	const imag = new Float32Array([0, 1, 0.42, 0.2, 0.09, 0.04]);
	return (etherTone = ctx.createPeriodicWave(new Float32Array(imag.length), imag));
}

function envelope(g, t, len, vel, { a = 0.01, d = 0.08, s = 0.7, r = 0.12 } = {}) {
	const peak = vel, sus = vel * s;
	g.gain.setValueAtTime(0, t);
	g.gain.linearRampToValueAtTime(peak, t + a);
	g.gain.linearRampToValueAtTime(sus, t + a + d);
	g.gain.setValueAtTime(sus, t + Math.max(a + d, len));
	g.gain.linearRampToValueAtTime(0, t + Math.max(a + d, len) + r);
	return t + Math.max(a + d, len) + r;
}

const VOICES = {
	square(t, f, len, vel) {
		const o = ctx.createOscillator(), g = ctx.createGain();
		o.setPeriodicWave(pulseWave()); o.frequency.value = f;
		o.connect(g); g.connect(dest);
		const end = envelope(g, t, len, vel * 0.6, { a: 0.005, d: 0.05, s: 0.8, r: 0.06 });
		o.start(t); o.stop(end + 0.02);
	},
	brass(t, f, len, vel) {
		const g = ctx.createGain(), lp = ctx.createBiquadFilter();
		lp.type = 'lowpass'; lp.Q.value = 2;
		// The filter opens on the attack: that "blat" is what reads as brass.
		lp.frequency.setValueAtTime(f * 1.5, t);
		lp.frequency.linearRampToValueAtTime(f * 7, t + 0.08);
		lp.frequency.linearRampToValueAtTime(f * 4, t + 0.3);
		lp.connect(g); g.connect(dest);
		const vib = ctx.createOscillator(), vibAmt = ctx.createGain();
		vib.frequency.value = 5.2; vibAmt.gain.value = f * 0.006;
		vib.connect(vibAmt);
		const end = envelope(g, t, len, vel * 0.5, { a: 0.04, d: 0.12, s: 0.75, r: 0.2 });
		for (const detune of [-7, 7]) {
			const o = ctx.createOscillator();
			o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = detune;
			vibAmt.connect(o.frequency);
			o.connect(lp); o.start(t); o.stop(end + 0.05);
		}
		vib.start(t); vib.stop(end + 0.05);
	},
	// Halfway between a synth horn and a theremin: the rounded tone carries the note,
	// quiet filtered saws give it the horn's edge. Each note glides in from the last
	// one (`from`) and takes on a slow, wide vibrato once it sustains.
	ether(t, f, len, vel, from = f * 0.955) {
		const g = ctx.createGain(), lp = ctx.createBiquadFilter(), horn = ctx.createGain();
		const vib = ctx.createOscillator(), vibAmt = ctx.createGain();
		const glide = Math.min(0.1, len * 0.4);
		lp.type = 'lowpass'; lp.Q.value = 1.5;
		lp.frequency.setValueAtTime(f * 1.2, t);
		lp.frequency.linearRampToValueAtTime(f * 5, t + 0.09);
		lp.frequency.linearRampToValueAtTime(f * 2.5, t + 0.35);
		horn.gain.value = 0.3;
		lp.connect(horn); horn.connect(g); g.connect(dest);
		const end = envelope(g, t, len, vel * 0.5, { a: 0.05, d: 0.12, s: 0.8, r: 0.28 });
		vib.frequency.value = 5.6;
		vibAmt.gain.setValueAtTime(0, t + 0.12);
		vibAmt.gain.linearRampToValueAtTime(f * 0.014, t + 0.45); // about 24 cents either way
		vib.connect(vibAmt);
		const osc = (target, setup) => {
			const o = ctx.createOscillator();
			setup(o);
			o.frequency.setValueAtTime(from, t);
			o.frequency.exponentialRampToValueAtTime(f, t + glide);
			vibAmt.connect(o.frequency);
			o.connect(target); o.start(t); o.stop(end + 0.05);
		};
		osc(g, o => o.setPeriodicWave(etherWave()));
		for (const detune of [-6, 6]) osc(lp, o => { o.type = 'sawtooth'; o.detune.value = detune; });
		vib.start(t); vib.stop(end + 0.05);
	},
	pad(t, f, len, vel) {
		const o = ctx.createOscillator(), g = ctx.createGain();
		o.type = 'triangle'; o.frequency.value = f;
		o.connect(g); g.connect(dest);
		const end = envelope(g, t, len, vel * 0.45, { a: 0.35, d: 0.2, s: 0.8, r: 0.6 });
		o.start(t); o.stop(end + 0.05);
	},
	tick(t, f, len, vel) {
		const n = Math.floor(ctx.sampleRate * 0.03), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
		for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
		const s = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), g = ctx.createGain();
		hp.type = 'highpass'; hp.frequency.value = f || 3000; g.gain.value = vel * 0.5;
		s.buffer = buf; s.connect(hp); hp.connect(g); g.connect(dest); s.start(t);
	},
};

const cache = new Map();

// Standard MIDI File (format 0/1) -> song. Tracks (or channels, for format 0)
// map in order onto `voices`; tempo comes from the first tempo event.
export function parseMidi(buf, voices = ['square', 'brass', 'pad', 'square']) {
	const d = new DataView(buf);
	let p = 0;
	const str = n => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(d.getUint8(p + i)); p += n; return s; };
	const u32 = () => { const v = d.getUint32(p); p += 4; return v; };
	const u16 = () => { const v = d.getUint16(p); p += 2; return v; };
	const vlq = () => { let v = 0, b; do { b = d.getUint8(p++); v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
	if (str(4) !== 'MThd') throw new Error('not a MIDI file');
	u32(); const format = u16(), ntracks = u16(), division = u16();
	if (division & 0x8000) throw new Error('SMPTE time division not supported');
	let bpm = 120;
	const notes = [], lanes = new Map(); // lane = track (fmt 1) or channel (fmt 0)
	for (let t = 0; t < ntracks; t++) {
		if (str(4) !== 'MTrk') break;
		const end = u32() + p;
		let tick = 0, status = 0;
		const open = new Map();
		while (p < end) {
			tick += vlq();
			let b = d.getUint8(p);
			if (b & 0x80) { status = b; p++; } // otherwise running status
			const type = status & 0xf0, ch = status & 0x0f;
			if (status === 0xff) {
				const meta = d.getUint8(p++), len = vlq();
				if (meta === 0x51 && len === 3) bpm = 60000000 / ((d.getUint8(p) << 16) | (d.getUint8(p + 1) << 8) | d.getUint8(p + 2));
				p += len;
			} else if (status === 0xf0 || status === 0xf7) {
				p += vlq();
			} else if (type === 0x90 || type === 0x80) {
				const key = d.getUint8(p++), vel = d.getUint8(p++);
				const lane = format === 0 ? ch : t;
				if (!lanes.has(lane)) lanes.set(lane, lanes.size);
				const id = `${ch}:${key}`;
				if (type === 0x90 && vel > 0) open.set(id, { tick, vel, lane });
				else if (open.has(id)) {
					const n = open.get(id); open.delete(id);
					notes.push([`v${lanes.get(n.lane)}`, key, n.tick / division, Math.max(0.05, (tick - n.tick) / division), n.vel / 127]);
				}
			} else if (type === 0xc0 || type === 0xd0) p += 1;
			else p += 2;
		}
		p = end;
	}
	if (!notes.length) throw new Error('no notes in MIDI file');
	const start = Math.min(...notes.map(n => n[2]));
	for (const n of notes) n[2] -= start; // drop leading silence
	const map = {};
	for (let i = 0; i < lanes.size; i++) map[`v${i}`] = voices[i % voices.length];
	return { title: 'MIDI', bpm, voices: map, notes };
}

async function load(id, voices) {
	if (cache.has(id)) return cache.get(id);
	const url = new URL(/\.(json|mid|midi)$/i.test(id) ? id : `${id}.json`, BASE);
	const res = await fetch(url);
	if (!res.ok) throw new Error(`jingle ${id}: HTTP ${res.status}`);
	const song = /\.midi?$/i.test(id) ? parseMidi(await res.arrayBuffer(), voices) : await res.json();
	cache.set(id, song);
	return song;
}

// The user's own covers, from local/index.json (git-ignored; none means silence).
export async function list() {
	try {
		return (await (await fetch(new URL('local/index.json', BASE), { cache: 'no-cache' })).json()).jingles || [];
	} catch (_) {
		return [];
	}
}

// Schedule a whole song. Returns seconds until it ends, or 0 if audio is blocked.
// An index entry can trim a long file to an excerpt and split one dense track
// by pitch: { id, voices, from, to (beats), splitBelow (MIDI note), lowVoice, hold (beats
// added to the final notes, so a cut ends on a sustained chord) }.
export function excerpt(song, { from = 0, to = Infinity, splitBelow, lowVoice = 'pad', hold = 0 } = {}) {
	const notes = [];
	for (const [voice, pitch, start, len, vel] of song.notes) {
		if (start < from || start >= to) continue;
		const low = splitBelow != null && midi(pitch) < splitBelow;
		notes.push([low ? '__low' : voice, pitch, start - from, Math.min(len, to - start), vel]);
	}
	const last = Math.max(...notes.map(n => n[2]));
	for (const n of notes) if (n[2] === last) n[3] += hold;
	return { ...song, voices: { ...song.voices, __low: lowVoice }, notes };
}

// `at` (a performance.now() time) starts it then instead of now. It is measured right before
// scheduling, on the audio clock, so a busy page cannot make it late once the file is loaded.
export async function play(idOrEntry, voices, at = 0) {
	const entry = typeof idOrEntry === 'object' && idOrEntry.id ? idOrEntry : null;
	const loaded = entry ? await load(entry.id, entry.voices) : typeof idOrEntry === 'string' ? await load(idOrEntry, voices) : idOrEntry;
	const song = entry && (entry.from != null || entry.to != null || entry.splitBelow != null) ? excerpt(loaded, entry) : loaded;
	const c = audio();
	if (c.state === 'suspended') { try { await c.resume(); } catch (_) {} }
	if (c.state !== 'running') return 0;
	stop();
	// Each song gets its own bus, so stopping fades exactly this song out.
	dest = c.createGain();
	dest.connect(out);
	const beat = 60 / (song.bpm || 120), t0 = c.currentTime + 0.05 + Math.max(0, (at - performance.now()) / 1000);
	let end = 0;
	const last = new Map(); // voice -> where its previous note ended, for the ether glide
	// MIDI parsing lists notes as they end; a glide needs them in the order they start.
	for (const [voice, pitch, start, len, vel = 0.8] of [...song.notes].sort((a, b) => a[2] - b[2])) {
		const kind = song.voices?.[voice] || voice;
		const fn = VOICES[kind];
		if (!fn) continue;
		// Numbers above the MIDI range are raw Hz (tick cutoff), not pitches.
		const f = typeof pitch === 'number' && pitch > 127 ? pitch : hz(midi(pitch));
		const prev = last.get(voice);
		// Only a melody line glides: not a chord note, a far leap, or after a rest.
		const from = prev && start >= prev.end - 0.02 && start - prev.end < 0.5 && Math.abs(Math.log2(f / prev.f)) <= 1 ? prev.f : undefined;
		fn(t0 + start * beat, f, len * beat, vel, from);
		last.set(voice, { f, end: start + len });
		end = Math.max(end, (start + len) * beat);
	}
	playing = dest;
	return end + 0.6;
}

export function stop() {
	if (!playing || !ctx) return;
	const g = playing.gain, now = ctx.currentTime;
	g.cancelScheduledValues(now);
	g.setValueAtTime(g.value, now);
	g.linearRampToValueAtTime(0, now + 0.08);
	playing = null;
}

export const ready = () => !!ctx && ctx.state === 'running';
