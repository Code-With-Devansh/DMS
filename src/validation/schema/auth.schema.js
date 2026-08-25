import {z} from "zod";

export const loginSchema = z.object({
    username: z.string().trim().min(1, "username is required"),
    password: z.string().min(1, "password is required"),
});

export const mfaCodeSchema = z.object({
    code: z
        .string()
        .trim()
        .regex(/^\d{6}$/, "code must be a 6-digit string"),
});
