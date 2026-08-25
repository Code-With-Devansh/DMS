export function apiError(res, statusCode, message) {
    return res.send(
        {
            "status" : statusCode,
            "message" : message
        }
    )
}