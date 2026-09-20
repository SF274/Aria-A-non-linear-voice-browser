/**
 * A recording `AudioContext` for the audio tests.
 *
 * Web Audio schedules sound into the future and produces no observable value at
 * the time you call it, so the only thing a test can assert on is what was
 * scheduled: which nodes were made, how they were wired, and every automation
 * call with the time it was given. This records exactly that.
 *
 * It is deliberately not a simulator. It does not render audio and it does not
 * validate the graph beyond what SPEC 9.3 and 9.5 require the engine to do.
 */

export interface ParamCall {
  method: "setValueAtTime" | "linearRampToValueAtTime" | "exponentialRampToValueAtTime";
  value: number;
  time: number;
}

export class FakeParam {
  value = 0;
  readonly calls: ParamCall[] = [];

  setValueAtTime(value: number, time: number): this {
    this.value = value;
    this.calls.push({ method: "setValueAtTime", value, time });
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.value = value;
    this.calls.push({ method: "linearRampToValueAtTime", value, time });
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    if (value === 0) {
      // The real API throws here. SPEC 9.3 exists because of it, so the fake
      // must be just as unforgiving or the rule is untested.
      throw new RangeError("exponentialRampToValueAtTime: value must not be 0");
    }
    this.value = value;
    this.calls.push({ method: "exponentialRampToValueAtTime", value, time });
    return this;
  }

  cancelScheduledValues(): this {
    return this;
  }

  /** Every value passed to the given method, in call order. */
  valuesFor(method: ParamCall["method"]): number[] {
    return this.calls.filter((c) => c.method === method).map((c) => c.value);
  }
}

export class FakeNode {
  readonly connectedTo: FakeNode[] = [];
  connect(target: FakeNode): FakeNode {
    this.connectedTo.push(target);
    return target;
  }
  disconnect(): void {
    this.connectedTo.length = 0;
  }
}

export class FakeOscillator extends FakeNode {
  type: OscillatorType = "sine";
  readonly frequency = new FakeParam();
  readonly detune = new FakeParam();
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  onended: (() => void) | null = null;

  start(time: number): void {
    this.startedAt = time;
  }
  stop(time: number): void {
    this.stoppedAt = time;
  }
}

export class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
}

export class FakePanner extends FakeNode {
  readonly pan = new FakeParam();
}

export class FakeFilter extends FakeNode {
  type: BiquadFilterType = "lowpass";
  readonly frequency = new FakeParam();
  readonly Q = new FakeParam();
}

export class FakeCompressor extends FakeNode {
  readonly threshold = new FakeParam();
  readonly knee = new FakeParam();
  readonly ratio = new FakeParam();
  readonly attack = new FakeParam();
  readonly release = new FakeParam();
}

export class FakeAudioContext {
  state: AudioContextState = "running";
  currentTime = 10; // Not 0: a test that assumes t0 is 0 would pass by accident.
  readonly destination = new FakeNode();

  readonly oscillators: FakeOscillator[] = [];
  readonly gains: FakeGain[] = [];
  readonly panners: FakePanner[] = [];
  readonly filters: FakeFilter[] = [];
  readonly compressors: FakeCompressor[] = [];

  createOscillator(): FakeOscillator {
    const node = new FakeOscillator();
    this.oscillators.push(node);
    return node;
  }
  createGain(): FakeGain {
    const node = new FakeGain();
    this.gains.push(node);
    return node;
  }
  createStereoPanner(): FakePanner {
    const node = new FakePanner();
    this.panners.push(node);
    return node;
  }
  createBiquadFilter(): FakeFilter {
    const node = new FakeFilter();
    this.filters.push(node);
    return node;
  }
  createDynamicsCompressor(): FakeCompressor {
    const node = new FakeCompressor();
    this.compressors.push(node);
    return node;
  }
  async resume(): Promise<void> {
    this.state = "running";
  }
  async close(): Promise<void> {
    this.state = "closed";
  }
}

/**
 * Install a fake as the global `AudioContext`. Returns the single instance the
 * engine will construct, so a test can read what was scheduled on it.
 */
export function installFakeAudioContext(
  stubGlobal: (name: string, value: unknown) => void
): FakeAudioContext {
  const instance = new FakeAudioContext();
  stubGlobal("AudioContext", function AudioContextStub(this: unknown) {
    return instance;
  } as unknown as typeof AudioContext);
  return instance;
}
