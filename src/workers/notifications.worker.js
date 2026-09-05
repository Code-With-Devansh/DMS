import { Worker } from 'bullmq';
import * as notificationService from '../services/notifications.service.js';
import { connection } from "../jobs/connection.js";

export const mentionNotificationWorker = new Worker("mention-notifications", async (job) => {
    console.log(`Processing mention notification job: ${job.id}`);
    console.log(`Job data: ${JSON.stringify(job.data)}`);
    const { commentId, caseId, mentionedUserId, authorId } = job.data;
    return notificationService.sendMentionNotification({ commentId, caseId, mentionedUserId, authorId });

}, {
    connection,
    concurrency: 4, // Adjust concurrency as needed
});


mentionNotificationWorker.on('completed', (job) => {
  console.log(`Job ${job.id} completed!`);
});

mentionNotificationWorker.on('failed', (job, error) => {
  console.error(`Mention notification job ${job?.id ?? "unknown"} failed:`, error);
});

mentionNotificationWorker.on('error', (error) => {
  console.error("Mention notification worker error:", error);
});
