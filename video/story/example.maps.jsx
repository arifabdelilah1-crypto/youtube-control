// A talking-maps film (the "atlas" look): two countries as characters on a real map. 9:16.
// Narration (one line per entry):
// 0 "Morocco and Algeria share a border of about 1,500 kilometres."
// 1 "Yet that border has been closed since 1994."
// 2 "Morocco says the Sahara is its southern provinces."
// 3 "Algeria backs the Polisario Front, which wants independence."
// 4 "In 2021, Algeria cut diplomatic ties with Morocco."
// 5 "Families on both sides still wave across the fence."
// 6 "Could football or trade one day open the border?"
function Film({ f }) {
  const both = ["MA", "DZ"];
  const MA = T.cast[0], DZ = T.cast[1];
  // one framing of the map, shared by the MapView and the Country characters standing on it
  const view = { W, H, focus: both, pad: 0.2 };
  const say = (who, a, b) => (f >= a && f <= b ? 1 : 0);
  return (
    <Shots f={f} W={W} H={H} shots={[
      // the real map: both countries light up as they are named
      { at: 0, zoom: [1.0, 1.08], focus: [W / 2, H * 0.45], render: () => (
        <>
          <MapView {...view} highlight={{ MA: f >= cue("Morocco") ? MA : T.land, DZ: f >= cue("Algeria") ? DZ : T.land }} dim={0.5}
            labels={{ MA: "Morocco", DZ: "Algeria" }} />
          <Glow x={W / 2} y={H * 0.45} r={W * 0.6} color={T.glow} power={0.25} />
        </>
      ) },
      // the closed border: the two characters face each other, a gate drops between them
      { at: cue("closed"), zoom: [1.05, 1.15], focus: [W / 2, H * 0.5], render: () => (
        <>
          <rect x={0} y={0} width={W} height={H} fill={T.sea} />
          <Country c="MA" x={W * 0.3} y={H * 0.48} size={W * 0.42} color={MA} f={f} mood="worried" lookX={1} />
          <Country c="DZ" x={W * 0.72} y={H * 0.48} size={W * 0.42} color={DZ} f={f} mood="angry" lookX={-1} />
          <rect x={W * 0.5 - 8} y={lerp(-H * 0.4, H * 0.28, eout(ramp(f, cue("closed"), cue("closed") + 12)))} width={16} height={H * 0.4} fill={T.metal} stroke={T.ink} strokeWidth={T.line} />
          <Impact x={W * 0.5} y={H * 0.6} f={f} at={cue("closed") + 12} r={120} />
        </>
      ) },
      // each side's position: the country that "speaks" talks and hops, the other listens
      { at: cue("Morocco says"), zoom: [1.1, 1.2], focus: [W * 0.35, H * 0.5], render: () => (
        <>
          <MapView W={W} H={H} focus={["MA"]} pad={0.6} dim={0.7} />
          <Country c="MA" map={{ W, H, focus: ["MA"], pad: 0.6 }} color={MA} f={f} mood="happy" talk={say("MA", cue("Morocco says"), cueEnd("provinces"))} hop={pop(f, cue("Sahara"), 12) * 0.6} />
        </>
      ) },
      { at: cue("Algeria backs"), zoom: [1.1, 1.2], focus: [W * 0.6, H * 0.5], render: () => (
        <>
          <MapView W={W} H={H} focus={["DZ"]} pad={0.6} dim={0.7} />
          <Country c="DZ" map={{ W, H, focus: ["DZ"], pad: 0.6 }} color={DZ} f={f} mood="sly" talk={say("DZ", cue("Algeria backs"), cueEnd("independence"))} />
        </>
      ) },
      // 2021: they turn their backs (lookX away), a phone line snaps
      { at: cue("2021"), zoom: [1.0, 1.1], focus: [W / 2, H * 0.5], shake: [cue("cut"), 10], render: () => (
        <>
          <rect x={0} y={0} width={W} height={H} fill={T.sea} />
          <Country c="MA" x={W * 0.28} y={H * 0.5} size={W * 0.38} color={MA} f={f} mood="sad" lookX={-1} />
          <Country c="DZ" x={W * 0.74} y={H * 0.5} size={W * 0.38} color={DZ} f={f} mood="angry" lookX={1} />
          <path d={`M ${W * 0.4} ${H * 0.42} Q ${W / 2} ${H * (0.36 + 0.1 * ramp(f, cue("cut"), cue("cut") + 8))} ${W * 0.6} ${H * 0.42}`} fill="none" stroke={T.ink} strokeWidth={T.line} strokeDasharray={f >= cue("cut") ? "30 26" : "none"} />
        </>
      ) },
      // the people: small figures on both sides of a fence, waving
      { at: cue("Families"), zoom: [1.05, 1.12], focus: [W / 2, H * 0.6], render: () => (
        <>
          <Outside W={W} H={H} horizon={H * 0.66} time="dusk" hills f={f} seed="b" />
          <rect x={W / 2 - 6} y={H * 0.5} width={12} height={H * 0.16} fill={T.metal} />
          <Figure x={W * 0.3} y={H * 0.66} s={1.3} coat={MA} pose="wave" f={f} seed="m" mood="happy" />
          <Figure x={W * 0.7} y={H * 0.66} s={1.3} facing={-1} coat={DZ} pose="wave" f={f} seed="d" mood="happy" />
        </>
      ) },
      // the question: back on the map, both lit, the border line pulsing
      { at: cue("Could"), zoom: [1.0, 1.06], focus: [W / 2, H * 0.45], render: () => (
        <>
          <MapView {...view} highlight={{ MA, DZ }} />
          <Country c="MA" map={view} color={MA} f={f} mood="surprised" lookX={1} talk={ramp(f, cue("Could"), cue("Could") + 8)} />
          <Country c="DZ" map={view} color={DZ} f={f} mood="surprised" lookX={-1} />
        </>
      ) },
    ]} />
  );
}
