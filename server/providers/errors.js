export class ProviderError extends Error {
  /**
   * @param {'rate_limited'|'unauthorized'|'not_entitled'|'not_found'|'http'|'network'|'bad_data'} code
   */
  constructor(code, message, { status, source } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.source = source;
  }
}
