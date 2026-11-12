export class MediaClientError extends Error {
  constructor(message, statusCode) { super(message); this.statusCode = statusCode; }
}
