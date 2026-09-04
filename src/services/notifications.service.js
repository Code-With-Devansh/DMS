import { notFound } from "../lib/errors.js";
import * as repository from "../repositories/notifications.repository.js";

export async function listNotifications(userId, pagination) {
  const { items, total } = await repository.listForUser(userId, pagination);
  return {
    items,
    page: pagination.page,
    pageSize: pagination.pageSize,
    total,
    totalPages: Math.ceil(total / pagination.pageSize),
  };
}

export async function markNotificationRead(userId, notificationId) {
  const notification = await repository.markRead(userId, notificationId);
  if (!notification) throw notFound("notification not found");
}

export async function markAllNotificationsRead(userId) {
  await repository.markAllRead(userId);
}