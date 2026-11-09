// LCARSv2 boot sound track: synthesized live, timed to the boot animation in
// css/boot.css (the times below are seconds from when it starts). A power-up slide
// climbs as the rails fill, each bank segment bleeps as it lights, data trills run
// under the title, the record count ticks, and a chirp answers "All systems nominal".

const LEVEL = 0.13;
const SLIDE = { start: 0.28, peak: 1.2, end: 1.7, from: 70, to: 1100, settle: 820 };
const BANK = [880, 1109, 1319, 1109, 1319, 1760]; // one per segment, at .4 s + .1 s each
const TRILL = [1568, 2093, 1760, 2349, 1976, 2637, 2093, 2794, 2349, 3136, 2637, 3520]; // while the title wipes in, from .72 s
const NOMINAL = [[1.6, 1319, 0.07], [1.68, 1760, 0.07], [1.76, 2093, 0.2]];

// Everything is scheduled at once on `ctx`. `stretch` matches the animation's slowdown (js/boot.js).
export function playBootSound(ctx, stretch = 1) {
	const zero = ctx.currentTime;
	const master = ctx.createGain();
	master.gain.value = LEVEL;
	master.connect(ctx.destination);
	const track = ctx.createGain(); // cut on a skip; the closing sweep goes around it
	track.connect(master);

	const blip = (t, freq, len, vol, type = 'triangle') => {
		const at = zero + t * stretch;
		const o = ctx.createOscillator(), g = ctx.createGain();
		o.type = type;
		o.frequency.value = freq;
		g.gain.setValueAtTime(0, at);
		g.gain.linearRampToValueAtTime(vol, at + 0.004);
		g.gain.setValueAtTime(vol, at + len * 0.6);
		g.gain.exponentialRampToValueAtTime(0.0001, at + len);
		o.connect(g);
		g.connect(track);
		o.start(at);
		o.stop(at + len + 0.02);
	};

	// The slide: a filtered saw over a sine, pitch and filter climbing together. A tremolo
	// that speeds up as it climbs gives the vvvvVVVVUUUU; past the peak it settles and fades.
	const start = zero + SLIDE.start * stretch, peak = zero + SLIDE.peak * stretch, end = zero + SLIDE.end * stretch;
	const body = ctx.createGain(), lp = ctx.createBiquadFilter(), wobble = ctx.createOscillator(), depth = ctx.createGain();
	lp.type = 'lowpass';
	lp.Q.value = 4;
	lp.frequency.setValueAtTime(SLIDE.from * 3, start);
	lp.frequency.exponentialRampToValueAtTime(SLIDE.to * 4, peak);
	lp.frequency.exponentialRampToValueAtTime(SLIDE.settle * 1.5, end);
	body.gain.setValueAtTime(0.0001, start);
	body.gain.exponentialRampToValueAtTime(0.55, start + 0.3);
	body.gain.linearRampToValueAtTime(0.7, peak);
	body.gain.linearRampToValueAtTime(0.55, peak + 0.2); // the "uhhh": hold after the climb, then let go
	body.gain.exponentialRampToValueAtTime(0.0001, end);
	wobble.frequency.setValueAtTime(11, start);
	wobble.frequency.exponentialRampToValueAtTime(46, peak);
	depth.gain.setValueAtTime(0.22, start);
	depth.gain.linearRampToValueAtTime(0.05, peak);
	wobble.connect(depth);
	depth.connect(body.gain);
	lp.connect(body);
	body.connect(track);
	for (const [type, scale, vol] of [['sawtooth', 1, 0.5], ['sine', 1, 0.8]]) {
		const o = ctx.createOscillator(), g = ctx.createGain();
		o.type = type;
		g.gain.value = vol;
		o.frequency.setValueAtTime(SLIDE.from * scale, start);
		o.frequency.exponentialRampToValueAtTime(SLIDE.to * scale, peak);
		o.frequency.exponentialRampToValueAtTime(SLIDE.settle * scale, end);
		o.connect(g);
		g.connect(lp);
		o.start(start);
		o.stop(end + 0.02);
	}
	wobble.start(start);
	wobble.stop(end + 0.02);

	BANK.forEach((f, n) => blip(0.4 + n * 0.1, f, 0.075, 0.5));
	TRILL.forEach((f, n) => blip(0.72 + n * 0.04, f, 0.034, 0.16, 'sine'));
	// The record count: ticks that close up and climb as the number spins (1.05 s for .6 s).
	for (let n = 0, t = 1.05, gap = 0.075; t < 1.62; n++, t += gap, gap = Math.max(0.028, gap * 0.9)) blip(t, 900 + n * 60, 0.018, 0.22, 'square');
	for (const [t, f, len] of NOMINAL) blip(t, f, len, 0.6);

	return {
		// The overlay leaves: cut whatever is left and sweep down with the handover.
		close() {
			const now = ctx.currentTime;
			track.gain.setTargetAtTime(0, now, 0.03);
			const o = ctx.createOscillator(), g = ctx.createGain();
			o.type = 'sine';
			o.frequency.setValueAtTime(1500, now);
			o.frequency.exponentialRampToValueAtTime(170, now + 0.5);
			g.gain.setValueAtTime(0.0001, now);
			g.gain.exponentialRampToValueAtTime(0.5, now + 0.03);
			g.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
			o.connect(g);
			g.connect(master);
			o.start(now);
			o.stop(now + 0.57);
		},
	};
}
