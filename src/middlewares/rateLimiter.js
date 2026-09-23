import redisClient from '../config/redis.js';

/**
 * Rate limiter middleware to limit the number of requests from a single IP address.
 * This middleware uses Redis to track the number of requests made by each IP address
 * within a specified time window. If the number of requests exceeds the allowed limit,
 * it responds with a 429 status code (Too Many Requests).
 * 
 * @param {Object} req - The request object.
 * @param {Object} res - The response object.
 * @param {Function} next - The next middleware function.
 */
export async function rateLimiter(req, res, next) {
    const ipAddress = req.ip;
    const windowSizeInHours = 1;
    const windowSizeInMillis = windowSizeInHours * 60 * 60 * 1000;
    const maxRequestsPerWindow = 20;

    try {
        const requests = await redisClient.get(ipAddress);
        if (!requests) {
            await redisClient.set(ipAddress, 1, 'PX', {
                "EX": windowSizeInMillis
            });
            return next();
        }   

        const requestCount = parseInt(requests, 10);
        console.log(`Request count for IP ${ipAddress}: ${requestCount}`);
        if (requestCount >= maxRequestsPerWindow) {
            return res.status(429).json({ message: 'Too many requests. Please try again later.' });
        }
        await redisClient.incr(ipAddress);
        return next();
    } catch (error) {
        console.error('Error in rate limiter:', error);
        return res.status(500).json({ message: 'Internal server error.' });
    }

}