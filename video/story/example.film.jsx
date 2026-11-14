// Example film for the Story stick kit ("The Wallet"), written by hand. Claude gets it as a model of the code it writes.
// Narration (one line per scene):
//   0 You find a wallet on the sidewalk.
//   1 Inside... five hundred dollars. And an ID.
//   2 Nobody is watching.
//   3 Scientists dropped seventeen thousand wallets in forty countries.
//   4 The wallets with more money came back more often.
//   5 So... would you return it?
function Film({ f }) {
  const portrait = H > W;
  const ground = portrait ? H * 0.7 : H * 0.8;   // where feet stand
  const heroX = portrait ? W * 0.32 : W * 0.3;
  const S = portrait ? 1.55 : 1.2;               // figure size: big, the characters carry the story
  const hero = T.cast[0];

  // key moments, on the words
  const find = cue("wallet");
  const open = cue("inside");
  const cash = cue("five hundred");
  const nobody = cue("nobody");
  const sci = cue("scientists");
  const back = cue("came back");
  const ask = cue("would you");

  const street = (lf, extra) => (
    <>
      <Outside W={W} H={H} horizon={ground} time="night" f={f} seed="st" />
      <Spot x={W * 0.62} top={ground - (portrait ? 900 : 700)} bottom={ground + 20} w={portrait ? 700 : 900} />
      <Air W={W} H={H} f={f} kind="dust" n={40} />
      {extra}
    </>
  );
  const wallet = (x, y, s, openK = 0) => (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x={-70} y={-40} width={140} height={80} rx={12} fill={T.wood} stroke={T.ink} strokeWidth={T.line} />
      <g transform={`translate(-70 -40) rotate(${-openK * 120})`}><rect x={0} y={-10} width={140} height={20} rx={6} fill={mix(T.wood, "#ffffff", 0.2)} stroke={T.ink} strokeWidth={T.line} /></g>
    </g>
  );

  const shots = [
    // 0: wide street, the hero walks in and stops: a wallet on the ground
    { at: 0, zoom: [1, 1.06], focus: [W * 0.5, ground - 200], render: (lf) => street(lf, <>
      {wallet(W * 0.62, ground - 10, 0.9)}
      <Glow x={W * 0.62} y={ground - 20} r={120} power={0.6 + wave(f, 0.15, 0.3)} />
      <Figure x={keys(f, [[0, -200], [find - 10, heroX]])} y={ground} s={S} coat={hero} pose={f < find - 10 ? "walk" : "stand"} f={f} mood={f < find ? "neutral" : "surprised"} lookX={f >= find ? 1 : 0} hat="cap" />
    </>) },
    // 1: close on the wallet opening: the cash, the ID
    { at: open - 6, zoom: [1.15, 1.3], focus: [W * 0.5, H * 0.5], hand: 0.6, render: (lf) => (<>
      <rect x={0} y={0} width={W} height={H} fill={T.floor2} />
      <Glow x={W / 2} y={H / 2} r={portrait ? 600 : 500} />
      {wallet(W / 2, H / 2 + 60, 3, ramp(f, open, open + 12))}
      <g opacity={ramp(f, cash, cash + 6)}><Cash x={W / 2 - 40} y={H / 2 - 80 - 40 * pop(f, cash)} s={1.4} n={4} rot={-6} /></g>
      <g opacity={ramp(f, cue("ID"), cue("ID") + 6)}><Sign x={W / 2 + 160} y={H / 2 - 160} text="ID" size={56} rot={8} /></g>
    </>) },
    // 2: the hero looks around, nobody there (a slow push, eyes left, right)
    { at: nobody - 4, zoom: [1.05, 1.18], focus: [heroX, ground - 330 * S], render: (lf) => street(lf, <>
      <Figure x={heroX} y={ground} s={S} coat={hero} pose="hold" f={f} mood="sly" lookX={wave(f, 0.12, 1)} hat="cap" holding={wallet(0, 0, 0.5)} />
    </>) },
    // 3: the experiment acted out: a row of wallets dropping on a map of lights
    { at: sci - 4, zoom: [1, 1.05], focus: [W / 2, H / 2], dip: true, render: (lf) => (<>
      <Stage W={W} H={H} horizon={ground} x={W / 2} />
      {Array.from({ length: portrait ? 12 : 18 }, (_, i) => {
        const cols = portrait ? 4 : 6, cx = (i % cols + 0.5) * (W / cols), cy = H * (portrait ? 0.3 : 0.25) + Math.floor(i / cols) * (portrait ? 260 : 200);
        const t0 = sci + 6 + i * 3;
        return <g key={i} opacity={ramp(f, t0, t0 + 4)}>{wallet(cx, cy - 80 * (1 - eout(ramp(f, t0, t0 + 10))), 0.8)}</g>;
      })}
      <Figure x={W * 0.15} y={ground} s={S * 0.9} coat={T.cast[1]} pose="point" f={f} mood="neutral" hat="top" />
    </>) },
    // 4: more money, more returned: the full wallets fly back to their owners' hands
    { at: back - 10, zoom: [1.02, 1.1], focus: [W / 2, ground - 300], render: (lf) => street(lf, <>
      <Figure x={W * 0.75} y={ground} s={S} coat={T.cast[2]} pose={f > back + 8 ? "cheer" : "reach"} facing={-1} f={f} mood={f > back + 8 ? "happy" : "worried"} />
      <g transform={`translate(${lerp(heroX + 120, W * 0.68, eio(ramp(f, back, back + 18)))} ${ground - 260 - 120 * Math.sin(Math.PI * ramp(f, back, back + 18))})`}>{wallet(0, 0, 0.8)}<Cash x={0} y={-50} s={0.5} n={3} /></g>
      <Figure x={heroX} y={ground} s={S} coat={hero} pose="point" f={f} mood="happy" hat="cap" />
    </>) },
    // 5: hold on the hero holding the wallet: the question
    { at: ask - 6, zoom: [1.1, 1.22], focus: [heroX + 60, ground - 300 * S], hand: 0.25, render: (lf) => street(lf, <>
      <Figure x={heroX + 60} y={ground} s={S * 1.1} coat={hero} pose="hold" f={f} mood="worried" hat="cap" lookX={-0.3} holding={wallet(0, 0, 0.5)} />
      <Bubble x={heroX + 360} y={ground - 640 * S} s={portrait ? 0.9 : 0.8} tail={-1}><Symbol kind="question" s={1.1} /></Bubble>
    </>) },
  ];
  return <Shots f={f} shots={shots} W={W} H={H} />;
}
