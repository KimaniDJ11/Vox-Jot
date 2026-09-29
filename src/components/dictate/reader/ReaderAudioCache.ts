import type { ReaderUnitAudio } from "./useReaderPlayback";

/** Owns synthesized blob URLs and in-flight loads for one Reader session. */
export class ReaderAudioCache {
  private readonly values = new Map<string, ReaderUnitAudio>();
  private readonly pending = new Map<string, Promise<ReaderUnitAudio>>();
  private generation = 0;

  constructor(
    private readonly capacity = 16,
    private readonly revoke: (url: string) => void = (url) =>
      URL.revokeObjectURL(url),
  ) {
    if (!Number.isInteger(capacity) || capacity < 1)
      throw new Error("Reader cache capacity must be positive.");
  }

  load(
    key: string,
    render: () => Promise<ReaderUnitAudio>,
  ): Promise<ReaderUnitAudio> {
    const cached = this.values.get(key);
    if (cached) return Promise.resolve(cached);
    const pending = this.pending.get(key);
    if (pending) return pending;

    const generation = this.generation;
    const request = this.render(key, generation, render);
    this.pending.set(key, request);
    const finish = () => {
      if (this.pending.get(key) === request) this.pending.delete(key);
    };
    void request.then(finish, finish);
    return request;
  }

  private async render(
    key: string,
    generation: number,
    render: () => Promise<ReaderUnitAudio>,
  ) {
    const value = await render();
    if (generation !== this.generation) {
      this.revoke(value.src);
      throw new Error("Reader document changed while loading audio.");
    }
    this.values.set(key, value);
    if (this.values.size > this.capacity) {
      const oldest = this.values.entries().next().value;
      if (oldest) {
        this.values.delete(oldest[0]);
        this.revoke(oldest[1].src);
      }
    }
    return value;
  }

  clear(): void {
    this.generation += 1;
    for (const value of this.values.values()) this.revoke(value.src);
    this.values.clear();
    this.pending.clear();
  }
}
