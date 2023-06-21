export class ValidationError extends Error {
  constructor(message?: string) {
    super(message);
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class OpenAPIVersionError extends Error {
  public type: 'oas-version-error';
  public version: '2.x.x' | undefined;

  constructor(message?: string, version?: '2.x.x') {
    super(message);
    this.type = 'oas-version-error';
    this.version = version;

    Object.setPrototypeOf(this, ValidationError.prototype);
  }

  static isInstance(v: any): v is OpenAPIVersionError {
    return v?.type === 'oas-version-error';
  }
}
