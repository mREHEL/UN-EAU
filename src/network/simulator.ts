/** Deterministic in-memory network used to exercise latency, packet loss and partitions. */
export class DeterministicNetwork<T> {
  private clock = 0
  private sequence = 0
  private readonly queue: Array<{ at: number; sequence: number; from: string; to: string; payload: T }> = []
  private readonly handlers = new Map<string, (from: string, payload: T) => void>()
  private readonly blocked = new Set<string>()
  private readonly droppedSequences = new Set<number>()

  connect(id: string, handler: (from: string, payload: T) => void): void {
    this.handlers.set(id, handler)
  }

  disconnect(id: string): void { this.handlers.delete(id) }

  partition(left: string, right: string): void {
    this.blocked.add(edge(left, right))
    this.blocked.add(edge(right, left))
  }

  heal(left: string, right: string): void {
    this.blocked.delete(edge(left, right))
    this.blocked.delete(edge(right, left))
  }

  drop(sequence: number): void { this.droppedSequences.add(sequence) }

  send(from: string, to: string, payload: T, delayMs = 0): number {
    this.sequence += 1
    this.queue.push({ at: this.clock + delayMs, sequence: this.sequence, from, to, payload })
    return this.sequence
  }

  advance(milliseconds: number): void {
    this.clock += milliseconds
    this.queue.sort((left, right) => left.at - right.at || left.sequence - right.sequence)
    const ready = this.queue.filter((message) => message.at <= this.clock)
    this.queue.splice(0, ready.length)
    for (const message of ready) {
      if (this.droppedSequences.delete(message.sequence) || this.blocked.has(edge(message.from, message.to))) continue
      this.handlers.get(message.to)?.(message.from, message.payload)
    }
  }
}

function edge(left: string, right: string): string { return `${left}\0${right}` }
