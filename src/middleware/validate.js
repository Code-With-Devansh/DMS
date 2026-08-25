// middleware/validate.js
export const validate = (schema) => (req, res, next) => {
    console.log(req.body);
    const result = schema.safeParse(req.body);
    console.log(result);

    if (!result.success) {
        // Return structured errors back to the client
        return res.status(400).json({
            status: 'fail',
            errors: result.error.errors.map(err => ({
                field: err.path.join('.'),
                message: err.message
            }))
        });
    }

    // Assign the stripped/parsed data back to req to safely strip unmapped fields
    req.body = result.data;
    next();
};
