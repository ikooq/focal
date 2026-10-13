// Locally synthesized sounds. No network audio and no claims of clinical effects.
export async function createFocusAudio() {
  const ctx = new AudioContext();
  await ctx.resume();
  let nodes: AudioScheduledSourceNode[] = [],
    interval: ReturnType<typeof setInterval> | undefined;
  const master = ctx.createGain();
  master.gain.value = 0.055;
  master.connect(ctx.destination);
  const stop = () => {
    nodes.forEach((n) => {
      try {
        n.stop();
        n.disconnect();
      } catch {}
    });
    nodes = [];
    if (interval) clearInterval(interval);
    interval = undefined;
  };
  const tone = (frequency: number, pan: number) => {
    const oscillator = ctx.createOscillator();
    const stereo = ctx.createStereoPanner();
    stereo.pan.value = pan;
    oscillator.frequency.value = frequency;
    oscillator.connect(stereo).connect(master);
    oscillator.start();
    nodes.push(oscillator);
    return oscillator;
  };
  return {
    set(type: string, enabled: boolean) {
      stop();
      if (!enabled || type === 'none') return;
      if (type === 'binaural') {
        tone(180, -1);
        tone(190, 1);
      }
      if (type === 'isochronic') {
        const o = ctx.createOscillator(),
          amp = ctx.createGain(),
          lfo = ctx.createOscillator(),
          depth = ctx.createGain();
        o.frequency.value = 180;
        amp.gain.value = 0.5;
        lfo.frequency.value = 10;
        depth.gain.value = 0.45;
        lfo.connect(depth).connect(amp.gain);
        o.connect(amp).connect(master);
        o.start();
        lfo.start();
        nodes.push(o, lfo);
      }
      if (type === 'baroque') {
        const melody = [
          261.63, 329.63, 392, 523.25, 493.88, 392, 329.63, 293.66, 246.94,
          293.66, 392, 493.88, 440, 349.23, 293.66, 261.63,
        ];
        let n = 0;
        const play = () => {
          const o = ctx.createOscillator(),
            g = ctx.createGain();
          o.type = 'triangle';
          o.frequency.value = melody[n++ % melody.length];
          g.gain.setValueAtTime(0.001, ctx.currentTime);
          g.gain.exponentialRampToValueAtTime(0.6, ctx.currentTime + 0.015);
          g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
          o.connect(g).connect(master);
          o.start();
          nodes.push(o);
          o.stop(ctx.currentTime + 0.75);
          o.onended = () => {
            nodes = nodes.filter((n) => n !== o);
            o.disconnect();
            g.disconnect();
          };
        };
        play();
        interval = setInterval(play, 500);
      }
    },
    close: () => {
      stop();
      void ctx.close();
    },
  };
}
