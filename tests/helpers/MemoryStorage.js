// Isolated test double; never use for production storage.
export class MemoryStorage {
  constructor() { this.objects = new Map(); }
  async put(key, bytes) { this.objects.set(key, Buffer.from(bytes)); }
  async head(key) { const body = this.objects.get(key); if (!body) throw new Error("Not found"); return { ContentLength: body.length }; }
  async get(key) { const body = this.objects.get(key); if (!body) throw new Error("Not found"); return { Body: Buffer.from(body) }; }
  async delete(key) { this.objects.delete(key); }
}
