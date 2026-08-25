// API error envelope per DESIGN §13: { error: { code, message, details? } }.
// Throw these from services/controllers; Express 5 forwards rejected promises to
// the error handler (middlewares/error.js), which serializes them.
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) =>
  new ApiError(400, "VALIDATION", message, details);
export const forbidden = (message = "forbidden") =>
  new ApiError(403, "FORBIDDEN", message);
export const notFound = (message = "resource not found") =>
  new ApiError(404, "NOT_FOUND", message);
export const conflict = (message, code = "CONFLICT") =>
  new ApiError(409, code, message);

export const invalidCredentials = (message = "Invalid username or password", code= "VALIDATION") =>
    new ApiError(401, code, message);

export const unauthenticated = (message = "unauthenticated") =>
    new ApiError(401, "UNAUTHORIZED", message);